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
 * userSpace.js —— 用户主页
 *
 * 入参（onLoad）：{ mid }（$page.loadOptions；onShow 检测 newOptions.mid 变化整页重载）。
 * 头部：getUserSpaceInfo → 大头像 + 昵称 + Lv 徽标 + 认证标记 + 签名（两行省略）+ 粉丝/关注行。
 * Tab：视频 | 专栏 | 动态，各自独立状态机（idle/loading/ready/error）与"加载更多"分页：
 *   视频 getUserVideos(pn/ps 分页，紧凑行卡) → videoDetail { bvid }；
 *   专栏 getUserArticles(pn/ps 分页，article-card) → article { id }；
 *   动态 getUserDynamics(offset 链式翻页) 复用 dynamics 页归一渲染思路：
 *     video → 详情；article/opus → article { id }；draw → 九宫格简渲染（点击提示）；
 *     forward → 文案 + 原卡摘要（可点击进原内容）。
 * 动态 Tab 首次切入若 -404/-412/-352/-403（含风控）→ empty"动态接口暂不可用"。
 * 异步守卫：loadXXX 捕获 mid 比对，mid 重载时丢弃旧请求结果（videoDetail 先例）。
 */

import { defineComponent } from 'vue';
import NavBar from '../../components/nav-bar.vue';
import Loading from '../../components/loading.vue';
import Empty from '../../components/empty.vue';
import ArticleCard from '../../components/article-card.vue';
import {
  getUserSpaceInfo,
  getUserVideos,
  getUserArticles,
  getUserDynamics,
} from '../../services/api/space.js';
import { formatCount, formatDate, formatDurationText } from '../../utils/format.js';

const PAGE_SIZE = 20;
const NOTICE_MS = 4000;
const MAX_GRID_IMAGES = 4;
const MAX_INLINE_IMAGES = 3;

const ERROR_MESSAGES = {
  '-101': '未登录，请先登录',
  '-412': '请求被风控拦截，请稍后再试',
  '-352': '触发安全验证，请稍后再试',
  '-404': '内容不存在',
  '-403': '权限不足',
  '-1': '网络连接失败，请检查网络',
  '-2': '响应数据异常',
  '-3': '请求参数错误',
};

const UNAVAILABLE_CODES = ['-404', '-412', '-352', '-403'];

const TAB_LABELS = {
  video: '视频',
  article: '专栏',
  dynamic: '动态',
};

