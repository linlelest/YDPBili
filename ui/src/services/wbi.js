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
 * wbi.js —— B 站 WBI 签名（纯 JS，零依赖，Node 可直接测试）
 *
 * 依据 bilibili-API-collect docs/misc/sign/wbi.md：
 * 1. 从 nav 接口取 img_url/sub_url，截文件名得 img_key/sub_key（每日更替，需缓存）；
 * 2. img_key + sub_key 按 MIXIN_KEY_ENC_TAB 重排取前 32 位得 mixin_key；
 *    官方文档固定向量：img=7cd084941338484aae1ad9425b84077c、
 *    sub=4932caff0ff746eab6f01bf08b70ac45 → mixin=ea1db124af3c7062474693fa704f4ff8；
 * 3. 参数加 wts（秒级时间戳）→ 按 key 升序 → 值过滤 !'()* → encodeURIComponent
 *    （大写十六进制、空格 %20）→ query 拼接 mixin_key → MD5 得 w_rid；
 * 4. 请求参数追加 wts 与 w_rid。
 *
 * 本文件不 import 任何模块（storage/fetch 依赖通过 bridge 注入），保证 Node 可测。
 */

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

const WBI_CHAR_FILTER = /[!'()*]/g;

/** RFC 1321 MD5，输入任意字符串（内部转 UTF-8），输出 32 位小写 hex。 */
export function md5(input) {
  const bytes = utf8Bytes(String(input));
  const words = bytesToWords(bytes);
  const state = binlMD5(words, bytes.length * 8);
  return binlToHex(state);
}

function utf8Bytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const lo = str.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        const cp = 0x10000 + ((code - 0xd800) << 10) + (lo - 0xdc00);
        i++;
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f)
        );
        continue;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return out;
}

function bytesToWords(bytes) {
  const words = [];
  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] = (words[i >> 2] || 0) | ((bytes[i] & 0xff) << ((i % 4) * 8));
  }
  return words;
}

function safeAdd(x, y) {
  const lsw = (x & 0xffff) + (y & 0xffff);
  const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return (msw << 16) | (lsw & 0xffff);
}

function bitRotateLeft(num, cnt) {
  return (num << cnt) | (num >>> (32 - cnt));
}

function md5cmn(q, a, b, x, s, t) {
  return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
}

function md5ff(a, b, c, d, x, s, t) {
  return md5cmn((b & c) | (~b & d), a, b, x, s, t);
}

function md5gg(a, b, c, d, x, s, t) {
  return md5cmn((b & d) | (c & ~d), a, b, x, s, t);
}

function md5hh(a, b, c, d, x, s, t) {
  return md5cmn(b ^ c ^ d, a, b, x, s, t);
}

function md5ii(a, b, c, d, x, s, t) {
  return md5cmn(c ^ (b | ~d), a, b, x, s, t);
}

