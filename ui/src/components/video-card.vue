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
    <div class="video-card" :style="{ width: width + 'px' }" @click="onClick">
        <div class="cover-wrap" :style="{ width: width + 'px', height: coverHeight + 'px' }">
            <image class="cover" :src="video.pic" resize="cover"></image>
            <text class="duration-badge">{{ durationText }}</text>
        </div>
        <div class="info">
            <text class="title">{{ video.title }}</text>
            <div class="meta-row">
                <text class="up-name">{{ upName }}</text>
                <text class="play-count">{{ viewText }}播放</text>
            </div>
        </div>
    </div>
</template>

<style lang="less" scoped>
@import '../styles/theme.less';

.video-card {
    background-color: @card;
    border-radius: @radius-md;
    overflow: hidden;
}

.cover-wrap {
    position: relative;
    background-color: @card-pressed;
}

.cover {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
}

.duration-badge {
    position: absolute;
    right: 8px;
    bottom: 8px;
    color: #ffffff;
    font-size: @font-xs;
    line-height: 24px;
    padding-left: 8px;
    padding-right: 8px;
    background-color: @mask;
    border-radius: @radius-sm;
}

.info {
    padding: @card-pad;
}

.title {
    color: @text;
    font-size: @font-base;
    line-height: 32px;
    lines: 2;
    text-overflow: ellipsis;
}

.meta-row {
    margin-top: 8px;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
}

.up-name {
    color: @text-secondary;
    font-size: @font-sm;
    lines: 1;
    text-overflow: ellipsis;
    flex: 1;
}

.play-count {
    color: @text-secondary;
    font-size: @font-sm;
    margin-left: 8px;
}
</style>

<script>
import { formatDuration, formatCount } from '../utils/format.js';

export default {
    name: 'VideoCard',
    props: {
        video: {
            type: Object,
            default: () => ({ pic: '', title: '', owner: {}, stat: {}, duration: 0 }),
        },
        width: { type: Number, default: 248 },
    },
    computed: {
        coverHeight() {
            return Math.round((this.width * 9) / 16);
        },
        durationText() {
            return formatDuration(this.video && this.video.duration);
        },
        upName() {
            return (this.video && this.video.owner && this.video.owner.name) || '未知UP主';
        },
        viewText() {
            const stat = (this.video && this.video.stat) || {};
            return formatCount(stat.view);
        },
    },
    methods: {
        onClick() {
            this.$emit('click', this.video);
        },
    },
};
</script>
