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

#include "AudioSink.hpp"
#include <atomic>
#include <cstring>
#include <fstream>
#include <mutex>
#include <vector>

#ifdef HAVE_ALSA
#include <alsa/asoundlib.h>
#endif

#ifdef HAVE_TINYALSA
#include <tinyalsa/asoundlib.h>
#endif

namespace media
{

    static std::atomic<int> g_preferredSink{0}; // 0=auto 1=alsa 2=tinyalsa 3=wav 4=null

    void setPreferredSink(const std::string &sinkKind)
    {
        if (sinkKind == "alsa")
            g_preferredSink = 1;
        else if (sinkKind == "tinyalsa")
            g_preferredSink = 2;
        else if (sinkKind == "wav")
            g_preferredSink = 3;
        else if (sinkKind == "null")
            g_preferredSink = 4;
        else
            g_preferredSink = 0;
    }

#ifdef HAVE_ALSA
    class AlsaAudioSink : public AudioSink
    {
    private:
        snd_pcm_t *handle = nullptr;
        int channels = 2;
        int sampleRate = 44100;
        uint64_t played = 0;

    public:
        ~AlsaAudioSink() override { close(); }
        bool open(int rate, int ch) override
        {
            sampleRate = rate;
            channels = ch;
            int err = snd_pcm_open(&handle, "default", SND_PCM_STREAM_PLAYBACK, 0);
            if (err < 0)
                return false;
            snd_pcm_hw_params_t *params = nullptr;
            snd_pcm_hw_params_alloca(&params);
            snd_pcm_hw_params_any(handle, params);
            if (snd_pcm_hw_params_set_access(handle, params, SND_PCM_ACCESS_RW_INTERLEAVED) < 0)
                return fail();
            if (snd_pcm_hw_params_set_format(handle, params, SND_PCM_FORMAT_S16_LE) < 0)
                return fail();
            if (snd_pcm_hw_params_set_channels(handle, params, channels) < 0)
                return fail();
            unsigned int rate = (unsigned int)sampleRate;
            if (snd_pcm_hw_params_set_rate_near(handle, params, &rate, 0) < 0)
                return fail();
            snd_pcm_uframes_t bufferSize = 8192;
            snd_pcm_uframes_t periodSize = 1024;
            snd_pcm_hw_params_set_buffer_size_near(handle, params, &bufferSize);
            snd_pcm_hw_params_set_period_size_near(handle, params, &periodSize, 0);
            if (snd_pcm_hw_params(handle, params) < 0)
                return fail();
            if (snd_pcm_prepare(handle) < 0)
                return fail();
            return true;
        }
        bool write(const int16_t *samples, size_t sampleCount) override
        {
            if (!handle)
                return false;
            size_t frames = sampleCount / channels;
            const snd_pcm_uframes_t chunk = 2048;
            size_t offset = 0;
            while (offset < frames)
            {
                snd_pcm_uframes_t toWrite = (frames - offset > chunk) ? chunk : (frames - offset);
                snd_pcm_sframes_t n = snd_pcm_writei(handle, samples + offset * channels, toWrite);
                if (n < 0)
                {
                    if (snd_pcm_recover(handle, (int)n, 1) < 0)
                        return false;
                    continue;
                }
                offset += (size_t)n;
                played += (uint64_t)n * channels;
            }
            return true;
        }
        void drain() override
        {
            if (handle)
                snd_pcm_drain(handle);
        }
        void close() override
        {
            if (handle)
            {
                snd_pcm_close(handle);
                handle = nullptr;
            }
        }
        uint64_t playedSamples() const override { return played; }

    private:
        bool fail()
        {
            close();
            return false;
        }
    };
#endif

#ifdef HAVE_TINYALSA
    class TinyAlsaAudioSink : public AudioSink
    {
    private:
        struct pcm *pcmHandle = nullptr;
        int channels = 2;
        int sampleRate = 44100;
        uint64_t played = 0;

