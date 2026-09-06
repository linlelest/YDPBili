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
    <div class="user-card" @click="onClick">
        <image v-if="user.upic" class="avatar" :src="user.upic" resize="cover"></image>
        <div v-else class="avatar avatar-fallback">
            <text class="avatar-fallback-text">{{ unameFirst }}</text>
        </div>
        <div class="info">
            <text class="uname">{{ unameText }}</text>
            <text class="usign">{{ usignText }}</text>
            <div class="meta-row">
                <text class="meta">{{ fansText }} 粉丝</text>
                <text class="meta" v-if="videosCount > 0">{{ videosText }} 视频</text>
            </div>
        </div>
    </div>
</template>

<style lang="less" scoped>
@import '../../styles/theme.less';

.user-card {
    background-color: @card;
    border-radius: @radius-md;
    padding: @card-pad;
    flex-direction: row;
    align-items: center;
}

.avatar {
    width: 64px;
    height: 64px;
    border-radius: @radius-round;
    background-color: @card-pressed;
}

.avatar-fallback {
    align-items: center;
    justify-content: center;
}

.avatar-fallback-text {
    color: @text-secondary;
    font-size: @font-md;
}

.info {
    flex: 1;
    margin-left: @card-pad;
}

.uname {
    color: @text;
    font-size: @font-base;
    lines: 1;
    text-overflow: ellipsis;
}

.usign {
    margin-top: 4px;
    color: @text-secondary;
    font-size: @font-sm;
    lines: 1;
    text-overflow: ellipsis;
}

.meta-row {
    margin-top: 8px;
    flex-direction: row;
    justify-content: space-between;
}

.meta {
    color: @text-secondary;
    font-size: @font-sm;
}
</style>

<script>
import { formatCount } from '../../utils/format.js';

export default {
    name: 'UserCard',
    props: {
        user: {
            type: Object,
            default: () => ({ mid: 0, uname: '', usign: '', upic: '', fans: 0, videos: 0 }),
        },
    },
    computed: {
        unameText() {
            return (this.user && this.user.uname) || '未知用户';
        },
        unameFirst() {
            return this.unameText.charAt(0) || 'B';
        },
        usignText() {
            return (this.user && this.user.usign) || '这个人很懒，什么都没有写';
        },
        fansText() {
            return formatCount(this.user && this.user.fans);
        },
        videosCount() {
            return Number(this.user && this.user.videos) || 0;
        },
        videosText() {
            return formatCount(this.videosCount);
        },
    },
    methods: {
        onClick() {
            this.$emit('click', this.user);
        },
    },
};
</script>
