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
            <div v-if="headerState === 'loading'" class="loading-zone">
                <loading :visible="true" text="正在加载用户信息..."></loading>
            </div>
            <div v-else-if="headerState === 'error'" class="error-zone">
                <empty :visible="true" :code="headerErrorCode" :message="headerErrorMsg">
                    <div v-if="mid" class="btn-retry" @click="onRetryHeader">
                        <text class="btn-retry-text">重试</text>
                    </div>
                </empty>
            </div>
            <div v-else class="main">
                <div class="header">
                    <div class="header-main">
                        <image
                            v-if="user.face"
                            class="avatar"
                            :src="user.face"
                            resize="cover"
                        ></image>
                        <text v-else class="avatar avatar-fallback">U</text>
                        <div class="header-info">
                            <div class="name-row">
                                <text class="name">{{ user.name || '未知用户' }}</text>
                                <text class="lv-badge">Lv{{ user.level }}</text>
                            </div>
                            <div v-if="officialText" class="official-row">
                                <text
                                    class="official-badge"
                                    :class="{ org: user.officialType === 1 }"
                                >{{ officialText }}</text>
                            </div>
                        </div>
                    </div>
                    <text class="sign">{{ signText }}</text>
                    <div class="stat-row">
                        <div class="stat-item">
                            <text class="stat-num">{{ fansText }}</text>
                            <text class="stat-label">粉丝</text>
                        </div>
                        <div class="stat-item">
                            <text class="stat-num">{{ followingText }}</text>
                            <text class="stat-label">关注</text>
                        </div>
                    </div>
                </div>

                <div class="tabs">
                    <div
                        v-for="tab in tabs"
                        :key="tab"
                        class="tab"
                        @click="onTabChange(tab)"
                    >
                        <text class="tab-text" :class="tabTextClass(tab)">{{ tabLabel(tab) }}</text>
                        <div class="tab-indicator" :class="tabIndicatorClass(tab)"></div>
                    </div>
                </div>

                <div class="tab-content">
                    <div v-if="activeTab === 'video'">
                        <loading
                            v-if="videoState === 'loading'"
                            :visible="true"
                            text="正在加载投稿视频..."
                        ></loading>
                        <empty
                            v-else-if="videoState === 'error'"
                            :visible="true"
                            :code="videoErrorCode"
                            :message="videoErrorMsg"
                        >
                            <div class="btn-retry" @click="onRetryTab">
                                <text class="btn-retry-text">重试</text>
                            </div>
                        </empty>
                        <empty
                            v-else-if="isEmptyVideo"
                            :visible="true"
                            message="TA 还没有投稿视频"
                        ></empty>
                        <div v-else>
                            <div
                                v-for="item in videoList"
                                :key="item.bvid || item.aid"
                                class="v-row"
                                @click="onVideoTap(item)"
                            >
                                <image
                                    v-if="item.pic"
                                    class="v-cover"
                                    :src="item.pic"
                                    resize="cover"
                                ></image>
                                <div v-else class="v-cover"></div>
                                <div class="v-info">
                                    <text class="v-title">{{ item.title }}</text>
                                    <text class="v-meta">{{ videoMetaText(item) }}</text>
                                </div>
                            </div>
                            <div
                                v-if="videoHasMore"
                                class="load-more"
                                @click="loadVideosMore"
                            >
                                <text class="load-more-text">{{ videoLoadingMore ? '加载中...' : '加载更多' }}</text>
                            </div>
                            <text v-else class="no-more">没有更多视频了</text>
                        </div>
                    </div>

                    <div v-else-if="activeTab === 'article'">
                        <loading
                            v-if="articleState === 'loading'"
                            :visible="true"
                            text="正在加载专栏文章..."
                        ></loading>
                        <empty
                            v-else-if="articleState === 'error'"
                            :visible="true"
                            :code="articleErrorCode"
                            :message="articleErrorMsg"
                        >
                            <div class="btn-retry" @click="onRetryTab">
                                <text class="btn-retry-text">重试</text>
                            </div>
                        </empty>
                        <empty
                            v-else-if="isEmptyArticle"
                            :visible="true"
                            message="TA 还没有发布专栏文章"
                        ></empty>
                        <div v-else>
                            <div
                                v-for="item in articleList"
                                :key="item.id"
                                class="article-item"
                            >
                                <article-card
                                    :article="articleProps(item)"
                                    @click="onArticleTap(item)"
                                ></article-card>
                            </div>
                            <div
                                v-if="articleHasMore"
                                class="load-more"
                                @click="loadArticlesMore"
                            >
                                <text class="load-more-text">{{ articleLoadingMore ? '加载中...' : '加载更多' }}</text>
                            </div>
                            <text v-else class="no-more">没有更多专栏了</text>
                        </div>
                    </div>

                    <div v-else>
                        <loading
                            v-if="dynState === 'loading'"
                            :visible="true"
                            text="正在加载动态..."
                        ></loading>
                        <empty
                            v-else-if="dynState === 'error'"
                            :visible="true"
                            :code="dynErrorCode"
                            :message="dynErrorMsg"
                        >
                            <div class="btn-retry" @click="onRetryTab">
                                <text class="btn-retry-text">重试</text>
                            </div>
                        </empty>
                        <empty
                            v-else-if="dynUnavailable"
                            :visible="true"
                            message="动态接口暂不可用"
                        ></empty>
                        <empty
                            v-else-if="isEmptyDyn"
                            :visible="true"
                            message="TA 还没有发布动态"
                        ></empty>
                        <div v-else>
                            <div
                                v-for="item in dynList"
                                :key="item.dynId"
                                class="dyn-card"
                            >
                                <div class="dyn-head-row">
                                    <text class="dyn-type">{{ dynTypeLabel(item) }}</text>
                                    <text class="dyn-time">{{ dynPubTime(item) }}</text>
                                </div>
                                <text v-if="dynBodyText(item)" class="dyn-text">{{ dynBodyText(item) }}</text>
                                <div
                                    v-if="item.cardType === 'video'"
                                    class="row-card"
                                    @click="onDynTap(item)"
                                >
                                    <image
                                        v-if="item.cover"
                                        class="row-cover"
                                        :src="item.cover"
                                        resize="cover"
                                    ></image>
                                    <div v-else class="row-cover"></div>
                                    <div class="row-info">
                                        <text class="row-title">{{ item.title }}</text>
                                        <text class="row-meta">{{ dynVideoMeta(item) }}</text>
                                    </div>
                                </div>
                                <div
                                    v-else-if="item.cardType === 'opus' || item.cardType === 'article'"
                                    class="row-card"
                                    @click="onDynTap(item)"
                                >
                                    <div class="row-info">
                                        <text class="row-title">{{ item.title || item.text || '图文动态' }}</text>
                                        <text class="row-meta">{{ item.cardType === 'article' ? '专栏文章' : '图文动态' }}</text>
                                    </div>
                                    <image
                                        v-if="item.cardType === 'article' && item.cover"
                                        class="row-thumb"
                                        :src="item.cover"
                                        resize="cover"
                                    ></image>
                                    <image
                                        v-else-if="dynInlineImages(item).length"
                                        class="row-thumb"
                                        :src="dynInlineImages(item)[0]"
                                        resize="cover"
                                    ></image>
                                </div>
                                <div v-else-if="item.cardType === 'draw'" class="grid">
                                    <image
                                        v-for="(img, idx) in dynGridImages(item)"
                                        :key="idx"
                                        class="grid-cell"
                                        :src="img"
                                        resize="cover"
                                        @click="onDynTap(item)"
                                    ></image>
                                </div>
                                <div
                                    v-else-if="item.cardType === 'forward'"
                                    class="orig-card"
                                    @click="onDynTap(item.orig || null)"
                                >
                                    <image
                                        v-if="origCover(item)"
                                        class="orig-cover"
                                        :src="origCover(item)"
                                        resize="cover"
                                    ></image>
                                    <div class="orig-info">
                                        <text class="orig-title">{{ origTitle(item) }}</text>
                                        <text class="orig-meta">{{ origMeta(item) }}</text>
                                    </div>
                                </div>
                            </div>
                            <div
                                v-if="dynHasMore"
                                class="load-more"
                                @click="loadDynMore"
                            >
                                <text class="load-more-text">{{ dynLoadingMore ? '加载中...' : '加载更多' }}</text>
                            </div>
                            <text v-else class="no-more">没有更多动态了</text>
                        </div>
                    </div>
                </div>
            </div>
        </scroller>
        <div v-if="notice" class="notice-mask">
            <text class="notice-text">{{ notice }}</text>
        </div>
    </div>
</template>

<style lang="less" scoped src="./userSpace.less"></style>

<script>
import page from './userSpace';
export default page;
</script>
