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
 * api/article.js —— 专栏/图文详情（端点选型见 Task 2 调研结论）
 *
 * 选型与理由：
 * - 旧专栏（cv 号）：GET /x/article/view?id=（必须带 UA；type=0 返回 HTML
 *   正文，type=3 返回 JSON 富文本/opus 结构）；-352 为风控需重试。
 * - 新图文（opus）：GET /x/polymer/web-polymer/opus/detail?opus_id=
 *   （当前 web 端图文页使用，MODULE_TYPE_CONTENT.paragraphs 结构）；
 *   失败时降级 GET /x/polymer/web-dynamic/v1/detail?id=（动态详情，
 *   item 结构与动态列表一致，MAJOR_TYPE_OPUS/ARTICLE/DRAW）。
 * 统一归一化输出：{title, author, publishTime, textBlocks[], images[], source}。
 */

import { biliGet } from '../http.js';

const ENTITY_MAP = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

function decodeEntities(text) {
  return String(text || '').replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m) => ENTITY_MAP[m]);
}

/**
 * 解析旧专栏 HTML 正文为文本块与图片列表（轻量正则实现，不依赖 DOM）。
 * HTML 无原始尺寸，图片宽高记 0。
 * @param {string} html
 * @returns {{textBlocks: string[], images: Array<{url: string, width: number, height: number}>, blocks: Array}}
 */
