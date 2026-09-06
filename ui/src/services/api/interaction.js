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
 * api/interaction.js —— 视频互动（点赞 / 投币 / 关注）
 *
 * 接口结论（已按 bilibili-API-collect 文档核实）：
 * - 点赞:POST /x/web-interface/archive/like,正文 aid|bvid 二选一 + like(1 点赞/2 取消赞) + csrf,
 *   仅 Cookie(SESSDATA);返回仅 {code,message,ttl};
 *   错误码 -101 未登录 / -111 csrf / 10003 稿件不存在 / 65004 取消点赞失败 / 65006 重复点赞。
 * - 投币:POST /x/web-interface/coin/add,正文 aid|bvid 二选一 + multiply(上限 2) +
 *   select_like(0/1,默认 0) + csrf;返回 data {like:bool}(附加点赞是否成功);
 *   错误码 -104 硬币不足 / 34002 不能给自己投币 / 34003 非法数量 / 34004 间隔太短 / 34005 超上限。
 * - 关注:POST /x/relation/modify,正文 fid + act + re_src(11) + csrf,需 Cookie;
 *   act 语义:1 公开关注 / 2 取消公开关注 / 3 悄悄关注 / 4 取消悄悄关注 / 5 拉黑 / 6 取消拉黑 / 7 移除粉丝;
 *   返回 {code,message,ttl}(无 data)。
 * - 状态查询(均 GET,Cookie 或 APP 鉴权,本模块走 Cookie):
 *   has/like → data 为数字 0/1(注意仅反映"近期"点赞,历史点赞可能回 0);
 *   archive/coins → data {multiply:num},multiply 为当前用户对该稿件的投币枚数(未投币 0,上限 2);
 *   /x/relation?fid= → data 关系对象 {mid,attribute,mtime,tag,special},无 is_following 字段,
 *   attribute:0 未关注 / 2 已关注 / 6 已互粉 / 128 已拉黑(1 悄悄关注已下线),
 *   判定已关注 = attribute∈{2,6}(同时兼容 is_following/following 数值字段以防接口形态变化)。
 */

import { biliGet, biliPost, BiliApiError } from '../http.js';
import { getSession } from '../auth.js';

const LIKE_PATH = '/x/web-interface/archive/like';
const COIN_ADD_PATH = '/x/web-interface/coin/add';
const HAS_LIKE_PATH = '/x/web-interface/archive/has/like';
const COINS_PATH = '/x/web-interface/archive/coins';
const RELATION_PATH = '/x/relation';
const RELATION_MODIFY_PATH = '/x/relation/modify';

const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';

/** aid/bvid 二选一参数:优先 aid,均缺失抛参数错误。 */
function pickIdParams(opts) {
  const aid = Number(opts.aid) || 0;
  const bvid = String(opts.bvid || '').trim();
  if (aid) return { aid };
  if (bvid) return { bvid };
  throw new BiliApiError(-3, '缺少稿件 aid/bvid');
}

/** 写操作统一取会话;未登录抛 BiliApiError(-101)。 */
async function requireSession() {
  const session = await getSession();
  if (!session || !session.SESSDATA || !session.bili_jct) {
    throw new BiliApiError(-101, '账号未登录,请先登录');
  }
  return session;
}

/** 仅判断 Cookie 是否存在(状态查询不需要 bili_jct)。 */
async function hasCookie() {
  try {
    const session = await getSession();
    return !!(session && session.SESSDATA);
  } catch (err) {
    return false;
  }
}

function formBody(idParams, fields) {
  const parts = Object.keys(idParams).map(
    (k) => k + '=' + encodeURIComponent(String(idParams[k]))
  );
  (fields || []).forEach((f) => parts.push(f));
  return parts.join('&');
}

/**
 * 查询当前用户是否已点赞该视频(近期语义)。
 * @param {Object} options {aid, bvid}
 * @returns {Promise<boolean>} 未登录直接返回 false 不抛错
 */
