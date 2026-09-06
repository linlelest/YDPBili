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
import Loading from '../../components/loading.vue';
import { createQrMatrix } from '../../utils/qrcode.js';
import { generateQrCode, pollQrCode } from '../../services/api/passport.js';
import { isLoggedIn, setSession, clearSession } from '../../services/auth.js';
import { getUserInfo } from '../../services/api/nav.js';

const POLL_INTERVAL_MS = 2000;
const COUNTDOWN_INTERVAL_MS = 1000;
const QR_TTL_SECONDS = 180;
const JUMP_DELAY_MS = 1200;
const EXPIRED_RETRY_DELAY_MS = 600;
const MAX_CONSECUTIVE_ERRORS = 5;

const EMPTY_USER = { face: '', uname: '', level: 0, money: 0 };

const page = defineComponent({
  components: {
    'nav-bar': NavBar,
    loading: Loading,
  },
  data() {
    return {
      title: '哔哩哔哩登录',
      mode: 'guest',
      qrStatus: 'loading',
      statusText: '正在获取二维码…',
      qrMatrix: [],
      qrSize: 0,
      countdown: 0,
      toast: '',
      userLoading: false,
      user: Object.assign({}, EMPTY_USER),
    };
  },
  computed: {
    showCountdown() {
      return this.qrStatus === 'waiting' || this.qrStatus === 'scanned';
    },
    qrCellPx() {
      return this.qrSize >= 47 ? 4 : 5;
    },
    qrGridPx() {
      return this.qrSize * this.qrCellPx;
    },
    qrCardStyle() {
      return { width: (this.qrGridPx || 225) + 20 + 'px' };
    },
    qrGridStyle() {
      return { width: this.qrGridPx + 'px', height: this.qrGridPx + 'px' };
    },
    qrMaskStyle() {
      return { width: this.qrGridPx + 'px', height: this.qrGridPx + 'px' };
    },
    qrLoadingStyle() {
      return { width: (this.qrGridPx || 225) + 'px', height: (this.qrGridPx || 225) + 'px' };
    },
  },
  created() {
    this.qrcodeKey = '';
    this.pollTimer = null;
    this.countdownTimer = null;
    this.pollBusy = false;
    this.consecutiveErrors = 0;
    this.toastTimer = null;
    this.initialized = false;
  },
  methods: {
    onBack() {
      const pageObj = this.$page;
      if (pageObj && typeof pageObj.finish === 'function') pageObj.finish();
    },

    goIndex() {
      $falcon.navTo('index', {});
    },

    showToast(message) {
      this.toast = message;
      if (this.toastTimer) {
        this.$page.clearTimeout(this.toastTimer);
      }
      this.toastTimer = this.$page.setTimeout(() => {
        this.toast = '';
        this.toastTimer = null;
      }, 1500);
    },

    startTimers() {
      if (this.pollTimer) return;
      this.pollTimer = this.$page.setInterval(() => this.pollTick(), POLL_INTERVAL_MS);
      this.countdownTimer = this.$page.setInterval(() => this.tickCountdown(), COUNTDOWN_INTERVAL_MS);
    },

    stopTimers() {
      if (this.pollTimer) {
        this.$page.clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      if (this.countdownTimer) {
        this.$page.clearInterval(this.countdownTimer);
        this.countdownTimer = null;
      }
    },

    onShow() {
      if (!this.initialized) {
        this.initialized = true;
        this.initPage();
        return;
      }
      if (this.mode !== 'guest') return;
      if (this.qrStatus === 'error') {
        this.loadQrCode();
        return;
      }
      if (this.qrcodeKey && (this.qrStatus === 'waiting' || this.qrStatus === 'scanned')) {
        this.startTimers();
      }
    },

    onHide() {
      this.stopTimers();
    },

    onUnload() {
      this.stopTimers();
    },

    async initPage() {
      let loggedIn = false;
      try {
        loggedIn = await isLoggedIn();
      } catch (err) {
        loggedIn = false;
      }
      if (loggedIn) {
        this.mode = 'user';
        await this.loadUser();
        return;
      }
      this.mode = 'guest';
      await this.loadQrCode();
    },

    async loadUser() {
      this.userLoading = true;
      try {
        const info = await getUserInfo();
        if (!info.isLogin) {
          await clearSession();
          this.user = Object.assign({}, EMPTY_USER);
          this.mode = 'guest';
          await this.loadQrCode();
          return;
        }
        this.user = info;
      } catch (err) {
        this.showToast('用户信息加载失败，请稍后重试');
      } finally {
        this.userLoading = false;
      }
    },

    async onLogout() {
      try {
        await clearSession();
      } catch (err) {
        this.showToast('退出登录失败，请重试');
        return;
      }
      this.user = Object.assign({}, EMPTY_USER);
      this.mode = 'guest';
      await this.loadQrCode();
    },

    onRefresh() {
      if (this.mode !== 'guest' || this.qrStatus === 'loading') return;
      this.refreshQrCode();
    },

    async refreshQrCode() {
      this.stopTimers();
      await this.loadQrCode();
    },

    async loadQrCode() {
      if (this.pollTimer || this.countdownTimer) {
        this.stopTimers();
      }
      this.qrStatus = 'loading';
      this.statusText = '正在获取二维码…';
      try {
        const result = await generateQrCode();
        const matrix = createQrMatrix(result.url, 'M');
        this.qrMatrix = matrix;
        this.qrSize = matrix.length;
        this.qrcodeKey = result.qrcodeKey;
        this.countdown = QR_TTL_SECONDS;
        this.consecutiveErrors = 0;
        this.qrStatus = 'waiting';
        this.statusText = '请使用哔哩哔哩 App 扫码';
        this.startTimers();
      } catch (err) {
        this.qrStatus = 'error';
        this.statusText = '二维码获取失败，请点击刷新重试';
      }
    },

    tickCountdown() {
      if (this.countdown > 0) this.countdown -= 1;
      if (this.countdown <= 0 && (this.qrStatus === 'waiting' || this.qrStatus === 'scanned')) {
        this.handleExpired('二维码已失效，正在重新获取…');
      }
    },

    handleExpired(message) {
      this.qrStatus = 'expired';
      this.statusText = message;
      this.stopTimers();
      this.$page.setTimeout(() => this.loadQrCode(), EXPIRED_RETRY_DELAY_MS);
    },

    async pollTick() {
      if (!this.qrcodeKey || this.pollBusy) return;
      this.pollBusy = true;
      try {
        const result = await pollQrCode(this.qrcodeKey);
        this.consecutiveErrors = 0;
        this.applyPollResult(result);
      } catch (err) {
        this.consecutiveErrors += 1;
        if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          this.stopTimers();
          this.qrStatus = 'error';
          this.statusText = '网络异常，请点击刷新重试';
        } else {
          this.statusText = '网络波动，正在重试…';
        }
      } finally {
        this.pollBusy = false;
      }
    },

    async applyPollResult(result) {
      switch (result.code) {
        case 0:
          await this.handleLoginSuccess(result);
          break;
        case 86090:
          this.qrStatus = 'scanned';
          this.statusText = '已扫描，请在手机上确认登录';
          break;
        case 86101:
          this.qrStatus = 'waiting';
          this.statusText = '请使用哔哩哔哩 App 扫码';
          break;
        case 86038:
          this.handleExpired('二维码已失效，正在重新获取…');
          break;
        default:
          this.statusText = '扫码状态异常(' + result.code + ')，继续等待…';
          break;
      }
    },

    async handleLoginSuccess(result) {
      this.stopTimers();
      const session = result.session || {};
      if (!session.SESSDATA || !session.bili_jct) {
        this.qrStatus = 'error';
        this.statusText = '登录凭证提取失败，请刷新重试';
        return;
      }
      try {
        await setSession({
          SESSDATA: session.SESSDATA,
          bili_jct: session.bili_jct,
          DedeUserID: session.DedeUserID,
          refresh_token: result.refreshToken,
          DedeUserID__ckMd5: session.DedeUserID__ckMd5,
        });
      } catch (err) {
        this.qrStatus = 'error';
        this.statusText = '登录凭证保存失败，请刷新重试';
        return;
      }
      this.qrStatus = 'success';
      this.statusText = '登录成功，正在跳转…';
      this.showToast('登录成功');
      this.$page.setTimeout(() => this.goIndex(), JUMP_DELAY_MS);
    },
  },
});

export default page;
