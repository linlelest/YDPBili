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
            <div v-if="loading" class="loading-wrap">
                <loading :visible="true" text="加载中..."></loading>
            </div>
            <div v-else-if="errorCode" class="error-wrap">
                <empty :visible="true" :code="errorCode" :message="errorMessage">
                    <div v-if="bvid" class="btn-retry" @click="onRetry">
                        <text class="btn-retry-text">重试</text>
                    </div>
                </empty>
            </div>
            <div v-else-if="detail" class="content">
                <div class="cover-wrap">
                    <image
                        v-if="coverUrl"
                        class="cover"
                        :src="coverUrl"
                        resize="cover"
                    ></image>
                    <div v-else class="cover cover-placeholder">
                        <text class="cover-placeholder-text">暂无封面</text>
                    </div>
                </div>
                <div class="head">
                    <text class="video-title">{{ detail.title }}</text>
                    <div class="up-row" @click="onUpClick">
                        <image
                            v-if="detail.owner.face"
                            class="avatar"
                            :src="detail.owner.face"
                            resize="cover"
                        ></image>
                        <div v-else class="avatar"></div>
                        <text class="up-name">{{ detail.owner.name || '未知UP主' }}</text>
                        <text class="pub-date">{{ pubDateText }}</text>
                        <text class="up-arrow">›</text>
                    </div>
                    <div class="stat-row">
                        <div
                            v-for="item in statItems"
                            :key="item.label"
                            class="stat-item"
                        >
                            <text class="stat-value">{{ item.value }}</text>
                            <text class="stat-label">{{ item.label }}</text>
                        </div>
                    </div>
                    <div class="interaction-bar">
                        <div
                            :class="liked ? 'interact-btn interact-btn-on' : 'interact-btn'"
                            @click="onLikeClick"
                        >
                            <text :class="liked ? 'interact-text interact-text-on' : 'interact-text'">👍 点赞 ({{ likeCountText }})</text>
                        </div>
                        <div
                            :class="coinsGiven > 0 ? 'interact-btn interact-btn-gap interact-btn-on' : 'interact-btn interact-btn-gap'"
                            @click="onCoinClick"
                        >
                            <text :class="coinsGiven > 0 ? 'interact-text interact-text-on' : 'interact-text'">{{ coinBtnText }}</text>
                        </div>
                        <div
                            :class="followed ? 'interact-btn interact-btn-gap interact-btn-followed' : 'interact-btn interact-btn-gap interact-btn-primary'"
                            @click="onFollowClick"
                        >
                            <text :class="followed ? 'interact-text interact-text-followed' : 'interact-text interact-text-primary'">{{ followBtnText }}</text>
                        </div>
                    </div>
                    <div v-if="coinPanelVisible" class="coin-panel">
                        <text class="coin-panel-title">选择投币数量</text>
                        <div class="coin-panel-row">
                            <div class="coin-option" @click="onCoinSelect(1)">
                                <text class="coin-option-text">🪙 投 1 枚</text>
                            </div>
                            <div class="coin-option coin-option-gap" @click="onCoinSelect(2)">
                                <text class="coin-option-text">🪙 投 2 枚</text>
                            </div>
                            <div class="coin-option coin-option-gap coin-option-cancel" @click="onCoinCancel">
                                <text class="coin-option-cancel-text">取消</text>
                            </div>
                        </div>
                    </div>
                    <div class="comments-entry" @click="onCommentsClick">
                        <text class="comments-entry-text">💬 评论区 ({{ replyCountText }})</text>
                        <text class="up-arrow">›</text>
                    </div>
                </div>
                <div class="desc-block" @click="toggleDesc">
                    <text class="desc-text" :style="{ lines: descExpanded ? 0 : 2 }">{{ detail.desc || '暂无简介' }}</text>
                    <text class="desc-toggle">{{ descExpanded ? '收起' : '展开全部' }}</text>
                </div>
                <div v-if="isMultiPage" class="pages-block">
                    <text class="block-title">分 P（{{ detail.pages.length }}）</text>
                    <div
                        v-for="(p, index) in detail.pages"
                        :key="p.cid"
                        :class="p.cid === selectedCid ? 'page-item-active' : 'page-item'"
                        @click="onSelectPage(p.cid)"
                    >
                        <text :class="p.cid === selectedCid ? 'page-name-active' : 'page-name'">P{{ index + 1 }} {{ p.part || '' }}</text>
                        <text class="page-duration">{{ formatDuration(p.duration) }}</text>
                    </div>
                </div>
                <div class="actions">
                    <div class="btn-play" @click="onPlay">
                        <text class="btn-play-text">▶ 播放</text>
                    </div>
                    <div class="btn-feed" @click="onFeed">
                        <text class="btn-feed-text">⏭ 连播刷视频</text>
                    </div>
                </div>
                <div class="related-block">
                    <text class="block-title">相关推荐</text>
                    <div v-if="relatedLoading" class="related-loading-wrap">
                        <loading :visible="true" text="加载中..."></loading>
                    </div>
                    <empty
                        v-else-if="relatedError"
                        :visible="true"
                        :code="relatedError"
                        :message="relatedMessage"
                    ></empty>
                    <div v-else-if="related.length === 0" class="related-empty">
                        <text class="related-empty-text">暂无相关推荐</text>
                    </div>
                    <div v-else class="related-list">
                        <div
                            v-for="(item, index) in related"
                            :key="index"
                            class="related-item"
                            @click="onRelatedClick(item)"
                        >
                            <image
                                v-if="item.pic"
                                class="related-cover"
                                :src="item.pic"
                                resize="cover"
                            ></image>
                            <div v-else class="related-cover related-cover-placeholder"></div>
                            <div class="related-info">
                                <text class="related-title">{{ item.title }}</text>
                                <text class="related-meta">{{ item.owner.name }} · {{ formatCount(item.stat.view) }}播放</text>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <empty v-else :visible="true" message="暂无内容"></empty>
        </scroller>
        <div v-if="toast" class="toast">
            <text class="toast-text">{{ toast }}</text>
        </div>
    </div>
</template>

<style lang="less" scoped src="./videoDetail.less"></style>

<script>
import page from './videoDetail';
export default page;
</script>
