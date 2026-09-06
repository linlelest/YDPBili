// Copyright (C) 2025 Bilibili miniapp contributors
//
// This file is part of miniapp.
//
// miniapp is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// miniapp is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with miniapp.  If not, see <https://www.gnu.org/licenses/>.

#include "Media.hpp"
#include "AudioSink.hpp"
#include "../Fetch.hpp"
#include "../Exceptions/NetworkError.hpp"

#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstring>
#include <fstream>
#include <functional>
#include <memory>
#include <mutex>
#include <sstream>
#include <thread>
#include <vector>

#ifdef HAVE_FFMPEG
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
#include <libavutil/imgutils.h>
#include <libavutil/opt.h>
#include <libswresample/swresample.h>
#include <libswscale/swscale.h>
}
#endif

namespace media
{

    static const char *BASE64_CHARS =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    static std::string base64Encode(const unsigned char *data, size_t size)
    {
        std::string out;
        out.reserve(((size + 2) / 3) * 4);
        size_t i = 0;
        while (i + 2 < size)
        {
            uint32_t v = ((uint32_t)data[i] << 16) | ((uint32_t)data[i + 1] << 8) | data[i + 2];
            out += BASE64_CHARS[(v >> 18) & 0x3F];
            out += BASE64_CHARS[(v >> 12) & 0x3F];
            out += BASE64_CHARS[(v >> 6) & 0x3F];
            out += BASE64_CHARS[v & 0x3F];
            i += 3;
        }
        if (i + 1 == size)
        {
            uint32_t v = (uint32_t)data[i] << 16;
            out += BASE64_CHARS[(v >> 18) & 0x3F];
            out += BASE64_CHARS[(v >> 12) & 0x3F];
            out += "==";
        }
        else if (i + 2 == size)
        {
            uint32_t v = ((uint32_t)data[i] << 16) | ((uint32_t)data[i + 1] << 8);
            out += BASE64_CHARS[(v >> 18) & 0x3F];
            out += BASE64_CHARS[(v >> 12) & 0x3F];
            out += BASE64_CHARS[(v >> 6) & 0x3F];
            out += "=";
        }
        return out;
    }

#ifdef HAVE_FFMPEG

    struct InputStream
    {
        AVFormatContext *fmt = nullptr;
        AVCodecContext *dec = nullptr;
        int streamIndex = -1;
        bool opened = false;
    };

    class Media::Impl
    {
    public:
        Impl() = default;
        ~Impl() { stop(); }

        FrameCallback frameCallback;
        EndCallback endCallback;
        ErrorCallback errorCallback;
        ProgressCallback downloadProgressCallback;

        void open(const std::string &audioUrl, const std::string &videoUrl,
                  const std::string &cacheDir)
        {
            stop();
            std::lock_guard<std::mutex> lock(stateMutex);
            audioPath = downloadToCache(audioUrl, cacheDir, "audio");
            videoPath = downloadToCache(videoUrl, cacheDir, "video");
            if (audioPath.empty() && videoPath.empty())
                throw std::runtime_error("Media::open: no input provided");

            durationMs = 0;
            positionMs = 0;
            rate = 1.0;
            paused = false;
            active = true;
            playing = false;
            seekTargetMs = -1;

            if (!audioPath.empty())
            {
                audioThread = std::thread(&Impl::audioLoop, this);
                audioThreadStarted = true;
            }
            if (!videoPath.empty())
            {
                videoThread = std::thread(&Impl::videoLoop, this);
                videoThreadStarted = true;
            }
        }

        void play()
        {
            std::lock_guard<std::mutex> lock(stateMutex);
            playing = true;
            paused = false;
            playCond.notify_all();
        }

        void pause()
        {
            std::lock_guard<std::mutex> lock(stateMutex);
            paused = true;
        }

        void resume()
        {
            std::lock_guard<std::mutex> lock(stateMutex);
            paused = false;
            playCond.notify_all();
        }

        void seek(double positionMsValue)
        {
            std::lock_guard<std::mutex> lock(stateMutex);
            seekTargetMs = positionMsValue;
            seekPendingAudio = true;
            seekPendingVideo = true;
            playCond.notify_all();
        }

        void setRate(double value)
        {
            if (value < 0.25)
                value = 0.25;
            if (value > 4.0)
                value = 4.0;
            std::lock_guard<std::mutex> lock(stateMutex);
            rate = value;
        }

