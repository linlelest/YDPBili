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
            <loading v-if="state === 'loading'" :visible="true" text="正在加载历史记录..."></loading>
            <empty
                v-else-if="state === 'error'"
                :visible="true"
                :code="errorCode"
                :message="errorMsg"
            ></empty>
            <div v-else class="content">
                <empty v-if="isEmpty" :visible="true" message="暂无观看记录"></empty>
                <div v-else>
                <div
                    v-for="(item, idx) in list"
                    :key="idx"
                    class="his-card"
                    @click="onItemTap(item)"
                >
                    <div class="his-main">
                        <image
                            v-if="item.cover"
                            class="his-cover"
                            :src="item.cover"
                            resize="cover"
                        ></image>
                        <div v-else class="his-cover his-cover-empty"></div>
                        <div class="his-info">
                            <text class="his-title">{{ item.title }}</text>
                            <div class="his-meta-row">
                                <text v-if="upName(item)" class="his-up">{{ upName(item) }}</text>
                                <text v-if="badgeText(item)" class="his-badge">{{ badgeText(item) }}</text>
                            </div>
                        </div>
                    </div>
                    <div class="his-progress-track">
                        <div class="his-progress-bar" :style="{ width: barWidth(item) + 'px' }"></div>
                    </div>
                    <div class="his-foot-row">
                        <text class="his-progress-text">{{ progressText(item) }}</text>
                        <text class="his-date">{{ showDate(item) }}</text>
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
                <text v-if="list.length && !hasMore" class="no-more">没有更多记录了</text>
                <loading v-if="list.length && loadingMore" :visible="true" text="正在加载更多记录..."></loading>
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

.his-card {
    background-color: @card;
    border-radius: @radius-md;
    padding: @card-pad;
    margin-bottom: @card-gap;
}

.his-main {
    flex-direction: row;
    align-items: flex-start;
}

.his-cover {
    width: 96px;
    height: 60px;
    border-radius: @radius-sm;
    background-color: @card-pressed;
}

.his-cover-empty {
    background-color: @divider;
}

.his-info {
    flex: 1;
    margin-left: 10px;
}

.his-title {
    color: @text;
    font-size: @font-base;
    line-height: 30px;
    lines: 2;
    text-overflow: ellipsis;
}

.his-meta-row {
    margin-top: 4px;
    flex-direction: row;
    align-items: center;
}

.his-up {
    color: @text-secondary;
    font-size: @font-xs;
    lines: 1;
    text-overflow: ellipsis;
    flex: 1;
}

.his-badge {
    margin-left: 6px;
    color: @primary;
    font-size: @font-xs;
    padding-left: 6px;
    padding-right: 6px;
    line-height: 24px;
    background-color: @card-pressed;
    border-radius: @radius-sm;
}

.his-progress-track {
    margin-top: 10px;
    width: 224px;
    height: 6px;
    background-color: @divider;
    border-radius: @radius-sm;
}

.his-progress-bar {
    height: 6px;
    background-color: @primary;
    border-radius: @radius-sm;
}

.his-foot-row {
    margin-top: 8px;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
}

.his-progress-text {
    color: @text-secondary;
    font-size: @font-xs;
}

.his-date {
    color: @text-disabled;
    font-size: @font-xs;
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
import page from './history';
export default page;
</script>
