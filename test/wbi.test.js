// WBI 签名自测脚本（Node ≥ 18，在仓库根运行：node test/wbi.test.js）
// 断言策略：
// 1) MD5 与 Node crypto 对拍（含中文/特殊字符/长串）；
// 2) mixin_key 用官方文档固定向量（img+sub → ea1db124af3c7062474693fa704f4ff8）；
// 3) 签名流程用官方文档示例（wts=1702204169 → w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4）
//    + 结构断言（排序/编码/过滤行为）；
// 4) WbiSigner 缓存与并发行为用 mock bridge 验证。

'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');

function md5Node(str) {
  return crypto.createHash('md5').update(Buffer.from(str, 'utf8')).digest('hex');
}

const OFFICIAL_IMG_KEY = '7cd084941338484aae1ad9425b84077c';
const OFFICIAL_SUB_KEY = '4932caff0ff746eab6f01bf08b70ac45';
const OFFICIAL_MIXIN_KEY = 'ea1db124af3c7062474693fa704f4ff8';
const OFFICIAL_WTS = 1702204169;
const OFFICIAL_W_RID = '8f6f2b5b3d485fe1886cec6a0be8c5d4';

async function main() {
  const wbi = await import('../ui/src/services/wbi.js');

  // ── 1. MD5 对拍 Node crypto ──
  const md5Cases = [
    '',
    'abc',
    'hello world',
    '中文测试',
    '五一四',
    'foo=bar&baz=qux',
    'one one four',
    "!'()*special",
    'a'.repeat(1000),
    'q=中文&x=one one four&y=1919810',
    '\uD83D\uDE00', // 代理对（emoji 😀）
  ];
  for (const c of md5Cases) {
    assert.strictEqual(
      wbi.md5(c),
      md5Node(c),
      'md5 mismatch for: ' + JSON.stringify(c.length > 40 ? c.slice(0, 40) + '...' : c)
    );
  }
  assert.strictEqual(wbi.md5(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.strictEqual(wbi.md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
  console.log('[ok] md5 与 Node crypto 全部对拍一致 (' + md5Cases.length + ' 例)');

  // ── 2. 官方文档固定向量：mixin_key ──
  assert.strictEqual(
    wbi.getMixinKey(OFFICIAL_IMG_KEY, OFFICIAL_SUB_KEY),
    OFFICIAL_MIXIN_KEY,
    'mixin_key 与官方文档向量不一致'
  );
  console.log('[ok] getMixinKey 官方向量一致: ' + OFFICIAL_MIXIN_KEY);

  // ── 3. 官方文档示例：固定 wts 的完整签名 ──
  const official = wbi.encodeWbi(
    { foo: '114', bar: '514', zab: 1919810 },
    OFFICIAL_MIXIN_KEY,
    OFFICIAL_WTS
  );
  assert.strictEqual(
    official.query.split('&w_rid=')[0],
    'bar=514&foo=114&wts=' + OFFICIAL_WTS + '&zab=1919810',
    'query 排序/编码结果与官方文档不符'
  );
  assert.strictEqual(official.wRid, OFFICIAL_W_RID, 'w_rid 与官方文档向量不一致');
  assert.strictEqual(official.params.wts, OFFICIAL_WTS);
  assert.strictEqual(official.params.w_rid, OFFICIAL_W_RID);
  console.log('[ok] encodeWbi 官方示例 w_rid 一致: ' + OFFICIAL_W_RID);

  // ── 4. 结构断言：中文大写百分号编码、空格 %20、!'()* 过滤 ──
  const enc = wbi.encodeWbi(
    { foo: 'one one four', bar: '五一四', baz: "a!b'c(d)e*f", zab: 1919810 },
    OFFICIAL_MIXIN_KEY,
    OFFICIAL_WTS
  );
  assert.ok(enc.query.includes('bar=%E4%BA%94%E4%B8%80%E5%9B%9B'), '中文应编码为大写 %E4..');
  assert.ok(!enc.query.includes('+'), '空格应编码为 %20 而非 +');
  assert.ok(enc.query.includes('foo=one%20one%20four'), '空格应编码为 %20');
  assert.ok(enc.query.includes('baz=abcdef'), "值中的 !'()* 应被过滤");
  assert.ok(!/[!'()*]/.test(enc.query), "query 中不应残留 !'()* 字符");
  assert.strictEqual(
    enc.wRid,
    md5Node(enc.query.replace(/&w_rid=.*/, '') + OFFICIAL_MIXIN_KEY),
    'w_rid 应等于 md5(query + mixin_key)'
  );
  console.log('[ok] encodeWbi 编码/过滤/结构断言通过');

  // ── 5. WbiSigner：mock bridge，验证签名参数与按日缓存 ──
  let navCalls = 0;
  const mockBridge = {
    loadKeys: async () => null,
    saveKeys: async (cached) => {
      assert.strictEqual(cached.imgKey, OFFICIAL_IMG_KEY);
      assert.strictEqual(cached.subKey, OFFICIAL_SUB_KEY);
      assert.strictEqual(cached.day, wbi.localDayString());
    },
    fetchNav: async () => {
      navCalls++;
      return { imgKey: OFFICIAL_IMG_KEY, subKey: OFFICIAL_SUB_KEY };
    },
  };
  const signer = new wbi.WbiSigner(mockBridge);
  const signed1 = await signer.sign({ keyword: '测试', page: 1 });
  assert.ok(signed1.wts > 0 && Number.isInteger(signed1.wts), 'wts 应为秒级整数时间戳');
  assert.ok(/^[0-9a-f]{32}$/.test(signed1.w_rid), 'w_rid 应为 32 位 hex');
  assert.ok(signed1.keyword === '测试' && signed1.page === 1, '原始参数应保留');
  const signed2 = await signer.sign({ keyword: 'second' });
  assert.strictEqual(navCalls, 1, '当日二次签名不应重复请求 nav');
  assert.ok(signed2.w_rid !== signed1.w_rid, '不同参数签名应不同');

  // loadKeys 提供当日缓存时不触发 nav
  const cachedSigner = new wbi.WbiSigner({
    loadKeys: async () => ({
      imgKey: OFFICIAL_IMG_KEY,
      subKey: OFFICIAL_SUB_KEY,
      day: wbi.localDayString(),
    }),
    fetchNav: async () => {
      throw new Error('should not fetch nav when cache is fresh');
    },
  });
  const signed3 = await cachedSigner.sign({});
  assert.ok(/^[0-9a-f]{32}$/.test(signed3.w_rid));
  console.log('[ok] WbiSigner mock bridge 行为断言通过');

  // ── 6. signWbi 默认签名器未初始化应抛出可识别错误 ──
  let threw = false;
  try {
    await wbi.signWbi({});
  } catch (err) {
    threw = /not initialized/.test(err.message);
  }
  assert.ok(threw, '未初始化默认签名器时 signWbi 应抛错');
  wbi.setDefaultWbiSigner(signer);
  const signed4 = await wbi.signWbi({ foo: 1 });
  assert.ok(/^[0-9a-f]{32}$/.test(signed4.w_rid));
  console.log('[ok] signWbi 默认签名器接线正常');

  console.log('\nAll wbi tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
