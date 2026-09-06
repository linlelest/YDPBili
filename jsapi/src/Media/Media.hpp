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

#include <functional>
#include <memory>
#include <string>

namespace media
{

    struct VideoFrame
    {
        int width = 0;
        int height = 0;
        double ptsMs = 0;
        std::string jpegBase64;
    };

    struct PlaybackState
    {
        double durationMs = 0;
        double positionMs = 0;
        bool playing = false;
        bool paused = false;
        double rate = 1.0;
    };

    using FrameCallback = std::function<void(const VideoFrame &)>;
    using StateCallback = std::function<void(const PlaybackState &)>;
    using EndCallback = std::function<void()>;
    using ErrorCallback = std::function<void(const std::string &)>;
    using ProgressCallback = std::function<void(double downloadedBytes, double totalBytes)>;

    // Media playback engine.
    // Without HAVE_FFMPEG all methods throw std::runtime_error("Media support not compiled").
    // Network fetching is done with the system libcurl (Fetch rawStream), then decoded
    // from the local cache; ffmpeg itself is built without network/TLS support.
    class Media
    {
    public:
        Media();
        ~Media();

        // Downloads and prepares the given DASH segments (either may be empty).
        // Blocking; intended to run on the JQAsyncInfo worker thread.
        // cacheDir must exist and be writable (e.g. /userdisk/... or /tmp).
        void open(const std::string &audioUrl, const std::string &videoUrl,
                  const std::string &cacheDir);

        void play();
        void pause();
        void resume();
        void seek(double positionMs);
        void setRate(double rate);
        PlaybackState getProgress();
        void stop();

        void setFrameCallback(FrameCallback cb);
        void setEndCallback(EndCallback cb);
        void setErrorCallback(ErrorCallback cb);
        void setDownloadProgressCallback(ProgressCallback cb);

    private:
        class Impl;
        std::unique_ptr<Impl> impl;
    };

}
