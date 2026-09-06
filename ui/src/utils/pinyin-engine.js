// Copyright (C) 2025 Bilibili miniapp contributors
//
// This file is part of miniapp.
//
// miniapp is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// miniapp is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with miniapp. If not, see <https://www.gnu.org/licenses/>.

/**
 * pinyin-engine.js —— 拼音候选引擎（零依赖、同步查询、纯内存查表）
 *
 * 数据来自 ./pinyin-dict.js（构建期由 tools/gen-pinyin-dict.js 离线生成，
 * 运行时零转换）：chars 拼音→字（字频序）、words 拼音串→词（词长升序）、
 * abbr 简拼→词、syllables 合法无调音节表（键序≈频度序）。
 *
 * 匹配策略（参见调研结论：正向/逆向最大匹配对 "fangan" 类歧义各有偏向，
 * 故采用 DP 枚举全部合法切分，词表整串查表与切分无关）：
 *   可完整切分时：
 *     1) words[s]            整串词（如 nihao → 你好）
 *     2) 前缀词 × 末音节字    组词（如 nihaode → 你好的）
 *     3) 各切分末音节 chars   单字（长音节切分优先，如 xian 先于 xi an）
 *   不可完整切分时：
 *     1) abbr[s]             首字母简拼（如 nh → 你好）
 *     2) words 键前缀匹配    进行中的词（如 niha → 你好）
 *     3) 最长可切前缀候选    输入进行中的已完成部分（如 nihaom → nihao 的候选）
 *     4) 音节前缀单字        未定音节的首字提示（如 n → 那/你/年…）
 *     5) 前导杂字母字面组合  bzhan → B站 + zhan 候选 + 原串兜底
 *
 * API：
 *   engine.suggest(buffer, limit=9) → string[]  字+词混合候选，频度降序
 *   engine.first(buffer)            → string|null  首选候选
 *   splitSyllables(buffer)          → string[]  全部切分（"ni hao" 形式）
 */

import DICT from './pinyin-dict.js';

const SYLLABLE_LIST = DICT.syllables;
const SYLLABLE_SET = new Set(SYLLABLE_LIST);
const CHARS = DICT.chars;
const WORDS = DICT.words;
const ABBR = DICT.abbr;
const WORDS_KEYS = Object.keys(WORDS);

const MAX_SYLLABLE_LEN = 6;
const MAX_CUTTINGS = 32;
const GREEDY_BUFFER_LEN = 24;
const MAX_LEAD_SKIP = 2;
const PREFIX_WORDS_MAX = 6;
const PREFIX_SYLLABLES_MAX = 3;
const PREFIX_SYLLABLE_CHARS = 2;
const COMBO_MAX = 4;

function normalize(buffer) {
  return String(buffer == null ? '' : buffer).toLowerCase().replace(/[^a-z]/g, '');
}

function greedyCut(s) {
  const cut = [];
  let i = 0;
  while (i < s.length) {
    let matched = '';
    for (let len = Math.min(MAX_SYLLABLE_LEN, s.length - i); len >= 1; len--) {
      const sub = s.slice(i, i + len);
      if (SYLLABLE_SET.has(sub)) {
        matched = sub;
        break;
      }
    }
    if (!matched) return [];
    cut.push(matched);
    i += matched.length;
  }
  return [cut];
}

function cutAll(s) {
  if (s.length === 0) return [];
  if (s.length > GREEDY_BUFFER_LEN) return greedyCut(s);
  const memo = new Map();
  const ways = (i) => {
    const cached = memo.get(i);
    if (cached) return cached;
    const out = [];
    if (i === s.length) {
      out.push([]);
      memo.set(i, out);
      return out;
    }
    for (let len = Math.min(MAX_SYLLABLE_LEN, s.length - i); len >= 1; len--) {
      const sub = s.slice(i, i + len);
      if (!SYLLABLE_SET.has(sub)) continue;
      const tails = ways(i + len);
      for (let t = 0; t < tails.length; t++) {
        out.push([sub].concat(tails[t]));
        if (out.length >= MAX_CUTTINGS) break;
      }
      if (out.length >= MAX_CUTTINGS) break;
    }
    memo.set(i, out);
    return out;
  };
  const result = ways(0);
  memo.clear();
  return result;
}

function pushAll(out, list, seen) {
  if (!list) return;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
}

