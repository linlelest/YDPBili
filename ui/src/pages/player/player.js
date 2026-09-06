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
 * player.js —— 播放器页
 *
 * 入参（onLoad）：{ bvid, aid, cid, title }（上游 videoDetail ▶ 播放时 navTo 传入）。
 * 内核：services/player.js createPlayer（state: idle/preparing/video/audio/unsupported/error）。
 * 视频区：video 模式原生 <video>；audio/unsupported 模式封面 + 播放按钮 + 波形装饰。
 * 控制栏：播放/暂停、进度条（点按 seek）、倍速循环（写 settings.playbackRate）、
 *   画质面板（acceptQuality → 重新 prepare；audio 模式标注"仅系统解码支持"）。
 * 进度刷新：$page.setInterval 500ms（无宿主实现时退回全局 setInterval）。
 */

import { defineComponent } from 'vue';
import NavBar from '../../components/nav-bar.vue';
import Loading from '../../components/loading.vue';
import Empty from '../../components/empty.vue';
import DanmakuLayer from './danmaku-layer.vue';
import { biliGet } from '../../services/http.js';
import { createPlayer, qualityLabel } from '../../services/player.js';
import {
  getSettings,
  setSettings,
  PLAYBACK_RATE_OPTIONS,
  QUALITY_OPTIONS,
} from '../../services/settings.js';
import {
  getSubtitleTracks,
  getSubtitleBody,
  findSubtitleLine,
} from '../../services/api/subtitle.js';
import { getDanmaku } from '../../services/api/danmaku.js';
import { formatDuration } from '../../utils/format.js';

const TRACK_WIDTH = 248;
const TRACK_PAGE_OFFSET = 16;
const WAVE_BARS = [14, 24, 34, 24, 14, 24, 14];
const DANMAKU_FONT_SIZES = [18, 25, 36];

