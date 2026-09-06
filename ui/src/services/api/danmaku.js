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
 * api/danmaku.js —— 视频弹幕
 *
 * 主路径（唯一路径，见 Task 18 报告）：
 *   GET https://api.bilibili.com/x/v1/dm/list.so?oid={cid}
 *   返回 XML：<d p="progress,mode,fontsize,color,ctime,pool,midHash,dmid[,weight]">content</d>
 *   p[0] 出现时间（秒，浮点）；mode 1-3 滚动 / 4 底部 / 5 顶部 / 6 逆向 / 7+ 高级。
 *   无弹幕（-404 / 空池）返回空数组。
 *
 * 降级路径 /x/v2/dm/web/seg.so（protobuf，DmSegMobileReply.elems=1；
 *   DanmakuElem: id=1,progress=2,mode=3,fontsize=4,color=5,midHash=6,content=7,
 *   ctime=8,weight=9,pool=11,idStr=12；segment_index 为 6 分钟分包，从 1 起）
 *   经核查在当前 Fetch 管线不可行：服务器无条件返回二进制（XML 亦被强制
 *   Content-Encoding: deflate），而 JSFetch.cpp 将 body 以 Bson 字符串
 *   （UTF-8）回传，非法 UTF-8 序列被替换/报错，二进制不可恢复。
 *   待原生层支持（CURLOPT_ACCEPT_ENCODING="" 或 base64 body）后再启用。
 */

import { rawRequest, BiliApiError } from '../http.js';

const LIST_SO_URL = 'https://api.bilibili.com/x/v1/dm/list.so?oid=';

/** 单条 <d> 标签（p 属性 + 文本内容）。 */
const D_TAG_RE = /<d\s+p="([^"]*)"[^>]*>([\s\S]*?)<\/d>/g;

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function codePointToChar(code) {
  if (!isFinite(code) || code <= 0 || code > 0x10ffff) return '';
  if (code >= 0xd800 && code <= 0xdfff) return '';
  return String.fromCodePoint(code);
}

/** XML 实体反转义：数字/十六进制字符引用 + 常见命名实体。 */
export function decodeXmlEntities(str) {
  const s = String(str || '');
  if (s.indexOf('&') === -1) return s;
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, function (_, hex) {
      return codePointToChar(parseInt(hex, 16));
    })
    .replace(/&#([0-9]+);/g, function (_, dec) {
      return codePointToChar(parseInt(dec, 10));
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, function (_, name) {
      return NAMED_ENTITIES[name] || '';
    });
}

/** 判定响应体是否为可解析的弹幕 XML（区别于 deflate 乱码 / JSON 错误）。 */
export function looksLikeDanmakuXml(text) {
  const s = String(text || '');
  return s.indexOf('<d ') >= 0 || s.indexOf('<i') >= 0;
}

/**
 * 解析弹幕 XML 文本 → 结构化数组。
 * @param {string} xml
 * @returns {Array<{progressMs: number, mode: number, fontsize: number, color: number, content: string}>}
 */
export function parseDanmakuXml(xml) {
  const text = String(xml || '');
  if (!looksLikeDanmakuXml(text)) return [];
  const out = [];
  D_TAG_RE.lastIndex = 0;
  let m;
  while ((m = D_TAG_RE.exec(text)) !== null) {
    const parts = m[1].split(',');
    if (parts.length < 4) continue;
    const sec = parseFloat(parts[0]);
    if (!isFinite(sec) || sec < 0) continue;
    const content = decodeXmlEntities(m[2].replace(/\s+/g, ' ')).trim();
    if (!content) continue;
    out.push({
      progressMs: Math.round(sec * 1000),
      mode: parseInt(parts[1], 10) || 1,
      fontsize: parseInt(parts[2], 10) || 25,
      color: parseInt(parts[3], 10) || 0xffffff,
      content,
    });
  }
  return out;
}

/** deflate 二进制（经 UTF-8 字符串化损坏）特征：替换符密集且无标签结构。 */
function detectBinaryBody(text) {
  const s = String(text || '');
  if (!s) return false;
  if (looksLikeDanmakuXml(s)) return false;
  let bad = 0;
  const sample = s.length > 4096 ? s.slice(0, 4096) : s;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0xfffd || (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d)) bad++;
  }
  return bad * 8 >= sample.length;
}

/**
 * 拉取弹幕 XML 并解析（list.so 主路径）。
 * - HTTP 404 / code!=0 / 空弹幕池 → 空数组（视为无弹幕）；
 * - 响应为压缩二进制（服务器强制 deflate，Fetch 层不支持解压）→ 抛 BiliApiError(-2)。
 * @param {number} cid 分 P 的 cid（oid）
 * @returns {Promise<Array<{progressMs: number, mode: number, fontsize: number, color: number, content: string}>>}
 */
export async function fetchDanmakuXml(cid) {
  const id = Number(cid) || 0;
  if (!id) {
    throw new BiliApiError(-3, '缺少 cid，无法获取弹幕');
  }
  const res = await rawRequest({ url: LIST_SO_URL + id, timeout: 15000 });
  const body = String(res.body || '');
  if (res.status === 404) return [];
  if (res.status < 200 || res.status >= 300) {
    throw new BiliApiError(res.status, '弹幕接口 HTTP ' + res.status);
  }
  if (body.indexOf('"code"') >= 0 && body.indexOf('<') !== 0) {
    let root = null;
    try {
      root = JSON.parse(body);
    } catch (err) {
      root = null;
    }
    if (root && typeof root.code === 'number' && root.code !== 0) {
      if (root.code === -404) return [];
      throw new BiliApiError(root.code, root.message || '弹幕接口错误');
    }
  }
  if (detectBinaryBody(body)) {
    throw new BiliApiError(
      -2,
      '弹幕数据为压缩二进制（Content-Encoding: deflate），当前 Fetch 层不支持解压'
    );
  }
  return parseDanmakuXml(body);
}

/**
 * 获取弹幕列表（按 progressMs 升序，供播放器窗口消费）。
 * @param {number} cid 分 P 的 cid（oid）
 * @param {number} [durationSec] 视频时长（秒）。预留给 seg.so 分包降级
 *   （min(ceil(duration/360), n) 包 protobuf）；当前二进制路径不可行，未使用。
 * @returns {Promise<Array<{progressMs: number, mode: number, fontsize: number, color: number, content: string}>>}
 */
export async function getDanmaku(cid, durationSec) {
  void durationSec;
  const items = await fetchDanmakuXml(cid);
  items.sort(function (a, b) {
    return a.progressMs - b.progressMs;
  });
  return items;
}
