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
                    <div class="up-row">
                        <image
                            v-if="detail.owner.face"
                            class="avatar"
                            :src="detail.owner.face"
                            resize="cover"
                        ></image>
                        <div v-else class="avatar"></div>
                        <text class="up-name">{{ detail.owner.name || '未知UP主' }}</text>
                        <text class="pub-date">{{ pubDateText }}</text>
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
                    <div class="related-loading-wrap">
                        <loading v-if="relatedLoading" :visible="true" text="加载中..."></loading>
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
    </div>
</template>

<style lang="less" scoped src="./videoDetail.less"></style>

<script>
import page from './videoDetail';
export default page;
</script>