function parseArticleHtml(html) {
  const textBlocks = [];
  const images = [];
  const blocks = [];
  const blockRe = /<(p|h[1-6]|blockquote|li|pre)[^>]*>([\s\S]*?)<\/\1>|<figure[^>]*>([\s\S]*?)<\/figure>/gi;
  let match;
  while ((match = blockRe.exec(html)) !== null) {
    const inner = match[2] !== undefined ? match[2] : match[3] || '';
    const imgRe = /<img[^>]+src=["']([^"']+)["']/gi;
    let img;
    while ((img = imgRe.exec(inner)) !== null) {
      images.push({ url: img[1], width: 0, height: 0 });
      blocks.push({ type: 'image', url: img[1], width: 0, height: 0 });
    }
    const text = decodeEntities(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim();
    if (text) {
      textBlocks.push(text);
      blocks.push({ type: 'text', text });
    }
  }
  if (images.length === 0) {
    const imgRe = /<img[^>]+src=["']([^"']+)["']/gi;
    let img;
    while ((img = imgRe.exec(html)) !== null) {
      images.push({ url: img[1], width: 0, height: 0 });
      blocks.push({ type: 'image', url: img[1], width: 0, height: 0 });
    }
  }
  return { textBlocks, images, blocks };
}

function parseParagraphs(paragraphs, out) {
  (paragraphs || []).forEach((para) => {
    if (!para) return;
    const paraType = para.para_type;
    if (paraType === 1 || paraType === 4) {
      const nodes = (para.text && para.text.nodes) || [];
      const text = nodes
        .map((node) => {
          if (node && node.word && node.word.words) return node.word.words;
          if (node && node.rich && node.rich.text) return node.rich.text;
          return '';
        })
        .join('')
        .trim();
      if (text) {
        const decoded = decodeEntities(text);
        out.textBlocks.push(decoded);
        out.blocks.push({ type: 'text', text: decoded });
      }
    } else if (paraType === 2) {
      const pics = (para.pics && para.pics.pictures) || [];
      pics.forEach((pic) => {
        if (pic && pic.url) {
          const item = { url: pic.url, width: pic.width || 0, height: pic.height || 0 };
          out.images.push(item);
          out.blocks.push({ type: 'image', url: item.url, width: item.width, height: item.height });
        }
      });
    }
  });
}

function parseArticleContent(data) {
  const out = { textBlocks: [], images: [], blocks: [] };
  if (typeof data.content === 'string' && data.content.indexOf('<') !== -1) {
    const parsed = parseArticleHtml(data.content);
    out.textBlocks = parsed.textBlocks;
    out.images = parsed.images;
    out.blocks = parsed.blocks;
    return out;
  }
  if (data.opus && data.opus.module_content) {
    parseParagraphs(data.opus.module_content.paragraphs, out);
    return out;
  }
  if (typeof data.content === 'string' && data.content) {
    try {
      const json = JSON.parse(data.content);
      (json.ops || []).forEach((op) => {
        if (!op) return;
        if (typeof op.insert === 'string') {
          const text = op.insert.trim();
          if (text) {
            const decoded = decodeEntities(text);
            out.textBlocks.push(decoded);
            out.blocks.push({ type: 'text', text: decoded });
          }
        } else if (op.insert && typeof op.insert === 'object') {
          Object.keys(op.insert).forEach((k) => {
            const v = op.insert[k];
            if (typeof v === 'string' && /^https?:\/\//.test(v)) {
              out.images.push({ url: v, width: 0, height: 0 });
              out.blocks.push({ type: 'image', url: v, width: 0, height: 0 });
            }
          });
        }
      });
      return out;
    } catch (err) {
      // 非 JSON 按纯文本处理
    }
    const plain = decodeEntities(data.content);
    out.textBlocks.push(plain);
    out.blocks.push({ type: 'text', text: plain });
  }
  return out;
}

function isOpusId(idOrOpusId) {
  const str = String(idOrOpusId);
  if (/^opus/i.test(str)) return true;
  const num = Number(str);
  return !isNaN(num) && num >= 1e15;
}

async function fetchArticleDetail(cvId) {
  const data = await biliGet('/x/article/view', { params: { id: cvId } });
  const content = parseArticleContent(data);
  return {
    title: data.title || '',
    author: {
      name: (data.author && data.author.name) || '',
      mid: (data.author && data.author.mid) || 0,
      face: (data.author && data.author.face) || '',
    },
    publishTime: data.publish_time || 0,
    textBlocks: content.textBlocks,
    images: content.images,
    blocks: content.blocks,
    source: 'article',
  };
}

async function fetchOpusDetail(opusId) {
  let item = null;
  try {
    const data = await biliGet('/x/polymer/web-polymer/opus/detail', {
      params: {
        opus_id: opusId,
        features: 'itemOpusStyle,opusBigCover',
      },
    });
    item = data && data.item;
  } catch (err) {
    item = null;
  }
  if (!item) {
    const data = await biliGet('/x/polymer/web-dynamic/v1/detail', {
      params: { id: opusId },
    });
    item = data && data.item;
  }
  if (!item) {
    const err = new Error('opus detail unavailable');
    err.code = -3;
    throw err;
  }

  const modules = item.modules || [];
  const out = {
    title: '',
    author: { name: '', mid: 0, face: '' },
    publishTime: 0,
    textBlocks: [],
    images: [],
    blocks: [],
  };

  const getModule = (type) =>
    Array.isArray(modules)
      ? modules.find((m) => m && m.module_type === type)
      : null;

  const authorModule = getModule('MODULE_TYPE_AUTHOR');
  if (authorModule && authorModule.module_author) {
    const a = authorModule.module_author;
    out.author = {
      name: a.name || '',
      mid: a.mid || 0,
      face: a.face || '',
    };
    out.publishTime = a.pub_ts || 0;
  }

  const dynModule = getModule('MODULE_TYPE_DYNAMIC');
  const dyn =
    (dynModule && dynModule.module_dynamic) ||
    (!Array.isArray(modules) ? modules.module_dynamic : null);
  const major = (dyn && dyn.major) || null;
  const contentModule = getModule('MODULE_TYPE_CONTENT');
  if (contentModule && contentModule.module_content) {
    parseParagraphs(contentModule.module_content.paragraphs, out);
  }
  if (major && major.archive) {
    out.title = major.archive.title || '';
  } else if (major && major.opus) {
    out.title = major.opus.title || '';
    const opusText = major.opus.text || '';
    if (opusText && out.textBlocks.length === 0) {
      opusText.split('\n').forEach((line) => {
        if (line.trim()) {
          out.textBlocks.push(line.trim());
          out.blocks.push({ type: 'text', text: line.trim() });
        }
      });
    }
    (major.opus.pics || []).forEach((pic) => {
      if (pic && pic.url) {
        const item = { url: pic.url, width: pic.width || 0, height: pic.height || 0 };
        out.images.push(item);
        out.blocks.push({ type: 'image', url: item.url, width: item.width, height: item.height });
      }
    });
  } else if (major && major.article) {
    out.title = major.article.title || '';
    (major.article.covers || []).forEach((cover) => {
      if (cover) {
        out.images.push({ url: cover, width: 0, height: 0 });
        out.blocks.push({ type: 'image', url: cover, width: 0, height: 0 });
      }
    });
  } else if (major && major.draw) {
    ((major.draw.items) || []).forEach((d) => {
      if (d && d.src) {
        const item = { url: d.src, width: d.width || 0, height: d.height || 0 };
        out.images.push(item);
        out.blocks.push({ type: 'image', url: item.url, width: item.width, height: item.height });
      }
    });
  }
  const dynText = (dyn && dyn.desc && dyn.desc.text) || '';
  if (dynText && out.textBlocks.length === 0) {
    dynText.split('\n').forEach((line) => {
      if (line.trim()) {
        out.textBlocks.push(line.trim());
        out.blocks.push({ type: 'text', text: line.trim() });
      }
    });
  }
  out.source = 'opus';
  return out;
}

/**
 * 获取专栏/图文详情（自动识别 cv 号与 opus 号）。
 * @param {string|number} idOrOpusId cv 号（旧专栏）或 opus/动态 id（新图文）
 * @returns {Promise<{title: string, author: {name: string, mid: number, face: string},
 *   publishTime: number, textBlocks: string[],
 *   images: Array<{url: string, width: number, height: number}>,
 *   blocks: Array<{type: 'text', text: string}|{type: 'image', url: string, width: number, height: number}>,
 *   source: 'article'|'opus'}>}
 */
export async function getArticleDetail(idOrOpusId) {
  if (isOpusId(idOrOpusId)) {
    return fetchOpusDetail(String(idOrOpusId).replace(/^opus/i, ''));
  }
  return fetchArticleDetail(idOrOpusId);
}
