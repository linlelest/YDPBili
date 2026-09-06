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
            <text class="group-title">播放</text>
            <div class="card">
                <text class="item-label">默认画质</text>
                <div class="chips">
                    <div v-for="q in qualityItems" :key="q.value"
                        :class="settings.videoQuality === q.value ? 'chip chip-active' : 'chip'"
                        @click="onQuality(q.value)">
                        <text
                            :class="settings.videoQuality === q.value ? 'chip-text-active' : 'chip-text'">{{ q.label }}</text>
                    </div>
                </div>
                <text class="item-note">720P以上需登录，高画质随账号权限自动降级</text>
            </div>
            <div class="card">
                <text class="item-label">默认倍速</text>
                <div class="chips">
                    <div v-for="r in rateItems" :key="r.value"
                        :class="settings.playbackRate === r.value ? 'chip chip-active' : 'chip'"
                        @click="onRate(r.value)">
                        <text
                            :class="settings.playbackRate === r.value ? 'chip-text-active' : 'chip-text'">{{ r.label }}</text>
                    </div>
                </div>
            </div>
            <div class="card">
                <text class="item-label">默认解码器</text>
                <div v-for="d in decoderItems" :key="d.value" class="decoder-item"
                    @click="onDecoder(d.value)">
                    <div :class="settings.decoder === d.value ? 'chip chip-active' : 'chip'">
                        <text
                            :class="settings.decoder === d.value ? 'chip-text-active' : 'chip-text'">{{ d.label }}</text>
                    </div>
                    <text
                        :class="settings.decoder === d.value ? 'decoder-desc decoder-desc-active' : 'decoder-desc'">{{ d.desc }}</text>
                </div>
            </div>

            <text class="group-title">数据</text>
            <div class="card">
                <div class="action-row" @click="onClearCache">
                    <text class="action-text">清除缓存</text>
                    <text class="action-sub">搜索历史与 WBI 当日缓存</text>
                </div>
                <div v-if="loggedIn" class="action-divider"></div>
                <div v-if="loggedIn" class="action-row" @click="onLogout">
                    <text class="action-text-danger">{{ logoutText }}</text>
                </div>
            </div>

            <text class="group-title">关于</text>
            <div class="card">
                <div class="about-row">
                    <text class="about-key">版本</text>
                    <text class="about-value">v1.0.0</text>
                </div>
                <text class="about-desc">第三方哔哩哔哩客户端，基于 langningchen/miniapp 与 penosext 社区框架构建，遵守 GPL-3.0 协议开源；数据来自 bilibili.com 公开接口。</text>
                <text class="about-disclaimer">免责声明：仅供个人学习与研究使用，内容版权归原平台及创作者所有，请遵守当地法律法规。</text>
            </div>
        </scroller>
        <div v-if="toast" class="toast">
            <text class="toast-text">{{ toast }}</text>
        </div>
    </div>
</template>

<style lang="less" scoped src="./settings.less"></style>

<script>
import page from './settings';
export default page;
</script>
