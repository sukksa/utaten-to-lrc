import * as cheerio from 'cheerio';

const LYRIC_PATH = /^\/lyric\/[A-Za-z0-9_-]+\/?$/;
const ARTIST_PATH = /\/artist\/(?:lyric\/)?\d+/;

const clean = (s = '') => s.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();

function absolutize(href, base) {
  if (!href) return '';
  try {
    return new URL(href, base).toString();
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* 搜索结果页                                                          */
/* ------------------------------------------------------------------ */

/**
 * 解析 https://utaten.com/search/ 的结果列表。
 * 不依赖具体 class：按文档顺序扫描 /lyric/ 与 /artist/ 链接，
 * 同一首歌通常出现两次（标题链接 + 歌い出し片段链接），取短文本作标题。
 */
export function parseSearchPage(html, { base, page = 1 } = {}) {
  const $ = cheerio.load(html);

  const anchors = [];
  $('a').each((i, el) => {
    anchors.push({
      index: i,
      href: absolutize($(el).attr('href'), base),
      text: clean($(el).text())
    });
  });

  const groups = new Map();
  for (const a of anchors) {
    if (!a.href || !LYRIC_PATH.test(new URL(a.href).pathname)) continue;
    const key = new URL(a.href).pathname.replace(/\/$/, '');
    if (!groups.has(key)) {
      groups.set(key, { key, url: a.href, firstIndex: a.index, lastIndex: a.index, texts: [] });
    }
    const g = groups.get(key);
    g.lastIndex = a.index;
    if (a.text) g.texts.push(a.text);
  }

  const list = [...groups.values()];
  const results = [];

  for (let i = 0; i < list.length; i++) {
    const g = list[i];
    if (!g.texts.length) continue;

    const sorted = [...g.texts].sort((x, y) => x.length - y.length);
    const title = sorted[0];
    const snippet = sorted[sorted.length - 1] !== title ? sorted[sorted.length - 1] : '';

    // 歌手：标题与下一条结果之间的第一个 /artist/ 链接
    const nextStart = list[i + 1]?.firstIndex ?? Infinity;
    const artistAnchor = anchors.find(
      (a) => a.index > g.firstIndex && a.index < Math.min(g.lastIndex + 40, nextStart) && ARTIST_PATH.test(a.href)
    );

    results.push({
      id: g.key.split('/').pop(),
      url: g.url,
      title,
      artist: artistAnchor?.text || '',
      artistUrl: artistAnchor?.href || '',
      snippet: snippet === title ? '' : snippet
    });
  }

  // 翻页：站点用的是 /search/=/.../page=2/ 这种路径式地址，页码不在查询串里
  let nextPage = null;
  $('a[href*="page="]').each((_, el) => {
    const href = absolutize($(el).attr('href'), base);
    if (!href) return;
    const m = href.match(/[?&/]page=(\d+)/);
    if (!m) return;
    const p = Number(m[1]);
    if (p > page && (nextPage === null || p < nextPage)) nextPage = p;
  });

  return { results, nextPage };
}

/* ------------------------------------------------------------------ */
/* 歌词详情页                                                          */
/* ------------------------------------------------------------------ */

function findTitleNode($) {
  const candidates = [
    'h2.newLyricTitle__main',
    'h1',
    'h2'
  ];
  for (const sel of candidates) {
    const nodes = $(sel).filter((_, el) => /歌詞/.test($(el).text()));
    if (nodes.length) return nodes.first();
  }
  return $('h2').first();
}

/** 在 scope 内查找「作詞 / 作曲 / 編曲」标签后面跟的值 */
function labelValue($, scope, label) {
  let value = '';
  scope.find('*').each((_, el) => {
    if (value) return;
    const $el = $(el);
    if ($el.children().length) return;
    if (clean($el.text()).replace(/[：:]/g, '') !== label) return;
    const next = $el.next();
    const raw = next.length ? next.text() : $el.parent().next().text();
    const v = clean(raw);
    if (v && v !== label) value = v;
  });
  return value;
}

function regexValue(text, label) {
  const re = new RegExp(
    `${label}\\s*[：:]?\\s*([\\s\\S]*?)(?=\\s*(?:作詞|作曲|編曲|文字サイズ|ふりがな|ダークモード|\\d{4}\\.\\d{1,2}\\.\\d{1,2})|$)`
  );
  const m = text.match(re);
  return m ? clean(m[1]) : '';
}

function metaFromDom($, scope, label) {
  const byLabel = labelValue($, scope, label);
  if (byLabel) return byLabel;
  return regexValue(clean(scope.text()), label);
}

/**
 * 把 div.hiragana 拆成逐行结构，并保留 ruby 注音的位置。
 * 输出：{ lines: [{ text, tokens: [{ index, base, rt }] }] }
 */
export function extractLines($, root) {
  const lines = [];
  let cur = { text: '', tokens: [] };

  const pushLine = () => {
    lines.push({ text: cur.text.replace(/[ \t]+$/, ''), tokens: cur.tokens });
    cur = { text: '', tokens: [] };
  };

  const addText = (raw) => {
    let t = String(raw).replace(/\r/g, '').replace(/\n/g, '');
    if (!t) return;
    if (!cur.text) t = t.replace(/^[ \t]+/, '');
    cur.text += t;
  };

  const walk = (node) => {
    $(node)
      .contents()
      .each((_, child) => {
        if (child.type === 'text') return addText(child.data);
        const name = child.name;
        if (name === 'br') return pushLine();
        if (name === 'script' || name === 'style') return;

        const $child = $(child);
        if (name === 'span' && ($child.hasClass('ruby') || $child.has('.rt').length)) {
          const base = clean($child.find('.rb').first().text()) || clean($child.children().first().text());
          const rt = clean($child.find('.rt').first().text());
          if (base) {
            const index = cur.text.length;
            cur.text += base;
            if (rt) cur.tokens.push({ index, base, rt });
            return;
          }
        }
        walk(child);
      });
  };

  walk(root);
  pushLine();

  // 去掉首尾空行，多个连续空行合并成一个
  while (lines.length && !lines[0].text) lines.shift();
  while (lines.length && !lines[lines.length - 1].text) lines.pop();

  const merged = [];
  for (const line of lines) {
    const prev = merged[merged.length - 1];
    if (!line.text && prev && !prev.text) continue;
    merged.push(line);
  }
  return merged.length ? merged : null;
}

export function parseLyricPage(html, { url, base }) {
  const $ = cheerio.load(html);

  // ---- 标题 / 副标题 ----
  const titleNode = findTitleNode($);
  let rawTitle = clean(titleNode.text()) || clean($('meta[property="og:title"]').attr('content') || '');
  rawTitle = rawTitle.replace(/\s*[-|｜]\s*うたてん\s*$/, '').replace(/\s*ふりがな付\s*$/, '');

  let title = rawTitle;
  let subtitle = '';
  const m = rawTitle.match(/^(.*?)\s*歌詞\s*(.*)$/);
  if (m) {
    title = clean(m[1]);
    subtitle = clean(m[2]);
  }

  // ---- 歌手 ----
  let artist = '';
  let artistUrl = '';
  let scope = titleNode.length ? titleNode.closest('div, section, header') : $('body');
  for (let i = 0; i < 5 && scope.length; i++) {
    const link = scope
      .find('a[href*="/artist/"]')
      .filter((_, el) => ARTIST_PATH.test($(el).attr('href') || '') && clean($(el).text()))
      .first();
    if (link.length) {
      artist = clean(link.text());
      artistUrl = absolutize(link.attr('href'), base);
      break;
    }
    scope = scope.parent();
  }

  // ---- 作詞 / 作曲 / 編曲 / 发行日 ----
  let infoScope = titleNode.length ? titleNode.closest('div, section') : $('body');
  for (let i = 0; i < 4 && infoScope.length && !/作詞/.test(infoScope.text()); i++) {
    infoScope = infoScope.parent();
  }
  if (!infoScope.length) infoScope = $('body');

  const lyricist = metaFromDom($, infoScope, '作詞');
  const composer = metaFromDom($, infoScope, '作曲');
  const arranger = metaFromDom($, infoScope, '編曲');

  const dateMatch = clean(infoScope.text()).match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  const releaseDate = dateMatch
    ? `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}`
    : '';

  // ---- 歌词正文 ----
  const container = $('div.hiragana').first();
  const fallback = container.length ? null : $('.lyricBody, #kashi_area, .hiragana').first();
  const lines = extractLines($, container.length ? container : fallback);

  if (!lines) {
    const err = new Error('未能从页面中定位歌词正文（可能是页面结构变化或被拦截）');
    err.status = 502;
    throw err;
  }

  return {
    id: new URL(url).pathname.split('/').filter(Boolean).pop(),
    url,
    title,
    subtitle,
    artist,
    artistUrl,
    lyricist,
    composer,
    arranger,
    releaseDate,
    lines,
    plain: lines.map((l) => l.text).join('\n'),
    ruby: toRubyText(lines)
  };
}

/** 把行结构还原成「汉字(かんじ)」形式的纯文本 */
export function toRubyText(lines) {
  return lines
    .map((line) => {
      if (!line.tokens?.length) return line.text;
      let out = '';
      let cursor = 0;
      for (const t of line.tokens) {
        if (t.index < cursor) continue;
        out += line.text.slice(cursor, t.index) + t.base + `(${t.rt})`;
        cursor = t.index + t.base.length;
      }
      return out + line.text.slice(cursor);
    })
    .join('\n');
}
