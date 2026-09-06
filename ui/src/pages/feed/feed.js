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
 * feed.js —— 刷视频页（类抖音连播，左右滑动切换上一条/下一条）
 *
 * 入参（onLoad）：{ bvid? }（上游 videoDetail ⏭ 连播传入）。
 * - 带 bvid：getVideoDetail 把该视频作为第 0 条并立即播放，getRecommendFeed 推荐流续尾；
 * - 无 bvid：读断点 storage key `bilibili_feed_breakpoint`（{bvid, index}），先拉推荐流
 *   并滑到断点条（优先按 bvid 定位，退化按 index，再退化从头）；恢复失败静默从头。
 *
 * 播放队列：[{bvid,aid,cid,title,pic,owner}]；滑到倒数第 2 条自动取下一页
 *   （getRecommendFeed(ps, refreshIndex)，refreshIndex 递增映射 fresh_idx），无缝 concat。
 * 滑动切换：@swipe 与 @panstart/@panmove/@panend 双通道（index 页同款约定，
 *   changedTouches[0].pageX/pageY 防御式解析；|dx|>60px 且 |dx|>|dy| 判翻页），
 *   SLIDE_LOCK_MS=300 防双触发；左滑=下一条、右滑=上一条；边界静默；左右箭头兜底。
 * 播放：services/player.js createPlayer 单实例，切条即 prepare 新条目并自动播放
 *   （auto→system video / ffmpeg→media_frame 帧 / audio_only→封面音频，降级链内置）；
 *   unsupported/error 态显示封面+标题+提示，不阻塞滑动切条。
 * 自动连播：onEnded → 切下一条；已在队尾则先"加载更多..."等待取到新条目再连播
 *   （loadMore 并发复用同一 Promise）；确无更多则提示。
 * 序号守卫：prepare 异步，快速连续滑动时 UI 以 prepareSeq 单调标记最新目标条，
 *   旧请求的完成事件由内核 seq（services/player.js prepare 内 mySeq!==seq 即丢弃）过滤；
 *   跨异步的自动连播（等待加载期间用户又切条）用捕获序号比对放弃，避免抢焦点。
 * 进度：内核无 onProgress 回调，按 player 页先例用 $page.setInterval 500ms 轮询
 *   getProgress() 驱动底部进度细条（宿主无 setInterval 时退回全局）。
 */

import { defineComponent } from 'vue';
import Loading from '../../components/loading.vue';
import Empty from '../../components/empty.vue';
import { getRecommendFeed } from '../../services/api/recommend.js';
import { getVideoDetail } from '../../services/api/video.js';
import { createPlayer } from '../../services/player.js';
import { setSettings, PLAYBACK_RATE_OPTIONS } from '../../services/settings.js';
import { storageGet, storageSet } from '../../services/env.js';

const PAGE_SIZE = 15;
const PRELOAD_AHEAD = 2;
const SLIDE_THRESHOLD = 60;
const DRAG_THRESHOLD = 10;
const SLIDE_LOCK_MS = 300;
const CLICK_GUARD_MS = 250;
const TICK_MS = 500;
const NOTICE_MS = 5000;
const TRACK_WIDTH = 248;
const BREAKPOINT_KEY = 'bilibili_feed_breakpoint';

const ERROR_MESSAGES = {
  '-101': '未登录，仍可继续刷视频',
  '-412': '请求被风控拦截，请稍后再试',
  '-352': '触发安全验证，请稍后再试',
  '-1': '网络连接失败，请检查网络',
  '-2': '响应数据异常',
  '-3': '请求参数错误',
};