const page = defineComponent({
  components: {
    'nav-bar': NavBar,
    loading: Loading,
    empty: Empty,
    'article-card': ArticleCard,
  },
  data() {
    return {
      title: '用户主页',
      mid: 0,
      headerState: 'loading',
      headerErrorCode: 0,
      headerErrorMsg: '',
      user: {
        mid: 0,
        name: '',
        face: '',
        sign: '',
        level: 0,
        fans: 0,
        following: 0,
        officialType: -1,
      },
      activeTab: 'video',
      tabs: ['video', 'article', 'dynamic'],
      videoState: 'idle',
      videoList: [],
      videoPn: 0,
      videoHasMore: false,
      videoLoadingMore: false,
      videoErrorCode: 0,
      videoErrorMsg: '',
      articleState: 'idle',
      articleList: [],
      articlePn: 0,
      articleHasMore: false,
      articleLoadingMore: false,
      articleErrorCode: 0,
      articleErrorMsg: '',
      dynState: 'idle',
      dynList: [],
      dynOffset: '',
      dynHasMore: false,
      dynLoadingMore: false,
      dynErrorCode: 0,
      dynErrorMsg: '',
      dynUnavailable: false,
      notice: '',
      noticeTimer: 0,
    };
  },
  computed: {
    isEmptyVideo() {
      return this.videoState === 'ready' && this.videoList.length === 0;
    },
    isEmptyArticle() {
      return this.articleState === 'ready' && this.articleList.length === 0;
    },
    isEmptyDyn() {
      return this.dynState === 'ready' && this.dynList.length === 0;
    },
    officialText() {
      if (this.user.officialType === 0) return '个人认证';
      if (this.user.officialType === 1) return '机构认证';
      return '';
    },
    signText() {
      return this.user.sign || '这个人很懒，什么都没有留下';
    },
    fansText() {
      return formatCount(this.user.fans);
    },
    followingText() {
      return formatCount(this.user.following);
    },
  },
  created() {
    this.lastNewOptionsKey = '';
  },
  mounted() {
    const pageObj = this.$page;
    const options = (pageObj && (pageObj.loadOptions || pageObj.options)) || {};
    this.lastNewOptionsKey = JSON.stringify(options) || '';
    this.applyOptions(options);
  },
  unmounted() {
    if (this.noticeTimer) {
      clearTimeout(this.noticeTimer);
      this.noticeTimer = 0;
    }
  },
  methods: {
    formatCount,
    formatDate,
    formatDurationText,
    onShow() {
      const pageObj = this.$page;
      if (!pageObj) return;
      const latest = pageObj.newOptions;
      if (!latest) return;
      const latestKey = JSON.stringify(latest) || '';
      if (latestKey && latestKey !== this.lastNewOptionsKey) {
        this.lastNewOptionsKey = latestKey;
        this.applyOptions(latest);
      }
    },
    onBack() {
      const pageObj = this.$page;
      if (pageObj && typeof pageObj.finish === 'function') pageObj.finish();
    },
    applyOptions(options) {
      const opts = options || {};
      const mid = Number(String(opts.mid || '').trim()) || 0;
      this.mid = mid;
      this.resetAll();
      if (!mid) {
        this.headerState = 'error';
        this.headerErrorCode = -3;
        this.headerErrorMsg = '缺少用户参数，无法加载';
        return;
      }
      this.loadHeader();
      this.loadVideosFirst();
    },
    resetAll() {
      this.headerState = 'loading';
      this.headerErrorCode = 0;
      this.headerErrorMsg = '';
      this.user = {
        mid: 0,
        name: '',
        face: '',
        sign: '',
        level: 0,
        fans: 0,
        following: 0,
        officialType: -1,
      };
      this.activeTab = 'video';
      this.videoState = 'idle';
      this.videoList = [];
      this.videoPn = 0;
      this.videoHasMore = false;
      this.videoLoadingMore = false;
      this.videoErrorCode = 0;
      this.videoErrorMsg = '';
      this.articleState = 'idle';
      this.articleList = [];
      this.articlePn = 0;
      this.articleHasMore = false;
      this.articleLoadingMore = false;
      this.articleErrorCode = 0;
      this.articleErrorMsg = '';
      this.dynState = 'idle';
      this.dynList = [];
      this.dynOffset = '';
      this.dynHasMore = false;
      this.dynLoadingMore = false;
      this.dynErrorCode = 0;
      this.dynErrorMsg = '';
      this.dynUnavailable = false;
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
    navTo(target, params) {
      try {
        $falcon.navTo(target, params || {});
      } catch (err) {
        this.showNotice('页面跳转失败：' + target);
      }
    },
    async loadHeader() {
      this.headerState = 'loading';
      this.headerErrorCode = 0;
      this.headerErrorMsg = '';
      const captured = String(this.mid);
      try {
        const info = await getUserSpaceInfo(this.mid);
        if (String(this.mid) !== captured) return;
        this.user = info;
        this.headerState = 'ready';
      } catch (err) {
        if (String(this.mid) !== captured) return;
        const mapped = this.mapError(err);
        this.headerState = 'error';
        this.headerErrorCode = mapped.code;
        this.headerErrorMsg = mapped.message;
      }
    },
    onRetryHeader() {
      if (!this.mid) return;
      this.loadHeader();
      this.loadVideosFirst();
    },
    onTabChange(tab) {
      if (this.activeTab === tab) return;
      this.activeTab = tab;
      if (tab === 'article' && this.articleState === 'idle') this.loadArticlesFirst();
      if (tab === 'dynamic' && this.dynState === 'idle') this.loadDynFirst();
    },
    async loadVideosFirst() {
      this.videoState = 'loading';
      this.videoErrorCode = 0;
      this.videoErrorMsg = '';
      const captured = String(this.mid);
      try {
        const result = await getUserVideos(this.mid, 1, PAGE_SIZE);
        if (String(this.mid) !== captured) return;
        this.videoList = result.items;
        this.videoPn = 1;
        this.videoHasMore = result.items.length > 0 && result.items.length < result.total;
        this.videoState = 'ready';
      } catch (err) {
        if (String(this.mid) !== captured) return;
        const mapped = this.mapError(err);
        this.videoState = 'error';
        this.videoErrorCode = mapped.code;
        this.videoErrorMsg = mapped.message;
      }
    },
    async loadVideosMore() {
      if (this.videoLoadingMore || !this.videoHasMore || this.videoState !== 'ready') return;
      this.videoLoadingMore = true;
      const captured = String(this.mid);
      const pn = this.videoPn + 1;
      try {
        const result = await getUserVideos(this.mid, pn, PAGE_SIZE);
        if (String(this.mid) !== captured) return;
        if (result.items.length > 0) {
          this.videoList = this.videoList.concat(result.items);
          this.videoPn = pn;
        }
        this.videoHasMore = result.items.length > 0 && this.videoList.length < result.total;
      } catch (err) {
        const mapped = this.mapError(err);
        this.showNotice('加载更多失败：' + mapped.message);
      } finally {
        this.videoLoadingMore = false;
      }
    },
    async loadArticlesFirst() {
      this.articleState = 'loading';
      this.articleErrorCode = 0;
      this.articleErrorMsg = '';
      const captured = String(this.mid);
      try {
        const result = await getUserArticles(this.mid, 1, PAGE_SIZE);
        if (String(this.mid) !== captured) return;
        this.articleList = result.items;
        this.articlePn = 1;
        this.articleHasMore = result.items.length > 0 && result.items.length < result.total;
        this.articleState = 'ready';
      } catch (err) {
        if (String(this.mid) !== captured) return;
        const mapped = this.mapError(err);
        this.articleState = 'error';
        this.articleErrorCode = mapped.code;
        this.articleErrorMsg = mapped.message;
      }
    },
    async loadArticlesMore() {
      if (this.articleLoadingMore || !this.articleHasMore || this.articleState !== 'ready') return;
      this.articleLoadingMore = true;
      const captured = String(this.mid);
      const pn = this.articlePn + 1;
      try {
        const result = await getUserArticles(this.mid, pn, PAGE_SIZE);
        if (String(this.mid) !== captured) return;
        if (result.items.length > 0) {
          this.articleList = this.articleList.concat(result.items);
          this.articlePn = pn;
        }
        this.articleHasMore = result.items.length > 0 && this.articleList.length < result.total;
      } catch (err) {
        const mapped = this.mapError(err);
        this.showNotice('加载更多失败：' + mapped.message);
      } finally {
        this.articleLoadingMore = false;
      }
    },
    async loadDynFirst() {
      this.dynState = 'loading';
      this.dynErrorCode = 0;
      this.dynErrorMsg = '';
      this.dynUnavailable = false;
      const captured = String(this.mid);
      try {
        const result = await getUserDynamics(this.mid, '');
        if (String(this.mid) !== captured) return;
        this.dynList = result.items;
        this.dynOffset = result.offset;
        this.dynHasMore = result.hasMore;
        this.dynState = 'ready';
      } catch (err) {
        if (String(this.mid) !== captured) return;
        const mapped = this.mapError(err);
        if (UNAVAILABLE_CODES.indexOf(String(mapped.code)) !== -1) {
          this.dynState = 'ready';
          this.dynUnavailable = true;
          return;
        }
        this.dynState = 'error';
        this.dynErrorCode = mapped.code;
        this.dynErrorMsg = mapped.message;
      }
    },
    async loadDynMore() {
      if (this.dynLoadingMore || !this.dynHasMore || this.dynState !== 'ready') return;
      this.dynLoadingMore = true;
      const captured = String(this.mid);
      try {
        const result = await getUserDynamics(this.mid, this.dynOffset);
        if (String(this.mid) !== captured) return;
        this.dynList = this.dynList.concat(result.items);
        this.dynOffset = result.offset;
        this.dynHasMore = result.hasMore;
      } catch (err) {
        const mapped = this.mapError(err);
        this.showNotice('加载更多失败：' + mapped.message);
      } finally {
        this.dynLoadingMore = false;
      }
    },
    onRetryTab() {
      if (this.activeTab === 'video') this.loadVideosFirst();
      else if (this.activeTab === 'article') this.loadArticlesFirst();
      else if (this.activeTab === 'dynamic') this.loadDynFirst();
    },
    onVideoTap(item) {
      if (!item || !item.bvid) {
        this.showNotice('该视频缺少信息，无法查看');
        return;
      }
      this.navTo('videoDetail', { bvid: item.bvid });
    },
    onArticleTap(item) {
      if (!item || !item.id) {
        this.showNotice('该专栏缺少信息，无法查看');
        return;
      }
      this.navTo('article', { id: item.id });
    },
    onDynTap(item) {
      if (!item) {
        this.showNotice('原内容不可见');
        return;
      }
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
    tabLabel(tab) {
      return TAB_LABELS[tab] || tab;
    },
    tabTextClass(tab) {
      return this.activeTab === tab ? 'tab-text tab-text-active' : 'tab-text';
    },
    tabIndicatorClass(tab) {
      return this.activeTab === tab ? 'tab-indicator tab-indicator-active' : 'tab-indicator';
    },
    videoMetaText(item) {
      const parts = [];
      const date = formatDate(item && item.created);
      if (date) parts.push(date);
      if (item && item.play) parts.push(formatCount(item.play) + '播放');
      if (item && item.length) parts.push(formatDurationText(item.length));
      return parts.join(' · ');
    },
    articleProps(item) {
      return {
        title: (item && item.title) || '',
        desc: formatDate(item && item.publishTime),
        pic: (item && item.bannerUrl) || '',
        author: this.user.name || '',
        view: (item && item.view) || 0,
      };
    },
    dynTypeLabel(item) {
      const labels = {
        video: '视频',
        draw: '图片',
        opus: '图文',
        article: '专栏',
        forward: '转发',
      };
      return labels[(item && item.cardType) || ''] || '动态';
    },
    dynPubTime(item) {
      return (item && item.author && item.author.pubTime) || '';
    },
    dynVideoMeta(item) {
      const parts = [];
      const view = item && item.stat && item.stat.view;
      if (view) parts.push(formatCount(view) + '播放');
      if (item && item.durationText) parts.push(formatDurationText(item.durationText));
      return parts.join(' · ');
    },
    dynBodyText(item) {
      if (!item) return '';
      if (item.cardType === 'video') return '';
      if (item.cardType === 'opus' && item.title) return '';
      if (item.cardType === 'article' && item.title) return '';
      return item.text || '';
    },
    dynGridImages(item) {
      const images = (item && item.images) || [];
      return images.slice(0, MAX_GRID_IMAGES);
    },
    dynInlineImages(item) {
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
    origMeta(item) {
      const orig = item && item.orig;
      if (!orig) return '';
      return this.dynTypeLabel(orig) + ' · ' + (orig.author && orig.author.name ? orig.author.name : '原内容');
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