export async function hasLiked(options) {
  const params = pickIdParams(options || {});
  if (!(await hasCookie())) return false;
  const data = await biliGet(HAS_LIKE_PATH, { params });
  return Number(data) === 1;
}

/**
 * 查询当前用户对该稿件的已投币枚数。
 * @param {Object} options {aid, bvid}
 * @returns {Promise<number>} 未登录直接返回 0 不抛错;上限 2
 */
export async function getCoinsInfo(options) {
  const params = pickIdParams(options || {});
  if (!(await hasCookie())) return 0;
  const data = await biliGet(COINS_PATH, { params });
  const coins = Number(data && data.multiply);
  return Number.isFinite(coins) && coins > 0 ? coins : 0;
}

/**
 * 查询当前用户对目标用户的关注状态。
 * @param {number|string} mid 目标用户 mid
 * @returns {Promise<boolean>} 未登录直接返回 false 不抛错
 */
export async function getFollowState(mid) {
  const target = Number(mid) || 0;
  if (!target) throw new BiliApiError(-3, '缺少用户 mid');
  if (!(await hasCookie())) return false;
  const data = await biliGet(RELATION_PATH, { params: { fid: target } });
  const rel = data || {};
  if (rel.is_following !== undefined) {
    return rel.is_following === true || Number(rel.is_following) === 1;
  }
  if (rel.following !== undefined) return Number(rel.following) === 1;
  const attribute = Number(rel.attribute) || 0;
  return attribute === 2 || attribute === 6;
}

/**
 * 点赞 / 取消点赞。
 * @param {Object} options {aid, bvid, on=true} on=false 为取消点赞
 * @returns {Promise<{liked: boolean}>}
 */
export async function likeVideo(options) {
  const opts = options || {};
  const idParams = pickIdParams(opts);
  const session = await requireSession();
  const like = opts.on === false ? 2 : 1;
  await biliPost(LIKE_PATH, {
    headers: { 'Content-Type': FORM_CONTENT_TYPE },
    body: formBody(idParams, ['like=' + like, 'csrf=' + encodeURIComponent(session.bili_jct)]),
  });
  return { liked: like === 1 };
}

/**
 * 投币(不触发一键三连;select_like 默认 false,仅投币)。
 * @param {Object} options {aid, bvid, multiply=1, selectLike=false}
 * @returns {Promise<{multiply: number, liked: boolean}>} liked 为附加点赞是否成功
 */
export async function coinVideo(options) {
  const opts = options || {};
  const idParams = pickIdParams(opts);
  const session = await requireSession();
  const multiply = Number(opts.multiply) === 2 ? 2 : 1;
  const selectLike = opts.selectLike === true ? 1 : 0;
  const data = await biliPost(COIN_ADD_PATH, {
    headers: { 'Content-Type': FORM_CONTENT_TYPE },
    body: formBody(idParams, [
      'multiply=' + multiply,
      'select_like=' + selectLike,
      'csrf=' + encodeURIComponent(session.bili_jct),
    ]),
  });
  return { multiply, liked: !!(data && data.like) };
}

/**
 * 关注 / 取消关注(relation/modify act=1 关注,act=2 取消关注)。
 * @param {number|string} mid 目标用户 mid
 * @param {boolean} [follow=true]
 * @returns {Promise<{followed: boolean}>}
 */
export async function followUser(mid, follow = true) {
  const target = Number(mid) || 0;
  if (!target) throw new BiliApiError(-3, '缺少用户 mid');
  const session = await requireSession();
  const act = follow === false ? 2 : 1;
  await biliPost(RELATION_MODIFY_PATH, {
    headers: { 'Content-Type': FORM_CONTENT_TYPE },
    body: formBody(
      { fid: target },
      ['act=' + act, 're_src=11', 'csrf=' + encodeURIComponent(session.bili_jct)]
    ),
  });
  return { followed: follow !== false };
}
