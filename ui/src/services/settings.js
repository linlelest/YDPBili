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
 * settings.js —— 应用设置读写
 *
 * storage key `bilibili_settings`，浅合并默认值；解析 decoder 选项集合
 * （auto/system/ffmpeg/audio_only，与 Task 1 决策的降级链一致）。
 */

import { storageGet, storageSet } from './env.js';

export const SETTINGS_KEY = 'bilibili_settings';

export const DEFAULT_SETTINGS = {
  videoQuality: 32,
  playbackRate: 1.0,
  decoder: 'auto',
};

export const DECODER_OPTIONS = ['auto', 'system', 'ffmpeg', 'audio_only'];

export const QUALITY_OPTIONS = [16, 32, 64, 80];

export const PLAYBACK_RATE_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

/**
 * 读取设置（浅合并默认值，非法 decoder 回退 auto）。
 * @returns {Promise<{videoQuality: number, playbackRate: number, decoder: string}>}
 */
export async function getSettings() {
  const stored = await storageGet(SETTINGS_KEY, null);
  const merged = Object.assign({}, DEFAULT_SETTINGS, stored || {});
  if (DECODER_OPTIONS.indexOf(merged.decoder) === -1) {
    merged.decoder = DEFAULT_SETTINGS.decoder;
  }
  if (typeof merged.videoQuality !== 'number') {
    merged.videoQuality = DEFAULT_SETTINGS.videoQuality;
  }
  if (typeof merged.playbackRate !== 'number') {
    merged.playbackRate = DEFAULT_SETTINGS.playbackRate;
  }
  return merged;
}

/**
 * 写入设置（浅合并）。
 * @param {Partial<{videoQuality: number, playbackRate: number, decoder: string}>} patch
 * @returns {Promise<Object>} 合并后的完整设置
 */
export async function setSettings(patch) {
  const current = await getSettings();
  const merged = Object.assign({}, current, patch || {});
  await storageSet(SETTINGS_KEY, merged);
  return merged;
}

/**
 * 解析 decoder 选项集合（供设置页 UI 使用）。
 * @returns {string[]}
 */
export function getDecoderOptions() {
  return DECODER_OPTIONS.slice();
}
