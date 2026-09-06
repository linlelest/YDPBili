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
    <div class="keyboard">
        <div class="kb-topbar">
            <div class="kb-seg-btn" @click="toggleSegment">
                <text class="kb-seg-text">{{ segment === 'letter' ? '123 符号' : '字母' }}</text>
            </div>
            <text class="kb-title">拼音/英文键盘</text>
            <div class="kb-collapse" @click="emitClose">
                <text class="kb-collapse-text">收起</text>
            </div>
        </div>
        <div class="kb-grid">
            <div class="kb-row" v-for="(row, ri) in currentRows" :key="'r' + ri">
                <div
                    class="kb-key"
                    v-for="(key, ki) in row"
                    :key="'k' + ki"
                    @click="onKeyClick(key)">
                    <text class="kb-key-text" v-if="key.label">{{ key.label }}</text>
                    <text class="kb-key-text kb-key-action" v-else-if="key.actionLabel">{{ key.actionLabel }}</text>
                </div>
            </div>
        </div>
        <div class="kb-funcrow">
            <div class="kb-func kb-space" @click="emitSpace">
                <text class="kb-func-text">空格</text>
            </div>
            <div class="kb-func kb-confirm" @click="emitConfirm">
                <text class="kb-confirm-text">搜索</text>
            </div>
        </div>
    </div>
</template>

<style lang="less" scoped>
@import url('../../styles/theme.less');

.keyboard {
    width: @page-width;
    background-color: @card;
    border-top-width: 1px;
    border-top-color: @divider;
}

.kb-topbar {
    width: @page-width;
    height: 44px;
    flex-direction: row;
    align-items: center;
    padding-left: 8px;
    padding-right: 8px;
    border-bottom-width: 1px;
    border-bottom-color: @divider;
}

.kb-seg-btn {
    width: 96px;
    height: 40px;
    background-color: @card-pressed;
    border-radius: @radius-sm;
    align-items: center;
    justify-content: center;
}

.kb-seg-text {
    color: @text;
    font-size: @font-sm;
}

.kb-title {
    flex: 1;
    color: @text-disabled;
    font-size: @font-xs;
    text-align: center;
}

.kb-collapse {
    width: 96px;
    height: 40px;
    align-items: center;
    justify-content: center;
}

.kb-collapse-text {
    color: @text-secondary;
    font-size: @font-sm;
}

.kb-grid {
    width: @page-width;
}

.kb-row {
    width: @page-width;
    height: 48px;
    flex-direction: row;
}

.kb-key {
    flex: 1;
    height: 48px;
    align-items: center;
    justify-content: center;
}

.kb-key-text {
    width: 40px;
    height: 40px;
    line-height: 40px;
    text-align: center;
    color: @text;
    font-size: @font-md;
    background-color: @card-pressed;
    border-radius: @radius-sm;
}

.kb-key-action {
    color: @primary;
    font-size: @font-sm;
}

.kb-funcrow {
    width: @page-width;
    height: 56px;
    flex-direction: row;
    padding-left: 8px;
    padding-right: 8px;
    background-color: @card;
    border-top-width: 1px;
    border-top-color: @divider;
}

.kb-func {
    height: 44px;
    margin-top: 5px;
    margin-bottom: 5px;
    align-items: center;
    justify-content: center;
    border-radius: @radius-sm;
}

.kb-space {
    flex: 1;
    background-color: @card-pressed;
    margin-right: 8px;
}

.kb-func-text {
    color: @text;
    font-size: @font-sm;
}

.kb-confirm {
    width: 96px;
    background-color: @primary;
}

.kb-confirm-text {
    color: #ffffff;
    font-size: @font-sm;
}
</style>

<script>
const LETTER_ROWS = [
    'abcdef',
    'ghijkl',
    'mnopqr',
    'stuvwx',
    'yz',
];

const SYMBOL_ROWS = [
    '123456',
    '7890-_',
    ':/.?!&',
    '@#%*=+',
    "'$",
];

const ACTION_CLEAR = 'clear';
const ACTION_BACKSPACE = 'backspace';
const ACTION_PAD = 'pad';

const CLEAR_KEY = { actionLabel: '清空', action: ACTION_CLEAR };
const BACKSPACE_KEY = { actionLabel: '⌫', action: ACTION_BACKSPACE };
const PAD_KEY = { action: ACTION_PAD };

function buildRows(rows) {
    const out = [];
    for (let r = 0; r < rows.length; r++) {
        const chars = String(rows[r]).split('');
        const line = chars.map((ch) => ({ label: ch, action: 'input', value: ch }));
        if (r === rows.length - 1) {
            while (line.length < 2) line.push(PAD_KEY);
            line.push(CLEAR_KEY, BACKSPACE_KEY);
            while (line.length < 6) line.push(PAD_KEY);
        }
        out.push(line);
    }
    return out;
}

export default {
    name: 'SoftKeyboard',
    data() {
        return {
            segment: 'letter',
            letterRows: buildRows(LETTER_ROWS),
            symbolRows: buildRows(SYMBOL_ROWS),
        };
    },
    computed: {
        currentRows() {
            return this.segment === 'letter' ? this.letterRows : this.symbolRows;
        },
    },
    methods: {
        toggleSegment() {
            this.segment = this.segment === 'letter' ? 'symbol' : 'letter';
        },
        onKeyClick(key) {
            if (!key || !key.action || key.action === ACTION_PAD) return;
            if (key.action === 'input') {
                this.$emit('input', key.value || '');
            } else if (key.action === ACTION_CLEAR) {
                this.$emit('clear');
            } else if (key.action === ACTION_BACKSPACE) {
                this.$emit('backspace');
            }
        },
        emitSpace() {
            this.$emit('space');
        },
        emitConfirm() {
            this.$emit('confirm');
        },
        emitClose() {
            this.$emit('close');
        },
    },
};
</script>
