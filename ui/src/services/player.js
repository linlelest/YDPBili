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
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with miniapp. If not, see <https://www.gnu.org/licenses/>.

/**
 * player.js —— 播放内核（createPlayer 工厂，player 页 / feed 页共用）
 *
 * 取流与归一化（prepare）：
 * - decoder = audio_only / ffmpeg → fnval=16 取 DASH（dash.audio[]，字段 id/bandwidth/baseUrl/backupUrl）；
 * - decoder = system / auto → fnval=1 取 durl MP4 渐进流（platform=html5，durl[0].url），
 *   MP4 缺失时自动降级 fnval=16；归一化结果
 *   {mode:'video-durl'|'audio-dash', url, backupUrls, timelength, quality}。
 *
 * 播放实现（按 decoder 降级链，见 docs-TASK1 §3.1）：
 * - system/auto + durl MP4：由页面渲染宿主 <video> 组件（src 直连），fail/error → 'unsupported'；
 * - audio_only/ffmpeg + DASH：custom 模块 Media（jsapi/src/Media/JSMedia.cpp）：
 *   Media.initialize() → Media.open(audioUrl, videoUrl, cacheDir)（Promise，位置参数）；
 *   事件 on/off 订阅：media_frame(dataURI 帧) / media_download_progress / media_ended / media_error。
 *   Media.open reject（如未编入 ffmpeg）→ ffmpeg 档先降级 audio_only，仍失败 → 'unsupported'。
 *
 * state ∈ 'idle' | 'preparing' | 'video' | 'audio' | 'unsupported' | 'error'
 */

import { getPlayUrl } from './api/video.js';
import { getSettings } from './settings.js';
import { Media } from 'custom';

const MEDIA_CACHE_DIR = '/tmp/bili_media';
const RATE_MIN = 0.25;
const RATE_MAX = 4.0;
const AUDIO_ID_64K = 30216;
const DECODER_SET = ['auto', 'system', 'ffmpeg', 'audio_only'];

const QUALITY_LABELS = {
  6: '240P',
  16: '360P',
  32: '480P',
  64: '720P',
  74: '720P60',
  80: '1080P',
  112: '1080P+',
  116: '1080P60',
  120: '4K',
};

export const PLAYER_STATES = ['idle', 'preparing', 'video', 'audio', 'unsupported', 'error'];

export function qualityLabel(qn) {
  const n = Number(qn) || 0;
  return QUALITY_LABELS[n] || (n > 0 ? n + 'P' : '自动');
}

/**
 * custom 模块导出的 Media 为已构造实例（JQFunctionTemplate::CallConstructor，
 * 与 Fetch 同型）；兼容其恰为构造函数的宿主形态。
 */
function resolveMedia() {
  if (!Media) return null;
  if (typeof Media === 'function') {
    try {
      return new Media();
    } catch (err) {
      return null;
    }
  }
  return Media;
}

