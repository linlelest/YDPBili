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
 * api/recommend.js —— 首页推荐流
 *
 * GET /x/web-interface/wbi/index/top/feed/rcmd（WBI 签名）
 * 参数：ps（≤30，默认 12）、fresh_idx/fresh_idx_1h（从 1 开始的翻页号）、fresh_type=4。
 * 返回 data.item[]，goto==='av' 的条目才是视频。
 */

import { biliGet } from '../http.js';

/**
 * 获取推荐视频流。
 * @param {number} [ps=15] 单页条数（最大 30）
 * @param {number} [refreshIndex] 翻页号（从 1 开始；映射 fresh_idx 与 fresh_idx_1h）
 * @returns {Promise<Array<{bvid: string, aid: number, cid: number, title: string,
 *   pic: string, owner: {name: string, mid: number, face: string},
 *   stat: {view: number, danmaku: number}, duration: number}>>}
 */
export async function getRecommendFeed(ps = 15, refreshIndex) {
  const params = { ps, fresh_type: 4 };
  if (refreshIndex) {
    params.fresh_idx = refreshIndex;
    params.fresh_idx_1h = refreshIndex;
  }
  const data = await biliGet('/x/web-interface/wbi/index/top/feed/rcmd', {
    params,
    wbi: true,
  });
  const items = (data && data.item) || [];
  return items
    .filter((it) => it && it.goto === 'av' && it.bvid)
    .map((it) => ({
      bvid: it.bvid,
      aid: it.id,
      cid: it.cid,
      title: it.title,
      pic: it.pic,
      owner: {
        name: (it.owner && it.owner.name) || '',
        mid: (it.owner && it.owner.mid) || 0,
        face: (it.owner && it.owner.face) || '',
      },
      stat: {
        view: (it.stat && it.stat.view) || 0,
        danmaku: (it.stat && it.stat.danmaku) || 0,
      },
      duration: it.duration || 0,
    }));
}
