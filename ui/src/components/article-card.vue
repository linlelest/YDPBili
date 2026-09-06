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
    <div class="article-card" @click="onClick">
        <div class="info">
            <text class="title">{{ article.title }}</text>
            <text class="desc">{{ descText }}</text>
            <div class="meta-row">
                <text class="author">{{ authorName }}</text>
                <text class="view">{{ viewText }}阅读</text>
            </div>
        </div>
        <image v-if="article.pic" class="thumb" :src="article.pic" resize="cover"></image>
    </div>
</template>

<style lang="less" scoped>
@import '../styles/theme.less';

.article-card {
    background-color: @card;
    border-radius: @radius-md;
    padding: @card-pad;
    flex-direction: row;
    align-items: center;
}

.info {
    flex: 1;
}

.title {
    color: @text;
    font-size: @font-base;
    line-height: 32px;
    lines: 2;
    text-overflow: ellipsis;
}

.desc {
    margin-top: 4px;
    color: @text-secondary;
    font-size: @font-sm;
    line-height: 28px;
    lines: 1;
    text-overflow: ellipsis;
}

.meta-row {
    margin-top: 8px;
    flex-direction: row;
    justify-content: space-between;
}

.author {
    color: @text-secondary;
    font-size: @font-sm;
}

.view {
    color: @text-secondary;
    font-size: @font-sm;
}

.thumb {
    width: 96px;
    height: 72px;
    margin-left: @card-pad;
    border-radius: @radius-sm;
    background-color: @card-pressed;
}
</style>

<script>
import { formatCount } from '../utils/format.js';

export default {
    name: 'ArticleCard',
    props: {
        article: {
            type: Object,
            default: () => ({ title: '', desc: '', pic: '', author: '', view: 0 }),
        },
    },
    computed: {
        descText() {
            return (this.article && this.article.desc) || '';
        },
        authorName() {
            return (this.article && this.article.author) || '未知作者';
        },
        viewText() {
            return formatCount(this.article && this.article.view);
        },
    },
    methods: {
        onClick() {
            this.$emit('click', this.article);
        },
    },
};
</script>
