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
            <div class="kb-top-btn" @click="toggleSegment">
                <text class="kb-top-text">{{ segment === 'letter' ? '符号' : '字母' }}</text>
            </div>
            <div class="kb-top-btn kb-top-lang" @click="toggleLang">
                <text :class="langBtnClass">{{ lang === 'pinyin' ? '中' : 'EN' }}</text>
            </div>
            <text class="kb-title">拼音/英文键盘</text>
            <div class="kb-top-btn" @click="emitClose">
                <text class="kb-top-text">收起</text>
            </div>
        </div>
        <div class="kb-cand">
            <text class="kb-cand-pinyin" v-if="pinyinMode">{{ buf || '拼音' }}</text>
            <text class="kb-cand-hint" v-else>{{ segment === 'symbol' ? '符号直接上屏' : '英文直接上屏' }}</text>
            <scroller class="kb-cand-scroll" scroll-direction="horizontal" v-if="pinyinMode && candidates.length > 0">
                <div class="kb-cand-row">
                    <div
                        class="kb-cand-item"
                        v-for="(cand, ci) in candidates"
                        :key="'c' + ci"
                        @click="commit(cand)">
                        <text class="kb-cand-text">{{ cand }}</text>
                    </div>
                </div>
            </scroller>
            <text class="kb-cand-empty" v-else-if="pinyinMode">键入拼音显示候选</text>
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
                <text class="kb-func-text">{{ pinyinMode && buf ? '上屏首选' : '空格' }}</text>
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

.kb-top-btn {
    width: 64px;
    height: 40px;
    background-color: @card-pressed;
    border-radius: @radius-sm;
    align-items: center;
    justify-content: center;
}

.kb-top-lang {
    margin-left: 8px;
    background-color: transparent;
}

.kb-top-text {
    color: @text;
    font-size: @font-sm;
}

.kb-lang-text {
    color: @text-secondary;
    font-size: @font-sm;
}

.kb-lang-text-active {
    color: @primary;
    font-size: @font-sm;
}

.kb-title {
    flex: 1;
    color: @text-disabled;
    font-size: @font-xs;
    text-align: center;
}

.kb-cand {
    width: @page-width;
    height: 64px;
    flex-direction: row;
    align-items: center;
    background-color: @bg;
    border-bottom-width: 1px;
    border-bottom-color: @divider;
}

.kb-cand-pinyin {
    width: 76px;
    padding-left: 8px;
    color: @primary;
    font-size: @font-sm;
    lines: 1;
}

.kb-cand-hint {
    width: 76px;
    padding-left: 8px;
    color: @text-disabled;
    font-size: @font-xs;
    lines: 1;
}

.kb-cand-scroll {
    flex: 1;
    height: 64px;
}

.kb-cand-row {
    flex-direction: row;
    align-items: center;
    height: 64px;
}

.kb-cand-item {
    height: 64px;
    padding-left: 12px;
    padding-right: 12px;
    justify-content: center;
}

.kb-cand-text {
    color: @text;
    font-size: @font-base;
}

