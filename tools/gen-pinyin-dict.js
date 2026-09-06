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

// gen-pinyin-dict.js —— 拼音词典离线生成脚本（构建期一次性执行，运行时零转换）
//
// 用法（仓库根目录）：
//   node tools/gen-pinyin-dict.js
//
// 输入（tools/pinyin-src/，需先下载）：
//   1) no-tone-pinyin-hanzi-table.json —— guoyunhe/pinyin-json（GPL-3.0）
//      现成反向表 { "ni": ["你","尼",...按字频], ... }，键序≈音节频度序；
//      下载：https://raw.githubusercontent.com/guoyunhe/pinyin-json/master/no-tone-pinyin-hanzi-table.json
//   2) large_pinyin.txt / pinyin.txt —— mozillazg/phrase-pinyin-data v0.19.0（MIT）
//      正向数据 { 词: 带调拼音 }（pinyin.txt 为人工校正版，优先级更高）；
//      下载：https://raw.githubusercontent.com/mozillazg/phrase-pinyin-data/master/large_pinyin.txt
//            https://raw.githubusercontent.com/mozillazg/phrase-pinyin-data/master/pinyin.txt
//   3) jieba-dict.txt —— fxsjy/jieba 主词典（MIT，"词 词频 词性"），
//      提供 26 万+ 汉语词的真实词频，用于词频度降序筛选；
//      下载：https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt
//
// 输出：ui/src/utils/pinyin-dict.js（ESM，导出 { chars, words, abbr, syllables }）
//   - chars:  { "ni": ["你","尼",...], ... }   每音节截前 CHAR_CAP 个（字频序）
//   - words:  { "nihao": ["你好",...], ... }   组内按 jieba 词频降序，每键 ≤ WORDS_PER_KEY
//   - abbr:   { "nh": ["你好",...], ... }      两音节词首字母简拼，每键 ≤ ABBR_PER_KEY
//   - syllables: [ "de","yi",... ]             合法无调音节表（取自 chars 键集 + 词表校验补充）
//
// 词表生成方式（正向→反向，构建期一次性完成，运行时零转换）：
//   jieba 词频降序遍历 → 查 phrase-pinyin 拼音 → 去调 → 音节切分校验 → 反向表
//
// 自校验：每个入典词必须能被音节表完整切分，否则丢弃并计数报告。

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'tools', 'pinyin-src');
const OUT_FILE = path.join(ROOT, 'ui', 'src', 'utils', 'pinyin-dict.js');

const CHAR_CAP = 16;
const WORDS_PER_KEY = 4;
const ABBR_PER_KEY = 4;
const MAX_PHRASE_LEN = 3;
const MIN_PHRASE_LEN = 2;
const MAX_KEY_LEN = 18;
const TOP_WORDS = 26000;

const TONE_MAP = {
  ā: 'a', á: 'a', ǎ: 'a', à: 'a',
  ē: 'e', é: 'e', ě: 'e', è: 'e',
  ī: 'i', í: 'i', ǐ: 'i', ì: 'i',
  ō: 'o', ó: 'o', ǒ: 'o', ò: 'o',
  ū: 'u', ú: 'u', ǔ: 'u', ù: 'u',
  ǖ: 'v', ǘ: 'v', ǚ: 'v', ǜ: 'v', ü: 'v',
};

function stripTone(syl) {
  let out = '';
  for (const ch of syl) out += TONE_MAP[ch] || ch;
  return out;
}

function log(msg) {
  process.stdout.write(msg + '\n');
}

// ── 1. 读取 chars 反向表（guoyunhe/pinyin-json，已是拼音→汉字频度序） ──
function buildChars() {
  const raw = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'no-tone-pinyin-hanzi-table.json'), 'utf8'));
  const chars = {};
  let droppedKeys = 0;
  for (const key of Object.keys(raw)) {
    const norm = stripTone(key);
    if (!/^[a-z]+$/.test(norm) || norm.length === 0) {
      droppedKeys++;
      continue;
    }
    const list = raw[key];
    if (!Array.isArray(list) || list.length === 0) continue;
    if (!chars[norm]) chars[norm] = [];
    for (const ch of list) {
      if (chars[norm].length >= CHAR_CAP) break;
      if (chars[norm].indexOf(ch) === -1) chars[norm].push(ch);
    }
  }
  log('[chars] 音节数=' + Object.keys(chars).length + '，丢弃非法键=' + droppedKeys);
  // ü 系别名：键盘无 ü，lv/nv 与 lue/nue 两种输入习惯都映射到同一字表
  if (chars.nve && !chars.nue) chars.nue = chars.nve.slice();
  if (chars.lve && !chars.lue) chars.lue = chars.lve.slice();
  return chars;
}

