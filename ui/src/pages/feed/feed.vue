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
        <div
            class="stage"
            v-if="state === 'ready'"
            @panstart="onPanStart"
            @panmove="onPanMove"
            @panend="onPanEnd"
            @swipe="onSwipe"
        >
            <div class="media">
                <video
                    v-if="isVideoMode"
                    class="video"
                    :src="videoUrl"
                    :play-status="playing ? 'play' : 'pause'"
                    :auto-play="true"
                    @start="onVideoStart"
                    @pause="onVideoPause"
                    @finish="onVideoFinish"
                    @fail="onVideoFail"
                ></video>
                <div v-else class="media-inner">
                    <image
                        v-if="hasFrame"
                        class="frame"
                        :src="frameSrc"
                        resize="contain"
                    ></image>
                    <image
                        v-else-if="coverUrl"
                        class="cover"
                        :src="coverUrl"
                        resize="cover"
                    ></image>
                    <div v-else class="cover cover-placeholder">
                        <text class="cover-placeholder-text">暂无封面</text>
                    </div>
                </div>
                <div v-if="isPreparing" class="media-loading">
                    <loading :visible="true" text="正在取流..."></loading>
                </div>
            </div>

            <div class="arrow-zone arrow-left" @click="onPrev">
                <text class="arrow">‹</text>
            </div>
            <div class="arrow-zone arrow-right" @click="onNext">
                <text class="arrow">›</text>
            </div>

            <div class="top-bar">
                <div class="exit-btn" @click="onExit">
                    <text class="bar-btn-text">✕ 退出</text>
                </div>
                <div class="rate-btn" @click="onRateCycle">
                    <text class="bar-btn-text">倍速 {{ rateText }}</text>
                </div>
            </div>

            <div class="overlay">
                <text class="mode-hint" v-if="modeHint">{{ modeHint }}</text>
                <text class="notice" v-if="noticeText">{{ noticeText }}</text>
                <text class="title">{{ titleText }}</text>
                <text class="up-name">@{{ upText }}</text>
                <text class="counter">{{ counterText }}</text>
            </div>

            <div class="progress-track">
                <div class="progress-fill" :style="{ width: fillWidth + 'px' }"></div>
            </div>

            <div class="footer" v-if="footerText">
                <text class="tip">{{ footerText }}</text>
            </div>
        </div>

        <div class="state-zone" v-if="state === 'loading'">
            <loading :visible="true" text="正在加载刷视频..."></loading>
        </div>

        <div class="state-zone" v-if="state === 'empty'">
            <empty :visible="true" message="暂无推荐内容">
                <div class="retry-btn" @click="onRetry">
                    <text class="retry-text">重新加载</text>
                </div>
            </empty>
        </div>

        <div class="state-zone" v-if="state === 'error'">
            <empty :visible="true" :code="errorCode" :message="errorMsg">
                <div class="retry-btn" @click="onRetry">
                    <text class="retry-text">重试</text>
                </div>
            </empty>
        </div>
    </div>
</template>

<style lang="less" scoped src="./feed.less"></style>

<script>
import page from './feed';
export default page;
</script>
