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
 * history.js —— 历史记录页
 *
 * 数据：api/history.js getHistory(cursor)，链式游标翻页：首页传 null，
 *   翻页透传上次响应 cursor（max/viewAt/business 由 api 层映射为
 *   max/view_at/business query），返回 {items, cursor}。
 * hasMore 判定：本次 items 为空，或响应 cursor.max 与 cursor.viewAt 均为 0
 *   （游标归零表示到底）时停止。
 * 进度语义：progress 单位秒、与视频等长；progress < 0 为「已看完」，
 *   百分比 = progress/duration（≤100%），文案「看到 x:xx」。
 * 点击 → business=archive 且有 bvid 时 videoDetail { bvid }；其余类型
 *   （pgc/live/article-list/article 等）提示暂不支持在笔端回看。
 * 入参：loadOptions/newOptions 无参数依赖，newOptions 变化时整页重载。
 */

import { defineComponent } from 'vue';
import NavBar from '../../components/nav-bar.vue';
import Loading from '../../components/loading.vue';
import Empty from '../../components/empty.vue';
import { getHistory } from '../../services/api/history.js';
import { formatDuration, formatDate } from '../../utils/format.js';

const NOTICE_MS = 4000;
// 进度条总宽：内容区 280 - 2*16(page-pad) - 2*12(卡片 padding) = 224px
const BAR_WIDTH_PX = 224;

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
      title: '历史记录',
      state: 'loading',
      list: [],
      cursor: { max: 0, viewAt: 0, business: '' },
      hasMore: true,
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
    formatDuration,
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
    applyResult(result) {
      const items = (result && result.items) || [];
      this.list = this.list.concat(items);
      this.cursor = {
        max: (result && result.cursor && result.cursor.max) || 0,
        viewAt: (result && result.cursor && result.cursor.viewAt) || 0,
        business: (result && result.cursor && result.cursor.business) || '',
      };
      const cursorZero = this.cursor.max === 0 && this.cursor.viewAt === 0;
      this.hasMore = items.length > 0 && !cursorZero;
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
        const result = await getHistory(null);
        this.list = [];
        this.cursor = { max: 0, viewAt: 0, business: '' };
        this.applyResult(result);
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
        const result = await getHistory({
          max: this.cursor.max,
          viewAt: this.cursor.viewAt,
          business: this.cursor.business,
        });
        this.applyResult(result);
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
    onItemTap(item) {
      if (item && item.business === 'archive' && item.bvid) {
        this.navTo('videoDetail', { bvid: item.bvid });
        return;
      }
      this.showNotice('该类型记录暂不支持在笔端回看');
    },
    progressPct(item) {
      if (!item) return 0;
      if (item.progress < 0) return 100;
      if (!item.duration || item.duration <= 0) return 0;
      const pct = Math.round((item.progress / item.duration) * 100);
      return Math.max(0, Math.min(100, pct));
    },
    progressText(item) {
      if (!item) return '';
      if (item.progress < 0) return '已看完';
      return '看到 ' + formatDuration(item.progress);
    },
    barWidth(item) {
      return Math.round((BAR_WIDTH_PX * this.progressPct(item)) / 100);
    },
    showDate(item) {
      return formatDate(item && item.viewAt);
    },
    badgeText(item) {
      return (item && item.badge) || '';
    },
    upName(item) {
      return (item && item.authorName) || '';
    },
  },
});

export default page;
