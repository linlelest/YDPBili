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
 * dynamics.js —— 动态页
 *
 * 数据：api/dynamic.js getDynamicFeed(offset)，offset 链式翻页（首页传空，
 *   翻页透传上次响应 offset），返回归一化卡片 cardType:
 *   video → 紧凑视频行卡（封面+标题+UP）→ videoDetail { bvid }；
 *   article/opus → article { id }（opus id 取自 major.opus，缺失时降级提示）；
 *   draw → 图片九宫格（≤4 图，点击提示）；
 *   forward → 转发文案 + 原卡摘要（orig 递归归一化，可点击）。
 * 入参：loadOptions/newOptions 无参数依赖，newOptions 变化时整页重载。
 */

import { defineComponent } from 'vue';
import NavBar from '../../components/nav-bar.vue';
import Loading from '../../components/loading.vue';
import Empty from '../../components/empty.vue';
import { getDynamicFeed } from '../../services/api/dynamic.js';
import { formatCount, formatDurationText } from '../../utils/format.js';

const NOTICE_MS = 4000;
const MAX_GRID_IMAGES = 4;
const MAX_INLINE_IMAGES = 3;

const ERROR_MESSAGES = {
  '-101': '未登录，请先登录',
  '-412': '请求被风控拦截，请稍后再试',
  '-352': '触发安全验证，请稍后再试',
  '-1': '网络连接失败，请检查网络',
  '-2': '响应数据异常',
  '-3': '请求参数错误',
};