function binlMD5(x, len) {
  x[len >> 5] |= 0x80 << (len % 32);
  x[(((len + 64) >>> 9) << 4) + 14] = len;

  let a = 1732584193;
  let b = -271733879;
  let c = -1732584194;
  let d = 271733878;

  for (let i = 0; i < x.length; i += 16) {
    const olda = a;
    const oldb = b;
    const oldc = c;
    const oldd = d;

    a = md5ff(a, b, c, d, x[i], 7, -680876936);
    d = md5ff(d, a, b, c, x[i + 1], 12, -389564586);
    c = md5ff(c, d, a, b, x[i + 2], 17, 606105819);
    b = md5ff(b, c, d, a, x[i + 3], 22, -1044525330);
    a = md5ff(a, b, c, d, x[i + 4], 7, -176418897);
    d = md5ff(d, a, b, c, x[i + 5], 12, 1200080426);
    c = md5ff(c, d, a, b, x[i + 6], 17, -1473231341);
    b = md5ff(b, c, d, a, x[i + 7], 22, -45705983);
    a = md5ff(a, b, c, d, x[i + 8], 7, 1770035416);
    d = md5ff(d, a, b, c, x[i + 9], 12, -1958414417);
    c = md5ff(c, d, a, b, x[i + 10], 17, -42063);
    b = md5ff(b, c, d, a, x[i + 11], 22, -1990404162);
    a = md5ff(a, b, c, d, x[i + 12], 7, 1804603682);
    d = md5ff(d, a, b, c, x[i + 13], 12, -40341101);
    c = md5ff(c, d, a, b, x[i + 14], 17, -1502002290);
    b = md5ff(b, c, d, a, x[i + 15], 22, 1236535329);

    a = md5gg(a, b, c, d, x[i + 1], 5, -165796510);
    d = md5gg(d, a, b, c, x[i + 6], 9, -1069501632);
    c = md5gg(c, d, a, b, x[i + 11], 14, 643717713);
    b = md5gg(b, c, d, a, x[i], 20, -373897302);
    a = md5gg(a, b, c, d, x[i + 5], 5, -701558691);
    d = md5gg(d, a, b, c, x[i + 10], 9, 38016083);
    c = md5gg(c, d, a, b, x[i + 15], 14, -660478335);
    b = md5gg(b, c, d, a, x[i + 4], 20, -405537848);
    a = md5gg(a, b, c, d, x[i + 9], 5, 568446438);
    d = md5gg(d, a, b, c, x[i + 14], 9, -1019803690);
    c = md5gg(c, d, a, b, x[i + 3], 14, -187363961);
    b = md5gg(b, c, d, a, x[i + 8], 20, 1163531501);
    a = md5gg(a, b, c, d, x[i + 13], 5, -1444681467);
    d = md5gg(d, a, b, c, x[i + 2], 9, -51403784);
    c = md5gg(c, d, a, b, x[i + 7], 14, 1735328473);
    b = md5gg(b, c, d, a, x[i + 12], 20, -1926607734);

    a = md5hh(a, b, c, d, x[i + 5], 4, -378558);
    d = md5hh(d, a, b, c, x[i + 8], 11, -2022574463);
    c = md5hh(c, d, a, b, x[i + 11], 16, 1839030562);
    b = md5hh(b, c, d, a, x[i + 14], 23, -35309556);
    a = md5hh(a, b, c, d, x[i + 1], 4, -1530992060);
    d = md5hh(d, a, b, c, x[i + 4], 11, 1272893353);
    c = md5hh(c, d, a, b, x[i + 7], 16, -155497632);
    b = md5hh(b, c, d, a, x[i + 10], 23, -1094730640);
    a = md5hh(a, b, c, d, x[i + 13], 4, 681279174);
    d = md5hh(d, a, b, c, x[i], 11, -358537222);
    c = md5hh(c, d, a, b, x[i + 3], 16, -722521979);
    b = md5hh(b, c, d, a, x[i + 6], 23, 76029189);
    a = md5hh(a, b, c, d, x[i + 9], 4, -640364487);
    d = md5hh(d, a, b, c, x[i + 12], 11, -421815835);
    c = md5hh(c, d, a, b, x[i + 15], 16, 530742520);
    b = md5hh(b, c, d, a, x[i + 2], 23, -995338651);

    a = md5ii(a, b, c, d, x[i], 6, -198630844);
    d = md5ii(d, a, b, c, x[i + 7], 10, 1126891415);
    c = md5ii(c, d, a, b, x[i + 14], 15, -1416354905);
    b = md5ii(b, c, d, a, x[i + 5], 21, -57434055);
    a = md5ii(a, b, c, d, x[i + 12], 6, 1700485571);
    d = md5ii(d, a, b, c, x[i + 3], 10, -1894986606);
    c = md5ii(c, d, a, b, x[i + 10], 15, -1051523);
    b = md5ii(b, c, d, a, x[i + 1], 21, -2054922799);
    a = md5ii(a, b, c, d, x[i + 8], 6, 1873313359);
    d = md5ii(d, a, b, c, x[i + 15], 10, -30611744);
    c = md5ii(c, d, a, b, x[i + 6], 15, -1560198380);
    b = md5ii(b, c, d, a, x[i + 13], 21, 1309151649);
    a = md5ii(a, b, c, d, x[i + 4], 6, -145523070);
    d = md5ii(d, a, b, c, x[i + 11], 10, -1120210379);
    c = md5ii(c, d, a, b, x[i + 2], 15, 718787259);
    b = md5ii(b, c, d, a, x[i + 9], 21, -343485551);

    a = safeAdd(a, olda);
    b = safeAdd(b, oldb);
    c = safeAdd(c, oldc);
    d = safeAdd(d, oldd);
  }
  return [a, b, c, d];
}