    public:
        ~TinyAlsaAudioSink() override { close(); }
        bool open(int rate, int ch) override
        {
            sampleRate = rate;
            channels = ch;
            unsigned int card = 0, device = 0;
            pcmConfig config;
            config.channels = channels;
            config.rate = sampleRate;
            config.period_size = 1024;
            config.period_count = 8;
            config.format = PCM_FORMAT_S16_LE;
            config.start_threshold = 0;
            config.stop_threshold = 0;
            config.silence_threshold = 0;
            pcmHandle = pcm_open(card, device, PCM_OUT, &config);
            if (pcmHandle == nullptr || !pcm_is_ready(pcmHandle))
            {
                if (pcmHandle)
                    pcm_close(pcmHandle);
                pcmHandle = nullptr;
                return false;
            }
            return true;
        }
        bool write(const int16_t *samples, size_t sampleCount) override
        {
            if (pcmHandle == nullptr)
                return false;
            unsigned int frames = (unsigned int)(sampleCount / channels);
            const unsigned int chunk = 2048;
            unsigned int offset = 0;
            while (offset < frames)
            {
                unsigned int toWrite = (frames - offset > chunk) ? chunk : (frames - offset);
                unsigned int n = pcm_write(pcmHandle, samples + offset * channels, toWrite);
                if (n != toWrite)
                    return false;
                offset += toWrite;
                played += (uint64_t)toWrite * channels;
            }
            return true;
        }
        void drain() override
        {
            if (pcmHandle)
                pcm_prepare(pcmHandle);
        }
        void close() override
        {
            if (pcmHandle)
            {
                pcm_close(pcmHandle);
                pcmHandle = nullptr;
            }
        }
        uint64_t playedSamples() const override { return played; }
    };
#endif

    class WavDebugSink : public AudioSink
    {
    private:
        std::ofstream out;
        int channels = 2;
        int sampleRate = 44100;
        uint64_t written = 0;
        std::mutex fileMutex;

    public:
        ~WavDebugSink() override { close(); }
        bool open(int rate, int ch) override
        {
            std::lock_guard<std::mutex> lock(fileMutex);
            sampleRate = rate;
            channels = ch;
            out.open("/tmp/media_debug.wav", std::ios::binary | std::ios::trunc);
            if (!out.is_open())
                return false;
            const uint8_t header[44] = {
                'R', 'I', 'F', 'F', 0, 0, 0, 0, 'W', 'A', 'V', 'E',
                'f', 'm', 't', ' ', 16, 0, 0, 0, 1, 0, (uint8_t)channels, 0,
                (uint8_t)(sampleRate & 0xFF), (uint8_t)((sampleRate >> 8) & 0xFF), 0, 0,
                0, 0, 0, 0, (uint8_t)(2 * channels), 0, 16, 0,
                'd', 'a', 't', 'a', 0, 0, 0, 0};
            out.write((const char *)header, 44);
            return true;
        }
        bool write(const int16_t *samples, size_t sampleCount) override
        {
            std::lock_guard<std::mutex> lock(fileMutex);
            if (!out.is_open())
                return false;
            out.write((const char *)samples, (std::streamsize)(sampleCount * sizeof(int16_t)));
            written += sampleCount;
            return true;
        }
        void drain() override {}
        void close() override
        {
            std::lock_guard<std::mutex> lock(fileMutex);
            if (out.is_open())
            {
                uint32_t dataBytes = (uint32_t)(written * sizeof(int16_t));
                uint32_t riffSize = 36 + dataBytes;
                uint32_t byteRate = (uint32_t)(sampleRate * channels * 2);
                out.seekp(4, std::ios::beg);
                out.write((const char *)&riffSize, 4);
                out.seekp(24, std::ios::beg);
                out.write((const char *)&sampleRate, 4);
                out.write((const char *)&byteRate, 4);
                out.seekp(40, std::ios::beg);
                out.write((const char *)&dataBytes, 4);
                out.close();
            }
        }
        uint64_t playedSamples() const override { return written; }
    };

    class NullAudioSink : public AudioSink
    {
    private:
        uint64_t written = 0;

    public:
        bool open(int, int) override { return true; }
        bool write(const int16_t *, size_t sampleCount) override
        {
            written += sampleCount;
            return true;
        }
        void drain() override {}
        void close() override {}
        uint64_t playedSamples() const override { return written; }
    };

    AudioSink *createAudioSink()
    {
        int preferred = g_preferredSink.load();
#ifdef HAVE_ALSA
        if (preferred == 0 || preferred == 1)
            return new AlsaAudioSink();
#endif
#ifdef HAVE_TINYALSA
        if (preferred == 0 || preferred == 2)
            return new TinyAlsaAudioSink();
#endif
        if (preferred == 3)
            return new WavDebugSink();
        if (preferred == 0)
            return new NullAudioSink();
        return new NullAudioSink();
    }

}