const page = defineComponent({
  components: {
    'nav-bar': NavBar,
    loading: Loading,
    empty: Empty,
  },
  data() {
    return {
      title: '动态',
      state: 'loading',
      list: [],
      offset: '',
      hasMore: false,
      loadingMore: false,
      refreshing: false,
      errorCode: 0,
      errorMsg: '',
      notice: '',
      noticeTimer: 0,
    };
  },
  computed: {
    isEmpty() {
      return this.state === 'ready' && this.list.length === 0;
    },
  },
  created() {
    this.startOptions = {};
    this.lastNewOptionsKey = '';
  },
  mounted() {
    const pageObj = this.$page;
    this.startOptions = (pageObj && (pageObj.loadOptions || pageObj.options)) || {};
    this.lastNewOptionsKey = JSON.stringify(this.startOptions) || '';
    this.loadFirst();
  },
  unmounted() {
    if (this.noticeTimer) {
      clearTimeout(this.noticeTimer);
      this.noticeTimer = 0;
    }
  },
  methods: {
    formatCount,
    onShow() {
      const pageObj = this.$page;
      const latest = (pageObj && pageObj.newOptions) || null;
      if (!latest) return;
      const latestKey = JSON.stringify(latest) || '';
      if (latestKey && latestKey !== this.lastNewOptionsKey) {
        this.lastNewOptionsKey = latestKey;
        this.startOptions = latest;
        this.loadFirst();
      }
    },
    onBack() {
      const pageObj = this.$page;
      if (pageObj && typeof pageObj.finish === 'function') pageObj.finish();
    },
    navTo(target, params) {
      try {
        $falcon.navTo(target, params || {});
      } catch (err) {
        this.showNotice('页面跳转失败：' + target);
      }
    },
    mapError(err) {
      const code = (err && err.code) || 0;
      const mapped = ERROR_MESSAGES[String(code)];
      return {
        code,
        message: mapped || (err && err.message) || '加载失败，请稍后再试',
      };
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
      if (this.refreshing) return;
      if (this.list.length === 0) {
        this.state = 'loading';
      } else {
        this.refreshing = true;
      }
      this.errorCode = 0;
      this.errorMsg = '';
      try {
        const result = await getDynamicFeed('');
        this.list = result.items;
        this.offset = result.offset;
        this.hasMore = result.hasMore;
        this.state = 'ready';
      } catch (err) {
        const mapped = this.mapError(err);
        if (this.list.length === 0) {
          this.state = 'error';
          this.errorCode = mapped.code;
          this.errorMsg = mapped.message;
        } else {
          this.showNotice('刷新失败：' + mapped.message);
        }
      } finally {
        this.refreshing = false;
      }
    },
    async loadMore() {
      if (this.loadingMore || !this.hasMore || this.state !== 'ready') return;
      this.loadingMore = true;
      try {
        const result = await getDynamicFeed(this.offset);
        this.list = this.list.concat(result.items);
        this.offset = result.offset;
        this.hasMore = result.hasMore;
      } catch (err) {
        const mapped = this.mapError(err);
        this.showNotice('加载更多失败：' + mapped.message);
      } finally {
        this.loadingMore = false;
      }
    },
    onRefresh() {
      if (this.refreshing || this.state === 'loading') return;
      this.loadFirst();
    },
    onCardTap(item) {
      if (!item) return;
      if (item.cardType === 'video') {
        if (!item.bvid) {
          this.showNotice('该动态缺少视频信息');
          return;
        }
        this.navTo('videoDetail', { bvid: item.bvid });
        return;
      }
      if (item.cardType === 'article' || item.cardType === 'opus') {
        const id = item.articleId || item.id || 0;
        if (!id) {
          this.showNotice('该内容暂不支持在笔端查看');
          return;
        }
        this.navTo('article', { id });
        return;
      }
      if (item.cardType === 'draw') {
        this.showNotice('图片动态请到哔哩哔哩 App 查看');
        return;
      }
      this.showNotice('该动态暂不支持在笔端查看');
    },
    onForwardTap(item) {
      const orig = item && item.orig;
      if (!orig) {
        this.showNotice('原内容不可见');
        return;
      }
      this.onCardTap(orig);
    },
    authorName(item) {
      return (item && item.author && item.author.name) || '未知UP主';
    },
    pubTime(item) {
      return (item && item.author && item.author.pubTime) || '';
    },
    cardTypeLabel(item) {
      const type = (item && item.cardType) || '';
      const labels = {
        video: '视频',
        draw: '图片',
        opus: '图文',
        article: '专栏',
        forward: '转发',
      };
      return labels[type] || '动态';
    },
    origMeta(item) {
      const orig = item && item.orig;
      if (!orig) return '';
      return this.authorName(orig) + ' · ' + this.cardTypeLabel(orig);
    },
    bodyText(item) {
      if (!item) return '';
      if (item.cardType === 'video') return '';
      if (item.cardType === 'opus' && item.title) return '';
      return item.text || '';
    },
    cardTitle(item) {
      if (!item) return '';
      if (item.cardType === 'video') return item.title || '';
      if (item.cardType === 'article') return item.title || '专栏文章';
      if (item.cardType === 'opus') return item.title || item.text || '图文动态';
      return item.text || '';
    },
    videoMeta(item) {
      const parts = [];
      const view = item && item.stat && item.stat.view;
      if (view) parts.push(formatCount(view) + '播放');
      if (item && item.durationText) parts.push(formatDurationText(item.durationText));
      return parts.join(' · ');
    },
    gridImages(item) {
      const images = (item && item.images) || [];
      return images.slice(0, MAX_GRID_IMAGES);
    },
    inlineImages(item) {
      const images = (item && item.images) || [];
      return images.slice(0, MAX_INLINE_IMAGES);
    },
    origTitle(item) {
      const orig = item && item.orig;
      if (!orig) return '原内容不可见';
      if (orig.cardType === 'video') return orig.title || '视频动态';
      if (orig.cardType === 'article') return orig.title || '专栏文章';
      if (orig.cardType === 'opus') return orig.title || orig.text || '图文动态';
      if (orig.cardType === 'draw') return orig.text || '图片动态';
      return '该动态暂不支持在笔端查看';
    },
    origCover(item) {
      const orig = item && item.orig;
      if (!orig) return '';
      if (orig.cardType === 'video') return orig.cover || '';
      if (orig.cardType === 'article') return orig.cover || '';
      if (orig.cardType === 'draw') return (orig.images && orig.images[0]) || '';
      return '';
    },
    origClickable(item) {
      const orig = item && item.orig;
      if (!orig) return false;
      if (orig.cardType === 'video') return !!orig.bvid;
      if (orig.cardType === 'article' || orig.cardType === 'opus') {
        return !!(orig.articleId || orig.id);
      }
      return false;
    },
  },
});

export default page;