// ── 2. 词表转换：正向（词→带调拼音）+ jieba 词频 → 反向（无声调拼音串→词，频度降序） ──

// 正向拼音索引：{ 词: [带调音节...] }；pinyin.txt（人工校正）先解析、优先级更高
function buildPhraseIndex() {
  const index = new Map();
  let loaded = 0;
  for (const file of ['pinyin.txt', 'large_pinyin.txt']) {
    const text = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
    for (const lineRaw of text.split(/\r?\n/)) {
      const line = lineRaw.trim();
      if (!line || line.startsWith('#')) continue;
      const hashIdx = line.indexOf('#');
      const body = hashIdx >= 0 ? line.slice(0, hashIdx) : line;
      const colonIdx = body.indexOf(':');
      if (colonIdx < 0) continue;
      const phrase = body.slice(0, colonIdx).trim();
      const toned = body.slice(colonIdx + 1).trim().split(/\s+/).filter(Boolean);
      if (!phrase || toned.length === 0 || index.has(phrase)) continue;
      index.set(phrase, toned);
      loaded++;
    }
  }
  log('[pinyin-index] 词条数=' + loaded);
  return index;
}

function buildWords(chars) {
  const syllableSet = new Set(Object.keys(chars));
  const phraseIndex = buildPhraseIndex();

  // jieba 词典：{ 词, 词频 }，仅收纯中文 2~3 字词，按词频降序
  const text = fs.readFileSync(path.join(SRC_DIR, 'jieba-dict.txt'), 'utf8');
  const freqEntries = [];
  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const word = parts[0];
    const freq = parseInt(parts[1], 10);
    if (!freq || freq <= 0) continue;
    if (word.length < MIN_PHRASE_LEN || word.length > MAX_PHRASE_LEN) continue;
    if (!/^[\u4e00-\u9fa5]+$/.test(word)) continue;
    freqEntries.push({ word, freq });
  }
  freqEntries.sort((a, b) => b.freq - a.freq);
  log('[jieba] 中文词数=' + freqEntries.length + '，最高频: ' +
      freqEntries.slice(0, 3).map((e) => e.word + '(' + e.freq + ')').join(' '));

  const wordsMap = new Map();
  const abbrMap = new Map();
  let total = 0;
  let noPinyin = 0;
  let unsplittable = 0;
  const missingSyllables = new Set();

  for (const { word } of freqEntries) {
    if (total >= TOP_WORDS) break;
    const toned = phraseIndex.get(word);
    if (!toned) {
      noPinyin++;
      continue;
    }
    if (word.length !== toned.length) continue;
    const syls = [];
    let ok = true;
    for (const s of toned) {
      const syl = stripTone(s);
      if (!syllableSet.has(syl)) {
        missingSyllables.add(syl);
        unsplittable++;
        ok = false;
        break;
      }
      syls.push(syl);
    }
    if (!ok) continue;
    const key = syls.join('');
    if (key.length > MAX_KEY_LEN) continue;
    let bucket = wordsMap.get(key);
    if (!bucket) {
      bucket = [];
      wordsMap.set(key, bucket);
    }
    if (bucket.length >= WORDS_PER_KEY || bucket.indexOf(word) !== -1) continue;
    bucket.push(word);
    total++;

    if (word.length === 2 && syls.length === 2) {
      const ab = syls[0][0] + syls[1][0];
      let abBucket = abbrMap.get(ab);
      if (!abBucket) {
        abBucket = [];
        abbrMap.set(ab, abBucket);
      }
      if (abBucket.indexOf(word) === -1 && abBucket.length < ABBR_PER_KEY) {
        abBucket.push(word);
      }
    }
  }

  const words = {};
  for (const key of wordsMap.keys()) {
    const bucket = wordsMap.get(key);
    if (bucket.length > 0) words[key] = bucket;
  }
  const abbr = {};
  for (const ab of abbrMap.keys()) abbr[ab] = abbrMap.get(ab);

  const abbrTotal = Object.keys(abbr).reduce((n, k) => n + abbr[k].length, 0);
  log('[words] 词键数=' + Object.keys(words).length + '，入典词数=' + total +
      '，无拼音=' + noPinyin + '，音节不可切=' + unsplittable);
  if (missingSyllables.size > 0) {
    log('[words] 字表缺失音节（词被丢弃）: ' + Array.from(missingSyllables).sort().join(' '));
  }
  log('[abbr] 简拼键数=' + Object.keys(abbr).length + '，词数=' + abbrTotal);
  return { words, abbr };
}

