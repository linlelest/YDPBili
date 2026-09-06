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

#include "JSMedia.hpp"
#include "Exceptions/AssertFailed.hpp"
#include "Media/AudioSink.hpp"
#include <iostream>

JSMedia::JSMedia() : mediaObject(nullptr) {}

JSMedia::~JSMedia() {}

void JSMedia::initialize(JQFunctionInfo &info)
{
    try
    {
        ASSERT(info.Length() == 0);
        std::lock_guard<std::mutex> lock(mediaMutex);
        mediaObject = std::make_unique<media::Media>();
        mediaObject->setFrameCallback([this](const media::VideoFrame &frame)
                                      {
                                          publish("media_frame", Bson::object{
                                                                     {"width", frame.width},
                                                                     {"height", frame.height},
                                                                     {"ptsMs", frame.ptsMs},
                                                                     {"jpegBase64", frame.jpegBase64}});
                                      });
        mediaObject->setEndCallback([this]()
                                    { publish("media_ended", Bson::object{}); });
        mediaObject->setErrorCallback([this](const std::string &message)
                                      { publish("media_error", Bson::object{{"message", message}}); });
        mediaObject->setDownloadProgressCallback([this](double downloaded, double total)
                                                 {
                                                     Bson::object progress = {
                                                         {"downloadedBytes", downloaded}};
                                                     if (total > 0)
                                                         progress["totalBytes"] = total;
                                                     publish("media_download_progress", progress);
                                                 });
        info.GetReturnValue().Set(true);
    }
    catch (const std::exception &e)
    {
        info.GetReturnValue().ThrowInternalError(e.what());
    }
}

void JSMedia::setAudioSink(JQFunctionInfo &info)
{
    try
    {
        ASSERT(info.Length() == 1);
        JSContext *ctx = info.GetContext();
        std::string sinkKind = JQString(ctx, info[0]).getString();
        media::setPreferredSink(sinkKind);
        info.GetReturnValue().Set(true);
    }
    catch (const std::exception &e)
    {
        info.GetReturnValue().ThrowInternalError(e.what());
    }
}

void JSMedia::open(JQAsyncInfo &info)
{
    try
    {
        media::Media *media = getMediaObject();
        ASSERT(info.Length() >= 1 && info.Length() <= 3);
        ASSERT(info[0].is_string());
        std::string audioUrl = info[0].string_value();
        std::string videoUrl;
        std::string cacheDir = "/tmp";
        if (info.Length() >= 2 && info[1].is_string())
            videoUrl = info[1].string_value();
        if (info.Length() >= 3 && info[2].is_string())
            cacheDir = info[2].string_value();
        media->open(audioUrl, videoUrl, cacheDir);
        info.post(true);
    }
    catch (const std::exception &e)
    {
        info.postError(e.what());
    }
}

void JSMedia::play(JQFunctionInfo &info)
{
    try
    {
        ASSERT(info.Length() == 0);
        getMediaObject()->play();
        info.GetReturnValue().Set(true);
    }
    catch (const std::exception &e)
    {
        info.GetReturnValue().ThrowInternalError(e.what());
    }
}

void JSMedia::pause(JQFunctionInfo &info)
{
    try
    {
        ASSERT(info.Length() == 0);
        getMediaObject()->pause();
        info.GetReturnValue().Set(true);
    }
    catch (const std::exception &e)
    {
        info.GetReturnValue().ThrowInternalError(e.what());
    }
}

void JSMedia::resume(JQFunctionInfo &info)
{
    try
    {
        ASSERT(info.Length() == 0);
        getMediaObject()->resume();
        info.GetReturnValue().Set(true);
    }
    catch (const std::exception &e)
    {
        info.GetReturnValue().ThrowInternalError(e.what());
    }
}

void JSMedia::seek(JQFunctionInfo &info)
{
    try
    {
        ASSERT(info.Length() == 1);
        JSContext *ctx = info.GetContext();
        double positionMs = JQNumber(ctx, info[0]).getDouble();
        getMediaObject()->seek(positionMs);
        info.GetReturnValue().Set(true);
    }
    catch (const std::exception &e)
    {
        info.GetReturnValue().ThrowInternalError(e.what());
    }
}

void JSMedia::setRate(JQFunctionInfo &info)
{
    try
    {
        ASSERT(info.Length() == 1);
        JSContext *ctx = info.GetContext();
        double rate = JQNumber(ctx, info[0]).getDouble();
        getMediaObject()->setRate(rate);
        info.GetReturnValue().Set(true);
    }
    catch (const std::exception &e)
    {
        info.GetReturnValue().ThrowInternalError(e.what());
    }
}

void JSMedia::getProgress(JQFunctionInfo &info)
{
    try
    {
        ASSERT(info.Length() == 0);
        media::PlaybackState state = getMediaObject()->getProgress();
        info.GetReturnValue().Set(Bson::object{
            {"durationMs", state.durationMs},
            {"positionMs", state.positionMs},
            {"playing", state.playing},
            {"paused", state.paused},
            {"rate", state.rate}});
    }
    catch (const std::exception &e)
    {
        info.GetReturnValue().ThrowInternalError(e.what());
    }
}

void JSMedia::stop(JQFunctionInfo &info)
{
    try
    {
        ASSERT(info.Length() == 0);
        getMediaObject()->stop();
        info.GetReturnValue().Set(true);
    }
    catch (const std::exception &e)
    {
        info.GetReturnValue().ThrowInternalError(e.what());
    }
}

extern JSValue createMedia(JQModuleEnv *env)
{
    JQFunctionTemplateRef tpl = JQFunctionTemplate::New(env, "Media");
    tpl->InstanceTemplate()->setObjectCreator([]()
                                              { return new JSMedia(); });

    tpl->SetProtoMethod("initialize", &JSMedia::initialize);
    tpl->SetProtoMethod("setAudioSink", &JSMedia::setAudioSink);

    tpl->SetProtoMethodPromise("open", &JSMedia::open);
    tpl->SetProtoMethod("play", &JSMedia::play);
    tpl->SetProtoMethod("pause", &JSMedia::pause);
    tpl->SetProtoMethod("resume", &JSMedia::resume);
    tpl->SetProtoMethod("seek", &JSMedia::seek);
    tpl->SetProtoMethod("setRate", &JSMedia::setRate);
    tpl->SetProtoMethod("getProgress", &JSMedia::getProgress);
    tpl->SetProtoMethod("stop", &JSMedia::stop);

    JSMedia::InitTpl(tpl);
    return tpl->CallConstructor();
}
