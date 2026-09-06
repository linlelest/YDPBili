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

#pragma once

#include "Media.hpp"
#include <jqutil_v2/jqutil.h>
#include <memory>
#include <mutex>
#include <stdexcept>

using namespace JQUTIL_NS;

class JSMedia : public JQPublishObject
{
private:
    std::unique_ptr<media::Media> mediaObject;
    mutable std::mutex mediaMutex;

    media::Media *getMediaObject() const
    {
        std::lock_guard<std::mutex> lock(mediaMutex);
        if (!mediaObject)
            throw std::runtime_error("Media not initialized, call initialize() first");
        return mediaObject.get();
    }

public:
    JSMedia();
    ~JSMedia();

    void initialize(JQFunctionInfo &info);
    void setAudioSink(JQFunctionInfo &info);

    void open(JQAsyncInfo &info);
    void play(JQFunctionInfo &info);
    void pause(JQFunctionInfo &info);
    void resume(JQFunctionInfo &info);
    void seek(JQFunctionInfo &info);
    void setRate(JQFunctionInfo &info);
    void getProgress(JQFunctionInfo &info);
    void stop(JQFunctionInfo &info);
};

extern JSValue createMedia(JQModuleEnv *env);
