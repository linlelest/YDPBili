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
 * settings.js —— 设置页
 *
 * 分组：播放（画质/倍速/解码器）、数据（清除缓存/退出登录）、关于。
 * 修改即时 setSettings 持久化并 toast「已保存」。
 * 清除缓存仅删 bilibili_search_history 与 bilibili_wbi_keys，
 * 保留 bilibili_session / bilibili_settings / buvid3。
 */

import { defineComponent } from 'vue';
import NavBar from '../../components/nav-bar.vue';
import {
  DEFAULT_SETTINGS,
  PLAYBACK_RATE_OPTIONS,
  QUALITY_OPTIONS,
  getSettings,
  setSettings,
} from '../../services/settings.js';
import { clearSession, isLoggedIn } from '../../services/auth.js';
import { storageRemove } from '../../services/env.js';

const SEARCH_HISTORY_KEY = 'bilibili_search_history';
const WBI_CACHE_KEY = 'bilibili_wbi_keys';

const QUALITY_LABELS = {
  16: '360P流畅',
  32: '480P清晰',
  64: '720P高清',
  80: '1080P全高清',
};

const RATE_LABELS = {
  0.5: '0.5x',
  0.75: '0.75x',
  1: '1.0x',
  1.25: '1.25x',
  1.5: '1.5x',
  2: '2.0x',
};

const DECODER_ITEMS = [
  { value: 'auto', label: '智能', desc: '优先系统播放器，不可用自动回退软解/仅音频' },
  { value: 'system', label: '系统', desc: '强制宿主视频组件播放，兼容性以真机为准' },
  { value: 'ffmpeg', label: '软解', desc: 'C++ 软解渲染画面，需固件编译支持，不可用自动降级' },
  { value: 'audio_only', label: '仅音频', desc: '只播音频并显示封面，最省流最稳定' },
];

const LOGOUT_ARM_MS = 3000;
const TOAST_MS = 1500;

const page = defineComponent({
  components: {
    'nav-bar': NavBar,
  },
  data() {
    return {
      title: '设置',
      toast: '',
      loggedIn: false,
      logoutText: '退出登录',
      settings: Object.assign({}, DEFAULT_SETTINGS),
      qualityItems: QUALITY_OPTIONS.map((q) => ({
        value: q,
        label: QUALITY_LABELS[q] || String(q),
      })),
      rateItems: PLAYBACK_RATE_OPTIONS.map((r) => ({
        value: r,
        label: RATE_LABELS[r] || String(r) + 'x',
      })),
      decoderItems: DECODER_ITEMS,
      danmakuFontItems: DANMAKU_FONT_OPTIONS.map((f) => ({
        value: f,
        label: DANMAKU_FONT_LABELS[f] || String(f),
      })),
    };
  },
  created() {
    this.toastTimer = null;
    this.logoutTimer = null;
    this.logoutArmed = false;
    this.restore();
  },
  methods: {
    onBack() {
      const pageObj = this.$page;
      if (pageObj && typeof pageObj.finish === 'function') pageObj.finish();
    },

    async restore() {
      try {
        this.settings = await getSettings();
        this.loggedIn = await isLoggedIn();
      } catch (err) {
        this.settings = Object.assign({}, DEFAULT_SETTINGS);
        this.loggedIn = false;
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

    async applySettings(patch) {
      try {
        this.settings = await setSettings(patch);
        this.showToast('已保存');
      } catch (err) {
        this.showToast('保存失败，请重试');
      }
    },

    onQuality(value) {
      if (this.settings.videoQuality === value) return;
      this.applySettings({ videoQuality: value });
    },

    onRate(value) {
      if (this.settings.playbackRate === value) return;
      this.applySettings({ playbackRate: value });
    },

    onDecoder(value) {
      if (this.settings.decoder === value) return;
      this.applySettings({ decoder: value });
    },

    onDanmakuToggle(value) {
      if (this.settings.danmakuEnabled === value) return;
      this.applySettings({ danmakuEnabled: value });
    },

    onDanmakuFont(value) {
      if (this.settings.danmakuFontSize === value) return;
      this.applySettings({ danmakuFontSize: value });
    },

    async onClearCache() {
      try {
        await storageRemove(SEARCH_HISTORY_KEY);
        await storageRemove(WBI_CACHE_KEY);
        this.showToast('已清除');
      } catch (err) {
        this.showToast('清除失败，请重试');
      }
    },

    onLogout() {
      if (!this.loggedIn) return;
      if (!this.logoutArmed) {
        this.logoutArmed = true;
        this.logoutText = '再点一次确认退出';
        if (this.logoutTimer) {
          this.$page.clearTimeout(this.logoutTimer);
        }
        this.logoutTimer = this.$page.setTimeout(() => {
          this.logoutArmed = false;
          this.logoutText = '退出登录';
          this.logoutTimer = null;
        }, LOGOUT_ARM_MS);
        return;
      }
      if (this.logoutTimer) {
        this.$page.clearTimeout(this.logoutTimer);
        this.logoutTimer = null;
      }
      this.logoutArmed = false;
      this.logoutText = '退出登录';
      clearSession()
        .then(() => {
          this.loggedIn = false;
          this.showToast('已退出登录');
        })
        .catch(() => {
          this.showToast('退出失败，请重试');
        });
    },
  },
});

export default page;
