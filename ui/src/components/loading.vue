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
    <div v-if="visible" class="loading">
        <text class="spinner">◌</text>
        <text class="text">{{ text }}</text>
    </div>
</template>

<style lang="less" scoped>
@import '../styles/theme.less';

.loading {
    padding: 32px;
    align-items: center;
    justify-content: center;
    flex-direction: row;
}

.spinner {
    color: @primary;
    font-size: @font-md;
    margin-right: 8px;
}

.text {
    color: @text-secondary;
    font-size: @font-base;
}
</style>

<script>
export default {
    name: 'Loading',
    props: {
        visible: { type: Boolean, default: true },
        text: { type: String, default: '加载中...' },
    },
};
</script>