.kb-cand-empty {
    flex: 1;
    color: @text-disabled;
    font-size: @font-xs;
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
import { createPinyinEngine } from '../../utils/pinyin-engine.js';

const engine = createPinyinEngine();

const LETTER_ROWS = [
    'abcdef',
    'ghijkl',
    'mnopqr',
    'stuvwx',
    'yz',
];

const SYMBOL_ROWS = [
    ['，', '。', '？', '！', '：', '；'],
    ['、', '"', "'", '（', '）', '《'],
    ['》', '…', '—', '·', '@', '#'],
    ['%', '&', '*', '-', '+', '/'],
    ['=', '.', ',', '!'],
];

const ACTION_CLEAR = 'clear';
const ACTION_BACKSPACE = 'backspace';
const ACTION_SHIFT = 'shift';
const ACTION_PAD = 'pad';

const CLEAR_KEY = { actionLabel: '清空', action: ACTION_CLEAR };
const BACKSPACE_KEY = { actionLabel: '⌫', action: ACTION_BACKSPACE };
const SHIFT_KEY = { actionLabel: '大写', action: ACTION_SHIFT };
const PAD_KEY = { action: ACTION_PAD };

function buildRows(rows) {
    const out = [];
    for (let r = 0; r < rows.length; r++) {
        const chars = Array.isArray(rows[r]) ? rows[r] : String(rows[r]).split('');
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
            lang: 'pinyin',
            shift: false,
            buf: '',
            candidates: [],
            letterRows: buildRows(LETTER_ROWS),
            symbolRows: buildRows(SYMBOL_ROWS),
        };
    },
    created() {
        this.letterRows[4].splice(2, 0, SHIFT_KEY);
    },
    computed: {
        pinyinMode() {
            return this.segment === 'letter' && this.lang === 'pinyin';
        },
        langBtnClass() {
            return this.lang === 'pinyin' ? 'kb-lang-text kb-lang-text-active' : 'kb-lang-text';
        },
        currentRows() {
            const rows = this.segment === 'letter' ? this.letterRows : this.symbolRows;
            if (this.segment !== 'letter') return rows;
            return rows.map((row) => row.map((key) => {
                if (key.action === ACTION_SHIFT) {
                    return { actionLabel: this.shift ? '小写' : '大写', action: ACTION_SHIFT };
                }
                if (key.action === 'input' && this.shift && key.label) {
                    return { label: key.label.toUpperCase(), action: 'input', value: key.value };
                }
                return key;
            }));
        },
    },
    methods: {
        updateCandidates() {
            this.candidates = this.buf ? engine.suggest(this.buf, 9) : [];
        },
        commit(cand) {
            this.$emit('input', String(cand));
            this.buf = '';
            this.candidates = [];
        },
        commitTop() {
            const top = this.candidates.length > 0 ? this.candidates[0] : this.buf;
            if (top) this.commit(top);
        },
        flushBuf() {
            if (this.buf) this.commitTop();
        },
        toggleSegment() {
            this.flushBuf();
            this.segment = this.segment === 'letter' ? 'symbol' : 'letter';
            this.shift = false;
        },
        toggleLang() {
            this.flushBuf();
            this.lang = this.lang === 'pinyin' ? 'en' : 'pinyin';
            this.shift = false;
        },
        onKeyClick(key) {
            if (!key || !key.action || key.action === ACTION_PAD) return;
            if (key.action === 'input') {
                if (this.segment === 'symbol') {
                    this.$emit('input', key.value || '');
                    return;
                }
                const ch = String(key.value || '');
                if (this.lang === 'en') {
                    this.$emit('input', this.shift ? ch.toUpperCase() : ch);
                    this.shift = false;
                } else {
                    this.buf += ch.toLowerCase();
                    this.shift = false;
                    this.updateCandidates();
                }
                return;
            }
            if (key.action === ACTION_SHIFT) {
                this.shift = !this.shift;
                return;
            }
            if (key.action === ACTION_CLEAR) {
                if (this.buf) {
                    this.buf = '';
                    this.candidates = [];
                } else {
                    this.$emit('clear');
                }
                return;
            }
            if (key.action === ACTION_BACKSPACE) {
                if (this.buf) {
                    this.buf = this.buf.slice(0, -1);
                    this.updateCandidates();
                } else {
                    this.$emit('backspace');
                }
            }
        },
        emitSpace() {
            if (this.pinyinMode && this.buf) {
                this.commitTop();
            } else {
                this.$emit('space');
            }
        },
        emitConfirm() {
            if (this.pinyinMode && this.buf) {
                this.commitTop();
            } else {
                this.$emit('confirm');
            }
        },
        emitClose() {
            this.$emit('close');
        },
    },
};
</script>