        PlaybackState getProgress()
        {
            std::lock_guard<std::mutex> lock(stateMutex);
            PlaybackState s;
            s.durationMs = durationMs;
            s.positionMs = positionMs;
            s.playing = playing;
            s.paused = paused;
            s.rate = rate;
            return s;
        }

        void stop()
        {
            active = false;
            playCond.notify_all();
            if (audioThreadStarted && audioThread.joinable())
                audioThread.join();
            if (videoThreadStarted && videoThread.joinable())
                videoThread.join();
            audioThreadStarted = false;
            videoThreadStarted = false;
            closeStream(audioStream);
            closeStream(videoStream);
            {
                std::lock_guard<std::mutex> lock(stateMutex);
                playing = false;
                paused = false;
                positionMs = 0;
            }
        }

    private:
        InputStream audioStream;
        InputStream videoStream;
        std::unique_ptr<AudioSink> sink;
        std::mutex sinkMutex;

        std::thread audioThread;
        std::thread videoThread;
        bool audioThreadStarted = false;
        bool videoThreadStarted = false;

        std::mutex stateMutex;
        std::condition_variable playCond;
        std::atomic<bool> active{false};
        bool playing = false;
        bool paused = false;
        double durationMs = 0;
        double positionMs = 0;
        double rate = 1.0;
        double seekTargetMs = -1;

        std::string audioPath;
        std::string videoPath;
        bool seekPendingAudio = false;
        bool seekPendingVideo = false;

        std::string downloadToCache(const std::string &url, const std::string &cacheDir,
                                    const std::string &tag)
        {
            if (url.empty())
                return "";
            size_t hash = std::hash<std::string>{}(url);
            std::ostringstream nameStream;
            nameStream << cacheDir << "/bili_" << tag << "_" << std::hex << hash << ".m4s";
            std::string path = nameStream.str();

            std::ofstream out(path, std::ios::binary | std::ios::trunc);
            if (!out.is_open())
                throw std::runtime_error("Media::open: cannot write cache file " + path);

            FetchOptions options("GET", {}, "", false, nullptr, 0);
            options.rawStream = true;
            options.rawStreamCallback = [&out, this](const unsigned char *data, size_t size)
            {
                out.write((const char *)data, (std::streamsize)size);
                if (downloadProgressCallback)
                    downloadProgressCallback((double)out.tellp(), 0);
            };
            Response response = Fetch::fetch(url, options);
            out.close();
            if (!response.isOk())
            {
                std::remove(path.c_str());
                throw std::runtime_error("Media::open: download failed with HTTP " +
                                         std::to_string(response.status));
            }
            return path;
        }

        static void closeStream(InputStream &stream)
        {
            if (stream.dec)
            {
                avcodec_free_context(&stream.dec);
                stream.dec = nullptr;
            }
            if (stream.fmt)
            {
                avformat_close_input(&stream.fmt);
                stream.fmt = nullptr;
            }
            stream.streamIndex = -1;
            stream.opened = false;
        }

        static bool openInput(InputStream &stream, const std::string &path,
                              AVMediaType mediaType)
        {
            if (avformat_open_input(&stream.fmt, path.c_str(), nullptr, nullptr) < 0)
                return false;
            if (avformat_find_stream_info(stream.fmt, nullptr) < 0)
                return false;
            stream.streamIndex = av_find_best_stream(stream.fmt, mediaType, -1, -1, nullptr, 0);
            if (stream.streamIndex < 0)
                return false;
            AVStream *st = stream.fmt->streams[stream.streamIndex];
            const AVCodec *codec = avcodec_find_decoder(st->codecpar->codec_id);
            if (codec == nullptr)
                return false;
            stream.dec = avcodec_alloc_context3(codec);
            if (stream.dec == nullptr)
                return false;
            if (avcodec_parameters_to_context(stream.dec, st->codecpar) < 0)
                return false;
            stream.dec->thread_count = 1;
            if (avcodec_open2(stream.dec, codec, nullptr) < 0)
                return false;
            stream.opened = true;
            return true;
        }

        static double streamTimeBaseMs(AVStream *st)
        {
            return 1000.0 * av_q2d(st->time_base);
        }

        void waitWhilePaused()
        {
            std::unique_lock<std::mutex> lock(stateMutex);
            playCond.wait(lock, [this]
                          { return !paused || !active; });
        }

