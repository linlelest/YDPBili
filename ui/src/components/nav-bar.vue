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
    <div class="nav-bar">
        <div class="nav-side left" @click="onBack">
            <text v-if="showBack" class="back-icon">‹</text>
        </div>
        <text class="nav-title">{{ title }}</text>
        <div class="nav-side right">
            <slot></slot>
        </div>
    </div>
</template>

<style lang="less" scoped>
@import '../styles/theme.less';

.nav-bar {
    height: @nav-height;
    background-color: @card;
    border-bottom-width: 1px;
    border-bottom-color: @divider;
    flex-direction: row;
    align-items: center;
    padding-left: @page-pad;
    padding-right: @page-pad;
}

.nav-side {
    width: 56px;
    height: @nav-height;
    justify-content: center;
    align-items: flex-start;
}

.nav-side.right {
    align-items: flex-end;
}

.back-icon {
    color: @text;
    font-size: 44px;
    line-height: @nav-height;
    width: 56px;
    height: @nav-height;
    text-align: left;
}

.nav-title {
    flex: 1;
    color: @text;
    font-size: @font-title;
    text-align: center;
    lines: 1;
    text-overflow: ellipsis;
}
</style>

<script>
export default {
    name: 'NavBar',
    props: {
        title: { type: String, default: '' },
        showBack: { type: Boolean, default: true },
    },
    methods: {
        onBack() {
            this.$emit('back');
        },
    },
};
</script>
