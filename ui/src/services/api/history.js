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
 * api/history.js —— 历史记录
 *
 * GET /x/web-interface/history/cursor（Cookie SESSDATA 必须，未登录 -101）
 * 参数：max/business/view_at（链表式翻页游标，取上次返回 data.cursor）、
 * type（all/archive/live/article 筛选）、ps（默认 20，最大 30）。
 */

import { biliGet } from '../http.js';

/**
 * 获取历史记录列表。
 * @param {Object} [cursor] 翻页游标（首页传空）
 * @param {number} [cursor.max] 上次最后一项目标 id
 * @param {number} [cursor.viewAt] 上次最后一项时间戳
 * @param {string} [cursor.business] 上次最后一项目标类型
 * @param {string} [cursor.type] 分类筛选 all/archive/article
 * @param {number} [ps=20] 每页条数（≤30）
 * @returns {Promise<{items: Array, cursor: {max: number, viewAt: number, business: string}}>}
 *   items: [{title, showTitle, cover, authorName, authorMid, progress, duration,
 *   viewAt, badge, business, bvid, oid, cid, page, kid}]
 */
export async function getHistory(cursor, ps = 20) {
  const params = { ps };
  if (cursor) {
    if (cursor.max) params.max = cursor.max;
    if (cursor.viewAt) params.view_at = cursor.viewAt;
    if (cursor.business) params.business = cursor.business;
    if (cursor.type) params.type = cursor.type;
  }
  const data = await biliGet('/x/web-interface/history/cursor', { params });
  const items = ((data && data.list) || []).map((h) => ({
    title: h.title || '',
    showTitle: h.show_title || '',
    cover: h.cover || '',
    authorName: h.author_name || '',
    authorMid: h.author_mid || 0,
    progress: h.progress || 0,
    duration: h.duration || 0,
    viewAt: h.view_at || 0,
    badge: h.badge || '',
    business: (h.history && h.history.business) || '',
    bvid: (h.history && h.history.bvid) || '',
    oid: (h.history && h.history.oid) || 0,
    cid: (h.history && h.history.cid) || 0,
    page: (h.history && h.history.page) || 1,
    kid: h.kid || 0,
  }));
  const c = (data && data.cursor) || {};
  return {
    items,
    cursor: {
      max: c.max || 0,
      viewAt: c.view_at || 0,
      business: c.business || '',
    },
  };
}
