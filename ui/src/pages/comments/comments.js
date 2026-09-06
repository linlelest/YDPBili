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
 * comments.js —— 评论区页
 *
 * 入参(mounted 消费 $page.loadOptions,即本框架 onLoad 等价先例,同 videoDetail):{ aid, title? }。
 * title 用于顶栏下方视频副标题;onShow 检测 newOptions.aid 变化重载。
 *
 * 列表:api/reply.js getComments(游标分页;热门 mode=3 / 最新 mode=2 切换重载,加载更多顺延 page);
 * 发送:api/reply.js addComment;未登录点击发送 → toast + navTo('login');
 * 发送成功:清空输入、列表顶部本地 unshift 新评论 + toast「发送成功」;
 * 键盘:复用 search 页 soft-keyboard(input/backspace/clear/space/confirm/close),从相对路径引入;
 * 点赞/回复本期仅展示数字,点「回复」提示「暂不支持回复,请直接发表评论」。
 */

import { defineComponent } from 'vue';
import NavBar from '../../components/nav-bar.vue';
import Empty from '../../components/empty.vue';
import Loading from '../../components/loading.vue';
import SoftKeyboard from '../search/soft-keyboard.vue';
import { getComments, addComment } from '../../services/api/reply.js';
import { isLoggedIn } from '../../services/auth.js';
import { getUserInfo } from '../../services/api/nav.js';
import { BiliApiError } from '../../services/http.js';
import { formatCount } from '../../utils/format.js';

const INPUT_MAX = 500;
const TOAST_MS = 1800;

/** 错误码文案映射(列表 + 发送共用;12002/12052 均为评论区已关闭)。 */
const ERROR_MESSAGES = {
  '-101': '未登录，请先登录',
  '-111': 'csrf 校验失败，请重新登录',
  '-412': '请求被风控拦截，请稍后再试',
  '-352': '触发安全验证，请稍后再试',
  '-404': '评论区不存在或已关闭',
  '-1': '网络连接失败，请检查网络',
  '-2': '响应数据异常',
  '-3': '请求参数错误',
  '12002': '评论区已关闭',
  '12052': '评论区已关闭',
  '12015': '发送评论需要验证码，请稍后再试',
  '12016': '评论包含敏感信息，请修改后重发',
  '12025': '评论字数过多',
  '12051': '重复评论，请勿刷屏',
};

