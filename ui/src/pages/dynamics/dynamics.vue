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
        <nav-bar :title="title" :show-back="true" @back="onBack">
            <text class="nav-action" @click="onRefresh">刷新</text>
        </nav-bar>
        <scroller class="body" scroll-direction="vertical">
            <loading v-if="state === 'loading'" :visible="true" text="正在加载动态..."></loading>
            <empty
                v-else-if="state === 'error'"
                :visible="true"
                :code="errorCode"
                :message="errorMsg"
            ></empty>
            <div v-else class="content">
                <empty
                    v-if="isEmpty"
                    :visible="true"
                    message="还没有动态，去关注一些 UP 主吧"
                ></empty>
                <div v-else>
                    <div
                        v-for="item in list"
                        :key="item.dynId"
                        class="dyn-card"
                    >
                    <div class="dyn-head">
                        <image
                            v-if="item.author && item.author.face"
                            class="head-avatar"
                            :src="item.author.face"
                            resize="cover"
                        ></image>
                        <text v-else class="head-avatar head-avatar-fallback">U</text>
                        <div class="head-info">
                            <text class="head-name">{{ authorName(item) }}</text>
                            <text v-if="pubTime(item)" class="head-time">{{ pubTime(item) }}</text>
                        </div>
                        <text class="head-type">{{ cardTypeLabel(item) }}</text>
                    </div>
                    <text v-if="bodyText(item)" class="dyn-text">{{ bodyText(item) }}</text>
                    <div
                        v-if="item.cardType === 'video'"
                        class="row-card"
                        @click="onCardTap(item)"
                    >
                        <image v-if="item.cover" class="row-cover" :src="item.cover" resize="cover"></image>
                        <div v-else class="row-cover row-cover-empty"></div>
                        <div class="row-info">
                            <text class="row-title">{{ cardTitle(item) }}</text>
                            <text class="row-meta">{{ authorName(item) }} · {{ videoMeta(item) }}</text>
                        </div>
                    </div>
                    <div
                        v-else-if="item.cardType === 'opus' || item.cardType === 'article'"
                        class="row-card"
                        @click="onCardTap(item)"
                    >
                        <div class="row-info">
                            <text class="row-title">{{ cardTitle(item) }}</text>
                            <text class="row-meta">{{ item.cardType === 'article' ? '专栏文章' : '图文动态' }}</text>
                        </div>
                        <image
                            v-if="item.cardType === 'article' && item.cover"
                            class="row-thumb"
                            :src="item.cover"
                            resize="cover"
                        ></image>
                        <image
                            v-else-if="inlineImages(item).length"
                            class="row-thumb"
                            :src="inlineImages(item)[0]"
                            resize="cover"
                        ></image>
                    </div>
                    <div v-else-if="item.cardType === 'draw'" class="grid-box">
                        <div class="grid">
                            <image
                                v-for="(img, idx) in gridImages(item)"
                                :key="idx"
                                class="grid-cell"
                                :src="img"
                                resize="cover"
                                @click="onCardTap(item)"
                            ></image>
                        </div>
                    </div>
                    <div
                        v-else-if="item.cardType === 'forward'"
                        class="orig-card"
                        @click="onForwardTap(item)"
                    >
                        <image v-if="origCover(item)" class="orig-cover" :src="origCover(item)" resize="cover"></image>
                        <div class="orig-info">
                            <text class="orig-title">{{ origTitle(item) }}</text>
                            <text class="orig-meta">{{ origMeta(item) }}</text>
                        </div>
                    </div>
                    </div>
                </div>
                <div
                    v-if="list.length && hasMore"
                    class="load-more"
                    @click="loadMore"
                >
                    <text class="load-more-text">{{ loadingMore ? '加载中...' : '加载更多' }}</text>
                </div>
                <text v-if="list.length && !hasMore" class="no-more">没有更多动态了</text>
                <loading v-if="list.length && loadingMore" :visible="true" text="正在加载更多动态..."></loading>
            </div>
        </scroller>
        <div v-if="notice" class="notice-mask">
            <text class="notice-text">{{ notice }}</text>
        </div>
    </div>
