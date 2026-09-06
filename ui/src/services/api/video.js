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
 * api/video.js —— 视频详情 / 相关推荐 / 播放地址
 *
 * - 详情：GET /x/web-interface/view?bvid=
 * - 相关：GET /x/web-interface/archive/related?bvid=
 * - 取流：GET /x/player/wbi/playurl（WBI 签名；未登录 qn 上限 480，
 *   try_look=1 可试看；fnval=16 请求 DASH，fnval=1 请求 MP4 durl）
 */

import { biliGet } from '../http.js';

/**
 * 获取视频详情（含分 P 列表）。
 * @param {string} bvid
 * @returns {Promise<{aid: number, bvid: string, cid: number, title: string, desc: string,
 *   pubdate: number, duration: number, owner: {name: string, mid: number, face: string},
 *   stat: {view: number, danmaku: number, like: number, reply: number, favorite: number,
 *   coin: number, share: number}, pages: Array<{cid: number, part: string, duration: number}>}>}
 */
export async function getVideoDetail(bvid) {
  const data = await biliGet('/x/web-interface/view', { params: { bvid } });
  return {
    aid: data.aid || 0,
    bvid: data.bvid || bvid,
    cid: data.cid || 0,
    pic: data.pic || '',
    title: data.title || '',
    desc: data.desc || '',
    pubdate: data.pubdate || 0,
    duration: data.duration || 0,
    owner: {
      name: (data.owner && data.owner.name) || '',
      mid: (data.owner && data.owner.mid) || 0,
      face: (data.owner && data.owner.face) || '',
    },
    stat: {
      view: (data.stat && data.stat.view) || 0,
      danmaku: (data.stat && data.stat.danmaku) || 0,
      like: (data.stat && data.stat.like) || 0,
      reply: (data.stat && data.stat.reply) || 0,
      favorite: (data.stat && data.stat.favorite) || 0,
      coin: (data.stat && data.stat.coin) || 0,
      share: (data.stat && data.stat.share) || 0,
    },
    pages: (data.pages || []).map((p) => ({
      cid: p.cid,
      part: p.part || '',
      duration: p.duration || 0,
    })),
  };
}

/**
 * 获取相关推荐列表（最多 40 条）。
 * @param {string} bvid
 * @returns {Promise<Array<{aid: number, bvid: string, cid: number, title: string,
 *   pic: string, owner: {name: string, mid: number, face: string},
 *   stat: {view: number, danmaku: number}, duration: number}>>}
 */
export async function getRelated(bvid) {
  const data = await biliGet('/x/web-interface/archive/related', { params: { bvid } });
  return (data || []).map((it) => ({
    aid: it.aid || 0,
    bvid: it.bvid || '',
    cid: it.cid || 0,
    title: it.title || '',
    pic: it.pic || '',
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

/**
 * 获取播放地址。
 * @param {Object} options
 * @param {string} [options.bvid]
 * @param {number} [options.aid]
 * @param {number} options.cid 分 P 的 cid
 * @param {number} [options.qn=32] 期望清晰度（16/32/64/80）
 * @param {number} [options.fnval=16] 功能位（16=DASH；1=MP4）
 * @param {string} [options.platform='html5'] 平台标识
 * @param {boolean} [options.tryLook=false] 未登录试看（try_look=1）
 * @returns {Promise<{quality: number, acceptQuality: number[], timelength: number,
 *   durl: Array<{url: string, size: number, length: number}>,
 *   dash: null | {video: Array<{id: number, baseUrl: string, bandwidth: number, codecs: string}>,
 *   audio: Array<{id: number, baseUrl: string, bandwidth: number, codecs: string}>}}>}
 */
export async function getPlayUrl(options) {
  const opts = options || {};
  const params = {
    cid: opts.cid,
    qn: opts.qn || 32,
    fnval: opts.fnval === undefined ? 16 : opts.fnval,
    platform: opts.platform || 'html5',
  };
  if (opts.bvid) params.bvid = opts.bvid;
  if (opts.aid) params.aid = opts.aid;
  if (opts.tryLook) params.try_look = 1;

  const data = await biliGet('/x/player/wbi/playurl', { params, wbi: true });

  const dash =
    data.dash && (data.dash.video || data.dash.audio)
      ? {
          video: (data.dash.video || []).map((v) => ({
            id: v.id,
            baseUrl: v.base_url || (v.backup_url && v.backup_url[0]) || '',
            bandwidth: v.bandwidth || 0,
            codecs: v.codecs || '',
          })),
          audio: (data.dash.audio || []).map((a) => ({
            id: a.id,
            baseUrl: a.base_url || (a.backup_url && a.backup_url[0]) || '',
            bandwidth: a.bandwidth || 0,
            codecs: a.codecs || '',
          })),
        }
      : null;

  return {
    quality: data.quality || 0,
    acceptQuality: data.accept_quality || [],
    timelength: data.timelength || 0,
    durl: (data.durl || []).map((d) => ({
      url: d.url || (d.backup_url && d.backup_url[0]) || '',
      size: d.size || 0,
      length: d.length || 0,
    })),
    dash,
  };
}
