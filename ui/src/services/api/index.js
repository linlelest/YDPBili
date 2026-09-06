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
 * api/index.js —— B 站业务 API 统一出口
 */

export { getUserInfo } from './nav.js';
export { getRecommendFeed } from './recommend.js';
export { ensureSearchReady, searchAll, searchVideos, searchArticles, stripEm } from './search.js';
export { getVideoDetail, getRelated, getPlayUrl } from './video.js';
export { getArticleDetail } from './article.js';
export { getDynamicFeed, normalizeDynamicItem } from './dynamic.js';
export { getHistory } from './history.js';
