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
 * api/dynamic.js —— 动态流
 *
 * GET /x/polymer/web-dynamic/v1/feed/all（Cookie SESSDATA 必须，未登录 -101）
 * 参数：offset（翻页偏移，上次返回值）、platform=web、features。
 * 返回 data.{has_more, offset, items[]}；items[n].modules 为模块化结构
 * （module_author / module_dynamic.major.{archive,opus,article,draw}）。
 * 旧版动态接口（/xlive/web-uinterface/... 与老 feed/all）均已下线，此为现行端点。
 */

import { biliGet } from '../http.js';

/**
 * 从 major.opus 提取图文/专栏跳转用数字 id：
 * 优先 item_id / opus_id，缺失时从 jump_url（…/opus/detail/{id} 或 …/opus/{id}）提取。
 * @param {Object} opus major.opus
 * @returns {number} 无有效 id 时返回 0
 */
function extractOpusId(opus) {
  const direct = opus.item_id || opus.opus_id;
  if (direct) return Number(direct) || 0;
  const jump = opus.jump_url || '';
  const matched = jump.match(/opus\/(?:detail\/)?(\d+)/) || jump.match(/(\d{15,})/);
  return matched ? Number(matched[1]) || 0 : 0;
}

/**
 * 把单条动态归一化为统一卡片结构（不可识别的类型返回 null）。
 * @param {Object} item data.items[n]
 * @returns {Object|null}
 */
export function normalizeDynamicItem(item) {
  if (!item || !item.modules || !item.modules.module_author) return null;
  const a = item.modules.module_author;
  const dyn = item.modules.module_dynamic || {};
  const major = dyn.major || null;
  const author = {
    name: a.name || '',
    mid: a.mid || 0,
    face: a.face || '',
    pubTime: a.pub_time || '',
    pubTs: a.pub_ts || 0,
  };
  const base = {
    dynId: item.id_str || '',
    type: item.type || '',
    author,
    text: (dyn.desc && dyn.desc.text) || '',
  };

  if (item.type === 'DYNAMIC_TYPE_AV' && major && major.archive) {
    const arc = major.archive;
    return Object.assign(base, {
      cardType: 'video',
      bvid: arc.bvid || '',
      aid: arc.aid || 0,
      cid: arc.cid || 0,
      title: arc.title || '',
      cover: arc.cover || '',
      durationText: arc.duration_text || '',
      stat: {
        view: (arc.stat && arc.stat.view) || 0,
        danmaku: (arc.stat && arc.stat.danmaku) || 0,
      },
    });
  }
  if (item.type === 'DYNAMIC_TYPE_DRAW' && major && major.draw) {
    return Object.assign(base, {
      cardType: 'draw',
      images: (major.draw.items || []).map((d) => (d && d.src) || '').filter(Boolean),
    });
  }
  if ((item.type === 'DYNAMIC_TYPE_OPUS' || item.type === 'DYNAMIC_TYPE_WORD') && major && major.opus) {
    return Object.assign(base, {
      cardType: 'opus',
      id: extractOpusId(major.opus),
      title: major.opus.title || '',
      images: (major.opus.pics || []).map((p) => (p && p.url) || '').filter(Boolean),
    });
  }
  if (item.type === 'DYNAMIC_TYPE_ARTICLE' && major && major.article) {
    return Object.assign(base, {
      cardType: 'article',
      articleId: major.article.id || 0,
      title: major.article.title || '',
      cover: (major.article.covers || [])[0] || '',
    });
  }
  if (item.type === 'DYNAMIC_TYPE_FORWARD' && item.orig) {
    const orig = normalizeDynamicItem(item.orig);
    return Object.assign(base, { cardType: 'forward', orig });
  }
  return Object.assign(base, { cardType: 'other' });
}

/**
 * 获取全部动态列表（已登录）。
 * @param {string} [offset] 上一次返回的 offset（翻页偏移；首页传空）
 * @returns {Promise<{items: Array, offset: string, hasMore: boolean}>}
 *   items 为归一化卡片数组（cardType: video/draw/opus/article/forward/other）
 */
export async function getDynamicFeed(offset) {
  const params = {
    platform: 'web',
    features: 'itemOpusStyle,opusBigCover',
  };
  if (offset) params.offset = offset;
  const data = await biliGet('/x/polymer/web-dynamic/v1/feed/all', { params });
  const items = ((data && data.items) || [])
    .map(normalizeDynamicItem)
    .filter((it) => it && it.cardType !== 'other');
  return {
    items,
    offset: (data && data.offset) || '',
    hasMore: !!(data && data.has_more),
  };
}
