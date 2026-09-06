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
 * auth.js —— 会话存取与设备标识
 *
 * - storage key `bilibili_session`：{SESSDATA, bili_jct, DedeUserID, refresh_token, timestamp}
 * - storage key `buvid3`：设备指纹。首次访问 https://www.bilibili.com 从 Set-Cookie
 *   提取；失败（如响应头未透传）则本地生成 UUIDv4 兜底并持久化。
 */

import { storageGet, storageSet, storageRemove, jsapiFetch } from './env.js';

export const SESSION_KEY = 'bilibili_session';
export const BUVID3_KEY = 'buvid3';

const BILI_HOME = 'https://www.bilibili.com/';

/** 读取会话对象（未登录/异常返回 null）。 */
export async function getSession() {
  const session = await storageGet(SESSION_KEY, null);
  if (!session || typeof session !== 'object' || !session.SESSDATA) return null;
  return session;
}

/**
 * 写入会话。
 * @param {{SESSDATA: string, bili_jct: string, DedeUserID: string|number, refresh_token?: string}} session
 */
export async function setSession(session) {
  if (!session || !session.SESSDATA) {
    throw new Error('setSession: SESSDATA is required');
  }
  const record = Object.assign({}, session, { timestamp: Date.now() });
  await storageSet(SESSION_KEY, record);
  return record;
}

/** 清除会话。 */
export async function clearSession() {
  await storageRemove(SESSION_KEY);
}

/** 是否已登录（仅判断会话存在，有效性以接口为准）。 */
export async function isLoggedIn() {
  return (await getSession()) !== null;
}

function uuidv4() {
  let out = '';
  for (let i = 0; i < 32; i++) {
    const r = Math.floor(Math.random() * 16);
    if (i === 12) out += '4';
    else if (i === 16) out += ((r & 0x3) | 0x8).toString(16);
    else out += r.toString(16);
    if (i === 8 || i === 12 || i === 16 || i === 20) out += '-';
  }
  return out;
}

/**
 * 获取 buvid3（带内存级缓存）。优先 storage；无则请求 B 站首页提取
 * Set-Cookie；仍失败则生成 UUIDv4 兜底。结果均持久化到 storage。
 * @returns {Promise<string>}
 */
export async function getBuvid3() {
  const cached = await storageGet(BUVID3_KEY, null);
  if (cached && typeof cached === 'string' && cached.length > 0) return cached;

  let buvid3 = '';
  try {
    const res = await jsapiFetch({ url: BILI_HOME, method: 'GET', timeout: 10000 });
    const setCookie = res.headers && res.headers['set-cookie'];
    if (setCookie) {
      const match = /buvid3=([^;]+)/i.exec(String(setCookie));
      if (match) buvid3 = match[1];
    }
  } catch (err) {
    // 网络失败走本地生成兜底
  }
  if (!buvid3) buvid3 = uuidv4();
  await storageSet(BUVID3_KEY, buvid3);
  return buvid3;
}