const page = defineComponent({
  components: {
    'nav-bar': NavBar,
    empty: Empty,
    loading: Loading,
    'soft-keyboard': SoftKeyboard,
  },
  data() {
    return {
      aid: 0,
      pageTitle: '',
      mode: 3,
      items: [],
      topItems: [],
      total: 0,
      isEnd: false,
      page: 1,
      loading: false,
      loadingMore: false,
      loaded: false,
      errorCode: 0,
      errorMessage: '',
      inputText: '',
      keyboardVisible: false,
      sending: false,
      me: null,
      toast: '',
    };
  },
  computed: {
    totalText() {
      return formatCount(this.total);
    },
    showEmpty() {
      return (
        this.loaded &&
        !this.loading &&
        this.items.length === 0 &&
        this.topItems.length === 0
      );
    },
    emptyMessage() {
      return this.errorCode !== 0 ? this.errorMessage : '还没有评论，抢首楼';
    },
    emptyCode() {
      return this.errorCode;
    },
    hasMore() {
      return this.loaded && !this.isEnd && this.items.length > 0;
    },
  },
  created() {
    this.toastTimer = null;
  },
  mounted() {
    const pageObj = this.$page;
    const options = (pageObj && (pageObj.loadOptions || pageObj.options)) || {};
    this.applyOptions(options);
  },
  methods: {
    formatCount,
    onShow() {
      const pageObj = this.$page;
      if (!pageObj) return;
      const latest = pageObj.newOptions;
      if (latest && latest.aid && String(latest.aid) !== String(this.aid)) {
        this.applyOptions(latest);
      }
    },
    onBack() {
      const pageObj = this.$page;
      if (pageObj && typeof pageObj.finish === 'function') pageObj.finish();
    },
    applyOptions(options) {
      const opts = options || {};
      const aid = Number(opts.aid) || 0;
      this.aid = aid;
      this.pageTitle = String(opts.title || '').trim();
      this.keyboardVisible = false;
      this.inputText = '';
      this.resetList();
      if (!aid) {
        this.loaded = true;
        this.errorCode = -3;
        this.errorMessage = '缺少稿件参数，无法加载评论';
        return;
      }
      this.loadComments(1);
      this.loadMe();
    },
    resetList() {
      this.mode = 3;
      this.items = [];
      this.topItems = [];
      this.total = 0;
      this.isEnd = false;
      this.page = 1;
      this.loaded = false;
      this.errorCode = 0;
      this.errorMessage = '';
    },
    async loadMe() {
      try {
        const info = await getUserInfo();
        this.me = info && info.isLogin ? info : null;
      } catch (err) {
        this.me = null;
      }
    },
    async loadComments(targetPage) {
      const aid = this.aid;
      const mode = this.mode;
      if (!aid || this.loading) return;
      const append = targetPage > 1;
      if (append) this.loadingMore = true;
      else this.loading = true;
      if (!append) {
        this.errorCode = 0;
        this.errorMessage = '';
      }
      try {
        const res = await getComments({ aid, page: targetPage, mode, ps: 20 });
        if (aid !== this.aid || mode !== this.mode) return;
        this.items = append ? this.items.concat(res.items) : res.items;
        if (!append) this.topItems = res.topItems;
        this.total = res.total;
        this.isEnd = res.isEnd;
        this.page = res.page;
        this.loaded = true;
      } catch (err) {
        if (aid !== this.aid || mode !== this.mode) return;
        if (!append) {
          this.errorCode = this.codeOf(err);
          this.errorMessage =
            ERROR_MESSAGES[String(this.errorCode)] ||
            (err && err.message) ||
            '评论加载失败，请稍后再试';
        } else {
          this.showToast('加载更多失败，请稍后再试');
        }
      } finally {
        this.loading = false;
        this.loadingMore = false;
      }
    },
    switchMode(mode) {
      if (this.mode === mode || this.loading) return;
      this.mode = mode;
      this.items = [];
      this.topItems = [];
      this.total = 0;
      this.isEnd = false;
      this.page = 1;
      this.loaded = false;
      this.errorCode = 0;
      this.errorMessage = '';
      this.loadComments(1);
    },
    loadMore() {
      if (!this.hasMore || this.loading || this.loadingMore) return;
      this.loadComments(this.page + 1);
    },
    openKeyboard() {
      this.keyboardVisible = true;
    },
    onKeyboardClose() {
      this.keyboardVisible = false;
    },
    onKeyInput(ch) {
      if (this.inputText.length >= INPUT_MAX) return;
      this.inputText += ch;
    },
    onBackspace() {
      this.inputText = this.inputText.slice(0, -1);
    },
    onClear() {
      this.inputText = '';
    },
    onSpace() {
      if (this.inputText.length === 0 || this.inputText.length >= INPUT_MAX) return;
      this.inputText += ' ';
    },
    async onSend() {
      if (this.sending) return;
      const message = this.inputText.trim();
      if (!message) {
        this.showToast('请输入评论内容');
        return;
      }
      let loggedIn = false;
      try {
        loggedIn = await isLoggedIn();
      } catch (err) {
        loggedIn = false;
      }
      if (!loggedIn) {
        this.showToast('请先登录后再评论');
        this.navTo('login');
        return;
      }
      const aid = this.aid;
      this.sending = true;
      try {
        await addComment({ aid, message });
        if (aid !== this.aid) return;
        this.inputText = '';
        this.keyboardVisible = false;
        this.unshiftLocalComment(message);
        this.showToast('发送成功');
      } catch (err) {
        if (aid !== this.aid) return;
        const code = this.codeOf(err);
        this.showToast(
          ERROR_MESSAGES[String(code)] || (err && err.message) || '发送失败，请稍后再试'
        );
      } finally {
        this.sending = false;
      }
    },
    unshiftLocalComment(message) {
      const me = this.me || {};
      const now = Math.floor(Date.now() / 1000);
      this.items = [
        {
          rpid: 'local_' + now,
          mid: me.mid || 0,
          uname: me.uname || '我',
          face: me.face || '',
          level: me.level || 0,
          content: message,
          like: 0,
          ctime: now,
          rcount: 0,
          timeText: '刚刚',
        },
      ].concat(this.items);
      this.total += 1;
    },
    onReplyTap() {
      this.showToast('暂不支持回复，请直接发表评论');
    },
    navTo(target, params) {
      try {
        $falcon.navTo(target, params || {});
      } catch (err) {
        this.showToast('页面跳转失败：' + target);
      }
    },
    showToast(message) {
      this.toast = message;
      if (this.toastTimer) {
        this.$page.clearTimeout(this.toastTimer);
      }
      this.toastTimer = this.$page.setTimeout(() => {
        this.toast = '';
        this.toastTimer = null;
      }, TOAST_MS);
    },
    tabClass(mode) {
      return this.mode === mode ? 'tab-text tab-text-active' : 'tab-text';
    },
    avatarChar(item) {
      const name = (item && item.uname) || '';
      return name ? name.slice(0, 1).toUpperCase() : 'B';
    },
    codeOf(error) {
      return error instanceof BiliApiError && typeof error.code === 'number'
        ? error.code
        : -1;
    },
  },
});

export default page;
