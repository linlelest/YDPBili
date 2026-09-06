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
                    <div v-if="articleId" class="btn-retry" @click="onRetry">
                        <text class="btn-retry-text">重试</text>
                    </div>
                </empty>
            </div>
            <div v-else-if="detail" class="content">
                <div class="head">
                    <text class="article-title">{{ detail.title || '无标题文章' }}</text>
                    <div class="author-row">
                        <image
                            v-if="detail.author.face"
                            class="avatar"
                            :src="detail.author.face"
                            resize="cover"
                        ></image>
                        <div v-else class="avatar"></div>
                        <text class="author-name">{{ detail.author.name || '未知作者' }}</text>
                        <text v-if="pubDateText" class="pub-date">{{ pubDateText }}</text>
                    </div>
                    <div class="head-divider"></div>
                </div>
                <div class="body-block">
                    <template v-for="(blk, index) in detail.blocks" :key="'b' + index">
                        <text
                            v-if="blk.type === 'text'"
                            class="para"
                        >{{ blk.text }}</text>
                        <image
                            v-else-if="blk.type === 'image'"
                            class="content-image"
                            :src="blk.url"
                            :style="{ height: bodyImageHeight(blk) + 'px' }"
                            resize="cover"
                        ></image>
                    </template>
                    <empty
                        v-if="isEmptyBody"
                        :visible="true"
                        message="暂无正文内容"
                    ></empty>
                    <text v-else class="end-tip">— 已读到底 —</text>
                </div>
            </div>
            <empty v-else :visible="true" message="暂无内容"></empty>
        </scroller>
    </div>
</template>

<style lang="less" scoped src="./article.less"></style>

<script>
import page from './article';
export default page;
</script>
