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
 * 互动：api/interaction.js 三状态查询（点赞/投币/关注）onShow 与详情加载后并行回显；
 *   未登录（getSession 为空）不发起查询、显示默认态，点击操作 → toast + navTo('login')。
 * 跳转：▶ 播放 → player { bvid, aid, cid, title }；⏭ 连播 → feed { bvid }；
 *   创作者行 → userSpace { mid }；💬 评论区 → comments { aid, title }；
 *   相关推荐 → videoDetail { bvid }（本页重载，onShow 检测 newOptions.bvid 变化兜底）。
 */

import { defineComponent } from 'vue';
import NavBar from '../../components/nav-bar.vue';
import Loading from '../../components/loading.vue';
import Empty from '../../components/empty.vue';
import { getVideoDetail, getRelated } from '../../services/api/video.js';
import {
  hasLiked,
  getCoinsInfo,
  getFollowState,
  likeVideo,
  coinVideo,
  followUser,
} from '../../services/api/interaction.js';
import { biliGet, BiliApiError } from '../../services/http.js';
import { isLoggedIn } from '../../services/auth.js';
import { formatDuration, formatCount, formatDate } from '../../utils/format.js';

const TOAST_MS = 1800;

/** 互动写操作错误码 → 全中文文案（-101/-111/65006/65004、投币族、关注族）。 */
const INTERACTION_ERRORS = {
  '-101': '请先登录',
  '-111': '登录状态已过期，请重新登录',
  '10003': '视频不存在或已被删除',
  '65004': '取消点赞失败，请稍后再试',
  '65006': '已经点过赞啦',
  '-104': '硬币不足，无法投币',
  '34002': '不能给自己投币',
  '34003': '投币数量不合法',
  '34004': '投币太频繁，请稍后再试',
  '34005': '已超过投币上限',
};

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
      // 互动状态（未登录显示默认值：未点赞/未投币/未关注）
      liked: false,
      coinsGiven: 0,
      followed: false,
      likeCount: 0,
      coinPanelVisible: false,
      likeBusy: false,
      coinBusy: false,
      followBusy: false,
      toast: '',
      toastTimer: null,
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
    likeCountText() {
      return formatCount(this.likeCount);
    },
    replyCountText() {
      const stat = (this.detail && this.detail.stat) || {};
      return formatCount(stat.reply);
    },
    coinBtnText() {
      return this.coinsGiven > 0 ? '🪙 已投 ' + this.coinsGiven + ' 枚' : '🪙 投币';
    },
    followBtnText() {
      return this.followed ? '✓ 已关注' : '➕ 关注';
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
        return;
      }
      // 从播放器/评论区等返回时刷新互动回显
      if (this.detail) this.refreshInteractionStates();
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
      this.resetInteractionState();
      if (!bvid) {
        this.loading = false;
        this.errorCode = -3;
        this.errorMessage = '缺少视频参数，无法加载';
        return;
      }
      this.fetchAll();
    },
    resetInteractionState() {
      this.liked = false;
      this.coinsGiven = 0;
      this.followed = false;
      this.likeCount = 0;
      this.coinPanelVisible = false;
      this.likeBusy = false;
      this.coinBusy = false;
      this.followBusy = false;
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
      this.likeCount = Number(detail.stat && detail.stat.like) || 0;
      this.loading = false;
      this.refreshInteractionStates();
      this.fetchRelated();
    },
    /**
     * 并行查询点赞/投币/关注三状态回显。
     * 未登录（isLoggedIn 为 false）不发起请求，保持默认值；单接口失败静默保持默认。
     */
    async refreshInteractionStates() {
      const detail = this.detail;
      if (!detail) return;
      const idParams = detail.aid ? { aid: detail.aid } : { bvid: detail.bvid || this.bvid };
      const mid = (detail.owner && detail.owner.mid) || 0;
      let loggedIn = false;
      try {
        loggedIn = await isLoggedIn();
      } catch (err) {
        loggedIn = false;
      }
      if (!loggedIn) {
        this.liked = false;
        this.coinsGiven = 0;
        this.followed = false;
        return;
      }
      const [likeRes, coinRes, followRes] = await Promise.all([
        this.wrapState(hasLiked(idParams)),
        this.wrapState(getCoinsInfo(idParams)),
        mid ? this.wrapState(getFollowState(mid)) : Promise.resolve(null),
      ]);
      if (this.detail !== detail) return;
      if (likeRes !== null) this.liked = likeRes === true;
      if (coinRes !== null) this.coinsGiven = Number(coinRes) || 0;
      if (followRes !== null) this.followed = followRes === true;
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
    onUpClick() {
      const mid = this.detail && this.detail.owner && this.detail.owner.mid;
      if (!mid) return;
      this.navTo('userSpace', { mid });
    },
    onCommentsClick() {
      const aid = this.detail && this.detail.aid;
      if (!aid) {
        this.showToast('缺少视频信息，无法打开评论区');
        return;
      }
      this.navTo('comments', { aid, title: (this.detail && this.detail.title) || '' });
    },
    /** 未登录统一处理：toast + 跳登录页；返回 true 表示已拦截。 */
    async guardLogin() {
      let loggedIn = false;
      try {
        loggedIn = await isLoggedIn();
      } catch (err) {
        loggedIn = false;
      }
      if (!loggedIn) {
        this.showToast('请先登录');
        this.navTo('login');
        return true;
      }
      return false;
    },
    async onLikeClick() {
      if (!this.detail || this.likeBusy) return;
      if (await this.guardLogin()) return;
      const target = this.detail;
      const turnOn = !this.liked;
      this.likeBusy = true;
      try {
        const res = await likeVideo({
          aid: target.aid,
          bvid: target.bvid || this.bvid,
          on: turnOn,
        });
        if (this.detail !== target) return;
        this.liked = !!(res && res.liked);
        this.likeCount = Math.max(0, this.likeCount + (turnOn ? 1 : -1));
        this.showToast(turnOn ? '点赞成功' : '已取消点赞');
      } catch (err) {
        if (this.detail !== target) return;
        const code = this.codeOf(err);
        // 重复点赞视为已赞成功
        if (code === 65006) {
          this.liked = true;
          if (this.likeCount === 0) this.likeCount = 1;
          this.showToast('已经点过赞啦');
          return;
        }
        this.showInteractionError(err);
      } finally {
        this.likeBusy = false;
      }
    },
    async onCoinClick() {
      if (!this.detail || this.coinBusy) return;
      if (this.coinsGiven >= 2) {
        this.showToast('已投过 2 枚硬币啦');
        return;
      }
      if (await this.guardLogin()) return;
      this.coinPanelVisible = true;
    },
    async onCoinSelect(multiply) {
      if (!this.detail || this.coinBusy) return;
      const target = this.detail;
      const coins = multiply === 2 ? 2 : 1;
      this.coinPanelVisible = false;
      this.coinBusy = true;
      try {
        const res = await coinVideo({
          aid: target.aid,
          bvid: target.bvid || this.bvid,
          multiply: coins,
          selectLike: false,
        });
        if (this.detail !== target) return;
        this.coinsGiven = Math.min(2, this.coinsGiven + (res ? res.multiply : coins));
        this.showToast('已投 ' + coins + ' 枚硬币');
        if (res && res.liked && !this.liked) {
          this.liked = true;
          this.likeCount += 1;
        }
      } catch (err) {
        if (this.detail !== target) return;
        this.showInteractionError(err);
      } finally {
        this.coinBusy = false;
      }
    },
    onCoinCancel() {
      this.coinPanelVisible = false;
    },
    async onFollowClick() {
      if (!this.detail || this.followBusy) return;
      if (await this.guardLogin()) return;
      const target = this.detail;
      const mid = target.owner && target.owner.mid;
      if (!mid) {
        this.showToast('缺少 UP 主信息');
        return;
      }
      const turnOn = !this.followed;
      this.followBusy = true;
      try {
        const res = await followUser(mid, turnOn);
        if (this.detail !== target) return;
        this.followed = !!(res && res.followed);
        this.showToast(turnOn ? '关注成功' : '已取消关注');
      } catch (err) {
        if (this.detail !== target) return;
        this.showInteractionError(err);
      } finally {
        this.followBusy = false;
      }
    },
    showInteractionError(error) {
      const code = this.codeOf(error);
      if (code === -101) {
        this.showToast('请先登录');
        this.navTo('login');
        return;
      }
      this.showToast(
        INTERACTION_ERRORS[String(code)] ||
          (error && error.message) ||
          '操作失败，请稍后再试'
      );
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
    navTo(target, params) {
      try {
        $falcon.navTo(target, params || {});
      } catch (err) {
        this.showToast('页面跳转失败：' + target);
      }
    },
    wrap(promise) {
      return promise
        .then((data) => ({ data, error: null }))
        .catch((error) => ({ data: null, error }));
    },
    /** 状态查询专用：失败返回 null（保持默认回显），不弹错误。 */
    wrapState(promise) {
      return promise.catch(() => null);
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
