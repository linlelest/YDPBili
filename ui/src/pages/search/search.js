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

import { defineComponent } from 'vue';
import NavBar from '../../components/nav-bar.vue';
import Empty from '../../components/empty.vue';
import Loading from '../../components/loading.vue';
import VideoCard from '../../components/video-card.vue';
import ArticleCard from '../../components/article-card.vue';
import SoftKeyboard from './soft-keyboard.vue';
import { ensureSearchReady, searchVideos, searchArticles } from '../../services/api/search.js';
import { storageGet, storageSet } from '../../services/env.js';

const HISTORY_KEY = 'bilibili_search_history';
const HISTORY_MAX = 5;
const PAGE_SIZE = 10;

const ERROR_MESSAGES = {
  '-412': '请求被风控，稍后再试',
  '-101': '未登录，请先登录',
  '-352': '触发安全验证，请稍后再试',
  '-1': '网络连接失败，请检查网络',
  '-2': '响应数据异常',
  '-3': '请求参数错误',
};

function parseDurationText(text) {
  const parts = String(text || '').trim().split(':');
  let seconds = 0;
  for (let i = 0; i < parts.length; i++) {
    seconds = seconds * 60 + (parseInt(parts[i], 10) || 0);
  }
  return seconds;
}

function mapVideoForCard(it) {
  return {
    bvid: it.bvid,
    aid: it.aid,
    title: it.title,
    pic: it.pic,
    owner: { name: it.author },
    stat: { view: it.play },
    duration: parseDurationText(it.durationText),
    author: it.author,
    play: it.play,
  };
}

