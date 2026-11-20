/** 组装下载用的文本 / JSON */

export function metaHeader(lyric) {
  const rows = [
    ['曲名', lyric.title + (lyric.subtitle ? `（${lyric.subtitle}）` : '')],
    ['歌手', lyric.artist],
    ['作詞', lyric.lyricist],
    ['作曲', lyric.composer],
    ['編曲', lyric.arranger],
    ['发行', lyric.releaseDate]
  ].filter(([, v]) => v);

  const width = Math.max(...rows.map(([k]) => [...k].length));
  const body = rows.map(([k, v]) => `${k}${'　'.repeat(width - [...k].length)}：${v}`).join('\n');
  return `${body}\n来源：${lyric.url}`;
}

export function toPlainText(lyric) {
  return `${metaHeader(lyric)}\n\n${'─'.repeat(24)}\n\n${lyric.plain}\n`;
}

export function toFuriganaText(lyric) {
  return `${metaHeader(lyric)}\n\n${'─'.repeat(24)}\n\n${lyric.ruby}\n`;
}

export function toJson(lyric) {
  return JSON.stringify(
    {
      id: lyric.id,
      url: lyric.url,
      title: lyric.title,
      subtitle: lyric.subtitle,
      artist: lyric.artist,
      lyricist: lyric.lyricist,
      composer: lyric.composer,
      arranger: lyric.arranger,
      releaseDate: lyric.releaseDate,
      lyrics: lyric.plain,
      lyricsWithFurigana: lyric.ruby,
      lines: lyric.lines,
      fetchedAt: new Date().toISOString()
    },
    null,
    2
  );
}

export function safeFileName(lyric, ext) {
  const base = `${lyric.artist ? lyric.artist + ' - ' : ''}${lyric.title}`;
  const cleaned = base
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${cleaned || lyric.id}.${ext}`;
}
