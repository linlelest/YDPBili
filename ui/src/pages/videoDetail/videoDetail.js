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
 * videoDetail.js —— 视频详情页
 *
 * 入参（onLoad）：{ bvid }（上游 index.js 点卡片跳转时即传此形态）。
 * 数据：api/video.js getVideoDetail(bvid) / getRelated(bvid)；封面 pic 由 getVideoDetail 直接映射。
 * 跳转：▶ 播放 → player { bvid, aid, cid, title }；⏭ 连播 → feed { bvid }；
 *   相关推荐 → videoDetail { bvid }（本页重载，onShow 检测 newOptions.bvid 变化兜底）。
 */

import { defineComponent } from 'vue';
import NavBar from '../../components/nav-bar.vue';
import Loading from '../../components/loading.vue';
import Empty from '../../components/empty.vue';
import { getVideoDetail, getRelated } from '../../services/api/video.js';
import { biliGet, BiliApiError } from '../../services/http.js';
import { formatDuration, formatCount, formatDate } from '../../utils/format.js';

const page = defineComponent({
  components: {
    'nav-bar': NavBar,
    loading: Loading,
    empty: Empty,
  },
  data() {
    return {
      title: '视频详情',
      loading: true,
      errorCode: 0,
      errorMessage: '',
      bvid: '',
      coverUrl: '',
      detail: null,
      selectedCid: 0,
      descExpanded: false,
      related: [],
      relatedLoading: false,
      relatedError: 0,
      relatedMessage: '',
    };
  },
  computed: {
    isMultiPage() {
      const pages = (this.detail && this.detail.pages) || [];
      return pages.length > 1;
    },
    statItems() {
      const stat = (this.detail && this.detail.stat) || {};
      return [
        { label: '播放', value: formatCount(stat.view) },
        { label: '弹幕', value: formatCount(stat.danmaku) },
        { label: '点赞', value: formatCount(stat.like) },
        { label: '收藏', value: formatCount(stat.favorite) },
      ];
    },
    pubDateText() {
      return (this.detail && formatDate(this.detail.pubdate)) || '';
    },
  },
  mounted() {
    const pageObj = this.$page;
    const options = (pageObj && (pageObj.loadOptions || pageObj.options)) || {};
    this.applyOptions(options);
  },
  methods: {
    formatDuration,
    formatCount,
    onShow() {
      const pageObj = this.$page;
      if (!pageObj) return;
      const latest = pageObj.newOptions;
      if (latest && latest.bvid && String(latest.bvid) !== String(this.bvid)) {
        this.applyOptions(latest);
      }
    },
    onBack() {
      const pageObj = this.$page;
      if (pageObj && typeof pageObj.finish === 'function') pageObj.finish();
    },
    applyOptions(options) {
      const opts = options || {};
      const bvid = String(opts.bvid || '').trim();
      this.bvid = bvid;
      this.coverUrl = '';
      this.detail = null;
      this.selectedCid = 0;
      this.descExpanded = false;
      this.related = [];
      this.relatedLoading = false;
      this.relatedError = 0;
      this.relatedMessage = '';
      if (!bvid) {
        this.loading = false;
        this.errorCode = -3;
        this.errorMessage = '缺少视频参数，无法加载';
        return;
      }
      this.fetchAll();
    },
    async fetchAll() {
      this.loading = true;
      this.errorCode = 0;
      this.errorMessage = '';
      const bvid = this.bvid;
      const [detailRes, coverRes] = await Promise.all([
        this.wrap(getVideoDetail(bvid)),
        this.wrap(this.fetchCover(bvid)),
      ]);
      if (bvid !== this.bvid) return;
      if (detailRes.error) {
        this.loading = false;
        this.showDetailError(detailRes.error);
        return;
      }
      const detail = detailRes.data;
      this.detail = detail;
      this.coverUrl = (coverRes.data && coverRes.data.pic) || '';
      this.selectedCid =
        detail.cid || ((detail.pages && detail.pages[0] && detail.pages[0].cid) || 0);
      this.loading = false;
      this.fetchRelated();
    },
    async fetchRelated() {
      this.relatedLoading = true;
      this.relatedError = 0;
      this.relatedMessage = '';
      const bvid = this.bvid;
      const res = await this.wrap(getRelated(bvid));
      if (bvid !== this.bvid) return;
      this.relatedLoading = false;
      if (res.error) {
        this.relatedError = this.codeOf(res.error);
        this.relatedMessage = (res.error && res.error.message) || '';
        return;
      }
      this.related = res.data || [];
    },
    onRetry() {
      if (!this.bvid) return;
      this.fetchAll();
    },
    toggleDesc() {
      this.descExpanded = !this.descExpanded;
    },
    onSelectPage(cid) {
      this.selectedCid = cid;
    },
    onPlay() {
      if (!this.detail || !this.selectedCid) return;
      $falcon.navTo('player', {
        bvid: this.detail.bvid || this.bvid,
        aid: this.detail.aid,
        cid: this.selectedCid,
        title: this.detail.title || '',
      });
    },
    onFeed() {
      if (!this.bvid) return;
      $falcon.navTo('feed', { bvid: this.bvid });
    },
    onRelatedClick(item) {
      if (!item || !item.bvid) return;
      $falcon.navTo('videoDetail', { bvid: item.bvid });
    },
    wrap(promise) {
      return promise
        .then((data) => ({ data, error: null }))
        .catch((error) => ({ data: null, error }));
    },
    codeOf(error) {
      return error instanceof BiliApiError && typeof error.code === 'number' ? error.code : -1;
    },
    showDetailError(error) {
      this.errorCode = this.codeOf(error);
      const code = this.errorCode;
      if (code === -404) this.errorMessage = '视频不存在或已被删除';
      else if (code === 62002) this.errorMessage = '稿件不可见';
      else if (code === 62004) this.errorMessage = '稿件审核中';
      else this.errorMessage = '';
    },
  },
});

export default page;