const page = defineComponent({
  components: {
    'nav-bar': NavBar,
    empty: Empty,
    loading: Loading,
    'video-card': VideoCard,
    'article-card': ArticleCard,
    'soft-keyboard': SoftKeyboard,
  },
  data() {
    return {
      keyword: '',
      activeTab: 'video',
      keyboardVisible: true,
      videos: [],
      articles: [],
      videoPage: 1,
      articlePage: 1,
      videoTotal: 0,
      articleTotal: 0,
      videoPageFull: false,
      articlePageFull: false,
      loading: false,
      loadingMore: false,
      searched: false,
      errorCode: 0,
      errorMessage: '',
      history: [],
    };
  },
  computed: {
    currentList() {
      return this.activeTab === 'video' ? this.videos : this.articles;
    },
    currentTotal() {
      return this.activeTab === 'video' ? this.videoTotal : this.articleTotal;
    },
    currentPageFull() {
      return this.activeTab === 'video' ? this.videoPageFull : this.articlePageFull;
    },
    hasMore() {
      if (this.currentPageFull !== true) return false;
      if (this.currentTotal > 0) return this.currentList.length < this.currentTotal;
      return true;
    },
    showEmpty() {
      return !this.loading && this.currentList.length === 0;
    },
    statusMessage() {
      if (this.errorCode !== 0) return this.errorMessage;
      if (this.searched && this.keyword) return '未找到相关内容';
      return '输入关键词开始搜索';
    },
    showTabs() {
      return this.searched;
    },
    showHistory() {
      return !this.searched && !this.keyboardVisible && this.history.length > 0;
    },
  },
  methods: {
    onBack() {
      const pageObj = this.$page;
      if (pageObj && typeof pageObj.finish === 'function') pageObj.finish();
    },
    openKeyboard() {
      this.keyboardVisible = true;
    },
    onKeyboardClose() {
      this.keyboardVisible = false;
    },
    onKeyInput(ch) {
      if (this.keyword.length >= 50) return;
      this.keyword += ch;
    },
    onBackspace() {
      this.keyword = this.keyword.slice(0, -1);
    },
    onClear() {
      this.keyword = '';
    },
    onSpace() {
      if (this.keyword.length === 0 || this.keyword.length >= 50) return;
      this.keyword += ' ';
    },
    tabClass(name) {
      return this.activeTab === name ? 'tab-text tab-text-active' : 'tab-text';
    },
    async loadHistory() {
      try {
        const list = await storageGet(HISTORY_KEY, []);
        this.history = Array.isArray(list) ? list.filter((h) => typeof h === 'string' && h.length > 0) : [];
      } catch (err) {
        this.history = [];
      }
    },
    async saveHistory(kw) {
      const list = [kw].concat(this.history.filter((h) => h !== kw)).slice(0, HISTORY_MAX);
      this.history = list;
      try {
        await storageSet(HISTORY_KEY, list);
      } catch (err) {
        // 历史写入失败不影响搜索
      }
    },
    onClearHistory() {
      this.history = [];
      storageSet(HISTORY_KEY, []).catch(() => {});
    },
    onHistoryPick(kw) {
      this.keyword = kw;
      this.onSearch();
    },
    resetError() {
      this.errorCode = 0;
      this.errorMessage = '';
    },
    applyError(err) {
      const code = err && typeof err.code === 'number' ? err.code : 0;
      const key = String(code || '');
      this.errorCode = code || -1;
      this.errorMessage = ERROR_MESSAGES[key] || '搜索失败，请稍后再试';
    },
    switchTab(tab) {
      if (this.activeTab === tab) return;
      this.activeTab = tab;
      if (this.searched && !this.loading && this.currentList.length === 0) {
        this.loadPage(1, false);
      }
    },
    async onSearch() {
      const kw = (this.keyword || '').trim();
      if (!kw) {
        this.resetError();
        this.searched = false;
        this.videos = [];
        this.articles = [];
        this.videoPage = 1;
        this.articlePage = 1;
        this.videoTotal = 0;
        this.articleTotal = 0;
        this.videoPageFull = false;
        this.articlePageFull = false;
        return;
      }
      this.keyword = kw;
      this.keyboardVisible = false;
      this.saveHistory(kw);
      this.videos = [];
      this.articles = [];
      this.videoPage = 1;
      this.articlePage = 1;
      this.videoTotal = 0;
      this.articleTotal = 0;
      this.videoPageFull = false;
      this.articlePageFull = false;
      this.activeTab = 'video';
      this.searched = true;
      this.resetError();
      await this.loadPage(1, false);
    },
    async loadPage(page, append) {
      const kw = this.keyword;
      if (!kw || this.loading) return;
      if (append) {
        this.loadingMore = true;
      } else {
        this.loading = true;
      }
      this.resetError();
      try {
        await ensureSearchReady();
        if (this.activeTab === 'video') {
          const res = await searchVideos(kw, page, PAGE_SIZE);
          const mapped = (res.items || []).map(mapVideoForCard);
          this.videos = append ? this.videos.concat(mapped) : mapped;
          this.videoPage = page;
          this.videoTotal = res.total || 0;
          this.videoPageFull = (res.items || []).length >= PAGE_SIZE;
        } else {
          const res = await searchArticles(kw, page, PAGE_SIZE);
          const items = res.items || [];
          this.articles = append ? this.articles.concat(items) : items;
          this.articlePage = page;
          this.articleTotal = res.total || 0;
          this.articlePageFull = items.length >= PAGE_SIZE;
        }
      } catch (err) {
        this.applyError(err);
      } finally {
        this.loading = false;
        this.loadingMore = false;
      }
    },
    loadMore() {
      if (!this.hasMore || this.loading || this.loadingMore) return;
      const page = (this.activeTab === 'video' ? this.videoPage : this.articlePage) + 1;
      this.loadPage(page, true);
    },
    openVideo(item) {
      if (!item || !item.bvid) return;
      try {
        $falcon.navTo('pages/videoDetail/videoDetail.vue', { options: { bvid: item.bvid } });
      } catch (err) {
        // 目标页面未就绪时忽略跳转
      }
    },
    openArticle(item) {
      if (!item || !item.id) return;
      try {
        $falcon.navTo('article', { id: item.id });
      } catch (err) {
        // 目标页面未就绪时忽略跳转
      }
    },
  },
  created() {
    this.loadHistory();
  },
});

export default page;
