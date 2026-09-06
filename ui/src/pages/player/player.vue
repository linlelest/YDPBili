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

        <div class="stage">
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
            <div v-else class="stage-inner">
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

            <div v-if="isAudioMode" class="stage-overlay" @click="onTogglePlay">
                <div class="wave-row">
                    <div
                        v-for="(h, i) in waveBars"
                        :key="i"
                        class="wave-bar"
                        :style="{ height: h + 'px', opacity: playing ? 1 : 0.4 }"
                    ></div>
                </div>
                <div class="big-play">
                    <text class="big-play-text">{{ playIcon }}</text>
                </div>
            </div>
            <div v-else-if="isUnsupported" class="stage-overlay">
                <text class="unsupport-icon">⚠️</text>
            </div>
            <div v-if="isPreparing" class="stage-loading">
                <loading :visible="true" text="正在取流..."></loading>
            </div>
        </div>

        <div class="info-row">
            <text class="mode-text">{{ modeText }}</text>
            <text v-if="noticeText" class="notice-text">{{ noticeText }}</text>
        </div>
        <div v-if="showBuffer" class="buffer-row">
            <text class="buffer-text">已缓存 {{ bufferPctText }}</text>
        </div>

        <div v-if="isUnsupported" class="unsupport-card">
            <text class="unsupport-title">当前解码器在笔端不可用，请到设置页切换</text>
            <div class="btn-settings" @click="onOpenSettings">
                <text class="btn-settings-text">打开设置</text>
            </div>
            <div class="btn-retry2" @click="onRetry">
                <text class="btn-retry2-text">重试</text>
            </div>
        </div>
        <div v-else-if="isError" class="error-card">
            <empty :visible="true" :message="errorMessage || '播放出错，请重试'">
                <div class="btn-retry2" @click="onRetry">
                    <text class="btn-retry2-text">重试</text>
                </div>
            </empty>
        </div>
        <div v-else-if="paramError" class="error-card">
            <empty :visible="true" message="缺少视频参数，无法播放"></empty>
        </div>

        <div v-if="isVideoMode || isAudioMode" class="controls">
            <div class="big-btn" @click="onTogglePlay">
                <text class="big-btn-text">{{ playIcon }}</text>
            </div>
            <div class="progress-area">
                <div class="progress-track" @click="onSeekTap">
                    <div class="progress-buffer" :style="{ width: bufferWidth + 'px' }"></div>
                    <div class="progress-fill" :style="{ width: fillWidth + 'px' }"></div>
                </div>
                <div class="time-row">
                    <text class="time-text">{{ positionText }}</text>
                    <text class="time-text">{{ durationText }}</text>
                </div>
            </div>
        </div>

        <div v-if="isVideoMode || isAudioMode" class="actions-row">
            <div class="action-btn" @click="onRateCycle">
                <text class="action-text">倍速 {{ rateText }}</text>
            </div>
            <div class="action-btn" @click="onToggleQualityPanel">
                <text class="action-text">画质 {{ qualityText }}</text>
            </div>
        </div>

        <div v-if="showQualityPanel && (isVideoMode || isAudioMode)" class="quality-panel">
            <text v-if="qualityLimited" class="quality-limited">画质切换仅系统解码支持，选择后将尝试系统解码播放</text>
            <div
                v-for="item in qualityOptions"
                :key="item.qn"
                :class="item.qn === quality ? 'quality-item-current' : 'quality-item'"
                @click="onQualityPick(item)"
            >
                <text :class="item.qn === quality ? 'quality-item-text-current' : 'quality-item-text'">{{ item.label }}</text>
            </div>
            <div v-if="qualityOptions.length === 0" class="quality-item">
                <text class="quality-item-text">暂无可选画质</text>
            </div>
        </div>

        <div class="title-block">
            <text class="title-text">{{ title }}</text>
            <text class="subtitle-text">B 站播放器 · {{ modeText || '准备中' }}</text>
        </div>
    </div>
</template>

<style lang="less" scoped src="./player.less"></style>

<script>
import page from './player';
export default page;
</script>
