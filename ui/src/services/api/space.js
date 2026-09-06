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
 * api/space.js —— 用户主页（空间）数据（端点选型见 Task 15 调研结论）
 *
 * 选型与理由：
 * - 用户信息：GET /x/web-interface/card?mid= 为主。一次返回 card{name, face, sign,
 *   level_info.current_level, official_verify.type, attention(关注)} + data.follower(粉丝)，
 *   对未登录/无 Cookie 宽容度高；/x/space/acc/info?mid= 现阶段风控敏感（-412/-352 常见，
 *   coins 等字段还需登录），仅作降级补 level/sign（data.level 为 0-6 直接数字）。
 * - 投稿视频：GET /x/space/wbi/arc/search（WBI 签名必带，order=pubdate），
 *   返回 data.list.vlist[] + data.page.count；接口对无 Cookie/风控敏感，错误透传 BiliApiError。
 * - 专栏列表：GET /x/space/article?mid=&pn=&ps=（sort=publish_time），
 *   返回 data.articles[] + data.page{count, total}。
 * - 单用户动态：GET /x/polymer/web-dynamic/v1/feed/space?host_mid=&offset=
 *   （首页 offset 传空，翻页透传上次返回值），items 结构与 feed/all 完全一致
 *   （modules 模块化），复用 api/dynamic.js 的 normalizeDynamicItem 归一化；
 *   未登录/风控可能 -101/-404/-412/-352，由页面映射"动态接口暂不可用"。
 */

import { biliGet } from '../http.js';
import { normalizeDynamicItem } from './dynamic.js';

/**
 * 静默请求 acc/info 补充信息（失败返回 null，不阻塞主流程）。
 * @param {number|string} mid
 * @returns {Promise<{sign: string, level: number, officialType: number}|null>}
 */
async function fetchAccInfoQuietly(mid) {
  try {
    const data = await biliGet('/x/space/acc/info', { params: { mid } });
    if (!data) return null;
    return {
      sign: data.sign || '',
      level: data.level || 0,
      officialType:
        data.official && typeof data.official.type === 'number' ? data.official.type : -1,
    };
  } catch (err) {
    return null;
  }
}

/**
 * 获取用户空间信息（card 为主，acc/info 降级补 level/sign）。
 * @param {number|string} mid 用户 mid
 * @returns {Promise<{mid: number, name: string, face: string, sign: string,
 *   level: number, fans: number, following: number, officialType: number}>}
 *   officialType：-1 无认证 / 0 个人认证 / 1 机构认证
 */
export async function getUserSpaceInfo(mid) {
  let cardData = null;
  let cardErr = null;
  try {
    cardData = await biliGet('/x/web-interface/card', { params: { mid } });
  } catch (err) {
    cardErr = err;
  }

  if (cardData && cardData.card) {
    const card = cardData.card;
    const verify = card.official_verify || {};
    const info = {
      mid: Number(card.mid) || Number(mid) || 0,
      name: card.name || '',
      face: card.face || '',
      sign: card.sign || '',
      level: (card.level_info && card.level_info.current_level) || 0,
      fans: Number(cardData.follower) || Number(card.fans) || 0,
      following: Number(card.attention) || Number(card.friend) || 0,
      officialType: typeof verify.type === 'number' ? verify.type : -1,
    };
    if (!info.sign || !info.level) {
      const extra = await fetchAccInfoQuietly(mid);
      if (extra) {
        if (!info.sign) info.sign = extra.sign;
        if (!info.level) info.level = extra.level;
        if (info.officialType === -1 && extra.officialType !== -1) {
          info.officialType = extra.officialType;
        }
      }
    }
    return info;
  }

  const fallback = await fetchAccInfoQuietly(mid);
  if (fallback && (fallback.sign || fallback.level)) {
    return {
      mid: Number(mid) || 0,
      name: '',
      face: '',
      sign: fallback.sign,
      level: fallback.level,
      fans: 0,
      following: 0,
      officialType: fallback.officialType,
    };
  }
  throw cardErr || new Error('获取用户信息失败');
}

/**
 * 获取用户投稿视频列表（WBI 签名；无 Cookie/风控敏感，错误透传 BiliApiError）。
 * @param {number|string} mid
 * @param {number} [pn=1] 页码（从 1 开始）
 * @param {number} [ps=20] 每页条数
 * @returns {Promise<{items: Array<{bvid: string, aid: number, title: string,
 *   pic: string, length: string, play: number, created: number}>, total: number}>}
 *   length 为接口原始 "mm:ss" 文本；created 为 UNIX 秒级时间戳
 */
export async function getUserVideos(mid, pn = 1, ps = 20) {
  const data = await biliGet('/x/space/wbi/arc/search', {
    params: { mid, pn, ps, order: 'pubdate' },
    wbi: true,
  });
  const vlist = (data && data.list && data.list.vlist) || [];
  const page = (data && data.page) || {};
  return {
    items: vlist.map((v) => ({
      bvid: v.bvid || '',
      aid: v.aid || 0,
      title: v.title || '',
      pic: v.pic || '',
      length: v.length || '',
      play: v.play || 0,
      created: v.created || 0,
    })),
    total: Number(page.count) || vlist.length,
  };
}

/**
 * 获取用户专栏列表。
 * @param {number|string} mid
 * @param {number} [pn=1]
 * @param {number} [ps=20]
 * @returns {Promise<{items: Array<{id: number, title: string, bannerUrl: string,
 *   publishTime: number, view: number}>, total: number}>}
 */
export async function getUserArticles(mid, pn = 1, ps = 20) {
  const data = await biliGet('/x/space/article', {
    params: { mid, pn, ps, sort: 'publish_time' },
  });
  const articles = (data && data.articles) || [];
  const page = (data && data.page) || {};
  return {
    items: articles.map((a) => ({
      id: a.id || 0,
      title: a.title || '',
      bannerUrl: a.banner_url || '',
      publishTime: a.publish_time || 0,
      view: (a.stats && a.stats.view) || 0,
    })),
    total: Number(page.count) || Number(page.total) || articles.length,
  };
}

/**
 * 获取用户动态列表（feed/space；归一化逻辑与动态页一致）。
 * @param {number|string} mid
 * @param {string} [offset=''] 上一次返回的 offset（翻页偏移；首页传空）
 * @returns {Promise<{items: Array, offset: string, hasMore: boolean}>}
 *   items 为归一化卡片数组（cardType: video/draw/opus/article/forward）
 */
export async function getUserDynamics(mid, offset) {
  const params = {
    host_mid: mid,
    platform: 'web',
    features: 'itemOpusStyle,opusBigCover',
  };
  if (offset) params.offset = offset;
  const data = await biliGet('/x/polymer/web-dynamic/v1/feed/space', { params });
  const items = ((data && data.items) || [])
    .map(normalizeDynamicItem)
    .filter((it) => it && it.cardType !== 'other');
  return {
    items,
    offset: (data && data.offset) || '',
    hasMore: !!(data && data.has_more),
  };
}
