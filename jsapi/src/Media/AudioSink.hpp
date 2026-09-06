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

#include <cstdint>
#include <cstddef>
#include <string>

namespace media
{

    // Abstract PCM output backend for the Media JSAPI.
    // Backends are selected at compile time via CMake options:
    //   HAVE_ALSA     -> AlsaAudioSink   (libasound, preferred)
    //   HAVE_TINYALSA -> TinyAlsaAudioSink (libtinyalsa, rk buildroot common)
    //   MEDIA_WAV_DEBUG -> WavDebugSink  (writes /tmp/media_debug.wav)
    //   fallback      -> NullAudioSink   (drops samples, no audio output)
    class AudioSink
    {
    public:
        virtual ~AudioSink() {}
        virtual bool open(int sampleRate, int channels) = 0;
        virtual bool write(const int16_t *samples, size_t sampleCount) = 0;
        virtual void drain() = 0;
        virtual void close() = 0;
        virtual uint64_t playedSamples() const = 0;
    };

    void setPreferredSink(const std::string &sinkKind);
    AudioSink *createAudioSink();
    AudioSink *createNullAudioSink();

}
