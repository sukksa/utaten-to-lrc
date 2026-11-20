#!/usr/bin/env node
/**
 * 从 UtaTen 歌词页导出 uta-annotated-lyrics JSON 与对照 TXT。
 * 与 assets/utaten_lyrics.py 的输出格式完全一致，只是换成 Node 实现。
 *
 *   node scripts/utaten-lyrics.mjs 'https://utaten.com/lyric/ym23010406/' --output '.tools/utaten/星座になれたら'
 *   node scripts/utaten-lyrics.mjs 'https://utaten.com/lyric/ym23010406/' --html saved.html --output out/测试
 *
 * 输出：<output>.uta-lyrics.json 与 <output>.txt；省略 --output 时只打印统计。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

import { setupProxy } from '../src/proxy.js';

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_HOSTS = new Set(['utaten.com', 'www.utaten.com']);
const USER_AGENT = 'UTA-Lyrics-Research/1.2 (single-page compatibility check)';

/* ------------------------------------------------------------------ */
/* URL 校验                                                            */
/* ------------------------------------------------------------------ */

function validateUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('请输入 https://utaten.com/lyric/歌曲编号/ 形式的歌词页网址。');
  }
  const ok =
    url.protocol === 'https:' &&
    ALLOWED_HOSTS.has(url.hostname) &&
    !url.username &&
    !url.password &&
    !url.port &&
    !url.search &&
    !url.hash &&
    /^\/lyric\/[A-Za-z0-9]+\/$/.test(url.pathname);

  if (!ok) throw new Error('请输入 https://utaten.com/lyric/歌曲编号/ 形式的歌词页网址。');
  return url.toString();
}

/* ------------------------------------------------------------------ */
/* 抓取（手动跟随重定向，逐跳校验目标）                                  */
/* ------------------------------------------------------------------ */

async function fetchPage(input) {
  let url = validateUrl(input);

  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(25000),
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error('网站返回了无法跟随的重定向。');
      url = validateUrl(new URL(location, url).toString());
      continue;
    }
    if (!res.ok) throw new Error(`网站返回 ${res.status}，未能获取歌词页。`);

    const type = res.headers.get('content-type') || '';
    if (!type.includes('text/html')) throw new Error('网站未返回 HTML 歌词页面。');

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES) throw new Error('页面超过 2MB，已停止解析。');
    return new TextDecoder('utf-8').decode(buffer);
  }
  throw new Error('重定向次数过多，已停止。');
}

/* ------------------------------------------------------------------ */
/* HTML 解析                                                           */
/* ------------------------------------------------------------------ */

const classList = (node) => (node.attribs?.class || '').split(/\s+/).filter(Boolean);
const hasClass = (node, name) => classList(node).includes(name);

/** 取节点内文本，跳过 script/style/rp（与 Python 版 text() 一致） */
function textOf($, node) {
  if (!node) return '';
  if (node.type === 'text') return node.data;
  if (node.type !== 'tag') return '';

  const tag = node.name;
  if (tag === 'script' || tag === 'style' || tag === 'rp') return '';

  let out = '';
  $(node)
    .contents()
    .each((_, child) => {
      out += textOf($, child);
    });
  return out;
}

/** 仅取直接子文本节点 */
function directTextOf($, node) {
  if (!node) return '';
  let out = '';
  $(node)
    .contents()
    .each((_, child) => {
      if (child.type === 'text') out += child.data;
    });
  return out;
}

/**
 * 把 .hiragana / .romaji 区块拆成行与词段。
 * 网站用的是 span.ruby > span.rb + span.rt，不是原生 <ruby>。
 */
function trackLines($, root, readingName) {
  const rows = [];
  let segments = [];

  const finish = () => {
    const surface = segments.map((s) => s.surface).join('').trim();
    if (surface) rows.push({ text: surface, segments });
    segments = [];
  };

  const walk = (node) => {
    if (node.type === 'text') {
      // 换行由 br 决定；清掉源码缩进，保留词间空格与标点
      const value = node.data.replace(/[\r\n\t]+[ ]*/g, '');
      if (value) segments.push({ surface: value });
      return;
    }
    if (node.type !== 'tag') return;

    const tag = node.name;
    if (tag === 'script' || tag === 'style' || tag === 'rt' || tag === 'rp') return;
    if (hasClass(node, 'rt')) return;

    if (tag === 'br') {
      finish();
      return;
    }

    if (tag === 'ruby' || hasClass(node, 'ruby')) {
      const $node = $(node);
      const base = $node.find('.rb').get(0);
      const rt = $node.find('.rt').get(0);

      const surface = (base ? textOf($, base) : directTextOf($, node)).trim();
      if (surface) {
        const item = { surface };
        const reading = rt ? textOf($, rt).trim() : '';
        if (reading) item[readingName] = reading;
        segments.push(item);
      }
      return;
    }

    $nodeChildren($, node).forEach(walk);
  };

  walk(root);
  finish();
  return rows;
}

function $nodeChildren($, node) {
  const out = [];
  $(node)
    .contents()
    .each((_, child) => out.push(child));
  return out;
}

const normalizeSurface = (value) => value.normalize('NFKC').replace(/\s+/g, '');

/* ------------------------------------------------------------------ */
/* 组装结果                                                            */
/* ------------------------------------------------------------------ */

