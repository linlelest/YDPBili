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
 * api/search.js —— 搜索
 *
 * 前置：搜索接口强制校验 Cookie（无 buvid3 直接 -412），请求前必须先
 * ensureSearchReady()（GET https://www.bilibili.com 取 buvid3，或本地兜底）。
 *
 * - 综合搜索：GET /x/web-interface/wbi/search/all/v2（WBI + buvid3）
 *   参数 keyword；固定返回第 1 页 20 条 + 各分类计数（data.pageinfo/top_tlist）。
 * - 分类搜索：GET /x/web-interface/wbi/search/type（WBI + buvid3）
 *   参数 search_type=video/article、page（从 1 起）、page_size（≤50）。
 */

import { biliGet } from '../http.js';
import { getBuvid3 } from '../auth.js';

const EM_TAG_RE = /<\/?em[^>]*>/gi;

/** 去掉搜索结果标题/描述中的 <em class="keyword"> 高亮标签。 */
export function stripEm(text) {
  return String(text || '').replace(EM_TAG_RE, '');
}

/** 搜索前确保 buvid3 就绪（-412 风控前置条件）。 */
export async function ensureSearchReady() {
  return getBuvid3();
}

/**
 * 综合搜索（默认搜索方式，返回第 1 页视频结果与各分类计数）。
 * @param {string} keyword 关键词
 * @returns {Promise<{videos: Array, counts: Object}>}
 *   videos: [{bvid, aid, title, author, mid, play, durationText, pic, pubdate}]
 *   counts: 各分类总数（numResults），如 {video, article, bili_user, ...}
 */
export async function searchAll(keyword) {
  await ensureSearchReady();
  const data = await biliGet('/x/web-interface/wbi/search/all/v2', {
    params: { keyword },
    wbi: true,
  });
  const result = (data && data.result) || [];
  const videoGroup = result.find((g) => g && g.result_type === 'video');
  const videos = ((videoGroup && videoGroup.data) || []).map((it) => ({
    bvid: it.bvid || '',
    aid: it.aid || 0,
    title: stripEm(it.title),
    author: it.author || '',
    mid: it.mid || 0,
    play: it.play || 0,
    durationText: it.duration || '',
    pic: it.pic || '',
    pubdate: it.pubdate || 0,
  }));
  const counts = {};
  const pageinfo = (data && data.pageinfo) || {};
  Object.keys(pageinfo).forEach((k) => {
    if (pageinfo[k] && typeof pageinfo[k].numResults === 'number') {
      counts[k] = pageinfo[k].numResults;
    }
  });
  return { videos, counts };
}

/**
 * 分类搜索：视频。
 * @param {string} keyword
 * @param {number} [page=1] 页码（从 1 开始）
 * @param {number} [pageSize=20] 每页条数（≤50）
 * @returns {Promise<{items: Array, total: number}>}
 *   items: [{bvid, aid, title, description, author, mid, play, durationText, pic, pubdate}]
 */
export async function searchVideos(keyword, page = 1, pageSize = 20) {
  await ensureSearchReady();
  const data = await biliGet('/x/web-interface/wbi/search/type', {
    params: { search_type: 'video', keyword, page, page_size: pageSize },
    wbi: true,
  });
  const items = ((data && data.result) || []).map((it) => ({
    bvid: it.bvid || '',
    aid: it.aid || 0,
    title: stripEm(it.title),
    description: stripEm(it.description),
    author: it.author || '',
    mid: it.mid || 0,
    play: it.play || 0,
    durationText: it.duration || '',
    pic: it.pic || '',
    pubdate: it.pubdate || 0,
  }));
  return { items, total: (data && data.numResults) || 0 };
}

/**
 * 分类搜索：图文（专栏文章）。
 * @param {string} keyword
 * @param {number} [page=1] 页码（从 1 开始）
 * @param {number} [pageSize=20] 每页条数（≤50）
 * @returns {Promise<{items: Array, total: number}>}
 *   items: [{id, title, desc, author, mid, pic, publishTime, view, reply}]
 */
export async function searchArticles(keyword, page = 1, pageSize = 20) {
  await ensureSearchReady();
  const data = await biliGet('/x/web-interface/wbi/search/type', {
    params: { search_type: 'article', keyword, page, page_size: pageSize },
    wbi: true,
  });
  const items = ((data && data.result) || []).map((it) => ({
    id: it.id || 0,
    title: stripEm(it.title),
    desc: stripEm(it.desc),
    author: it.author || '',
    mid: it.mid || 0,
    pic: it.pic || it.banner_url || '',
    publishTime: it.publish_time || 0,
    view: it.view || 0,
    reply: it.reply || 0,
  }));
  return { items, total: (data && data.numResults) || 0 };
}
