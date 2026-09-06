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
            <div v-if="mode === 'guest'" class="guest">
                <text class="headline">哔哩哔哩登录</text>
                <text class="subhead">使用哔哩哔哩 App 扫码登录</text>
                <div class="qr-card" :style="qrCardStyle">
                    <div v-if="qrStatus === 'error' || (qrStatus === 'loading' && qrSize === 0)" class="qr-loading-wrap" :style="qrLoadingStyle">
                        <loading v-if="qrStatus === 'loading'" :visible="true" text="正在获取二维码…"></loading>
                        <div v-else class="qr-mask-block">
                            <text class="qr-mask-text">二维码获取失败</text>
                            <text class="qr-mask-sub">点击下方按钮重试</text>
                        </div>
                    </div>
                    <div v-else class="qr-grid" :style="qrGridStyle">
                        <div v-for="(row, r) in qrMatrix" :key="'r' + r" class="qr-row"
                            :style="{ height: qrCellPx + 'px' }">
                            <div v-for="(cell, c) in row" :key="'c' + c" class="qr-cell"
                                :style="{ width: qrCellPx + 'px', height: qrCellPx + 'px', backgroundColor: cell ? '#000000' : '#FFFFFF' }"></div>
                        </div>
                    </div>
                    <div v-if="qrStatus === 'expired'" class="qr-expired-mask" :style="qrMaskStyle">
                        <text class="qr-mask-text">二维码已失效</text>
                        <text class="qr-mask-sub">正在重新获取…</text>
                    </div>
                </div>
                <text class="status">{{ statusText }}</text>
                <text v-if="showCountdown" class="countdown">有效期剩余 {{ countdown }} 秒</text>
                <div class="btn btn-primary" @click="onRefresh">
                    <text class="btn-text">刷新二维码</text>
                </div>
                <div class="btn btn-ghost" @click="goIndex">
                    <text class="btn-ghost-text">跳过，先逛逛</text>
                </div>
            </div>
            <div v-else class="user">
                <image v-if="user.face" :src="user.face" class="avatar" resize="cover"></image>
                <text v-else class="avatar-fallback">B</text>
                <text class="uname">{{ user.uname || '哔哩哔哩用户' }}</text>
                <div class="badges">
                    <text class="badge">Lv.{{ user.level }}</text>
                    <text class="badge">硬币 {{ user.money }}</text>
                </div>
                <text v-if="userLoading" class="user-tip">用户信息加载中…</text>
                <div class="btn btn-danger" @click="onLogout">
                    <text class="btn-danger-text">退出登录</text>
                </div>
            </div>
        </scroller>
        <div v-if="toast" class="toast">
            <text class="toast-text">{{ toast }}</text>
        </div>
    </div>
</template>

<style lang="less" scoped src="./login.less"></style>

<script>
import page from './login';
export default page;
</script>
