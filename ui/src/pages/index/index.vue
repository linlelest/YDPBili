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
        <div class="top-bar">
            <text class="logo">哔哩</text>
            <div class="actions">
                <div class="icon-btn" @click="onRefresh">
                    <text class="icon">↻</text>
                </div>
                <div class="icon-btn" @click="goSearch">
                    <text class="icon">🔍</text>
                </div>
                <div class="icon-btn" @click="goMine">
                    <text class="icon">👤</text>
                </div>
                <div class="icon-btn" @click="goFeed">
                    <text class="icon">▶</text>
                </div>
            </div>
        </div>

        <div class="notice-bar" v-if="notice">
            <text class="notice-text">{{ notice }}</text>
        </div>

        <div
            class="stage"
            v-if="state === 'ready'"
            @panstart="onPanStart"
            @panmove="onPanMove"
            @panend="onPanEnd"
            @swipe="onSwipe"
        >
            <div class="arrow-zone" @click="onPrev">
                <text class="arrow">◀</text>
            </div>
            <div class="card-zone">
                <video-card
                    v-if="currentVideo"
                    :video="currentVideo"
                    :width="200"
                    @click="onCardClick"
                ></video-card>
            </div>
            <div class="arrow-zone" @click="onNext">
                <text class="arrow">▶</text>
            </div>
        </div>

        <div class="state-zone" v-if="state === 'loading'">
            <loading :visible="true" text="正在加载推荐..."></loading>
        </div>

        <div class="state-zone" v-if="state === 'empty'">
            <empty :visible="true" message="暂无推荐内容">
                <div class="retry-btn" @click="onRefresh">
                    <text class="retry-text">重新加载</text>
                </div>
            </empty>
        </div>

        <div class="state-zone" v-if="state === 'error'">
            <empty :visible="true" :code="errorCode" :message="errorMsg">
                <div class="retry-btn" @click="onRefresh">
                    <text class="retry-text">重试</text>
                </div>
            </empty>
        </div>

        <div class="footer" v-if="state === 'ready'">
            <text class="counter">{{ counterText }}</text>
            <text class="tip" v-if="loadingMore">正在加载更多...</text>
            <text class="tip" v-else-if="feedTip">{{ feedTip }}</text>
            <text class="tip" v-else>左右滑动或点箭头切换视频</text>
        </div>
    </div>
</template>

<style lang="less" scoped>
@import url('index.less');
</style>

<script>
import page from './index';
export default page;
</script>