// ── 3. 自校验：核心词条 + 音节表完整性 ──
function validate(chars, words) {
  const problems = [];
  if (!chars.ni || chars.ni[0] !== '你') problems.push('chars.ni 首字应为"你"，实际: ' + (chars.ni || []).slice(0, 3).join(','));
  if (!chars.hao || chars.hao[0] !== '好') problems.push('chars.hao 首字应为"好"');
  if (!words.nihao || words.nihao.indexOf('你好') === -1) problems.push('words.nihao 应含"你好"，实际: ' + JSON.stringify(words.nihao));
  if (!words.fangan || words.fangan[0] !== '方案') problems.push('words.fangan 首词应为"方案"（jieba 词频），实际: ' + JSON.stringify(words.fangan));
  const sylCount = Object.keys(chars).length;
  if (sylCount < 400) problems.push('音节表仅 ' + sylCount + ' 个，应 ≥400');
  if (problems.length) {
    for (const p of problems) log('[校验失败] ' + p);
    process.exit(1);
  }
  log('[校验] chars.ni[0]=你，words.nihao 含 你好，音节表 ' + sylCount + ' 个 —— 通过');
}

// ── 4. 输出 ESM 词典文件 ──
function emit(chars, words, abbr) {
  const syllables = Object.keys(chars);
  const header = [
    '// Copyright (C) 2025 Bilibili miniapp contributors',
    '//',
    '// This file is part of miniapp.',
    '//',
    '// miniapp is free software: you can redistribute it and/or modify',
    '// it under the terms of the GNU General Public License as published by',
    '// the Free Software Foundation, either version 3 of the License, or',
    '// (at your option) any later version.',
    '//',
    '// miniapp is distributed in the hope that it will be useful,',
    '// but WITHOUT ANY WARRANTY; without even the implied warranty of',
    '// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the',
    '// GNU General Public License for more details.',
    '//',
    '// You should have received a copy of the GNU General Public License',
    '// along with miniapp. If not, see <https://www.gnu.org/licenses/>.',
    '',
    '// pinyin-dict.js —— 拼音输入反向词典（构建产物，勿手改）',
    '// 重新生成：node tools/gen-pinyin-dict.js（原始数据见 tools/pinyin-src/ 说明）',
    '// 数据来源：',
    '//   chars     —— guoyunhe/pinyin-json no-tone-pinyin-hanzi-table.json（GPL-3.0，字频序反向表，截每音节前 ' + CHAR_CAP + ' 字）',
    '//   words/abbr —— fxsjy/jieba dict.txt（MIT，词频降序筛选 top ' + TOP_WORDS + '）× mozillazg/phrase-pinyin-data（MIT，词→拼音，构建期转为反向表，每键 ≤ ' + WORDS_PER_KEY + ' 词）',
    '//   syllables —— 取自 chars 键集（405+ 无调合法音节，键序≈频度序）',
    '',
    'const chars = ' + JSON.stringify(chars) + ';',
    '',
    'const words = ' + JSON.stringify(words) + ';',
    '',
    'const abbr = ' + JSON.stringify(abbr) + ';',
    '',
    'const syllables = ' + JSON.stringify(syllables) + ';',
    '',
    'export default { chars, words, abbr, syllables };',
    '',
  ];
  const content = header.join('\n');
  fs.writeFileSync(OUT_FILE, content, 'utf8');
  const bytes = Buffer.byteLength(content, 'utf8');
  log('[输出] ' + path.relative(ROOT, OUT_FILE));
  log('[体积] ' + (bytes / 1024).toFixed(1) + ' KB（约束 ≤ 800 KB）');
  if (bytes > 800 * 1024) {
    log('[失败] 词典超出 800KB 约束，请调小 CHAR_CAP / WORDS_PER_KEY / MAX_PHRASE_LEN 后重试');
    process.exit(1);
  }
}

function main() {
  const t0 = Date.now();
  if (!fs.existsSync(path.join(SRC_DIR, 'no-tone-pinyin-hanzi-table.json')) ||
      !fs.existsSync(path.join(SRC_DIR, 'pinyin.txt'))) {
    log('缺少原始数据，请先下载到 tools/pinyin-src/：');
    log('  Invoke-WebRequest https://raw.githubusercontent.com/guoyunhe/pinyin-json/master/no-tone-pinyin-hanzi-table.json -OutFile tools\\pinyin-src\\no-tone-pinyin-hanzi-table.json');
    log('  Invoke-WebRequest https://raw.githubusercontent.com/mozillazg/phrase-pinyin-data/master/pinyin.txt -OutFile tools\\pinyin-src\\pinyin.txt');
    process.exit(1);
  }
  const chars = buildChars();
  const { words, abbr } = buildWords(chars);
  validate(chars, words);
  emit(chars, words, abbr);
  log('[完成] 耗时 ' + (Date.now() - t0) + 'ms');
}

main();