function binlToHex(input) {
  const hexTab = '0123456789abcdef';
  let output = '';
  for (let i = 0; i < input.length * 4; i++) {
    output +=
      hexTab.charAt((input[i >> 2] >> ((i % 4) * 8 + 4)) & 0x0f) +
      hexTab.charAt((input[i >> 2] >> ((i % 4) * 8)) & 0x0f);
  }
  return output;
}

/**
 * 由 img_key + sub_key 重排取前 32 位得 mixin_key。
 * @param {string} imgKey
 * @param {string} subKey
 * @returns {string}
 */
export function getMixinKey(imgKey, subKey) {
  const raw = String(imgKey) + String(subKey);
  let result = '';
  for (let i = 0; i < MIXIN_KEY_ENC_TAB.length; i++) {
    result += raw.charAt(MIXIN_KEY_ENC_TAB[i]);
  }
  return result.slice(0, 32);
}

/**
 * 纯函数签名：对参数做 WBI 签名计算。
 * @param {Object} params 原始请求参数
 * @param {string} mixinKey
 * @param {number} wts 秒级时间戳
 * @returns {{params: Object, query: string, wts: number, wRid: string}}
 *          params 为追加 wts/w_rid 后的参数对象；query 为排序编码后的完整 query（含 w_rid）
 */
export function encodeWbi(params, mixinKey, wts) {
  const merged = Object.assign({}, params, { wts });
  const keys = Object.keys(merged).sort();
  const query =
    keys
      .filter((k) => merged[k] !== undefined && merged[k] !== null)
      .map((k) => {
        const value = String(merged[k]).replace(WBI_CHAR_FILTER, '');
        return encodeURIComponent(k) + '=' + encodeURIComponent(value);
      })
      .join('&');
  const wRid = md5(query + mixinKey);
  return {
    params: Object.assign({}, params, { wts, w_rid: wRid }),
    query: query + '&w_rid=' + wRid,
    wts,
    wRid,
  };
}

/** 本地日期字符串（YYYY-MM-DD），用于"按日"缓存判定。 */
export function localDayString(date) {
  const d = date || new Date();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

/**
 * WBI 签名器。依赖通过 bridge 注入（避免引入 env.js/http.js，保持 Node 可测）：
 *   loadKeys(): Promise<{imgKey, subKey, day}|null>   读缓存（storage）
 *   saveKeys(cached): Promise                          写缓存
 *   fetchNav(): Promise<{imgKey, subKey}>              调 nav 接口取最新 key
 */
export class WbiSigner {
  constructor(bridge) {
    this.bridge = bridge || {};
    this.cache = null;
    this.pending = null;
  }

  /** 获取当日有效 keys（无并发重复请求：pending 共享）。 */
  async ensureKeys() {
    const today = localDayString();
    if (this.cache && this.cache.day === today) return this.cache;
    if (this.pending) return this.pending;

    this.pending = (async () => {
      try {
        let cached = this.bridge.loadKeys ? await this.bridge.loadKeys() : null;
        if (cached && cached.imgKey && cached.subKey && cached.day === today) {
          this.cache = cached;
          return cached;
        }
        const keys = await this.bridge.fetchNav();
        this.cache = {
          imgKey: keys.imgKey,
          subKey: keys.subKey,
          day: today,
        };
        if (this.bridge.saveKeys) {
          try {
            await this.bridge.saveKeys(this.cache);
          } catch (err) {
            // 缓存写失败不影响本次签名
          }
        }
        return this.cache;
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }

  /**
   * 对请求参数做 WBI 签名。
   * @param {Object} params 原始参数
   * @returns {Promise<Object>} 追加 wts/w_rid 后的参数
   */
  async sign(params) {
    const keys = await this.ensureKeys();
    const wts = Math.round(Date.now() / 1000);
    return encodeWbi(params, getMixinKey(keys.imgKey, keys.subKey), wts).params;
  }
}

let defaultSigner = null;

/** 注册全局默认签名器（由 http.js 在笔端装配；Node 测试可注入 mock）。 */
export function setDefaultWbiSigner(signer) {
  defaultSigner = signer;
}

/**
 * 使用默认签名器对参数做 WBI 签名。
 * @param {Object} params
 * @returns {Promise<Object>}
 */
export async function signWbi(params) {
  if (!defaultSigner) {
    throw new Error('WBI signer not initialized: call setDefaultWbiSigner() first');
  }
  return defaultSigner.sign(params);
}
