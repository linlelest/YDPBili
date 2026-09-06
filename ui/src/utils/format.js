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
 * utils/format.js —— 展示格式化工具
 */

/** 秒数 → "mm:ss" / "h:mm:ss"。 */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
}

/** 播放量/阅读量 → "1.2万" / "3.4亿"。 */
export function formatCount(num) {
  const n = Number(num) || 0;
  if (n >= 1e8) return trimZero((n / 1e8).toFixed(1)) + '亿';
  if (n >= 1e4) return trimZero((n / 1e4).toFixed(1)) + '万';
  return String(n);
}

function trimZero(text) {
  return String(text).replace(/\.0$/, '');
}

/** "mm:ss" 文本时长（搜索/动态接口直接给字符串）原样返回，空值兜底。 */
export function formatDurationText(text) {
  return String(text || '').trim() || '--:--';
}

/** UNIX 秒级时间戳 → "YYYY-MM-DD"。 */
export function formatDate(timestamp) {
  const ts = Number(timestamp) || 0;
  if (ts <= 0) return '';
  const d = new Date(ts * 1000);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}