const page = defineComponent({
  components: {
    'nav-bar': NavBar,
    loading: Loading,
    empty: Empty,
    'danmaku-layer': DanmakuLayer,
  },
  data() {
    return {
      title: '播放',
      bvid: '',
      aid: 0,
      cid: 0,
      state: 'idle',
      playing: false,
      coverUrl: '',
      frameSrc: '',
      videoUrl: '',
      modeText: '',
      quality: 0,
      qualityText: '自动',
      acceptQuality: [],
      rate: 1.0,
      rateText: '1.0x',
      durationMs: 0,
      positionMs: 0,
      positionText: '00:00',
      durationText: '--:--',
      progressPct: 0,
      bufferedRatio: 0,
      noticeText: '',
      errorMessage: '',
      paramError: false,
      showQualityPanel: false,
      qualityLimited: false,
      waveBars: WAVE_BARS,
      timerId: null,
      timerKind: '',
      subtitleTracks: [],
      subtitleAvailable: false,
      subtitleLan: '',
      subtitleOn: false,
      subtitleLine: '',
      showSubtitlePanel: false,
      subtitleLoading: false,
      subtitleCache: {},
      danmakuItems: [],
      danmakuOn: true,
      danmakuFontSize: 25,
      danmakuResetKey: 0,
      danmakuLoading: false,
      danmakuError: '',
    };
  },
  computed: {
    isPreparing() {
      return this.state === 'preparing';
    },
    isVideoMode() {
      return this.state === 'video' && !!this.videoUrl;
    },
    isAudioMode() {
      return this.state === 'audio';
    },
    isUnsupported() {
      return this.state === 'unsupported';
    },
    isError() {
      return this.state === 'error';
    },
    hasFrame() {
      return this.isAudioMode && !!this.frameSrc;
    },
    bufferPctText() {
      return Math.round(this.bufferedRatio * 100) + '%';
    },
    showBuffer() {
      return this.isAudioMode && this.bufferedRatio > 0 && this.bufferedRatio < 1;
    },
    fillWidth() {
      const ratio = this.durationMs > 0 ? Math.min(1, this.positionMs / this.durationMs) : 0;
      return Math.round(ratio * TRACK_WIDTH);
    },
    bufferWidth() {
      return Math.round(Math.min(1, this.bufferedRatio) * TRACK_WIDTH);
    },
    qualityOptions() {
      const list = this.acceptQuality || [];
      return QUALITY_OPTIONS.filter(function (qn) {
        return list.indexOf(qn) >= 0;
      }).map(function (qn) {
        return { qn, label: qualityLabel(qn) };
      });
    },
    playIcon() {
      return this.playing ? '⏸' : '▶';
    },
    subtitleBtnText() {
      if (!this.subtitleAvailable) return '字幕 无';
      return '字幕 ' + (this.subtitleOn ? '开' : '关');
    },
    danmakuBtnText() {
      return '💬 弹幕 ' + (this.danmakuOn ? '开' : '关');
    },
    subtitleCurrentDoc() {
      const lan = this.subtitleLan;
      for (let i = 0; i < this.subtitleTracks.length; i++) {
        if (this.subtitleTracks[i].lan === lan) return this.subtitleTracks[i].lanDoc;
      }
      return '';
    },
  },
  mounted() {
    const pageObj = this.$page;
    const options = (pageObj && (pageObj.loadOptions || pageObj.options)) || {};
    this.applyOptions(options);
    this.initDanmakuSettings();
  },
  onShow() {
    const pageObj = this.$page;
    if (!pageObj) return;
    const latest = pageObj.newOptions;
    if (latest && latest.bvid && String(latest.bvid) !== String(this.bvid)) {
      this.applyOptions(latest);
    }
  },
  methods: {
    formatDuration,
    onBack() {
      this.teardown();
      const pageObj = this.$page;
      if (pageObj && typeof pageObj.finish === 'function') pageObj.finish();
    },
    applyOptions(options) {
      const opts = options || {};
      const prevCid = this.cid;
      this.bvid = String(opts.bvid || '');
      this.aid = Number(opts.aid) || 0;
      this.cid = Number(opts.cid) || 0;
      this.title = String(opts.title || '播放');
      this.noticeText = '';
      this.showQualityPanel = false;
      this.showSubtitlePanel = false;
      if (!this.player) this.initPlayer();
      if (!this.bvid && !this.cid) {
        this.paramError = true;
        return;
      }
      this.paramError = false;
      this.fetchCover();
      if (this.cid && String(this.cid) !== String(prevCid)) {
        this.loadSubtitleTracks();
        this.loadDanmaku();
      }
      this.startTimer();
      this.player.prepare({ bvid: this.bvid, aid: this.aid, cid: this.cid });
    },
    initPlayer() {
      const self = this;
      this.player = createPlayer({
        onState(state, info) {
          self.state = state;
          self.syncInfo(info);
        },
        onReady(info) {
          self.syncInfo(info);
        },
        onFrame(uri) {
          if (uri) self.frameSrc = uri;
        },
        onEnded() {
          self.playing = false;
        },
        onPlayState(p) {
          self.playing = !!p;
        },
        onDownload(ratio) {
          self.bufferedRatio = Number(ratio) || 0;
        },
        onNotice(msg) {
          self.noticeText = msg || '';
        },
        onError(err) {
          self.noticeText = (err && err.message) || '播放出错';
        },
      });
    },
    syncInfo(info) {
      if (!info) return;
      this.videoUrl = info.state === 'video' ? info.url : '';
      this.quality = info.quality || 0;
      this.qualityText = qualityLabel(this.quality);
      this.acceptQuality = info.acceptQuality || [];
      if (info.timelength) this.durationMs = info.timelength;
      this.rate = info.rate || this.rate;
      this.rateText = this.formatRate(this.rate);
      this.modeText = this.buildModeText(info.state, info.decoder);
      this.qualityLimited = info.state === 'audio' || info.state === 'unsupported';
      if (info.state !== 'audio') this.frameSrc = '';
      this.errorMessage = info.state === 'error' ? info.error || '播放出错，请重试' : '';
      this.updateTimeText(this.positionMs);
    },
    buildModeText(state, decoder) {
      if (state === 'video') return '系统解码 · MP4';
      if (state === 'audio') return decoder === 'ffmpeg' ? '软解 · 音频+画面' : '仅音频';
      if (state === 'unsupported') return '解码器不可用';
      if (state === 'error') return '播放出错';
      return '准备中';
    },
    async fetchCover() {
      const bvid = this.bvid;
      if (!bvid) return;
      try {
        const data = await biliGet('/x/web-interface/view', { params: { bvid } });
        if (bvid !== this.bvid) return;
        this.coverUrl = (data && data.pic) || '';
      } catch (err) {
        this.coverUrl = '';
      }
    },
    /** 弹幕开关默认值与字号：读设置页持久化字段（存在性兜底，会话内可切但不写回）。 */
    async initDanmakuSettings() {
      let enabled;
      let size;
      try {
        const settings = await getSettings();
        enabled = settings.danmakuEnabled;
        size = Number(settings.danmakuFontSize);
      } catch (err) {
        enabled = undefined;
        size = NaN;
      }
      this.danmakuOn = enabled === undefined || enabled === null ? true : !!enabled;
      this.danmakuFontSize =
        DANMAKU_FONT_SIZES.indexOf(size) >= 0 ? size : 25;
    },
    /** 拉字幕轨道：WBI 签名 + Cookie（http.js 统一）；未登录/无字幕 → 空（CC 置灰）。 */
    async loadSubtitleTracks() {
      const cid = this.cid;
      this.subtitleTracks = [];
      this.subtitleAvailable = false;
      this.subtitleLan = '';
      this.subtitleOn = false;
      this.subtitleLine = '';
      this.subtitleCache = {};
      if (!cid || (!this.aid && !this.bvid)) return;
      try {
        const tracks = await getSubtitleTracks({
          aid: this.aid,
          cid,
          bvid: this.bvid,
        });
        if (cid !== this.cid) return;
        this.subtitleTracks = tracks;
        this.subtitleAvailable = tracks.length > 0;
      } catch (err) {
        if (cid !== this.cid) return;
        this.subtitleAvailable = false;
      }
    },
    /** 拉弹幕（list.so XML，预排序）；失败仅提示，不阻塞播放。 */
    async loadDanmaku() {
      const cid = this.cid;
      this.danmakuItems = [];
      this.danmakuError = '';
      this.danmakuResetKey += 1;
      if (!cid) return;
      this.danmakuLoading = true;
      try {
        const list = await getDanmaku(cid);
        if (cid !== this.cid) return;
        this.danmakuItems = list;
      } catch (err) {
        if (cid !== this.cid) return;
        this.danmakuError = (err && err.message) || '弹幕获取失败';
        this.noticeText = '弹幕获取失败';
      } finally {
        if (cid === this.cid) this.danmakuLoading = false;
      }
    },
    /** CC 按钮：无轨道置灰并提示；有轨道直接开/关（首次默认第一条轨道）。 */
    onToggleSubtitle() {
      if (!this.subtitleAvailable) {
        this.noticeText = '未登录或该视频暂无字幕';
        return;
      }
      if (this.subtitleOn) {
        this.subtitleOn = false;
        this.subtitleLine = '';
        return;
      }
      if (!this.subtitleLan) {
        const first = this.subtitleTracks[0];
        if (!first) return;
        this.onSubtitlePick(first);
        return;
      }
      this.subtitleOn = true;
      this.ensureSubtitleBody(this.subtitleLan);
    },
    /** 语言面板入口：点击字幕条切换面板。 */
    onSubtitleBarTap() {
      if (!this.subtitleAvailable) return;
      this.showSubtitlePanel = !this.showSubtitlePanel;
    },
    async onSubtitlePick(track) {
      if (!track || !track.lan) return;
      this.showSubtitlePanel = false;
      this.subtitleOn = true;
      const lan = track.lan;
      this.subtitleLan = lan;
      this.subtitleLine = '';
      await this.ensureSubtitleBody(lan);
      if (this.cid && this.subtitleOn && this.subtitleLan === lan) {
        this.updateSubtitleLine();
      }
    },
    onSubtitleOff() {
      this.showSubtitlePanel = false;
      this.subtitleOn = false;
      this.subtitleLine = '';
    },
    /** 拉取并缓存所选语言字幕正文（JSON body，from/to 秒）。 */
    async ensureSubtitleBody(lan) {
      if (!lan) return;
      if (this.subtitleCache[lan]) return;
      let track = null;
      for (let i = 0; i < this.subtitleTracks.length; i++) {
        if (this.subtitleTracks[i].lan === lan) {
          track = this.subtitleTracks[i];
          break;
        }
      }
      if (!track || !track.url) return;
      const cid = this.cid;
      this.subtitleLoading = true;
      try {
        const body = await getSubtitleBody(track.url);
        if (cid !== this.cid) return;
        this.subtitleCache = Object.assign({}, this.subtitleCache);
        this.subtitleCache[lan] = body;
      } catch (err) {
        if (cid === this.cid) this.noticeText = '字幕加载失败';
      } finally {
        if (cid === this.cid) this.subtitleLoading = false;
      }
    },
    /** 会话级弹幕开关：不写回设置（设置页为持久化入口）。 */
    onToggleDanmaku() {
      this.danmakuOn = !this.danmakuOn;
    },
    /** 进度回调内查当前字幕句（二分，from <= pos < to）。 */
    updateSubtitleLine() {
      if (!this.subtitleOn || !this.subtitleLan) {
        if (this.subtitleLine) this.subtitleLine = '';
        return;
      }
      const body = this.subtitleCache[this.subtitleLan];
      const line = body && body.length ? findSubtitleLine(body, this.positionMs) : '';
      if (line !== this.subtitleLine) this.subtitleLine = line;
    },
    onTogglePlay() {
      if (!this.player) return;
      const st = this.player.getState();
      if (st === 'video' || st === 'audio') this.player.togglePlay();
    },
    onSeekTap(e) {
      if (!this.player || this.durationMs <= 0) return;
      const ev = e || {};
      let x = null;
      if (typeof ev.offsetX === 'number') x = ev.offsetX;
      else if (ev.detail && typeof ev.detail.offsetX === 'number') x = ev.detail.offsetX;
      else if (typeof ev.clientX === 'number') x = ev.clientX - TRACK_PAGE_OFFSET;
      if (x == null) x = 0;
      const ratio = Math.max(0, Math.min(1, x / TRACK_WIDTH));
      const target = Math.floor(ratio * this.durationMs);
      this.player.seek(target);
      this.positionMs = target;
      this.updateTimeText(target);
    },
    onRateCycle() {
      const rates = PLAYBACK_RATE_OPTIONS;
      const idx = rates.indexOf(this.rate);
      const next = rates[(idx + 1) % rates.length] || 1.0;
      if (this.player) this.player.setRate(next);
      this.rate = next;
      this.rateText = this.formatRate(next);
      setSettings({ playbackRate: next }).catch(function () {});
    },
    onToggleQualityPanel() {
      this.showQualityPanel = !this.showQualityPanel;
    },
    onQualityPick(item) {
      this.showQualityPanel = false;
      if (!item || !this.player) return;
      this.noticeText = '';
      const needSystem = this.state === 'audio' || this.state === 'unsupported';
      this.player.prepare({
        bvid: this.bvid,
        aid: this.aid,
        cid: this.cid,
        qn: item.qn,
        decoder: needSystem ? 'system' : undefined,
      });
    },
    onOpenSettings() {
      $falcon.navTo('settings', {});
    },
    onRetry() {
      if (!this.player || (!this.bvid && !this.cid)) return;
      this.noticeText = '';
      this.player.prepare({ bvid: this.bvid, aid: this.aid, cid: this.cid });
    },
    onVideoStart() {
      if (this.player) this.player.notifyVideoState(true);
    },
    onVideoPause() {
      if (this.player) this.player.notifyVideoState(false);
    },
    onVideoFinish() {
      if (this.player) this.player.notifyVideoFinish();
    },
    onVideoFail() {
      if (this.player) this.player.notifyVideoError('宿主视频组件播放失败');
    },
    formatRate(r) {
      const n = Number(r) || 1.0;
      const text = n === Math.floor(n) ? n.toFixed(1) : String(n);
      return text + 'x';
    },
    updateTimeText(ms) {
      this.positionText = formatDuration(Math.floor((Number(ms) || 0) / 1000));
      this.durationText =
        this.durationMs > 0 ? formatDuration(Math.floor(this.durationMs / 1000)) : '--:--';
    },
    tick() {
      if (!this.player || this.state === 'preparing') return;
      const st = this.player.getProgress();
      this.positionMs = st.positionMs || 0;
      if (st.durationMs) this.durationMs = st.durationMs;
      this.playing = !!st.playing;
      this.bufferedRatio = Number(st.bufferedRatio) || 0;
      this.updateTimeText(this.positionMs);
      this.updateSubtitleLine();
    },
    startTimer() {
      if (this.timerId) return;
      const self = this;
      const tick = function () {
        self.tick();
      };
      const pageObj = this.$page;
      if (pageObj && typeof pageObj.setInterval === 'function') {
        this.timerId = pageObj.setInterval(tick, 500);
        this.timerKind = 'page';
      } else {
        this.timerId = setInterval(tick, 500);
        this.timerKind = 'global';
      }
    },
    stopTimer() {
      if (!this.timerId) return;
      if (this.timerKind === 'page') {
        const pageObj = this.$page;
        if (pageObj && typeof pageObj.clearInterval === 'function') pageObj.clearInterval(this.timerId);
      } else {
        clearInterval(this.timerId);
      }
      this.timerId = null;
      this.timerKind = '';
    },
    teardown() {
      this.stopTimer();
      if (this.player) {
        this.player.destroy();
        this.player = null;
      }
    },
  },
});

export default page;