export function createPlayer(bus) {
  const cb = bus || {};
  function emit(name, a, b) {
    const fn = cb[name];
    if (typeof fn === 'function') {
      try {
        fn(a, b);
      } catch (err) {}
    }
  }

  let seq = 0;
  let state = 'idle';
  let stream = null;
  let meta = null;
  let lastError = '';
  let media = null;
  let mediaReady = false;
  let mediaBound = false;
  let mediaHandlers = [];
  let rate = 1.0;
  let playing = false;
  let ended = false;
  let videoPlaying = false;
  let videoBaseMs = 0;
  let videoClockAt = 0;
  let bufferedRatio = 0;

  function info() {
    return {
      state,
      mode: stream ? stream.mode : '',
      decoder: meta ? meta.decoder : '',
      url: stream ? stream.url : '',
      timelength: stream ? stream.timelength : 0,
      quality: stream ? stream.quality : 0,
      acceptQuality: stream ? stream.acceptQuality : [],
      rate,
      error: lastError,
    };
  }

  function setState(next) {
    if (state === next) return;
    state = next;
    emit('onState', next, info());
  }

  function clampMs(ms) {
    const n = Number(ms) || 0;
    return n < 0 ? 0 : n;
  }

  function resetVideoClock(baseMs) {
    videoBaseMs = clampMs(baseMs);
    videoClockAt = Date.now();
  }

  function estimateVideoMs() {
    if (!stream) return 0;
    const duration = stream.timelength || 0;
    let ms = videoBaseMs;
    if (videoPlaying) ms += Date.now() - videoClockAt;
    if (ended) ms = duration;
    if (duration > 0 && ms > duration) ms = duration;
    return ms < 0 ? 0 : ms;
  }

  async function fetchStream(fnval, qn) {
    const data = await getPlayUrl({
      bvid: meta.bvid,
      aid: meta.aid,
      cid: meta.cid,
      qn,
      fnval,
      platform: 'html5',
      tryLook: true,
    });
    const hasDurl = !!(data && data.durl && data.durl.length > 0);
    const hasDash = !!(
      data &&
      data.dash &&
      ((data.dash.audio && data.dash.audio.length > 0) ||
        (data.dash.video && data.dash.video.length > 0))
    );
    if (!hasDurl && !hasDash) {
      throw new Error('接口未返回可用的播放流');
    }
    return data;
  }

  /** 音频流选择：优先 64K（30216，笔端省流，Task 1 决策），其次码率最低。 */
  function pickAudio(list) {
    const arr = (list || []).filter(function (a) {
      return a && a.baseUrl;
    });
    if (!arr.length) return null;
    arr.sort(function (a, b) {
      const pa = a.id === AUDIO_ID_64K ? 0 : 1;
      const pb = b.id === AUDIO_ID_64K ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return (a.bandwidth || 0) - (b.bandwidth || 0);
    });
    return arr[0];
  }

  /** 视频流选择：软解档限 480P 内的 H.264（avc1...，Task 1 §3.3）。 */
  function pickVideo(list, qn) {
    const arr = (list || []).filter(function (v) {
      return v && v.baseUrl;
    });
    if (!arr.length) return null;
    const codecs = String(arr[0].codecs || '').toLowerCase();
    const avc = arr.filter(function (v) {
      return String(v.codecs || '').toLowerCase().indexOf('avc') >= 0;
    });
    const pool = avc.length ? avc : arr;
    const cap = Math.min(Number(qn) || 32, 32);
    const fit = pool.filter(function (v) {
      return (Number(v.id) || 0) <= cap;
    });
    const use = fit.length ? fit : pool;
    use.sort(function (a, b) {
      return (Number(b.id) || 0) - (Number(a.id) || 0);
    });
    return use[0];
  }

  function stopMedia() {
    if (media && mediaReady) {
      try {
        media.stop();
      } catch (err) {}
    }
    videoPlaying = false;
    playing = false;
  }

  function bindMediaEvents() {
    if (mediaBound || !media || typeof media.on !== 'function') return;
    mediaBound = true;
    mediaHandlers = [
      [
        'media_frame',
        function (data) {
          const d = data || {};
          const uri = d.jpegBase64 ? 'data:image/jpeg;base64,' + d.jpegBase64 : '';
          emit('onFrame', uri, d);
        },
      ],
      [
        'media_download_progress',
        function (data) {
          const d = data || {};
          const total = Number(d.totalBytes) || 0;
          const done = Number(d.downloadedBytes) || 0;
          bufferedRatio = total > 0 ? Math.min(1, done / total) : 0;
          emit('onDownload', bufferedRatio, d);
        },
      ],
      [
        'media_ended',
        function () {
          ended = true;
          playing = false;
          emit('onPlayState', false);
          emit('onEnded');
        },
      ],
      [
        'media_error',
        function (data) {
          const d = data || {};
          if (stream && stream.wantVideo) {
            if (mediaSeq !== seq) return;
            degradeAudio(new Error(d.message || '视频解码出错'));
            return;
          }
          lastError = d.message || '播放出错';
          setState('error');
          emit('onError', { message: lastError, error: d });
        },
      ],
    ];
    for (let i = 0; i < mediaHandlers.length; i++) {
      media.on(mediaHandlers[i][0], mediaHandlers[i][1]);
    }
  }

  /** Media.open reject / media_error 降级：ffmpeg→audio_only→unsupported。 */
  async function degradeAudio(fromErr) {
    if (stream && stream.wantVideo && media) {
      try {
        stream.wantVideo = false;
        stream.videoUrl = '';
        try {
          media.stop();
        } catch (err) {}
        await media.open(stream.audioUrl, '', MEDIA_CACHE_DIR);
        try {
          media.play();
        } catch (err) {}
        playing = true;
        setState('audio');
        emit('onReady', info());
        emit('onNotice', '视频软解不可用，已切换为仅音频');
        return;
      } catch (err) {
        /* 落入 unsupported */
      }
    }
    lastError = (fromErr && fromErr.message) || '媒体解码不可用';
    setState('unsupported');
    emit('onError', { message: '当前解码器在笔端不可用，请到设置页切换' });
  }

  async function startMedia(mySeq) {
    media = resolveMedia();
    if (!media) {
      setState('unsupported');
      emit('onError', { message: '媒体模块不可用，请到设置页切换解码器' });
      return;
    }
    try {
      if (!mediaReady) {
        media.initialize();
        mediaReady = true;
        bindMediaEvents();
      }
      await media.open(stream.audioUrl, stream.videoUrl || '', MEDIA_CACHE_DIR);
      if (mySeq !== seq) return;
      if (rate !== 1 && typeof media.setRate === 'function') {
        try {
          media.setRate(rate);
        } catch (err) {}
      }
      try {
        media.play();
      } catch (err) {}
      playing = true;
      setState('audio');
      emit('onReady', info());
    } catch (err) {
      if (mySeq !== seq) return;
      await degradeAudio(err);
    }
  }

  async function prepareDash(mySeq, decoder) {
    const res = await fetchStream(16, meta.qn);
    if (mySeq !== seq) return;
    const dash = res.dash || {};
    const audio = pickAudio(dash.audio);
    if (!audio) {
      throw new Error('未获取到可播放的音频流');
    }
    let videoUrl = '';
    const wantVideo = decoder === 'ffmpeg';
    if (wantVideo) {
      const v = pickVideo(dash.video, meta.qn);
      if (v) videoUrl = v.baseUrl;
    }
    stream = {
      mode: 'audio-dash',
      url: audio.baseUrl,
      backupUrls: [],
      timelength: res.timelength || 0,
      quality: res.quality || 0,
      acceptQuality: res.acceptQuality || [],
      audioUrl: audio.baseUrl,
      videoUrl,
      wantVideo: wantVideo && !!videoUrl,
    };
    await startMedia(mySeq);
  }

  /**
   * 取流并进入对应播放态。
   * @param {{bvid?: string, aid?: number, cid?: number, qn?: number, decoder?: string}} req
   */
  async function prepare(req) {
    const opt = req || {};
    const mySeq = ++seq;
    const settings = await getSettings();
    if (mySeq !== seq) return;
    const prev = meta || { bvid: '', aid: 0, cid: 0, qn: 0, decoder: '' };
    meta = {
      bvid: String(opt.bvid || prev.bvid || ''),
      aid: Number(opt.aid) > 0 ? Number(opt.aid) : prev.aid || 0,
      cid: Number(opt.cid) > 0 ? Number(opt.cid) : prev.cid || 0,
      qn: Number(opt.qn) > 0 ? Number(opt.qn) : settings.videoQuality,
      decoder:
        DECODER_SET.indexOf(opt.decoder) >= 0
          ? opt.decoder
          : DECODER_SET.indexOf(prev.decoder) >= 0
          ? prev.decoder
          : settings.decoder || 'auto',
    };
    rate = typeof settings.playbackRate === 'number' && settings.playbackRate > 0 ? settings.playbackRate : 1.0;
    lastError = '';
    ended = false;
    bufferedRatio = 0;
    setState('preparing');
    stopMedia();
    resetVideoClock(0);
    try {
      if (meta.decoder === 'audio_only' || meta.decoder === 'ffmpeg') {
        await prepareDash(mySeq, meta.decoder);
      } else {
        const res = await fetchStream(1, meta.qn);
        if (mySeq !== seq) return;
        const first = res.durl && res.durl.length ? res.durl[0] : null;
        if (first && first.url) {
          stream = {
            mode: 'video-durl',
            url: first.url,
            backupUrls: [],
            timelength: res.timelength || 0,
            quality: res.quality || 0,
            acceptQuality: res.acceptQuality || [],
            wantVideo: true,
          };
          playing = true;
          videoPlaying = true;
          videoClockAt = Date.now();
          setState('video');
          emit('onReady', info());
        } else {
          emit('onNotice', '该视频无 MP4 渐进流，已降级 DASH 音频');
          await prepareDash(mySeq, meta.decoder);
        }
      }
    } catch (err) {
      if (mySeq !== seq) return;
      lastError = (err && err.message) || '获取播放地址失败';
      setState('error');
      emit('onError', { message: lastError, error: err });
    }
  }

  function play() {
    if (state === 'video') {
      if (videoPlaying) return;
      videoPlaying = true;
      videoClockAt = Date.now();
      playing = true;
      emit('onPlayState', true);
    } else if (state === 'audio' && media && mediaReady) {
      try {
        media.play();
      } catch (err) {}
      playing = true;
      emit('onPlayState', true);
    }
  }

  function pause() {
    if (state === 'video') {
      if (!videoPlaying) return;
      videoBaseMs = estimateVideoMs();
      videoPlaying = false;
      playing = false;
      emit('onPlayState', false);
    } else if (state === 'audio' && media && mediaReady) {
      try {
        media.pause();
      } catch (err) {}
      playing = false;
      emit('onPlayState', false);
    }
  }

  function togglePlay() {
    if (playing) pause();
    else play();
  }

  function seek(ms) {
    const target = clampMs(ms);
    ended = false;
    if (state === 'video') {
      resetVideoClock(target);
    } else if (state === 'audio' && media && mediaReady) {
      try {
        media.seek(target);
      } catch (err) {}
    }
  }

  function setRate(x) {
    const n = Number(x) || 1.0;
    rate = Math.min(RATE_MAX, Math.max(RATE_MIN, n));
    if (state === 'audio' && media && mediaReady) {
      try {
        media.setRate(rate);
      } catch (err) {}
    }
    emit('onRate', rate);
  }

  function getProgress() {
    if (state === 'audio' && media && mediaReady) {
      try {
        const st = media.getProgress() || {};
        const p = {
          durationMs: Number(st.durationMs) || (stream ? stream.timelength : 0) || 0,
          positionMs: clampMs(st.positionMs),
          playing: !!st.playing && !st.paused,
          paused: !!st.paused,
          rate: Number(st.rate) || rate,
          bufferedRatio,
        };
        playing = p.playing;
        return p;
      } catch (err) {}
    }
    return {
      durationMs: (stream ? stream.timelength : 0) || 0,
      positionMs: state === 'video' ? estimateVideoMs() : 0,
      playing: playing && state === 'video',
      paused: !playing,
      rate,
      bufferedRatio: state === 'video' ? 1 : bufferedRatio,
    };
  }

  /** 宿主 <video> 组件事件回灌（start/pause），校准 video 模式估算时钟。 */
  function notifyVideoState(isPlaying) {
    if (state !== 'video') return;
    const next = !!isPlaying;
    if (videoPlaying === next) return;
    videoPlaying = next;
    playing = next;
    if (next) {
      ended = false;
      videoClockAt = Date.now();
    } else {
      videoBaseMs = estimateVideoMs();
    }
    emit('onPlayState', next);
  }

  function notifyVideoFinish() {
    if (state !== 'video') return;
    videoPlaying = false;
    playing = false;
    ended = true;
    videoBaseMs = stream ? stream.timelength : 0;
    emit('onPlayState', false);
    emit('onEnded');
  }

  /** 宿主 <video> 渲染/播放失败 → unsupported（无音频兜底，按 Task 7 约定）。 */
  function notifyVideoError(reason) {
    if (state !== 'video') return;
    videoPlaying = false;
    playing = false;
    lastError = reason || '宿主视频组件不可用';
    setState('unsupported');
    emit('onError', { message: '当前解码器在笔端不可用，请到设置页切换' });
  }

  function destroy() {
    seq++;
    stopMedia();
    if (media && mediaBound && typeof media.off === 'function') {
      for (let i = 0; i < mediaHandlers.length; i++) {
        try {
          media.off(mediaHandlers[i][0], mediaHandlers[i][1]);
        } catch (err) {}
      }
    }
    mediaBound = false;
    mediaHandlers = [];
    stream = null;
    lastError = '';
    setState('idle');
  }

  return {
    prepare,
    play,
    pause,
    togglePlay,
    seek,
    setRate,
    getProgress,
    getState: function () {
      return state;
    },
    getInfo: info,
    isPlaying: function () {
      return playing;
    },
    notifyVideoState,
    notifyVideoFinish,
    notifyVideoError,
    destroy,
  };
}
