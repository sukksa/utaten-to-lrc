import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseLyricPage, parseSearchPage, toRubyText } from '../src/parse.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(path.join(dir, 'fixtures', name), 'utf8');
const BASE = 'https://utaten.com';

test('歌词页：标题 / 歌手 / 制作信息', () => {
  const lyric = parseLyricPage(read('lyric-page.html'), {
    url: 'https://utaten.com/lyric/ks25070443/',
    base: BASE
  });

  assert.equal(lyric.title, 'IRIS OUT');
  assert.equal(lyric.subtitle, '劇場版「チェンソーマン レゼ篇」主題歌');
  assert.equal(lyric.artist, '米津玄師');
  assert.equal(lyric.artistUrl, 'https://utaten.com/artist/lyric/8450');
  assert.equal(lyric.lyricist, '米津玄師');
  assert.equal(lyric.composer, '米津玄師');
  assert.equal(lyric.arranger, '米津玄師');
  assert.equal(lyric.releaseDate, '2025-09-24');
  assert.equal(lyric.id, 'ks25070443');
});

test('歌词页：注音被剥离，正文无假名残留', () => {
  const lyric = parseLyricPage(read('lyric-page.html'), {
    url: 'https://utaten.com/lyric/ks25070443/',
    base: BASE
  });

  assert.equal(
    lyric.lines[0].text,
    '駄目駄目駄目　脳みその中から「やめろ馬鹿」と喚くモラリティ'
  );
  assert.equal(
    lyric.lines[1].text,
    'ダーリンベイビーダーリン　半端なくラブ！ときらめき浮き足立つフィロソフィ'
  );
  assert.ok(!lyric.plain.includes('だめだめだめ'), '正文不应包含 rt 注音');
  assert.ok(!lyric.plain.includes('のう'), '正文不应包含 rt 注音');
  assert.ok(lyric.plain.startsWith('駄目駄目駄目'));
});

test('歌词页：行结构与空行分节', () => {
  const lyric = parseLyricPage(read('lyric-page.html'), {
    url: 'https://utaten.com/lyric/ks25070443/',
    base: BASE
  });

  // 3 行 + 空行 + 2 行 + 空行 + 2 行
  assert.deepEqual(
    lyric.lines.map((l) => (l.text ? 'text' : 'blank')),
    ['text', 'text', 'blank', 'text', 'text', 'blank', 'text', 'text']
  );
  assert.equal(lyric.lines[0].tokens[0].base, '駄目駄目駄目');
  assert.equal(lyric.lines[0].tokens[0].rt, 'だめだめだめ');
  assert.equal(lyric.lines[0].tokens[0].index, 0);
  assert.equal(lyric.lines[0].tokens[1].base, '脳');
  assert.equal(lyric.lines[0].tokens[1].index, 7); // 「駄目駄目駄目」(6) + 「　」(1)
});

test('歌词页：注音文本格式', () => {
  const lyric = parseLyricPage(read('lyric-page.html'), {
    url: 'https://utaten.com/lyric/ks25070443/',
    base: BASE
  });
  const first = lyric.ruby.split('\n')[0];
  assert.ok(first.startsWith('駄目駄目駄目(だめだめだめ)　脳(のう)みその中(なか)から'));
});

test('歌词页：正文缺失时抛出 502', () => {
  assert.throws(
    () => parseLyricPage('<html><body><h2>テスト 歌詞 テスト</h2></body></html>', { url: `${BASE}/lyric/xxxx/`, base: BASE }),
    (err) => err.status === 502
  );
});

test('搜索结果页：解析标题 / 歌手 / 片段，并按歌曲去重', () => {
  const { results, nextPage } = parseSearchPage(read('search-page.html'), { base: BASE, page: 1 });

  assert.equal(results.length, 3);
  assert.equal(results[0].id, 'ks25070443');
  assert.equal(results[0].title, 'IRIS OUT(劇場版「チェンソーマン レゼ篇」主題歌)');
  assert.equal(results[0].artist, '米津玄師');
  assert.ok(results[0].snippet.startsWith('駄目駄目駄目'));
  assert.equal(results[2].artist, 'YOASOBI');
  assert.equal(nextPage, 2);
});

test('搜索结果页：宽松结构（无 class）也能解析', () => {
  const html = `
    <div><a href="/lyric/aaa111/">曲A</a> <a href="/artist/1/">歌手A</a>
      <span><a href="/lyric/aaa111/">曲A の歌い出しです</a></span></div>
    <div><a href="/lyric/bbb222/">曲B</a> <a href="/artist/2/">歌手B</a>
      <span><a href="/lyric/bbb222/">曲B の歌い出しです</a></span></div>`;
  const { results } = parseSearchPage(html, { base: BASE });
  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((r) => [r.id, r.title, r.artist]),
    [
      ['aaa111', '曲A', '歌手A'],
      ['bbb222', '曲B', '歌手B']
    ]
  );
});

test('toRubyText 在注音位置插入括号', () => {
  const lines = [{ text: '猫が寝た', tokens: [{ index: 0, base: '猫', rt: 'ねこ' }, { index: 2, base: '寝', rt: 'ね' }] }];
  assert.equal(toRubyText(lines), '猫(ねこ)が寝(ね)た');
});