        bool handleSeekRequest(InputStream &stream, bool isAudio, std::mutex &streamMutex)
        {
            double target = -1;
            bool pending = false;
            {
                std::lock_guard<std::mutex> lock(stateMutex);
                pending = isAudio ? seekPendingAudio : seekPendingVideo;
                target = seekTargetMs;
            }
            if (!pending || target < 0)
                return false;
            {
                std::lock_guard<std::mutex> lock(streamMutex);
                if (stream.fmt && stream.streamIndex >= 0)
                {
                    int64_t ts = (int64_t)(target / 1000.0 / av_q2d(stream.fmt->streams[stream.streamIndex]->time_base));
                    avformat_seek_file(stream.fmt, stream.streamIndex, INT64_MIN, ts, ts, 0);
                    avcodec_flush_buffers(stream.dec);
                }
                std::lock_guard<std::mutex> slock(stateMutex);
                positionMs = target;
                if (isAudio)
                    seekPendingAudio = false;
                else
                    seekPendingVideo = false;
                if (!seekPendingAudio && !seekPendingVideo)
                    seekTargetMs = -1;
            }
            return true;
        }

        void audioLoop()
        {
            std::mutex streamMutex;
            if (!openInput(audioStream, audioPath, AVMEDIA_TYPE_AUDIO))
            {
                reportError("Media: failed to open audio stream");
                return;
            }
            int inSampleRate = audioStream.dec->sample_rate;
            int outSampleRate = 44100;
            int outChannels = 2;
            if (inSampleRate == 22050 || inSampleRate == 24000)
                outSampleRate = inSampleRate;

            {
                std::lock_guard<std::mutex> slock(stateMutex);
                double streamDuration = audioStream.fmt->duration > 0
                                            ? audioStream.fmt->duration * 1000.0 / AV_TIME_BASE
                                            : 0;
                if (streamDuration > durationMs)
                    durationMs = streamDuration;
            }

            std::unique_ptr<AudioSink> localSink(createAudioSink());
            bool sinkReady = localSink->open(outSampleRate, outChannels);
            if (!sinkReady)
                localSink = std::make_unique<NullAudioSink>();

            SwrContext *swr = nullptr;
            AVChannelLayout outLayout;
            av_channel_layout_default(&outLayout, outChannels);
            if (swr_alloc_set_opts2(&swr, &outLayout, AV_SAMPLE_FMT_S16, outSampleRate,
                                    &audioStream.dec->ch_layout, audioStream.dec->sample_fmt,
                                    inSampleRate, 0, nullptr) < 0)
            {
                reportError("Media: swr init failed");
                return;
            }
            if (swr_init(swr) < 0)
            {
                reportError("Media: swr_init failed");
                swr_free(&swr);
                return;
            }

            std::vector<uint8_t> resampleBuffer(8192 * 16);
            AVPacket *packet = av_packet_alloc();
            AVFrame *frame = av_frame_alloc();
            bool ended = false;

            while (active)
            {
                waitWhilePaused();
                if (!active)
                    break;
                if (handleSeekRequest(audioStream, true, streamMutex))
                    continue;
                {
                    bool shouldPlay = false;
                    {
                        std::lock_guard<std::mutex> slock(stateMutex);
                        shouldPlay = playing;
                    }
                    if (!shouldPlay)
                    {
                        lockWait(20);
                        continue;
                    }
                }
                {
                    std::lock_guard<std::mutex> slock(streamMutex);
                    if (av_read_frame(audioStream.fmt, packet) < 0)
                    {
                        ended = true;
                    }
                    else if (packet->stream_index == audioStream.streamIndex)
                    {
                        if (avcodec_send_packet(audioStream.dec, packet) >= 0)
                        {
                            while (avcodec_receive_frame(audioStream.dec, frame) >= 0)
                            {
                                int maxOut = (int)resampleBuffer.size() / (outChannels * sizeof(int16_t));
                                uint8_t *outPtr = resampleBuffer.data();
                                int outSamples = swr_convert(swr, &outPtr, maxOut,
                                                             (const uint8_t **)frame->data, frame->nb_samples);
                                if (outSamples > 0)
                                {
                                    std::lock_guard<std::mutex> sinkLock(sinkMutex);
                                    double rateNow = 1.0;
                                    {
                                        std::lock_guard<std::mutex> clock(stateMutex);
                                        rateNow = rate;
                                    }
                                    int skip = (int)((1.0 - 1.0 / rateNow) * outSamples);
                                    if (skip < 0)
                                        skip = 0;
                                    int useSamples = outSamples - skip;
                                    if (useSamples > 0)
                                        localSink->write((const int16_t *)resampleBuffer.data(),
                                                         (size_t)useSamples * outChannels);
                                }
                            }
                        }
                    }
                    av_packet_unref(packet);
                }
                if (ended)
                    break;

                {
                    std::lock_guard<std::mutex> slock(stateMutex);
                    uint64_t played = localSink->playedSamples();
                    positionMs = 1000.0 * (double)played / outSampleRate / rate;
                }
            }

            if (ended)
            {
                localSink->drain();
                if (endCallback)
                    endCallback();
            }
            av_frame_free(&frame);
            av_packet_free(&packet);
            swr_free(&swr);
            closeStream(audioStream);
        }

