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
 * api/nav.js —— 导航栏用户信息（含 WBI 密钥来源接口）
 *
 * GET /x/web-interface/nav
 * - 已登录：code=0，data.isLogin=true，含完整用户信息；
 * - 未登录：code=-101，data.wbi_img 仍可用（WBI 签名依赖此接口）。
 */

import { biliGet } from '../http.js';

/**
 * 获取当前登录用户信息。
 * @returns {Promise<{isLogin: boolean, mid: number, uname: string, face: string,
 *   level: number, money: number, vipStatus: number}>}
 *   未登录（-101）时返回 isLogin=false，其余字段为空值。
 */
export async function getUserInfo() {
  let data;
  try {
    data = await biliGet('/x/web-interface/nav');
  } catch (err) {
    if (err && err.code === -101) {
      return {
        isLogin: false,
        mid: 0,
        uname: '',
        face: '',
        level: 0,
        money: 0,
        vipStatus: 0,
      };
    }
    throw err;
  }
  return {
    isLogin: !!(data && data.isLogin),
    mid: (data && data.mid) || 0,
    uname: (data && data.uname) || '',
    face: (data && data.face) || '',
    level: (data && data.level_info && data.level_info.current_level) || 0,
    money: (data && data.money) || 0,
    vipStatus: (data && data.vipStatus) || 0,
  };
}