function parseUtatenHtml(html, sourceUrl = '') {
  const $ = cheerio.load(html);
  const bodyNode = $('.lyricBody').get(0);
  if (!bodyNode) throw new Error('页面没有 UtaTen 歌词结构；可能不是歌词页，或网站结构已变化。');

  const kanaNode = $(bodyNode).find('.hiragana').get(0);
  if (!kanaNode) throw new Error('页面没有 UtaTen 注音歌词结构；可能不是歌词页，或网站结构已变化。');

  const rows = trackLines($, kanaNode, 'kana');
  if (!rows.length) throw new Error('页面没有可提取的歌词行。');

  const romanNode = $(bodyNode).find('.romaji').get(0);
  const romanRows = romanNode ? trackLines($, romanNode, 'romaji') : [];

  // 两个区块的分词粒度不同（注音区「は6」是一段，罗马音区是「は」+「6」），
  // 所以按整行文本排队匹配，而不是按词下标硬配。
  const available = new Map();
  for (const row of romanRows) {
    const key = normalizeSurface(row.text);
    if (!available.has(key)) available.set(key, []);
    available.get(key).push(row);
  }

  const warnings = [];
  rows.forEach((row, index) => {
    row.index = index + 1;
    row.kana = row.segments.map((s) => s.kana ?? s.surface).join('').trim();

    const queue = available.get(normalizeSurface(row.text));
    if (queue && queue.length) {
      const matched = queue.shift();
      row.romaji_segments = matched.segments;
      row.romaji = matched.segments.map((s) => s.romaji ?? s.surface).join('').trim();
    } else {
      row.romaji = null;
    }
  });

  const unmatched = [...available.values()].reduce((n, q) => n + q.length, 0);
  const missing = rows.filter((r) => r.romaji === null).length;
  if (missing || unmatched) {
    warnings.push(`罗马音有 ${missing} 行未匹配、${unmatched} 行多余；未猜测配对。`);
  }

  const titleNode = $('.newLyricTitle__main').get(0);
  const artistNode = $('.newLyricWork__name').get(0);

  // 标题节点里还挂着动画名等副标签，只取直接文本，再去掉站点的「歌詞」后缀
  const title = directTextOf($, titleNode).trim().replace(/\s+歌詞\s*$/, '');

  return {
    format: 'uta-annotated-lyrics',
    version: 1,
    source: 'UtaTen',
    url: sourceUrl,
    title,
    artist: textOf($, artistNode).trim(),
    timed: false,
    lines: rows,
    warnings
  };
}

/* ------------------------------------------------------------------ */
/* 输出                                                                */
/* ------------------------------------------------------------------ */

function summary(result) {
  const segments = result.lines.flatMap((row) => row.segments);
  return {
    source: result.source,
    url: result.url,
    title: result.title,
    artist: result.artist,
    timed: result.timed,
    warnings: result.warnings,
    lines: result.lines.length,
    kana_segments: segments.filter((s) => 'kana' in s).length,
    romaji_lines: result.lines.filter((row) => row.romaji !== null).length,
    romaji_segments: result.lines.reduce((n, row) => n + (row.romaji_segments?.length || 0), 0)
  };
}

function exportFiles(result, base) {
  const jsonFile = `${base}.uta-lyrics.json`;
  const textFile = `${base}.txt`;

  if (fs.existsSync(jsonFile) || fs.existsSync(textFile)) {
    throw new Error('输出文件已存在，请换一个文件名。');
  }
  fs.mkdirSync(path.dirname(path.resolve(base)), { recursive: true });

  const blocks = result.lines.map((row) => {
    const annotated = row.segments
      .map((s) => s.surface + (s.kana && s.kana !== s.surface ? `（${s.kana}）` : ''))
      .join('')
      .trim();
    return [annotated, row.kana, ...(row.romaji !== null ? [row.romaji] : [])].join('\n');
  });

  fs.writeFileSync(jsonFile, JSON.stringify(result, null, 2) + '\n', 'utf8');
  fs.writeFileSync(textFile, blocks.join('\n\n') + '\n', 'utf8');
  return [jsonFile, textFile];
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = { url: '', html: '', output: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--html') args.html = argv[++i] || '';
    else if (arg === '--output') args.output = argv[++i] || '';
    else if (arg === '-h' || arg === '--help') args.help = true;
    else if (!arg.startsWith('-') && !args.url) args.url = arg;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || (!args.url && !args.html)) {
    console.log(`用法:
  node scripts/utaten-lyrics.mjs 'https://utaten.com/lyric/歌曲编号/' [--output 输出文件名（不带扩展名）]
  node scripts/utaten-lyrics.mjs 'https://utaten.com/lyric/歌曲编号/' --html 本地页面.html [--output ...]

省略 --output 时只打印统计，不写文件。`);
    return 0;
  }

  await setupProxy();

  const html = args.html ? fs.readFileSync(args.html, 'utf8') : await fetchPage(args.url);
  const result = parseUtatenHtml(html, args.url);

  console.log(JSON.stringify(summary(result), null, 2));

  if (args.output) {
    for (const file of exportFiles(result, args.output)) {
      console.log(path.resolve(file));
    }
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`提取失败：${error.message}\n`);
    process.exit(1);
  }
);