        void lockWait(int ms)
        {
            std::this_thread::sleep_for(std::chrono::milliseconds(ms));
        }

        void videoLoop()
        {
            std::mutex streamMutex;
            if (!openInput(videoStream, videoPath, AVMEDIA_TYPE_VIDEO))
            {
                reportError("Media: failed to open video stream");
                return;
            }
            AVStream *st = videoStream.fmt->streams[videoStream.streamIndex];
            double frameTimeBaseMs = streamTimeBaseMs(st);

            const AVCodec *encoder = avcodec_find_encoder(AV_CODEC_ID_MJPEG);
            if (encoder == nullptr)
            {
                reportError("Media: mjpeg encoder unavailable");
                return;
            }
            AVCodecContext *encCtx = avcodec_alloc_context3(encoder);
            int outWidth = videoStream.dec->width;
            int outHeight = videoStream.dec->height;
            if (outWidth > 480)
            {
                outHeight = outHeight * 480 / outWidth;
                outWidth = 480;
            }
            outWidth &= ~1;
            outHeight &= ~1;
            encCtx->width = outWidth;
            encCtx->height = outHeight;
            encCtx->pix_fmt = AV_PIX_FMT_YUVJ420P;
            encCtx->time_base = AVRational{1, 1000};
            encCtx->qmin = 3;
            encCtx->qmax = 8;
            if (avcodec_open2(encCtx, encoder, nullptr) < 0)
            {
                reportError("Media: mjpeg encoder open failed");
                avcodec_free_context(&encCtx);
                return;
            }

            SwsContext *sws = sws_getContext(videoStream.dec->width, videoStream.dec->height,
                                             videoStream.dec->pix_fmt,
                                             outWidth, outHeight, AV_PIX_FMT_YUVJ420P,
                                             SWS_BILINEAR, nullptr, nullptr, nullptr);
            AVFrame *scaleFrame = av_frame_alloc();
            scaleFrame->format = AV_PIX_FMT_YUVJ420P;
            scaleFrame->width = outWidth;
            scaleFrame->height = outHeight;
            av_frame_get_buffer(scaleFrame, 0);
            AVFrame *frame = av_frame_alloc();
            AVPacket *packet = av_packet_alloc();
            AVPacket *jpegPacket = av_packet_alloc();
            int64_t outPts = 0;
            bool firstFrame = true;

            while (active)
            {
                waitWhilePaused();
                if (!active)
                    break;
                if (handleSeekRequest(videoStream, false, streamMutex))
                {
                    firstFrame = true;
                    continue;
                }
                {
                    bool shouldPlay = false;
                    {
                        std::lock_guard<std::mutex> slock(stateMutex);
                        shouldPlay = playing;
                    }
                    if (!shouldPlay)
                    {
                        lockWait(20);
                        continue;
                    }
                }
                {
                    std::lock_guard<std::mutex> slock(streamMutex);
                    if (av_read_frame(videoStream.fmt, packet) < 0)
                        break;
                    if (packet->stream_index == videoStream.streamIndex &&
                        avcodec_send_packet(videoStream.dec, packet) >= 0)
                    {
                        while (avcodec_receive_frame(videoStream.dec, frame) >= 0)
                        {
                            double frameMs = frame->pts * frameTimeBaseMs;
                            if (!firstFrame)
                            {
                                double audioPos = 0;
                                {
                                    std::lock_guard<std::mutex> slock2(stateMutex);
                                    audioPos = positionMs;
                                }
                                double aheadMs = (frameMs - audioPos) / rate;
                                if (aheadMs > 150)
                                    lockWait((int)(aheadMs - 120));
                                else if (aheadMs < -400)
                                    continue;
                            }
                            else
                            {
                                firstFrame = false;
                                std::lock_guard<std::mutex> slock2(stateMutex);
                                if (positionMs < 10)
                                    positionMs = frameMs;
                            }
                            sws_scale(sws, frame->data, frame->linesize, 0,
                                      videoStream.dec->height, scaleFrame->data,
                                      scaleFrame->linesize);
                            scaleFrame->pts = outPts++;
                            if (avcodec_send_frame(encCtx, scaleFrame) >= 0)
                            {
                                while (avcodec_receive_packet(encCtx, jpegPacket) >= 0)
                                {
                                    if (frameCallback)
                                    {
                                        VideoFrame videoFrame;
                                        videoFrame.width = outWidth;
                                        videoFrame.height = outHeight;
                                        videoFrame.ptsMs = frameMs;
                                        videoFrame.jpegBase64 = base64Encode(jpegPacket->data,
                                                                             (size_t)jpegPacket->size);
                                        frameCallback(videoFrame);
                                    }
                                    av_packet_unref(jpegPacket);
                                }
                            }
                        }
                    }
                    av_packet_unref(packet);
                }
            }
            av_packet_free(&jpegPacket);
            av_packet_free(&packet);
            av_frame_free(&frame);
            av_frame_free(&scaleFrame);
            sws_freeContext(sws);
            avcodec_free_context(&encCtx);
            closeStream(videoStream);
        }

