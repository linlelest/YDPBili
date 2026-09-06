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
        <nav-bar title="搜索" :show-back="true" @back="onBack"></nav-bar>

        <div class="search-row">
            <div class="input-box" @click="openKeyboard">
                <text class="input-placeholder" v-if="!keyword">搜索视频、专栏、用户</text>
                <text class="input-text" v-else>{{ keyword }}</text>
            </div>
            <div class="search-btn" @click="onSearch">
                <text class="search-btn-text">搜索</text>
            </div>
        </div>

        <div class="history-panel" v-if="showHistory">
            <div class="history-head">
                <text class="history-title">最近搜索</text>
                <text class="history-clear" @click="onClearHistory">清空</text>
            </div>
            <div class="history-chips">
                <div class="history-chip" v-for="h in history" :key="h" @click="onHistoryPick(h)">
                    <text class="history-chip-text">{{ h }}</text>
                </div>
            </div>
        </div>

        <soft-keyboard
            v-if="keyboardVisible"
            @input="onKeyInput"
            @backspace="onBackspace"
            @clear="onClear"
            @space="onSpace"
            @confirm="onSearch"
            @close="onKeyboardClose">
        </soft-keyboard>

        <div class="tabs" v-if="showTabs">
            <div class="tab-item" @click="switchTab('video')">
                <text :class="tabClass('video')">视频</text>
                <div class="tab-line" v-if="activeTab === 'video'"></div>
            </div>
            <div class="tab-item" @click="switchTab('article')">
                <text :class="tabClass('article')">专栏</text>
                <div class="tab-line" v-if="activeTab === 'article'"></div>
            </div>
            <div class="tab-item" @click="switchTab('user')">
                <text :class="tabClass('user')">用户</text>
                <div class="tab-line" v-if="activeTab === 'user'"></div>
            </div>
        </div>

        <scroller class="result-area" scroll-direction="vertical">
            <div class="result-list" v-if="activeTab === 'video' && videos.length > 0">
                <div class="list-item" v-for="item in videos" :key="item.bvid" @click="openVideo(item)">
                    <video-card :video="item"></video-card>
                </div>
            </div>
            <div class="result-list" v-if="activeTab === 'article' && articles.length > 0">
                <div class="list-item" v-for="item in articles" :key="item.id" @click="openArticle(item)">
                    <article-card :article="item"></article-card>
                </div>
            </div>
            <div class="result-list" v-if="activeTab === 'user' && users.length > 0">
                <div class="list-item" v-for="item in users" :key="item.mid" @click="openUser(item)">
                    <user-card :user="item"></user-card>
                </div>
            </div>

            <loading :visible="loading" text="搜索中..."></loading>

            <empty
                v-if="showEmpty"
                :visible="true"
                :code="errorCode"
                :message="statusMessage"></empty>

            <div class="load-more" v-if="hasMore && !loading && currentList.length > 0" @click="loadMore">
                <text class="load-more-text">{{ loadingMore ? '加载中...' : '加载更多' }}</text>
            </div>
            <div class="no-more" v-if="!hasMore && !loading && currentList.length > 0">
                <text class="no-more-text">没有更多了</text>
            </div>
        </scroller>
    </div>
</template>

<style lang="less" scoped src="./search.less"></style>

<script>
import page from './search';
export default page;
</script>