</template>

<style lang="less" scoped>
@import url('../../styles/theme.less');

.page {
    width: @page-width;
    height: 936px;
    background-color: @bg;
}

.body {
    flex: 1;
}

.nav-action {
    color: @primary;
    font-size: @font-base;
}

.content {
    padding: @page-pad;
}

.dyn-card {
    background-color: @card;
    border-radius: @radius-md;
    padding: @card-pad;
    margin-bottom: @card-gap;
}

.dyn-head {
    flex-direction: row;
    align-items: center;
}

.head-avatar {
    width: @avatar-size;
    height: @avatar-size;
    border-radius: @radius-round;
    background-color: @card-pressed;
}

.head-avatar-fallback {
    color: @text-secondary;
    font-size: @font-md;
    line-height: @avatar-size;
    text-align: center;
}

.head-info {
    flex: 1;
    margin-left: 10px;
}

.head-name {
    color: @text;
    font-size: @font-base;
    lines: 1;
    text-overflow: ellipsis;
}

.head-time {
    margin-top: 2px;
    color: @text-secondary;
    font-size: @font-xs;
}

.head-type {
    color: @text-disabled;
    font-size: @font-xs;
}

.dyn-text {
    margin-top: 10px;
    color: @text;
    font-size: @font-base;
    line-height: 32px;
}

.row-card {
    margin-top: 10px;
    flex-direction: row;
    align-items: center;
    background-color: @card-pressed;
    border-radius: @radius-sm;
    padding: 8px;
}

.row-cover {
    width: 96px;
    height: 60px;
    border-radius: @radius-sm;
    background-color: @divider;
}

.row-cover-empty {
    background-color: @divider;
}

.row-thumb {
    width: 72px;
    height: 72px;
    border-radius: @radius-sm;
    background-color: @divider;
    margin-left: 8px;
}

.row-info {
    flex: 1;
}

.row-title {
    color: @text;
    font-size: @font-base;
    line-height: 30px;
    lines: 2;
    text-overflow: ellipsis;
}

.row-meta {
    margin-top: 4px;
    color: @text-secondary;
    font-size: @font-xs;
    lines: 1;
    text-overflow: ellipsis;
}

.grid-box {
    margin-top: 10px;
}

.grid {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: space-between;
}

.grid-cell {
    width: 120px;
    height: 120px;
    border-radius: @radius-sm;
    background-color: @divider;
    margin-bottom: 8px;
}

.orig-card {
    margin-top: 10px;
    flex-direction: row;
    align-items: center;
    background-color: @card-pressed;
    border-radius: @radius-sm;
    padding: 8px;
    border-left-width: 3px;
    border-left-color: @primary-dark;
}

.orig-cover {
    width: 72px;
    height: 48px;
    border-radius: @radius-sm;
    background-color: @divider;
}

.orig-info {
    flex: 1;
    margin-left: 8px;
}

.orig-title {
    color: @text;
    font-size: @font-sm;
    line-height: 28px;
    lines: 2;
    text-overflow: ellipsis;
}

.orig-meta {
    margin-top: 2px;
    color: @text-secondary;
    font-size: @font-xs;
    lines: 1;
    text-overflow: ellipsis;
}

.load-more {
    height: 64px;
    background-color: @card;
    border-radius: @radius-md;
    align-items: center;
    justify-content: center;
    margin-bottom: @card-gap;
}

.load-more-text {
    color: @primary;
    font-size: @font-base;
}

.no-more {
    color: @text-disabled;
    font-size: @font-sm;
    text-align: center;
    padding: 16px;
}

.notice-mask {
    position: absolute;
    left: @page-pad;
    right: @page-pad;
    bottom: 48px;
    background-color: @mask;
    border-radius: @radius-sm;
    padding: 12px;
    align-items: center;
}

.notice-text {
    color: #ffffff;
    font-size: @font-sm;
    text-align: center;
    lines: 2;
}
</style>

<script>
import page from './dynamics';
export default page;
</script>