        void reportError(const std::string &message)
        {
            if (errorCallback)
                errorCallback(message);
        }
    };

    Media::Media() : impl(std::make_unique<Impl>()) {}
    Media::~Media() = default;

    void Media::open(const std::string &audioUrl, const std::string &videoUrl,
                     const std::string &cacheDir)
    {
        impl->open(audioUrl, videoUrl, cacheDir);
    }
    void Media::play() { impl->play(); }
    void Media::pause() { impl->pause(); }
    void Media::resume() { impl->resume(); }
    void Media::seek(double positionMs) { impl->seek(positionMs); }
    void Media::setRate(double rate) { impl->setRate(rate); }
    PlaybackState Media::getProgress() { return impl->getProgress(); }
    void Media::stop() { impl->stop(); }

    void Media::setFrameCallback(FrameCallback cb) { impl->frameCallback = cb; }
    void Media::setEndCallback(EndCallback cb) { impl->endCallback = cb; }
    void Media::setErrorCallback(ErrorCallback cb) { impl->errorCallback = cb; }
    void Media::setDownloadProgressCallback(ProgressCallback cb) { impl->downloadProgressCallback = cb; }

#else

    class Media::Impl
    {
    public:
        void open(const std::string &, const std::string &, const std::string &)
        {
            throw std::runtime_error("Media support not compiled (HAVE_FFMPEG is OFF)");
        }
        void play() { unavailable(); }
        void pause() { unavailable(); }
        void resume() { unavailable(); }
        void seek(double) { unavailable(); }
        void setRate(double) { unavailable(); }
        PlaybackState getProgress()
        {
            unavailable();
            return PlaybackState{};
        }
        void stop() {}
        FrameCallback frameCallback;
        EndCallback endCallback;
        ErrorCallback errorCallback;
        ProgressCallback downloadProgressCallback;

    private:
        void unavailable()
        {
            throw std::runtime_error("Media support not compiled (HAVE_FFMPEG is OFF)");
        }
    };

    Media::Media() : impl(std::make_unique<Impl>()) {}
    Media::~Media() = default;

    void Media::open(const std::string &audioUrl, const std::string &videoUrl,
                     const std::string &cacheDir)
    {
        impl->open(audioUrl, videoUrl, cacheDir);
    }
    void Media::play() { impl->play(); }
    void Media::pause() { impl->pause(); }
    void Media::resume() { impl->resume(); }
    void Media::seek(double positionMs) { impl->seek(positionMs); }
    void Media::setRate(double rate) { impl->setRate(rate); }
    PlaybackState Media::getProgress() { return impl->getProgress(); }
    void Media::stop() { impl->stop(); }

    void Media::setFrameCallback(FrameCallback cb) { impl->frameCallback = cb; }
    void Media::setEndCallback(EndCallback cb) { impl->endCallback = cb; }
    void Media::setErrorCallback(ErrorCallback cb) { impl->errorCallback = cb; }
    void Media::setDownloadProgressCallback(ProgressCallback cb) { impl->downloadProgressCallback = cb; }

#endif

}