const page = defineComponent({
  components: {
    loading: Loading,
    empty: Empty,
  },
  data() {
    return {
      state: 'loading',
      errorCode: 0,
      errorMsg: '',
      queue: [],
      currentIndex: 0,
      refreshIndex: 1,
      hasMore: true,
      loadingMore: false,
      feedTip: '',
      noticeText: '',
      seedBvid: '',
      pState: 'idle',
      playing: false,
      videoUrl: '',
      frameSrc: '',
      positionMs: 0,
      durationMs: 0,
      bufferedRatio: 0,
      rate: 1.0,
      rateText: '1.0x',
      playingKey: '',
      prepareSeq: 0,
      panning: false,
      panStartX: 0,
      panStartY: 0,
      panDx: 0,
      panDy: 0,
      lastSlideAt: 0,
      lastDragAt: 0,
      timerId: null,
      timerKind: '',
      noticeTimer: 0,
    };
  },
  computed: {
    currentItem() {
      return this.queue[this.currentIndex] || null;
    },
    isPreparing() {
      return this.pState === 'preparing';
    },
    isVideoMode() {
      return this.pState === 'video' && !!this.videoUrl;
    },
    isAudioMode() {
      return this.pState === 'audio';
    },
    isUnsupported() {
      return this.pState === 'unsupported';
    },
    isErrorState() {
      return this.pState === 'error';
    },
    hasFrame() {
      return this.isAudioMode && !!this.frameSrc;
    },
    coverUrl() {
      return (this.currentItem && this.currentItem.pic) || '';
    },
    titleText() {
      return (this.currentItem && this.currentItem.title) || '';
    },
    upText() {
      const item = this.currentItem;
      return (item && item.owner && item.owner.name) || '未知UP主';
    },
    counterText() {
      if (!this.queue.length) return '';
      return (this.currentIndex + 1) + ' / ' + this.queue.length;
    },
    fillWidth() {
      const ratio = this.durationMs > 0 ? Math.min(1, this.positionMs / this.durationMs) : 0;
      return Math.round(ratio * TRACK_WIDTH);
    },
    modeHint() {
      if (this.isUnsupported) return '当前解码器在笔端不可用，滑动可切换下一条';
      if (this.isErrorState) return '播放出错，滑动可切换下一条';
      return '';
    },
    footerText() {
      if (this.loadingMore) return '正在加载更多...';
      if (this.feedTip) return this.feedTip;
      return '';
    },
  },
  mounted() {
    const pageObj = this.$page;
    const options = (pageObj && (pageObj.loadOptions || pageObj.options)) || {};
    this.initPlayer();
    this.bootstrap(options);
  },
  unmounted() {
    this.teardown();
  },
  methods: {
    initPlayer() {
      const self = this;
      this.player = createPlayer({
        onState(state, info) {
          self.pState = state;
          self.syncInfo(info);
        },
        onReady(info) {
          self.syncInfo(info);
        },
        onFrame(uri) {
          if (uri) self.frameSrc = uri;
        },
        onEnded() {
          self.onPlayEnded();
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
        onRate(r) {
          self.rate = Number(r) || 1.0;
          self.rateText = self.formatRate(self.rate);
        },
      });
    },
    syncInfo(info) {
      if (!info) return;
      this.videoUrl = info.state === 'video' ? info.url : '';
      if (info.timelength) this.durationMs = info.timelength;
      if (info.rate) {
        this.rate = info.rate;
        this.rateText = this.formatRate(this.rate);
      }
      if (info.state !== 'audio') this.frameSrc = '';
    },
    async bootstrap(options) {
      const opts = options || {};
      const bvid = String(opts.bvid || '').trim();
      this.seedBvid = bvid;
      if (bvid) {
        await this.loadWithSeed(bvid);
      } else {
        await this.loadFeedWithBreakpoint();
      }
      this.startTimer();
    },
    async loadWithSeed(bvid) {
      this.state = 'loading';
      this.errorCode = 0;
      this.errorMsg = '';
      try {
        const detail = await getVideoDetail(bvid);
        const pages = detail.pages || [];
        const cid = detail.cid || (pages[0] && pages[0].cid) || 0;
        this.queue = [
          {
            bvid: detail.bvid || bvid,
            aid: detail.aid || 0,
            cid,
            title: detail.title || '',
            pic: detail.pic || '',
            owner: {
              name: (detail.owner && detail.owner.name) || '',
              mid: (detail.owner && detail.owner.mid) || 0,
              face: (detail.owner && detail.owner.face) || '',
            },
          },
        ];
        this.refreshIndex = 1;
        this.hasMore = true;
        this.state = 'ready';
        this.slideToIndex(0);
        this.loadMore();
      } catch (err) {
        this.showFeedError(err);
      }
    },
    async loadFeedWithBreakpoint() {
      const bp = await this.readBreakpoint();
      try {
        await this.loadFirstPage(bp);
      } catch (err) {
        if (!bp) {
          this.showFeedError(err);
          return;
        }
        try {
          await this.loadFirstPage(null);
        } catch (retryErr) {
          this.showFeedError(retryErr);
        }
      }
    },
    readBreakpoint() {
      return storageGet(BREAKPOINT_KEY, null)
        .then((bp) => {
          if (bp && bp.bvid && typeof bp.index === 'number' && bp.index >= 0) return bp;
          return null;
        })
        .catch(() => null);
    },
    saveBreakpoint() {
      const item = this.queue[this.currentIndex];
      if (!item || !item.bvid) return;
      storageSet(BREAKPOINT_KEY, { bvid: item.bvid, index: this.currentIndex }).catch(() => {});
    },
    async loadFirstPage(bp) {
      this.state = 'loading';
      this.errorCode = 0;
      this.errorMsg = '';
      this.feedTip = '';
      this.currentIndex = 0;
      this.refreshIndex = 1;
      this.hasMore = true;
      this.queue = [];
      const items = await getRecommendFeed(PAGE_SIZE, this.refreshIndex);
      this.refreshIndex += 1;
      if (!items.length) {
        this.hasMore = false;
        this.state = 'empty';
        return;
      }
      if (items.length < PAGE_SIZE) this.hasMore = false;
      this.queue = items;
      let target = 0;
      if (bp) {
        const byId = this.indexOfBvid(bp.bvid);
        if (byId >= 0) {
          target = byId;
        } else if (bp.index < this.queue.length) {
          target = bp.index;
        }
      }
      this.state = 'ready';
      this.slideToIndex(target);
    },
    showFeedError(err) {
      const mapped = this.mapError(err);
      this.errorCode = mapped.code;
      this.errorMsg = mapped.message;
      this.state = 'error';
      if (mapped.code === -101) {
        this.showNotice('未登录，仍可继续刷视频');
      }
    },
    indexOfBvid(bvid) {
      for (let i = 0; i < this.queue.length; i++) {
        if (this.queue[i] && this.queue[i].bvid === bvid) return i;
      }
      return -1;
    },
    mapError(err) {
      const code = (err && err.code) || 0;
      const mapped = ERROR_MESSAGES[String(code)];
      if (mapped) {
        return { code, message: mapped };
      }
      return { code, message: (err && err.message) || '加载失败，请稍后再试' };
    },
    showNotice(text) {
      this.noticeText = text;
      if (this.noticeTimer) clearTimeout(this.noticeTimer);
      this.noticeTimer = setTimeout(() => {
        this.noticeText = '';
        this.noticeTimer = 0;
      }, NOTICE_MS);
    },
    slideToIndex(index) {
      if (index < 0 || index >= this.queue.length) return false;
      this.currentIndex = index;
      this.playAt(index);
      this.maybePreload();
      return true;
    },
    playAt(index) {
      const item = this.queue[index];
      if (!item || !this.player) return;
      const key = item.bvid + ':' + (item.cid || 0);
      if (key === this.playingKey && this.pState !== 'idle' && this.pState !== 'error') return;
      this.prepareSeq += 1;
      this.playingKey = key;
      this.frameSrc = '';
      this.videoUrl = '';
      this.positionMs = 0;
      this.durationMs = 0;
      this.bufferedRatio = 0;
      this.playing = false;
      this.feedTip = '';
      this.saveBreakpoint();
      this.player.prepare({ bvid: item.bvid, aid: item.aid, cid: item.cid });
    },
    slideBy(delta) {
      const now = Date.now();
      if (now - this.lastSlideAt < SLIDE_LOCK_MS) return;
      if (this.state !== 'ready' || !this.queue.length) return;
      const next = this.currentIndex + delta;
      if (next < 0) return;
      if (next >= this.queue.length) {
        if (this.hasMore) {
          this.feedTip = '正在加载更多...';
          this.loadMore();
        } else {
          this.feedTip = '已经滑到最后一条了';
        }
        return;
      }
      this.lastSlideAt = now;
      this.feedTip = '';
      this.slideToIndex(next);
    },
    onPrev() {
      if (this.isGuardedClick()) return;
      this.slideBy(-1);
    },
    onNext() {
      if (this.isGuardedClick()) return;
      this.slideBy(1);
    },
    isGuardedClick() {
      return Date.now() - this.lastDragAt < CLICK_GUARD_MS;
    },
    onPlayEnded() {
      const token = this.prepareSeq;
      const next = this.currentIndex + 1;
      if (next < this.queue.length) {
        this.slideToIndex(next);
        return;
      }
      if (this.hasMore) {
        this.feedTip = '加载更多...';
        this.autoNextAfterLoad(token);
      } else {
        this.feedTip = '已经全部播完了';
      }
    },
    async autoNextAfterLoad(token) {
      await this.loadMore();
      if (token !== this.prepareSeq) return;
      if (this.state !== 'ready') return;
      const next = this.currentIndex + 1;
      if (next < this.queue.length) {
        this.slideToIndex(next);
      } else if (!this.hasMore) {
        this.feedTip = '暂无更多内容';
      } else {
        this.feedTip = '加载更多...';
      }
    },
    async loadMore() {
      if (this.loadingMore) return this.morePromise || false;
      if (!this.hasMore) return false;
      this.loadingMore = true;
      this.morePromise = this.doLoadMore();
      const ok = await this.morePromise;
      this.morePromise = null;
      return ok;
    },
    async doLoadMore() {
      try {
        const items = await getRecommendFeed(PAGE_SIZE, this.refreshIndex);
        this.refreshIndex += 1;
        if (!items.length) {
          this.hasMore = false;
          return false;
        }
        if (items.length < PAGE_SIZE) this.hasMore = false;
        this.queue = this.queue.concat(items);
        return true;
      } catch (err) {
        const mapped = this.mapError(err);
        this.feedTip = mapped.message + '，稍后滑动可重试';
        if (mapped.code === -101) {
          this.showNotice('未登录，仍可继续刷视频');
        }
        return false;
      } finally {
        this.loadingMore = false;
      }
    },
    maybePreload() {
      if (!this.hasMore || this.loadingMore) return;
      if (this.currentIndex >= this.queue.length - PRELOAD_AHEAD) {
        this.loadMore();
      }
    },
    getTouch(e) {
      const t = (e && e.changedTouches && e.changedTouches[0])
        || (e && e.touches && e.touches[0])
        || e
        || {};
      return {
        x: typeof t.pageX === 'number' ? t.pageX : (t.clientX || 0),
        y: typeof t.pageY === 'number' ? t.pageY : (t.clientY || 0),
      };
    },
    onPanStart(e) {
      const t = this.getTouch(e);
      this.panning = true;
      this.panStartX = t.x;
      this.panStartY = t.y;
      this.panDx = 0;
      this.panDy = 0;
    },
    onPanMove(e) {
      if (!this.panning) return;
      const t = this.getTouch(e);
      this.panDx = t.x - this.panStartX;
      this.panDy = t.y - this.panStartY;
      if (Math.abs(this.panDx) > DRAG_THRESHOLD || Math.abs(this.panDy) > DRAG_THRESHOLD) {
        this.lastDragAt = Date.now();
      }
    },
    onPanEnd() {
      const dx = this.panDx;
      const dy = this.panDy;
      this.panning = false;
      this.panStartX = 0;
      this.panStartY = 0;
      this.panDx = 0;
      this.panDy = 0;
      if (Math.abs(dx) > SLIDE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
        this.slideBy(dx < 0 ? 1 : -1);
      }
    },
    onSwipe(e) {
      const dir = e && e.direction;
      if (dir === 'left') {
        this.slideBy(1);
      } else if (dir === 'right') {
        this.slideBy(-1);
      }
    },
    onRateCycle() {
      if (this.isGuardedClick()) return;
      const rates = PLAYBACK_RATE_OPTIONS;
      const idx = rates.indexOf(this.rate);
      const next = rates[(idx + 1) % rates.length] || 1.0;
      if (this.player) this.player.setRate(next);
      this.rate = next;
      this.rateText = this.formatRate(next);
      setSettings({ playbackRate: next }).catch(() => {});
    },
    formatRate(r) {
      const n = Number(r) || 1.0;
      const text = n === Math.floor(n) ? n.toFixed(1) : String(n);
      return text + 'x';
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
    onRetry() {
      if (this.seedBvid) {
        this.loadWithSeed(this.seedBvid);
      } else {
        this.loadFeedWithBreakpoint();
      }
    },
    onExit() {
      if (this.isGuardedClick()) return;
      this.saveBreakpoint();
      this.teardown();
      const pageObj = this.$page;
      if (pageObj && typeof pageObj.finish === 'function') pageObj.finish();
    },
    tick() {
      if (!this.player || this.pState === 'preparing') return;
      const st = this.player.getProgress();
      this.positionMs = st.positionMs || 0;
      if (st.durationMs) this.durationMs = st.durationMs;
      this.playing = !!st.playing;
      this.bufferedRatio = Number(st.bufferedRatio) || 0;
    },
    startTimer() {
      if (this.timerId) return;
      const self = this;
      const tick = () => {
        self.tick();
      };
      const pageObj = this.$page;
      if (pageObj && typeof pageObj.setInterval === 'function') {
        this.timerId = pageObj.setInterval(tick, TICK_MS);
        this.timerKind = 'page';
      } else {
        this.timerId = setInterval(tick, TICK_MS);
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
      if (this.noticeTimer) {
        clearTimeout(this.noticeTimer);
        this.noticeTimer = 0;
      }
      if (this.player) {
        this.player.destroy();
        this.player = null;
      }
    },
  },
});

export default page;
