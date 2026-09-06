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
 * mine.js —— 我的页
 *
 * 未登录：空态 + 「去登录」→ navTo('login')；
 * 已登录：头像/昵称/Lv/硬币 + 菜单（我的动态 → dynamics、历史记录 → history、
 *   设置 → settings）+ 退出登录（二次点击确认，文案变「再点一次确认退出」）。
 * onShow 每次进入刷新登录态（从登录页返回后自动同步）；
 * loadOptions/newOptions 无参数依赖，仅保留启动参数存档。
 */

import { defineComponent } from 'vue';
import NavBar from '../../components/nav-bar.vue';
import Loading from '../../components/loading.vue';
import Empty from '../../components/empty.vue';
import { getUserInfo } from '../../services/api/nav.js';
import { isLoggedIn, clearSession } from '../../services/auth.js';

const LOGOUT_ARM_RESET_MS = 3000;
const NOTICE_MS = 4000;

const EMPTY_USER = { uname: '未命名用户', face: '', level: 0, money: 0 };

const MENUS = [
  { key: 'dynamics', icon: '📋', label: '我的动态', desc: '关注 UP 主的最新动态' },
  { key: 'history', icon: '🕘', label: '历史记录', desc: '继续观看没看完的视频' },
  { key: 'settings', icon: '⚙', label: '设置', desc: '画质、倍速与解码器' },
];

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
      title: '我的',
      state: 'loading',
      isLogin: false,
      user: Object.assign({}, EMPTY_USER),
      errorCode: 0,
      errorMsg: '',
      logoutArmed: false,
      notice: '',
      noticeTimer: 0,
    };
  },
  computed: {
    menuList() {
      return MENUS;
    },
    levelText() {
      return 'Lv.' + (this.user.level || 0);
    },
    coinText() {
      return '硬币 ' + (this.user.money || 0);
    },
    logoutText() {
      return this.logoutArmed ? '再点一次确认退出' : '退出登录';
    },
  },
  created() {
    this.started = false;
    this.startOptions = {};
    this.logoutArmTimer = 0;
  },
  mounted() {
    const pageObj = this.$page;
    this.startOptions = (pageObj && (pageObj.loadOptions || pageObj.options)) || {};
  },
  unmounted() {
    if (this.noticeTimer) {
      clearTimeout(this.noticeTimer);
      this.noticeTimer = 0;
    }
    if (this.logoutArmTimer) {
      clearTimeout(this.logoutArmTimer);
      this.logoutArmTimer = 0;
    }
  },
  methods: {
    onShow() {
      this.refresh(!this.started);
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
    async refresh(withLoading) {
      if (withLoading) {
        this.state = 'loading';
        this.errorCode = 0;
        this.errorMsg = '';
      }
      let loggedIn = false;
      try {
        loggedIn = await isLoggedIn();
      } catch (err) {
        loggedIn = false;
      }
      if (!loggedIn) {
        this.started = true;
        this.isLogin = false;
        this.user = Object.assign({}, EMPTY_USER);
        this.resetLogoutArm();
        this.state = 'ready';
        return;
      }
      try {
        const info = await getUserInfo();
        if (!info.isLogin) {
          try {
            await clearSession();
          } catch (err) {
            // 会话清理失败不影响未登录态展示
          }
          this.isLogin = false;
          this.user = Object.assign({}, EMPTY_USER);
        } else {
          this.isLogin = true;
          this.user = {
            uname: info.uname || EMPTY_USER.uname,
            face: info.face || '',
            level: info.level || 0,
            money: info.money || 0,
          };
        }
        this.state = 'ready';
      } catch (err) {
        const mapped = this.mapError(err);
        if (this.started) {
          this.showNotice('用户信息刷新失败：' + mapped.message);
        } else {
          this.state = 'error';
          this.errorCode = mapped.code;
          this.errorMsg = mapped.message;
        }
      }
      this.started = true;
    },
    goLogin() {
      this.navTo('login', {});
    },
    onMenuTap(menu) {
      if (!menu || !menu.key) return;
      this.navTo(menu.key, {});
    },
    resetLogoutArm() {
      this.logoutArmed = false;
      if (this.logoutArmTimer) {
        clearTimeout(this.logoutArmTimer);
        this.logoutArmTimer = 0;
      }
    },
    onLogoutTap() {
      if (!this.logoutArmed) {
        this.logoutArmed = true;
        if (this.logoutArmTimer) clearTimeout(this.logoutArmTimer);
        this.logoutArmTimer = setTimeout(() => {
          this.logoutArmed = false;
          this.logoutArmTimer = 0;
        }, LOGOUT_ARM_RESET_MS);
        return;
      }
      this.resetLogoutArm();
      this.doLogout();
    },
    async doLogout() {
      try {
        await clearSession();
      } catch (err) {
        this.showNotice('退出登录失败，请重试');
        return;
      }
      this.isLogin = false;
      this.user = Object.assign({}, EMPTY_USER);
      this.showNotice('已退出登录');
    },
  },
});

export default page;
