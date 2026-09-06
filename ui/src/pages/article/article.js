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
 * article.js —— 文章详情页（图文/专栏/Opus）
 *
 * 入参（onLoad）：{ id }（上游 navTo('article', { id }) 约定，cv 号或 opus 号均可）。
 * 数据：api/article.js getArticleDetail(id) 归一化输出
 *   { title, author, publishTime, textBlocks[], images[], blocks[], source }；
 *   页面优先消费 blocks（按原文顺序交错的 {type:'text',text} /
 *   {type:'image',url,width,height}），图片高度按原始宽高比换算
 *   （正文图宽 248px），无原始尺寸时 176px 固定高 resize=cover 兜底。
 * 复用实例重进：onShow 检测 newOptions.id 变化即整体重载。
 * 错误映射：-352 → 内容风控拦截，稍后再试；-404 → 文章不存在或已被删除。
 */

import { defineComponent } from 'vue';
import NavBar from '../../components/nav-bar.vue';
import Loading from '../../components/loading.vue';
import Empty from '../../components/empty.vue';
import { getArticleDetail } from '../../services/api/article.js';
import { BiliApiError } from '../../services/http.js';
import { formatDate } from '../../utils/format.js';

// 正文图显示宽 = @page-width(280) - @page-pad(16)*2，与 article.less .content-image 一致
const BODY_IMAGE_WIDTH = 248;
const BODY_IMAGE_FALLBACK_HEIGHT = 176;

const page = defineComponent({
  components: {
    'nav-bar': NavBar,
    loading: Loading,
    empty: Empty,
  },
  data() {
    return {
      title: '文章详情',
      loading: true,
      errorCode: 0,
      errorMessage: '',
      articleId: '',
      detail: null,
    };
  },
  computed: {
    pubDateText() {
      return (this.detail && formatDate(this.detail.publishTime)) || '';
    },
    isEmptyBody() {
      const detail = this.detail;
      return !!detail && (!detail.blocks || detail.blocks.length === 0);
    },
  },
  mounted() {
    const pageObj = this.$page;
    const options = (pageObj && (pageObj.loadOptions || pageObj.options)) || {};
    this.applyOptions(options);
  },
  methods: {
    formatDate,
    bodyImageHeight(block) {
      const w = block && block.width;
      const h = block && block.height;
      if (w > 0 && h > 0) {
        return Math.round((BODY_IMAGE_WIDTH * h) / w);
      }
      return BODY_IMAGE_FALLBACK_HEIGHT;
    },
    onShow() {
      const pageObj = this.$page;
      if (!pageObj) return;
      const latest = pageObj.newOptions;
      if (latest && latest.id && String(latest.id) !== String(this.articleId)) {
        this.applyOptions(latest);
      }
    },
    onBack() {
      const pageObj = this.$page;
      if (pageObj && typeof pageObj.finish === 'function') pageObj.finish();
    },
    applyOptions(options) {
      const opts = options || {};
      const id = String(opts.id || '').trim();
      this.articleId = id;
      this.detail = null;
      if (!id) {
        this.loading = false;
        this.errorCode = -3;
        this.errorMessage = '缺少文章参数，无法加载';
        return;
      }
      this.fetchAll();
    },
    async fetchAll() {
      this.loading = true;
      this.errorCode = 0;
      this.errorMessage = '';
      const id = this.articleId;
      const res = await this.wrap(getArticleDetail(id));
      if (id !== this.articleId) return;
      this.loading = false;
      if (res.error) {
        this.showArticleError(res.error);
        return;
      }
      this.detail = res.data;
    },
    onRetry() {
      if (!this.articleId) return;
      this.fetchAll();
    },
    wrap(promise) {
      return promise
        .then((data) => ({ data, error: null }))
        .catch((error) => ({ data: null, error }));
    },
    codeOf(error) {
      return error instanceof BiliApiError && typeof error.code === 'number' ? error.code : -1;
    },
    showArticleError(error) {
      this.errorCode = this.codeOf(error);
      const code = this.errorCode;
      if (code === -352) this.errorMessage = '内容风控拦截，稍后再试';
      else if (code === -404) this.errorMessage = '文章不存在或已被删除';
      else this.errorMessage = '';
    },
  },
});

export default page;
