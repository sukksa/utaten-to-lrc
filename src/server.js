import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import config from './config.js';
import { cache, fetchHtml } from './fetcher.js';
import { setupProxy } from './proxy.js';
import { parseLyricPage, parseSearchPage } from './parse.js';
import { safeFileName, toFuriganaText, toJson, toPlainText } from './format.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const SEARCH_TYPES = new Set(['all', 'artist', 'title', 'body']);
const PARAM_BY_TYPE = { artist: 'artist_name', title: 'title', body: 'body' };

function searchUrl(query, type, page) {
  const params = new URLSearchParams();
  params.set('sort', 'popular_sort_asc'); // 缺少该参数会返回默认榜单
  params.set('show_artists', '1');
  params.set(PARAM_BY_TYPE[type], query);
  if (page > 1) params.set('page', String(page)); // 站点同时接受 ?page= 与路径式 page=2
  return `${config.base}/search/?${params}`;
}

async function searchOne(query, type, page) {
  const key = `search:${type}:${query}:${page}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const html = await fetchHtml(searchUrl(query, type, page));
  const parsed = parseSearchPage(html, { base: config.base, page });
  cache.set(key, parsed, config.cacheTtlMs.search);
  return parsed;
}

app.get('/api/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const type = SEARCH_TYPES.has(String(req.query.type)) ? String(req.query.type) : 'all';
    const page = Math.max(1, Number(req.query.page) || 1);

    if (!q) return res.status(400).json({ error: '请输入关键词' });
    if (q.length > 80) return res.status(400).json({ error: '关键词过长' });

    let payload;
    if (type === 'all') {
      // 综合：歌手 + 曲名各查一次，歌手结果优先，去重后合并
      const [byArtist, byTitle] = await Promise.all([
        searchOne(q, 'artist', page).catch((e) => ({ results: [], error: e })),
        searchOne(q, 'title', page).catch((e) => ({ results: [], error: e }))
      ]);
      if (byArtist.error && byTitle.error) throw byArtist.error;

      const seen = new Set();
      const results = [];
      for (const item of [...(byArtist.results || []), ...(byTitle.results || [])]) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        results.push(item);
      }
      payload = { results, nextPage: byTitle.nextPage ?? byArtist.nextPage ?? null };
    } else {
      payload = await searchOne(q, type, page);
    }

    res.json({ query: q, type, page, count: payload.results.length, ...payload });
  } catch (err) {
    next(err);
  }
});

function normalizeLyricUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    const err = new Error('缺少歌词地址或 id');
    err.status = 400;
    throw err;
  }

  let url;
  if (/^[A-Za-z0-9_-]{4,}$/.test(raw)) {
    url = new URL(`/lyric/${raw}/`, config.base);
  } else {
    url = new URL(raw, config.base);
  }

  const baseHost = new URL(config.base).host;
  if (url.host !== baseHost) {
    const err = new Error('只支持 utaten.com 的歌词页');
    err.status = 400;
    throw err;
  }
  if (!/^\/lyric\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
    const err = new Error('不是有效的歌词页地址');
    err.status = 400;
    throw err;
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function getLyric(input) {
  const url = normalizeLyricUrl(input);
  const key = `lyric:${url}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const html = await fetchHtml(url);
  const lyric = parseLyricPage(html, { url, base: config.base });
  cache.set(key, lyric, config.cacheTtlMs.lyric);
  return lyric;
}

app.get('/api/lyric', async (req, res, next) => {
  try {
    const lyric = await getLyric(req.query.id || req.query.url);
    res.json(lyric);
  } catch (err) {
    next(err);
  }
});

app.get('/api/download', async (req, res, next) => {
  try {
    const format = String(req.query.format || 'txt');
    const lyric = await getLyric(req.query.id || req.query.url);

    let body;
    let ext;
    if (format === 'json') {
      body = toJson(lyric);
      ext = 'json';
    } else if (format === 'furigana') {
      body = toFuriganaText(lyric);
      ext = 'txt';
    } else {
      body = toPlainText(lyric);
      ext = 'txt';
    }

    const fileName = safeFileName(lyric, ext);
    const asciiName = `${lyric.id}.${ext}`;
    res.setHeader('Content-Type', format === 'json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
    res.send(body);
  } catch (err) {
    next(err);
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, base: config.base }));

app.use((err, req, res, next) => {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error('[error]', err.message);
  res.status(status).json({ error: err.message || '服务器内部错误' });
});

app.listen(config.port, async () => {
  const proxy = await setupProxy();
  console.log(`\n  UtaTen 歌词下载器已启动：http://localhost:${config.port}`);
  console.log(`  数据源：${config.base}${proxy ? `（代理 ${proxy}）` : ''}\n`);
});
