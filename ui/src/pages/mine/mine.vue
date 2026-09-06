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
    <div class="page">
        <nav-bar :title="title" :show-back="true" @back="onBack"></nav-bar>
        <scroller class="body" scroll-direction="vertical">
            <loading v-if="state === 'loading'" :visible="true" text="正在加载用户信息..."></loading>
            <empty
                v-else-if="state === 'error'"
                :visible="true"
                :code="errorCode"
                :message="errorMsg"
            ></empty>
            <div v-else class="content">
                <div v-if="!isLogin" class="guest-box">
                    <empty :visible="true" icon="👤" message="登录后可查看动态与历史记录"></empty>
                    <div class="primary-btn" @click="goLogin">
                        <text class="primary-btn-text">去登录</text>
                    </div>
                </div>
                <div v-else>
                    <div class="profile-card">
                        <image
                            v-if="user.face"
                            class="avatar"
                            :src="user.face"
                            resize="cover"
                        ></image>
                        <text v-else class="avatar avatar-fallback">B</text>
                        <div class="profile-info">
                            <text class="uname">{{ user.uname }}</text>
                            <div class="meta-row">
                                <text class="level-badge">{{ levelText }}</text>
                                <text class="coin">{{ coinText }}</text>
                            </div>
                        </div>
                    </div>
                    <div class="menu-group">
                        <div
                            v-for="menu in menuList"
                            :key="menu.key"
                            class="menu-item"
                            @click="onMenuTap(menu)"
                        >
                            <text class="menu-icon">{{ menu.icon }}</text>
                            <div class="menu-text">
                                <text class="menu-label">{{ menu.label }}</text>
                                <text class="menu-desc">{{ menu.desc }}</text>
                            </div>
                            <text class="menu-arrow">›</text>
                        </div>
                    </div>
                    <div class="logout-btn" @click="onLogoutTap">
                        <text :class="['logout-text', logoutArmed ? 'logout-text-armed' : '']">{{ logoutText }}</text>
                    </div>
                </div>
            </div>
        </scroller>
        <div v-if="notice" class="notice-mask">
            <text class="notice-text">{{ notice }}</text>
        </div>
    </div>
</template>

<style lang="less" scoped>
@import url('../../styles/theme.less');

.page {
    width: @page-width;
    height: 936px;
    background-color: @bg;
}

.body {
    flex: 1;
}

.content {
    padding: @page-pad;
}

.guest-box {
    padding-top: 80px;
    align-items: center;
}

.primary-btn {
    margin-top: 24px;
    width: 200px;
    height: 64px;
    background-color: @primary;
    border-radius: @radius-round;
    align-items: center;
    justify-content: center;
}

.primary-btn-text {
    color: #ffffff;
    font-size: @font-base;
}

.profile-card {
    background-color: @card;
    border-radius: @radius-md;
    padding: @card-pad;
    flex-direction: row;
    align-items: center;
}

.avatar {
    width: 72px;
    height: 72px;
    border-radius: @radius-round;
    background-color: @card-pressed;
}

.avatar-fallback {
    color: @text-secondary;
    font-size: @font-lg;
    line-height: 72px;
    text-align: center;
}

.profile-info {
    flex: 1;
    margin-left: @card-pad;
}

.uname {
    color: @text;
    font-size: @font-title;
    lines: 1;
    text-overflow: ellipsis;
}

.meta-row {
    margin-top: 8px;
    flex-direction: row;
    align-items: center;
}

.level-badge {
    color: @primary;
    font-size: @font-xs;
    padding-left: 8px;
    padding-right: 8px;
    line-height: 28px;
    background-color: @card-pressed;
    border-radius: @radius-sm;
}

.coin {
    margin-left: 12px;
    color: @text-secondary;
    font-size: @font-sm;
}

.menu-group {
    margin-top: @card-gap;
    background-color: @card;
    border-radius: @radius-md;
}

.menu-item {
    height: 96px;
    padding-left: @card-pad;
    padding-right: @card-pad;
    flex-direction: row;
    align-items: center;
    border-bottom-width: 1px;
    border-bottom-color: @divider;
}

.menu-text {
    flex: 1;
    margin-left: 12px;
}

.menu-icon {
    color: @text;
    font-size: @font-md;
    width: 40px;
}

.menu-label {
    color: @text;
    font-size: @font-base;
}

.menu-desc {
    margin-top: 2px;
    color: @text-secondary;
    font-size: @font-xs;
    lines: 1;
    text-overflow: ellipsis;
}

.menu-arrow {
    color: @text-disabled;
    font-size: @font-lg;
}

.logout-btn {
    margin-top: 24px;
    height: 72px;
    background-color: @card;
    border-radius: @radius-md;
    border-width: 1px;
    border-color: @danger;
    align-items: center;
    justify-content: center;
}

.logout-text {
    color: @danger;
    font-size: @font-base;
}

.logout-text-armed {
    color: @warning;
}

.notice-mask {
    position: absolute;
    left: @page-pad;
    right: @page-pad;
    bottom: 48px;
    background-color: @mask;
    border-radius: @radius-sm;
    padding: 12px;
    align-items: center;
}

.notice-text {
    color: #ffffff;
    font-size: @font-sm;
    text-align: center;
    lines: 2;
}
</style>

<script>
import page from './mine';
export default page;
</script>
