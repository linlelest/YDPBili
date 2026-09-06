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
 * http.js —— BiliHttp 统一请求封装
 *
 * - 固定 UA（Mobile 日常浏览器 UA，常量可配）与默认 Referer；
 * - Cookie 头自动拼装：SESSDATA/bili_jct/DedeUserID/DedeUserID__ckMd5（会话，存在才拼）+ buvid3（设备）；
 * - 默认超时 10s；
 * - 统一 code!==0 处理：抛出带 code 的 BiliApiError（-101 未登录 / -412 风控 / -352 触发验证等）；
 * - GET 参数拼 URL 编码、JSON 解析；
 * - WBI 签名：模块加载时装配默认 WbiSigner（nav 取 key，按日缓存到 storage）。
 */

import { jsapiFetch, storageGet, storageSet } from './env.js';
import { WbiSigner, setDefaultWbiSigner, signWbi } from './wbi.js';
import { getSession, getBuvid3 } from './auth.js';

export const API_ORIGIN = 'https://api.bilibili.com';

export const DEFAULT_UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Mobile Safari/537.36';

export const DEFAULT_REFERER = 'https://www.bilibili.com/';

export const DEFAULT_TIMEOUT_MS = 10000;

let userAgent = DEFAULT_UA;

/** 覆盖 UA（真机调试时可用于切换桌面 UA 等）。 */
export function setUserAgent(ua) {
  userAgent = String(ua || DEFAULT_UA);
}

export function getUserAgent() {
  return userAgent;
}

/** B 站业务错误：code 为接口返回的 code（本地错误用负数约定：-1 网络 / -2 解析 / -3 参数）。 */
export class BiliApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BiliApiError';
    this.code = code;
  }
}

/**
 * 拼接 URL 与 GET 参数（键值均 encodeURIComponent）。
 * @param {string} base 相对路径（自动加 API_ORIGIN）或完整 URL
 * @param {Object} [params]
 * @returns {string}
 */
export function buildUrl(base, params) {
  const url = /^https?:\/\//.test(base) ? base : API_ORIGIN + base;
  if (!params) return url;
  const qs = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])))
    .join('&');
  if (!qs) return url;
  return url + (url.indexOf('?') === -1 ? '?' : '&') + qs;
}

async function buildCookieHeader(extra) {
  const parts = [];
  try {
    const session = await getSession();
    if (session && session.SESSDATA) parts.push('SESSDATA=' + session.SESSDATA);
    if (session && session.bili_jct) parts.push('bili_jct=' + session.bili_jct);
    if (session && session.DedeUserID) parts.push('DedeUserID=' + session.DedeUserID);
    if (session && session.DedeUserID__ckMd5) {
      parts.push('DedeUserID__ckMd5=' + session.DedeUserID__ckMd5);
    }
  } catch (err) {
    // 会话读取失败按未登录处理
  }
  try {
    const buvid3 = await getBuvid3();
    if (buvid3) parts.push('buvid3=' + buvid3);
  } catch (err) {
    // buvid3 失败不阻塞请求
  }
  if (extra) {
    Object.keys(extra).forEach((k) => parts.push(k + '=' + extra[k]));
  }
  return parts.join('; ');
}

/**
 * 原始请求（不做 code 校验、不解析 JSON），供 Set-Cookie 抓取、nav 等场景。
 * @param {Object} options {url, method?, headers?, body?, timeout?}
 * @returns {Promise<{status: number, headers: Object, body: string, ok: boolean}>}
 */
export async function rawRequest(options) {
  const opts = options || {};
  const headers = Object.assign(
    {
      'User-Agent': userAgent,
      Referer: DEFAULT_REFERER,
    },
    opts.headers || {}
  );
  try {
    return await jsapiFetch({
      url: opts.url,
      method: opts.method || 'GET',
      headers,
      body: opts.body || '',
      timeout: opts.timeout || DEFAULT_TIMEOUT_MS,
    });
  } catch (err) {
    throw new BiliApiError(-1, '网络请求失败: ' + (err && err.message ? err.message : err));
  }
}

/**
 * 原始 JSON 请求（解析根对象，不校验 code）。
 * @param {string} url
 * @param {Object} [options] {method?, headers?, body?, timeout?}
 * @returns {Promise<Object>} 解析后的根对象（含 code/message/data）
 */
export async function rawJson(url, options) {
  const res = await rawRequest(Object.assign({ url }, options || {}));
  try {
    return JSON.parse(res.body);
  } catch (err) {
    throw new BiliApiError(-2, '响应 JSON 解析失败: ' + String(res.body).slice(0, 120));
  }
}

/**
 * 统一业务请求：code!==0 抛 BiliApiError，成功返回 data 字段。
 * @param {string} pathOrUrl 相对路径或完整 URL
 * @param {Object} [options] {params?, method?, body?, headers?, wbi?, cookie?, timeout?}
 * @returns {Promise<*>} 接口 data 字段
 */
export async function biliRequest(pathOrUrl, options) {
  const opts = options || {};
  let params = opts.params || {};
  if (opts.wbi) {
    params = await signWbi(params);
  }
  const url = buildUrl(pathOrUrl, params);
  const headers = Object.assign(
    { Cookie: await buildCookieHeader(opts.cookie) },
    opts.headers || {}
  );
  const root = await rawJson(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body,
    timeout: opts.timeout,
  });
  if (root.code !== 0) {
    throw new BiliApiError(root.code, root.message || ('接口返回 code=' + root.code));
  }
  return root.data;
}

/** GET 快捷方式（params 可选 wbi 签名）。 */
export function biliGet(pathOrUrl, options) {
  return biliRequest(pathOrUrl, Object.assign({ method: 'GET' }, options || {}));
}

/** POST 快捷方式（params 以 query 拼接，body 原样传字符串）。 */
export function biliPost(pathOrUrl, options) {
  return biliRequest(pathOrUrl, Object.assign({ method: 'POST' }, options || {}));
}

function extractWbiKey(url) {
  if (!url) return '';
  const filename = url.slice(url.lastIndexOf('/') + 1);
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? filename : filename.slice(0, dot);
}

async function fetchWbiKeysFromNav() {
  const root = await rawJson(buildUrl('/x/web-interface/nav'));
  const wbiImg = (root.data && root.data.wbi_img) || {};
  const imgKey = extractWbiKey(wbiImg.img_url);
  const subKey = extractWbiKey(wbiImg.sub_url);
  if (!imgKey || !subKey) {
    throw new BiliApiError(-3, 'nav 接口未返回 WBI 密钥 (code=' + root.code + ')');
  }
  return { imgKey, subKey };
}

const WBI_CACHE_KEY = 'bilibili_wbi_keys';

const wbiSigner = new WbiSigner({
  loadKeys: () => storageGet(WBI_CACHE_KEY),
  saveKeys: (data) => storageSet(WBI_CACHE_KEY, data),
  fetchNav: fetchWbiKeysFromNav,
});

setDefaultWbiSigner(wbiSigner);

/** 获取模块内装配的 WbiSigner（高级用法：手动预取 key）。 */
export function getWbiSigner() {
  return wbiSigner;
}
