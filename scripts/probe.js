/**
 * 选择器自查工具：拿到真实页面跑一遍解析，快速判断站点结构是否变化。
 *
 *   npm run probe -- https://utaten.com/lyric/ks25070443/
 *   npm run probe -- ks25070443
 *   npm run probe -- search 米津玄師 artist
 *   npm run probe -- search 夜に駆ける title
 */
import config from '../src/config.js';
import { fetchHtml } from '../src/fetcher.js';
import { parseLyricPage, parseSearchPage } from '../src/parse.js';
import { setupProxy } from '../src/proxy.js';

const [first, second, third] = process.argv.slice(2);

function line(label, value) {
  const mark = value ? '✓' : '✗';
  console.log(`  ${mark} ${label.padEnd(10, '　')} ${value || '（空）'}`);
}

async function probeLyric(input) {
  const url = /^https?:\/\//.test(input) ? input : `${config.base}/lyric/${input}/`;
  console.log(`\n抓取 ${url}`);
  const started = Date.now();
  const html = await fetchHtml(url);
  console.log(`  页面 ${(html.length / 1024).toFixed(1)} KB，耗时 ${Date.now() - started} ms\n`);

  const lyric = parseLyricPage(html, { url, base: config.base });
  const hasKana = lyric.lines.some((l) => l.tokens?.length);

  line('标题', lyric.title);
  line('副标题', lyric.subtitle);
  line('歌手', lyric.artist);
  line('作詞', lyric.lyricist);
  line('作曲', lyric.composer);
  line('发行日', lyric.releaseDate);
  line('行数', String(lyric.lines.length));
  line('注音行', hasKana ? '有' : '无（可能不需要注音，或结构变化）');

  console.log(`\n--- 正文前 5 行 ---\n${lyric.lines.slice(0, 5).map((l) => l.text).join('\n')}\n`);
  if (!lyric.title || !lyric.artist) {
    console.log('⚠ 标题或歌手为空，请检查页面结构是否调整。\n');
  }
}

async function probeSearch(keyword, type = 'artist') {
  const param = { artist: 'artist_name', title: 'title', body: 'body' }[type] || 'artist_name';
  const params = new URLSearchParams({ sort: 'popular_sort_asc', show_artists: '1', [param]: keyword });
  const url = `${config.base}/search/?${params}`;
  console.log(`\n抓取 ${url}`);
  const html = await fetchHtml(url);
  console.log(`  页面 ${(html.length / 1024).toFixed(1)} KB\n`);

  const { results, nextPage } = parseSearchPage(html, { base: config.base });
  line('结果数', String(results.length));
  line('下一页', nextPage ? `第 ${nextPage} 页` : '无');
  console.log('');
  results.slice(0, 6).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.title}  —  ${r.artist || '?'}  (${r.id})`);
  });
  if (!results.length) console.log('⚠ 没解析到结果，可能是参数不对或页面结构变化。');
  console.log('');
}

(async () => {
  await setupProxy();
  try {
    if (!first) {
      console.log(`\n用法：
  npm run probe -- <歌词页链接或 id>
  npm run probe -- search <关键词> [artist|title|body]\n`);
      return;
    }
    if (first === 'search') await probeSearch(second, third);
    else await probeLyric(first);
  } catch (err) {
    console.error(`\n✗ 失败：${err.message}\n`);
    process.exitCode = 1;
  }
})();
