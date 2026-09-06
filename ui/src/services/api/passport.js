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
 * api/passport.js —— 扫码登录（passport.bilibili.com，与 api.bilibili.com 不同域）
 *
 * GET /x/passport-login/web/qrcode/generate → data:{ url, qrcode_key }
 * GET /x/passport-login/web/qrcode/poll?qrcode_key=xxx → data:{ code, message, url?, refresh_token? }
 *   data.code：0 成功 / 86101 未扫描 / 86090 已扫码未确认 / 86038 二维码已失效
 *   密钥超时约 180 秒。code=0 时登录 Cookie 经 Set-Cookie 响应头下发；
 *   data.url 为跨域登录跳转链接，其查询串同样携带 DedeUserID/DedeUserID__ckMd5/SESSDATA/bili_jct，
 *   在 C++ 响应头聚合导致 Set-Cookie 缺失时作为兜底提取来源（值保持 URL 原样编码，与 Cookie 形态一致）。
 */

import { rawRequest, rawJson, BiliApiError } from '../http.js';

const PASSPORT_ORIGIN = 'https://passport.bilibili.com';

const GENERATE_PATH = '/x/passport-login/web/qrcode/generate';
const POLL_PATH = '/x/passport-login/web/qrcode/poll';

/** poll 状态码（data.code） */
export const QR_CODE_SUCCESS = 0;
export const QR_CODE_NOT_SCANNED = 86101;
export const QR_CODE_SCANNED = 86090;
export const QR_CODE_EXPIRED = 86038;

/**
 * 申请二维码。
 * @returns {Promise<{url: string, qrcodeKey: string}>} url 为二维码内容（B 站 App 扫码识别），qrcodeKey 供轮询
 */
export async function generateQrCode() {
  const root = await rawJson(PASSPORT_ORIGIN + GENERATE_PATH);
  if (root.code !== 0) {
    throw new BiliApiError(root.code, root.message || ('二维码获取失败 (code=' + root.code + ')'));
  }
  const data = root.data || {};
  if (!data.url || !data.qrcode_key) {
    throw new BiliApiError(-2, '二维码接口返回数据不完整');
  }
  return { url: data.url, qrcodeKey: data.qrcode_key };
}

/**
 * 轮询扫码状态。
 * @param {string} qrcodeKey generate 返回的密钥
 * @returns {Promise<{code: number, message: string, url: string, refreshToken: string,
 *   session: null|{SESSDATA: string, bili_jct: string, DedeUserID: string, DedeUserID__ckMd5: string}}>}
 *   code 为扫码状态（0/86101/86090/86038）；code=0 时 session 为提取到的登录 Cookie（可能字段不全，调用方校验 SESSDATA）。
 */
export async function pollQrCode(qrcodeKey) {
  const url = PASSPORT_ORIGIN + POLL_PATH + '?qrcode_key=' + encodeURIComponent(qrcodeKey);
  const res = await rawRequest({ url, method: 'GET' });
  let root;
  try {
    root = JSON.parse(res.body);
  } catch (err) {
    throw new BiliApiError(-2, '扫码状态响应解析失败');
  }
  const data = root.data || {};
  const code = data.code != null ? data.code : root.code;
  const message = data.message && data.message !== '0' ? data.message : root.message || '';
  const out = {
    code: Number(code),
    message: String(message || ''),
    url: data.url || '',
    refreshToken: data.refresh_token || '',
    session: null,
  };
  if (out.code === QR_CODE_SUCCESS) {
    out.session = extractLoginSession(res.headers, out.url);
  }
  return out;
}

/**
 * 从 poll 响应（headers + data.url）提取登录 Cookie，响应头优先、url 查询串兜底。
 * @param {Object<string,string>} headers Fetch 返回的响应头（键大小写不确定，可能聚合）
 * @param {string} loginUrl poll 成功时 data.url
 * @returns {{SESSDATA: string, bili_jct: string, DedeUserID: string, DedeUserID__ckMd5: string}}
 */
export function extractLoginSession(headers, loginUrl) {
  const fromHeader = parseSessionFromSetCookie(pickHeader(headers, 'set-cookie'));
  const fromUrl = parseSessionFromUrl(loginUrl);
  const merged = Object.assign({}, fromUrl, fromHeader);
  return {
    SESSDATA: merged.SESSDATA || '',
    bili_jct: merged.bili_jct || '',
    DedeUserID: merged.DedeUserID || '',
    DedeUserID__ckMd5: merged.DedeUserID__ckMd5 || '',
  };
}

/** 大小写不敏感取头值（数组值合并为分号串）。 */
function pickHeader(headers, name) {
  if (!headers) return '';
  const lower = String(name).toLowerCase();
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i]).toLowerCase() === lower) {
      const value = headers[keys[i]];
      return Array.isArray(value) ? value.join('; ') : String(value == null ? '' : value);
    }
  }
  return '';
}

const COOKIE_KEYS_PATTERN = '(SESSDATA|bili_jct|DedeUserID__ckMd5|DedeUserID)';

/**
 * 从 Set-Cookie（可能是多条聚合成的一个字符串）提取目标 Cookie 值。
 * 值模式 [^;,\s]+：SESSDATA 内部逗号为 URL 编码（%2C），裸逗号只会出现在 Expires/分隔处，不受影响。
 */
function parseSessionFromSetCookie(setCookie) {
  const out = {};
  if (!setCookie) return out;
  const pattern = new RegExp(COOKIE_KEYS_PATTERN + '=([^;,\\s]+)', 'g');
  let match;
  while ((match = pattern.exec(String(setCookie))) !== null) {
    if (!out[match[1]]) out[match[1]] = match[2];
  }
  return out;
}

/**
 * 从跨域登录 url 查询串提取目标 Cookie 值（不做 decode，保持与 Set-Cookie 相同的编码形态）。
 */
function parseSessionFromUrl(loginUrl) {
  const out = {};
  const url = String(loginUrl || '');
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return out;
  const segments = url.slice(queryStart + 1).split('&');
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const eq = seg.indexOf('=');
    if (eq === -1) continue;
    const key = seg.slice(0, eq);
    if (key === 'SESSDATA' || key === 'bili_jct' || key === 'DedeUserID' || key === 'DedeUserID__ckMd5') {
      if (!out[key]) out[key] = seg.slice(eq + 1);
    }
  }
  return out;
}
