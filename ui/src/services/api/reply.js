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
 * api/reply.js —— 评论区列表 / 发送评论
 *
 * 列表选型:GET /x/v2/reply/main?type=1&oid={aid}&mode={3|2}&next={cursor}&ps=20
 *   - 游标分页:next 从 0 起;返回 data.cursor{is_end, next, all_count};
 *   - mode=3 按热度 / mode=2 按时间;ps 为每页条数上限(服务端按 20 处理);
 *   - 置顶评论在 data.top_replies[](无置顶时为 null);
 *   - 该接口为公开查询接口,无 WBI 签名要求,未登录可读公开评论区;
 *   - code=-404:oid/type 不匹配或评论区不可见。
 *   (旧接口 /x/v2/reply?pn=&sort= 为 pn 翻页,sort 0/1/2 与本页 mode 需求不符,弃用。)
 *
 * 发送:POST /x/v2/reply/add,正文 application/x-www-form-urlencoded
 *   body: type=1&oid={aid}&message={文本}&plat=1&csrf={bili_jct}[&root=&parent=]
 *   - csrf 取 getSession().bili_jct;未登录抛 BiliApiError(-101);
 *   - 成功返回 {rpid}(取 rpid_str 字串形态);
 *   - 常见错误码:12002/12052 评论区已关闭、12015 需要验证码、12016 敏感信息、
 *     12051 重复评论、12025 字数超限、-111 csrf 校验失败。
 */

import { biliGet, biliPost, BiliApiError } from '../http.js';
import { getSession } from '../auth.js';
import { formatDate } from '../../utils/format.js';

const REPLY_MAIN_PATH = '/x/v2/reply/main';
const REPLY_ADD_PATH = '/x/v2/reply/add';

/**
 * 游标缓存:key = `${aid}_${mode}`,value = { [page]: next 游标 }。
 * 第 1 页固定 next=0;请求第 page 页后把返回 cursor.next 记为第 page+1 页入参,
 * 使 getComments({aid, page, mode}) 的 page 语义可用(顺序翻页)。
 */
const cursorCache = new Map();

/** 单条评论 → 页面展示字段(ctime 秒转日期文案用 utils/format.js)。 */
function mapReply(r) {
  const reply = r || {};
  const member = reply.member || {};
  const ctime = Number(reply.ctime) || 0;
  return {
    rpid: String(reply.rpid_str || reply.rpid || ''),
    mid: Number(member.mid) || 0,
    uname: member.uname || '',
    face: member.avatar || '',
    level: (member.level_info && member.level_info.current_level) || 0,
    content: (reply.content && reply.content.message) || '',
    like: Number(reply.like) || 0,
    ctime,
    rcount: Number(reply.rcount) || 0,
    timeText: formatDate(ctime),
  };
}

/**
 * 拉取评论列表(游标分页)。
 * @param {Object} options {aid, page=1, mode=3, ps=20}
 * @returns {Promise<{items: Array, topItems: Array, total: number, isEnd: boolean, page: number}>}
 */
export async function getComments(options) {
  const opts = options || {};
  const aid = Number(opts.aid) || 0;
  if (!aid) throw new BiliApiError(-3, '缺少稿件 aid');
  const page = Math.max(1, Number(opts.page) || 1);
  const mode = Number(opts.mode) === 2 ? 2 : 3;
  const ps = Math.min(20, Math.max(1, Number(opts.ps) || 20));

  const cacheKey = aid + '_' + mode;
  let cursors = cursorCache.get(cacheKey);
  if (!cursors || page === 1) {
    cursors = { 1: '0' };
    cursorCache.set(cacheKey, cursors);
  }
  const cursor = cursors[page] !== undefined ? cursors[page] : '0';

  const data = await biliGet(REPLY_MAIN_PATH, {
    params: { type: 1, oid: aid, mode, next: cursor, ps },
  });

  const replies = Array.isArray(data && data.replies) ? data.replies : [];
  const topReplies = Array.isArray(data && data.top_replies) ? data.top_replies : [];
  const cursorObj = (data && data.cursor) || {};
  const nextCursor =
    cursorObj.next === 0 || cursorObj.next ? String(cursorObj.next) : cursor;
  if (cursors[page + 1] === undefined) cursors[page + 1] = nextCursor;

  const allCount = Number(cursorObj.all_count);
  const total = Number.isFinite(allCount) && allCount > 0
    ? allCount
    : Number(data && data.page && data.page.acount) || 0;

  return {
    items: replies.map(mapReply),
    topItems: topReplies.map(mapReply),
    total,
    isEnd: cursorObj.is_end === true,
    page,
  };
}

/**
 * 发送评论(一级评论,或携带 root/parent 的楼中楼回复)。
 * @param {Object} options {aid, message, root?, parent?}
 * @returns {Promise<{rpid: string}>} code=0 时返回新评论 rpid
 */
export async function addComment(options) {
  const opts = options || {};
  const aid = Number(opts.aid) || 0;
  const message = String(opts.message || '').trim();
  if (!aid) throw new BiliApiError(-3, '缺少稿件 aid');
  if (!message) throw new BiliApiError(-3, '评论内容不能为空');
  if (message.length > 1000) throw new BiliApiError(12025, '评论字数过多(上限 1000 字)');

  const session = await getSession();
  if (!session || !session.SESSDATA || !session.bili_jct) {
    throw new BiliApiError(-101, '账号未登录,请先登录');
  }

  const parts = [
    'type=1',
    'oid=' + encodeURIComponent(String(aid)),
    'message=' + encodeURIComponent(message),
    'plat=1',
    'csrf=' + encodeURIComponent(session.bili_jct),
  ];
  if (opts.root) parts.push('root=' + encodeURIComponent(String(opts.root)));
  if (opts.parent) parts.push('parent=' + encodeURIComponent(String(opts.parent)));

  const data = await biliPost(REPLY_ADD_PATH, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: parts.join('&'),
  });
  return { rpid: String((data && (data.rpid_str || data.rpid)) || '') };
}
