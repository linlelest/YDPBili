<!--
 Copyright (C) 2025 Bilibili miniapp contributors

 This file is part of miniapp.

 miniapp is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 miniapp is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with miniapp. If not, see <https://www.gnu.org/licenses/>.
-->

<template>
    <div v-if="visible" class="empty">
        <text class="icon">{{ icon }}</text>
        <text class="message">{{ messageText }}</text>
        <slot></slot>
    </div>
</template>

<style lang="less" scoped>
@import '../styles/theme.less';

.empty {
    padding: 48px @page-pad;
    align-items: center;
}

.icon {
    color: @text-disabled;
    font-size: 56px;
    margin-bottom: 12px;
}

.message {
    color: @text-secondary;
    font-size: @font-base;
    text-align: center;
    line-height: 32px;
}
</style>

<script>
/**
 * 错误码文案映射（BiliApiError 常见 code）：
 * -101 未登录 / -412 风控拦截 / -352 触发安全验证 / -404 内容不存在 /
 * -403 权限不足 / 62002 稿件不可见 / 62004 审核中 / -1 网络错误 / -2 解析错误
 */
const ERROR_MESSAGES = {
  '-101': '未登录，请先登录',
  '-412': '请求被风控拦截，请稍后再试',
  '-352': '触发安全验证，请稍后再试',
  '-404': '内容不存在',
  '-403': '权限不足',
  '62002': '稿件不可见',
  '62004': '稿件审核中',
  '-1': '网络连接失败，请检查网络',
  '-2': '响应数据异常',
  '-3': '请求参数错误',
};

const ERROR_ICONS = {
  '-101': '🔒',
  '-412': '🛡',
  '-352': '🛡',
};

export default {
  name: 'Empty',
  props: {
    visible: { type: Boolean, default: true },
    code: { type: [Number, String], default: 0 },
    message: { type: String, default: '' },
  },
  computed: {
    messageText() {
      if (this.message) return this.message;
      const key = String(this.code || '');
      return ERROR_MESSAGES[key] || '暂无内容';
    },
    icon() {
      const key = String(this.code || '');
      return ERROR_ICONS[key] || '📭';
    },
  },
};
</script>
