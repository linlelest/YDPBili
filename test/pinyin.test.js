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

// 拼音引擎自测脚本（Node ≥ 18，在仓库根运行：node test/pinyin.test.js）
// 断言策略：
// 1) 词典体积 ≤ 800KB、音节表 ≥ 400；
// 2) 核心词条：nihao→你好、ni→你、fangan→方案（jieba 词频序）、简拼 nh、bzhan→B站；
// 3) 音节切分：DP 多方案（fangan → fang an / fan gan）、空格与大写归一；
// 4) 候选约束：≤9、去重、频度降序（chars.ni[0]=你）；
// 5) 性能：1000 次混合查询 < 2s，单次 < 50ms。

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function assertUnique(list, tag) {
  assert.strictEqual(new Set(list).size, list.length, tag + ' 候选不应重复: ' + JSON.stringify(list));
}

async function main() {
  const pinyin = await import('../ui/src/utils/pinyin-engine.js');
  const { createPinyinEngine, splitSyllables } = pinyin;
  const engine = createPinyinEngine();

  // ── 1. 词典体积与音节表约束 ──
  const dictPath = path.resolve(__dirname, '../ui/src/utils/pinyin-dict.js');
  const dictBytes = fs.statSync(dictPath).size;
  assert.ok(dictBytes <= 800 * 1024, '词典超出 800KB：' + (dictBytes / 1024).toFixed(1) + 'KB');
  const dict = (await import('../ui/src/utils/pinyin-dict.js')).default;
  const sylCount = dict.syllables.length;
  assert.ok(sylCount >= 400, '音节表应 ≥400，实际 ' + sylCount);
  console.log('[ok] 词典体积 ' + (dictBytes / 1024).toFixed(1) + 'KB ≤ 800KB，音节表 ' + sylCount + ' 个');

  // ── 2. 核心词条候选 ──
  const nihao = engine.suggest('nihao', 9);
  assert.ok(nihao.includes('你好'), 'nihao 候选应含"你好"：' + JSON.stringify(nihao));
  assert.strictEqual(nihao[0], '你好', 'nihao 首选应为"你好"');
  const ni = engine.suggest('ni', 9);
  assert.ok(ni.includes('你'), 'ni 候选应含"你"');
  assert.strictEqual(ni[0], '你', 'ni 首选应为"你"（字频降序）');
  assert.strictEqual(engine.suggest('shi', 9)[0], '是', 'shi 首选应为"是"');
  const fangan = engine.suggest('fangan', 9);
  assert.strictEqual(fangan[0], '方案', 'fangan 首选应为"方案"（jieba 词频）');
  assert.ok(fangan.includes('反感'), 'fangan 候选应含"反感"');
  console.log('[ok] 核心词条：nihao→你好、ni→你、shi→是、fangan→方案/反感');

  // ── 3. 简拼与不可切分串兜底 ──
  const nh = engine.suggest('nh', 9);
  assert.ok(nh.length > 0, '简拼 nh 应有候选');
  assert.ok(nh.every((c) => /[\u4e00-\u9fa5]/.test(c)), 'nh 候选应为汉字词');
  const bzhan = engine.suggest('bzhan', 9);
  assert.ok(bzhan.includes('B站'), 'bzhan 候选应含"B站"：' + JSON.stringify(bzhan));
  assert.ok(bzhan.includes('bzhan'), 'bzhan 无匹配时应回退原串');
  assert.deepStrictEqual(engine.suggest('', 9), [], '空输入应返回空候选');
  assert.deepStrictEqual(engine.suggest('123-+ 呢', 9), [], '无字母输入应返回空候选');
  console.log('[ok] 简拼 nh=' + JSON.stringify(nh.slice(0, 3)) + '，bzhan 含 B站 与原串兜底');

  // ── 4. 音节切分：DP 多方案与归一 ──
  const nihaoCuts = splitSyllables('nihao');
  assert.ok(nihaoCuts.includes('ni hao'), 'nihao 应切出 ni hao');
  const fanganCuts = splitSyllables('fangan');
  assert.ok(fanganCuts.includes('fang an') && fanganCuts.includes('fan gan'),
    'fangan 应枚举双切分：' + JSON.stringify(fanganCuts));
  assert.deepStrictEqual(splitSyllables('ni hao'), nihaoCuts, '空格分隔应与连写切分一致');
  assert.deepStrictEqual(splitSyllables('NI HAO'), nihaoCuts, '大写应归一后切分');
  assert.deepStrictEqual(splitSyllables(''), [], '空串无切分');
  const xian = engine.suggest('xian', 9);
  assert.strictEqual(xian[0], '现', 'xian 长音节切分优先，首选"现"');
  const lv = engine.suggest('lv', 9);
  const nv = engine.suggest('nv', 9);
  const nue = engine.suggest('nue', 9);
  assert.strictEqual(lv[0], '律', 'lv 首选应为"律"');
  assert.strictEqual(nv[0], '女', 'nv 首选应为"女"');
  assert.strictEqual(nue[0], '虐', 'nue 别名音节首选应为"虐"');
  console.log('[ok] 切分：' + JSON.stringify(fanganCuts) + '；ü 系 lv/nv/nue 正常');

  // ── 5. 候选约束：≤9、去重、混合候选 ──
  const queries = ['nihaode', 'nihaom', 'n', 'women', 'zhongguo', 'shide', 'bilibili', 'a'];
  for (const q of queries) {
    const list = engine.suggest(q, 9);
    assert.ok(list.length <= 9, q + ' 候选应 ≤9');
    assertUnique(list, q);
    assert.ok(list.every((c) => typeof c === 'string' && c.length > 0), q + ' 候选应为非空字符串');
  }
  const zhongguo = engine.suggest('zhongguo', 9);
  assert.strictEqual(zhongguo[0], '中国', 'zhongguo 首选应为"中国"');
  const nihaode = engine.suggest('nihaode', 9);
  assert.ok(nihaode.includes('你好的'), 'nihaode 应组词"你好的"');
  const women = engine.suggest('women', 9);
  assert.strictEqual(women[0], '我们', 'women 首选应为"我们"');
  assert.strictEqual(engine.first('nihao'), '你好', 'first(nihao) 应为"你好"');
  console.log('[ok] 候选约束与组词：zhongguo→中国、nihaode 组词、women→我们');

  // ── 6. 性能：1000 次混合查询 < 2s，单次 < 50ms ──
  const perfQueries = ['nihao', 'ni', 'fangan', 'bzhan', 'nihaom', 'n', 'zhongguo', 'women', 'xian', 'shide'];
  let maxCost = 0;
  const t0 = Date.now();
  for (let i = 0; i < 1000; i++) {
    const q = perfQueries[i % perfQueries.length];
    const s = Date.now();
    engine.suggest(q, 9);
    const cost = Date.now() - s;
    if (cost > maxCost) maxCost = cost;
  }
  const totalCost = Date.now() - t0;
  assert.ok(totalCost < 2000, '1000 次查询耗时应 <2s，实际 ' + totalCost + 'ms');
  assert.ok(maxCost < 50, '单次查询耗时应 <50ms，实际最大 ' + maxCost + 'ms');
  console.log('[ok] 性能：1000 次查询 ' + totalCost + 'ms（<2s），单次最大 ' + maxCost + 'ms（<50ms）');

  console.log('\nAll pinyin tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