function wordsStartingWith(s, max) {
  const out = [];
  for (let i = 0; i < WORDS_KEYS.length && out.length < max; i++) {
    const key = WORDS_KEYS[i];
    if (key.length > s.length && key.slice(0, s.length) === s) {
      const list = WORDS[key];
      for (let j = 0; j < list.length && out.length < max; j++) out.push(list[j]);
    }
  }
  return out;
}

function longestCutPrefixLen(s) {
  for (let len = s.length - 1; len >= 2; len--) {
    if (cutAll(s.slice(0, len)).length > 0) return len;
  }
  return 0;
}

function suggest(buffer, limit) {
  const max = limit || 9;
  const s = normalize(buffer);
  if (!s) return [];
  const seen = new Set();
  const out = [];

  const cuts = cutAll(s);
  if (cuts.length > 0) {
    // 歧义单音节（如 xian = 单音节"先"或 xi+an"西安"）：单字优先于词
    const charsFirst = cuts[0].length === 1 && cuts.length > 1;
    if (charsFirst) {
      pushAll(out, CHARS[cuts[0][0]], seen);
    }
    pushAll(out, WORDS[s], seen);
    const tailSeen = new Set();
    let combos = 0;
    for (let c = 0; c < cuts.length && combos < COMBO_MAX; c++) {
      const cut = cuts[c];
      if (cut.length < 2) continue;
      const tail = cut[cut.length - 1];
      if (tailSeen.has(tail)) continue;
      tailSeen.add(tail);
      const prefix = s.slice(0, s.length - tail.length);
      const prefixWords = WORDS[prefix];
      const tailChars = CHARS[tail];
      if (!prefixWords || !tailChars) continue;
      for (let w = 0; w < prefixWords.length && combos < COMBO_MAX; w++) {
        for (let k = 0; k < tailChars.length && combos < COMBO_MAX; k++) {
          const combo = prefixWords[w] + tailChars[k];
          if (!seen.has(combo)) {
            seen.add(combo);
            out.push(combo);
            combos++;
          }
        }
      }
    }
    const charSeen = new Set();
    for (let c = 0; c < cuts.length && out.length < max + 4; c++) {
      const tail = cuts[c][cuts[c].length - 1];
      if (charSeen.has(tail)) continue;
      charSeen.add(tail);
      pushAll(out, CHARS[tail], seen);
    }
    pushAll(out, ABBR[s], seen);
  } else {
    pushAll(out, ABBR[s], seen);
    pushAll(out, wordsStartingWith(s, PREFIX_WORDS_MAX), seen);
    const prefixLen = longestCutPrefixLen(s);
    if (prefixLen > 0) {
      pushAll(out, suggest(s.slice(0, prefixLen), max), seen);
    }
    if (s.length < MAX_SYLLABLE_LEN) {
      let picked = 0;
      for (let i = 0; i < SYLLABLE_LIST.length && picked < PREFIX_SYLLABLES_MAX; i++) {
        const syl = SYLLABLE_LIST[i];
        if (syl.length > s.length && syl.slice(0, s.length) === s) {
          pushAll(out, CHARS[syl].slice(0, PREFIX_SYLLABLE_CHARS), seen);
          picked++;
        }
      }
    }
    for (let skip = 1; skip <= MAX_LEAD_SKIP; skip++) {
      if (skip >= s.length) break;
      const rest = s.slice(skip);
      if (cutAll(rest).length > 0) {
        const restCands = suggest(rest, 4);
        const lead = s.slice(0, skip).toUpperCase();
        for (let i = 0; i < restCands.length && i < 3; i++) {
          const combo = lead + restCands[i];
          if (!seen.has(combo)) {
            seen.add(combo);
            out.push(combo);
          }
        }
        pushAll(out, restCands, seen);
        if (!seen.has(s)) {
          seen.add(s);
          out.push(s);
        }
        break;
      }
    }
    if (out.length === 0) out.push(s);
  }
  return out.slice(0, max);
}

export function createPinyinEngine() {
  return {
    suggest,
    first(buffer, limit) {
      const list = suggest(buffer, limit || 1);
      return list.length > 0 ? list[0] : null;
    },
  };
}

export function splitSyllables(buffer) {
  return cutAll(normalize(buffer)).map((cut) => cut.join(' '));
}
