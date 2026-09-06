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
 * env.js —— JSAPICall 统一封装层
 *
 * 职责：
 * 1. 统一 Promise 调用 custom 模块的原生 fetch（C++ Fetch libcurl 实现）；
 * 2. 统一 Promise 调用宿主内置 storage（$falcon.jsapi.storage.{set,get}）；
 * 3. 提供 Node 测试注入点：
 *    - storage：globalThis.$falcon 直接可被 mock（storageSet/storageGet 自动探测）；
 *    - fetch：setFetchBridge(fn) 注入替代实现（笔端默认用 custom 模块的 Fetch）。
 *
 * custom 模块导出形态（jsapi/src/JSAPI.cpp）：
 *   import { Fetch } from 'custom'
 *   await Fetch.fetch({ url, method, headers, body, timeout })
 *   → Promise<{ status, ok, headers, body }>（timeout 单位毫秒，C++ 侧换算为秒）
 */

import { Fetch } from 'custom';

let fetchBridge = null;

/**
 * 注入替代 fetch 实现（Node 测试用）。
 * @param {(options: {url: string, method?: string, headers?: Object, body?: string, timeout?: number}) => Promise<{status: number, headers: Object, body: string, ok?: boolean}>} fn
 */
export function setFetchBridge(fn) {
  fetchBridge = fn;
}

/** 恢复默认（custom 模块）fetch 实现。 */
export function resetFetchBridge() {
  fetchBridge = null;
}

function getFetchBridge() {
  if (fetchBridge) return fetchBridge;
  if (Fetch && typeof Fetch.fetch === 'function') {
    return (options) => Fetch.fetch(options);
  }
  throw new Error('native fetch bridge unavailable (custom module not loaded)');
}

/**
 * 调用原生 fetch。
 * @param {Object} options {url, method?, headers?, body?, timeout?}
 * @returns {Promise<{status: number, headers: Object<string,string>, body: string, ok: boolean}>}
 */
export async function jsapiFetch(options) {
  const opts = options || {};
  const bridge = getFetchBridge();
  return bridge({
    url: opts.url,
    method: opts.method || 'GET',
    headers: opts.headers || {},
    body: opts.body || '',
    timeout: opts.timeout || 10000,
  });
}

function storage() {
  const falcon = globalThis.$falcon;
  if (falcon && falcon.jsapi && falcon.jsapi.storage) {
    return falcon.jsapi.storage;
  }
  return null;
}

/** 宿主 storage 是否可用（笔端恒可用；Node mock 后可用）。 */
export function hasStorage() {
  return storage() !== null;
}

/**
 * 写入 storage（值自动 JSON 序列化）。
 * @param {string} key
 * @param {*} value
 */
export async function storageSet(key, value) {
  const s = storage();
  if (!s) return false;
  await s.setStorage({ key, data: JSON.stringify(value) });
  return true;
}

/**
 * 读取 storage（值自动 JSON 反序列化）。
 * @param {string} key
 * @param {*} fallback key 不存在或解析失败时的返回值
 * @returns {Promise<*>}
 */
export async function storageGet(key, fallback = null) {
  const s = storage();
  if (!s) return fallback;
  try {
    const res = await s.getStorage({ key });
    if (res == null || typeof res.data !== 'string' || res.data === '') return fallback;
    return JSON.parse(res.data);
  } catch (err) {
    return fallback;
  }
}

/**
 * 删除 storage 键（宿主未提供删除 API，以空串覆盖实现）。
 * @param {string} key
 */
export async function storageRemove(key) {
  const s = storage();
  if (!s) return false;
  await s.setStorage({ key, data: '' });
  return true;
}
