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
 * api/subtitle.js —— 视频字幕
 *
 * - 轨道列表：GET /x/player/wbi/v2?aid&cid&bvid（WBI 签名，Cookie 必带；
 *   未登录 data.subtitle.subtitles 为空数组）。
 *   data.subtitle.subtitles[] → { lan, lan_doc, subtitle_url }。
 * - 字幕正文：subtitle_url 以 "//" 开头（协议相对，需补 https:），返回 JSON：
 *   { ..., body: [{ from, to, content, ... }] }，from/to 单位秒。
 */

import { biliGet, rawRequest, BiliApiError } from '../http.js';

/** subtitle_url 协议补全（"//aisubtitle.hdslb.com/..." → https://...）。 */
export function ensureHttpsUrl(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  return 'https://' + u;
}

/**
 * 获取字幕轨道列表（WBI 签名；Cookie 由 http.js 统一携带）。
 * @param {Object} options
 * @param {number} [options.aid] 稿件 avid（aid/bvid 至少其一）
 * @param {number} options.cid 分 P 的 cid（必需）
 * @param {string} [options.bvid] 稿件 bvid
 * @returns {Promise<Array<{lan: string, lanDoc: string, url: string}>>}
 *          未登录 / 无字幕时为空数组
 */
export async function getSubtitleTracks(options) {
  const opts = options || {};
  const cid = Number(opts.cid) || 0;
  if (!cid) {
    throw new BiliApiError(-3, '缺少 cid，无法获取字幕');
  }
  const params = { cid };
  if (opts.bvid) params.bvid = String(opts.bvid);
  if (Number(opts.aid) > 0) params.aid = Number(opts.aid);

  const data = await biliGet('/x/player/wbi/v2', { params, wbi: true });
  const subtitles =
    (data && data.subtitle && data.subtitle.subtitles) || [];
  const tracks = [];
  for (let i = 0; i < subtitles.length; i++) {
    const s = subtitles[i] || {};
    if (!s.subtitle_url) continue;
    tracks.push({
      lan: String(s.lan || ''),
      lanDoc: String(s.lan_doc || s.lan || '未知语言'),
      url: ensureHttpsUrl(s.subtitle_url),
    });
  }
  return tracks;
}

/**
 * 拉取并解析字幕正文（JSON，body[].from/to 单位秒）。
 * @param {string} url subtitle_url（协议相对自动补 https:）
 * @returns {Promise<Array<{from: number, to: number, content: string}>>}
 */
export async function getSubtitleBody(url) {
  const full = ensureHttpsUrl(url);
  if (!full) return [];
  const res = await rawRequest({ url: full, timeout: 15000 });
  let root = null;
  try {
    root = JSON.parse(res.body);
  } catch (err) {
    throw new BiliApiError(-2, '字幕响应解析失败: ' + String(res.body).slice(0, 80));
  }
  const body = root && Array.isArray(root.body) ? root.body : [];
  const lines = [];
  for (let i = 0; i < body.length; i++) {
    const it = body[i] || {};
    const from = Number(it.from) || 0;
    const to = Number(it.to) || 0;
    const content = String(it.content || '');
    if (to <= from || !content) continue;
    lines.push({ from, to, content });
  }
  return lines;
}

/**
 * 二分查找当前进度对应的字幕句（from <= pos < to，from 升序）。
 * @param {Array<{from: number, to: number, content: string}>} lines
 * @param {number} posMs 当前播放位置（毫秒）
 * @returns {string} 无命中返回空串
 */
export function findSubtitleLine(lines, posMs) {
  if (!lines || !lines.length) return '';
  const pos = (Number(posMs) || 0) / 1000;
  let lo = 0;
  let hi = lines.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = lines[mid];
    if (seg.to <= pos) lo = mid + 1;
    else if (seg.from > pos) hi = mid - 1;
    else return seg.content;
  }
  return '';
}
