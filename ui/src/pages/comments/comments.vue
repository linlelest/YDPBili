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
        <nav-bar title="评论" :show-back="true" @back="onBack"></nav-bar>

        <div class="video-row" v-if="pageTitle">
            <text class="video-title">{{ pageTitle }}</text>
        </div>

        <div class="tabs">
            <div class="tab-item" @click="switchMode(3)">
                <text :class="tabClass(3)">热门</text>
                <div class="tab-line" v-if="mode === 3"></div>
            </div>
            <div class="tab-item" @click="switchMode(2)">
                <text :class="tabClass(2)">最新</text>
                <div class="tab-line" v-if="mode === 2"></div>
            </div>
            <div class="tabs-total" v-if="total > 0">
                <text class="tabs-total-text">共 {{ totalText }} 条</text>
            </div>
        </div>

        <scroller class="list-area" scroll-direction="vertical">
            <div class="cmt-item" v-for="item in topItems" :key="'top-' + item.rpid">
                <image
                    class="cmt-avatar"
                    :src="item.face"
                    v-if="item.face"
                    resize="cover"></image>
                <div class="cmt-avatar-holder" v-else>
                    <text class="cmt-avatar-holder-text">{{ avatarChar(item) }}</text>
                </div>
                <div class="cmt-main">
                    <div class="cmt-head">
                        <text class="cmt-uname">{{ item.uname }}</text>
                        <text class="cmt-top-badge">置顶</text>
                        <text class="cmt-level">Lv{{ item.level }}</text>
                    </div>
                    <text class="cmt-content">{{ item.content }}</text>
                    <div class="cmt-foot">
                        <text class="cmt-foot-text">{{ item.timeText }}</text>
                        <text class="cmt-foot-text">点赞 {{ formatCount(item.like) }}</text>
                        <text class="cmt-foot-reply" @click="onReplyTap">回复 {{ item.rcount }}</text>
                    </div>
                </div>
            </div>

            <div class="cmt-item" v-for="item in items" :key="item.rpid">
                <image
                    class="cmt-avatar"
                    :src="item.face"
                    v-if="item.face"
                    resize="cover"></image>
                <div class="cmt-avatar-holder" v-else>
                    <text class="cmt-avatar-holder-text">{{ avatarChar(item) }}</text>
                </div>
                <div class="cmt-main">
                    <div class="cmt-head">
                        <text class="cmt-uname">{{ item.uname }}</text>
                        <text class="cmt-level">Lv{{ item.level }}</text>
                    </div>
                    <text class="cmt-content">{{ item.content }}</text>
                    <div class="cmt-foot">
                        <text class="cmt-foot-text">{{ item.timeText }}</text>
                        <text class="cmt-foot-text">点赞 {{ formatCount(item.like) }}</text>
                        <text class="cmt-foot-reply" @click="onReplyTap">回复 {{ item.rcount }}</text>
                    </div>
                </div>
            </div>

            <loading :visible="loading" text="加载评论中..."></loading>

            <empty
                v-if="showEmpty"
                :visible="true"
                :code="emptyCode"
                :message="emptyMessage"></empty>

            <div class="load-more" v-if="hasMore && !loading" @click="loadMore">
                <text class="load-more-text">{{ loadingMore ? '加载中...' : '加载更多' }}</text>
            </div>
            <div class="no-more" v-if="!hasMore && !loading && items.length > 0">
                <text class="no-more-text">没有更多评论了</text>
            </div>
            <div class="list-bottom-pad"></div>
        </scroller>

        <soft-keyboard
            v-if="keyboardVisible"
            @input="onKeyInput"
            @backspace="onBackspace"
            @clear="onClear"
            @space="onSpace"
            @confirm="onSend"
            @close="onKeyboardClose">
        </soft-keyboard>

        <div class="composer">
            <div class="composer-input" @click="openKeyboard">
                <text class="composer-placeholder" v-if="!inputText">说点什么...</text>
                <text class="composer-text" v-else>{{ inputText }}</text>
            </div>
            <div class="composer-send" @click="onSend">
                <text class="composer-send-text">{{ sending ? '发送中' : '发送' }}</text>
            </div>
        </div>

        <div v-if="toast" class="toast">
            <text class="toast-text">{{ toast }}</text>
        </div>
    </div>
</template>

<style lang="less" scoped src="./comments.less"></style>

<script>
import page from './comments';
export default page;
</script>
