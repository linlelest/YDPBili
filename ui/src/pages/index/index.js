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
 * index.js —— 主页（推荐页，单卡横向滑动）
 *
 * 数据：api/recommend.js getRecommendFeed(ps, refreshIndex)
 *   refreshIndex 映射 fresh_idx/fresh_idx_1h（从 1 开始，成功后本地 +1）。
 * 手势：@swipe（优先，direction）与 @panstart/@panmove/@panend（位移 >60px 判翻页）
 *   双通道并存，SLIDE_LOCK_MS 防抖避免同一次滑动翻两页；箭头按钮兜底。
 * 状态：loading（首屏）/ ready / empty / error（BiliApiError code 文案映射），
 *   -101 未登录仅提示，不阻断浏览。
 */

import { defineComponent } from 'vue';
import VideoCard from '../../components/video-card.vue';
import Loading from '../../components/loading.vue';
import Empty from '../../components/empty.vue';
import { getRecommendFeed } from '../../services/api/recommend.js';

const PAGE_SIZE = 15;
const PRELOAD_AHEAD = 3;
const SLIDE_THRESHOLD = 60;
const DRAG_THRESHOLD = 10;
const SLIDE_LOCK_MS = 300;
const CLICK_GUARD_MS = 250;
const NOTICE_MS = 5000;

const ERROR_MESSAGES = {
  '-101': '未登录，仍可继续浏览推荐内容',
  '-412': '请求被风控拦截，请稍后再试',
  '-352': '触发安全验证，请稍后再试',
  '-1': '网络连接失败，请检查网络',
  '-2': '响应数据异常',
  '-3': '请求参数错误',
};

const page = defineComponent({
  components: {
    'video-card': VideoCard,
    loading: Loading,
    empty: Empty,
  },
  data() {
    return {
      feedList: [],
      currentIndex: 0,
      refreshIndex: 1,
      state: 'loading',
      errorCode: 0,
      errorMsg: '',
      feedTip: '',
      notice: '',
      loadingMore: false,
      hasMore: true,
      panning: false,
      panStartX: 0,
      panStartY: 0,
      panDx: 0,
      panDy: 0,
      lastSlideAt: 0,
      lastDragAt: 0,
      noticeTimer: 0,
    };
  },
  computed: {
    currentVideo() {
      return this.feedList[this.currentIndex] || null;
    },
    counterText() {
      if (!this.feedList.length) return '';
      return (this.currentIndex + 1) + ' / ' + this.feedList.length;
    },
    canPrev() {
      return this.currentIndex > 0;
    },
    canNext() {
      return this.currentIndex < this.feedList.length - 1;
    },
  },
  mounted() {
    this.loadFirst();
  },
  unmounted() {
    if (this.noticeTimer) {
      clearTimeout(this.noticeTimer);
      this.noticeTimer = 0;
    }
  },
  methods: {
    mapError(err) {
      const code = (err && err.code) || 0;
      const mapped = ERROR_MESSAGES[String(code)];
      if (mapped) {
        return { code, message: mapped };
      }
      return { code, message: (err && err.message) || '加载失败，请稍后再试' };
    },
    showNotice(text) {
      this.notice = text;
      if (this.noticeTimer) clearTimeout(this.noticeTimer);
      this.noticeTimer = setTimeout(() => {
        this.notice = '';
        this.noticeTimer = 0;
      }, NOTICE_MS);
    },
    async loadFirst() {
      this.state = 'loading';
      this.errorCode = 0;
      this.errorMsg = '';
      this.feedTip = '';
      this.currentIndex = 0;
      this.refreshIndex = 1;
      this.hasMore = true;
      this.feedList = [];
      try {
        const items = await getRecommendFeed(PAGE_SIZE, this.refreshIndex);
        this.refreshIndex += 1;
        if (!items.length) {
          this.hasMore = false;
          this.state = 'empty';
          return;
        }
        this.feedList = items;
        this.state = 'ready';
        if (items.length < PAGE_SIZE) this.hasMore = false;
      } catch (err) {
        const mapped = this.mapError(err);
        this.errorCode = mapped.code;
        this.errorMsg = mapped.message;
        this.state = 'error';
        if (mapped.code === -101) {
          this.showNotice('未登录，推荐内容可能受限，登录后体验更佳');
        }
      }
    },
    async loadMore() {
      if (this.loadingMore || !this.hasMore) return;
      this.loadingMore = true;
      this.feedTip = '';
      try {
        const items = await getRecommendFeed(PAGE_SIZE, this.refreshIndex);
        this.refreshIndex += 1;
        if (!items.length) {
          this.hasMore = false;
          return;
        }
        if (items.length < PAGE_SIZE) this.hasMore = false;
        this.feedList = this.feedList.concat(items);
      } catch (err) {
        const mapped = this.mapError(err);
        this.feedTip = mapped.message + '，稍后滑动可重试';
        if (mapped.code === -101) {
          this.showNotice('未登录，仍可继续浏览推荐内容');
        }
      } finally {
        this.loadingMore = false;
      }
    },
    maybePreload() {
      if (!this.hasMore || this.loadingMore) return;
      if (this.currentIndex >= this.feedList.length - PRELOAD_AHEAD) {
        this.loadMore();
      }
    },
    slideBy(delta) {
      const now = Date.now();
      if (now - this.lastSlideAt < SLIDE_LOCK_MS) return;
      const list = this.feedList;
      if (!list.length) return;
      const next = this.currentIndex + delta;
      if (next < 0) return;
      if (next >= list.length) {
        if (this.hasMore) {
          this.loadMore();
        } else {
          this.feedTip = '已经滑到最后一张了';
        }
        return;
      }
      this.lastSlideAt = now;
      this.feedTip = '';
      this.currentIndex = next;
      this.maybePreload();
    },
    onPrev() {
      this.slideBy(-1);
    },
    onNext() {
      this.slideBy(1);
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
    onCardClick(item) {
      if (Date.now() - this.lastDragAt < CLICK_GUARD_MS) return;
      if (!item || !item.bvid) return;
      this.navTo('videoDetail', { bvid: item.bvid });
    },
    navTo(target, options) {
      try {
        $falcon.navTo(target, options || {});
      } catch (err) {
        this.showNotice('页面跳转失败：' + target);
      }
    },
    goSearch() {
      this.navTo('search');
    },
    goMine() {
      this.navTo('mine');
    },
    goFeed() {
      this.navTo('feed');
    },
    onRefresh() {
      this.loadFirst();
    },
  },
});

export default page;
