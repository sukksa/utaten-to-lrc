/**
 * 把 LRC 时间轴套用到 uta-annotated-lyrics 的 lines 上。
 *
 *   node lrc-time.mjs <文件名> [--in-place]
 *   node lrc-time.mjs 星座になれたら --in-place
 *
 * 输入固定为同名的一对文件：<文件名>.txt 与 <文件名>.uta-lyrics.json
 * 规则：
 * - 按 text 顺序匹配，比较时忽略空白与标点符号（NFKC 归一化后只保留文字和数字）
 * - 整行都是符号时退回「只去空白」的比较，避免归一化后变空串乱配
 * - 完全匹配不上时，再在前后两句之间按相似度兜底
 * - 同一句重复出现时按出现顺序依次消费
 * - 时间写入每行的第一个字段 start，单位秒，保留两位小数
 * - 默认输出 <文件名>.uta-lyrics.timed.json，加 --in-place 直接写回原 JSON
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `用法: node lrc-time.mjs <文件名> [--in-place]

  <文件名>  不带扩展名，需同时存在 <文件名>.txt 与 <文件名>.uta-lyrics.json
            默认在当前目录找，找不到再去 assets/ 找
  --in-place  直接写回 <文件名>.uta-lyrics.json（默认输出到 .timed.json）

例: node lrc-time.mjs 星座になれたら --in-place`;

const argv = process.argv.slice(2);
const flags = argv.filter((item) => item.startsWith('-'));
const arg = argv.find((item) => !item.startsWith('-'));

if (!arg || flags.includes('-h') || flags.includes('--help')) {
  console.log(USAGE);
  process.exit(arg ? 0 : 1);
}

const inPlace = flags.includes('--in-place');
// 允许顺手带上扩展名
const name = arg.replace(/\.uta-lyrics\.json$/i, '').replace(/\.txt$/i, '');

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const candidates = [path.resolve(process.cwd(), name)];
if (!/[\\/]/.test(name)) candidates.push(path.resolve(ROOT, 'assets', name));

const base = candidates.find(
  (item) => fs.existsSync(`${item}.txt`) || fs.existsSync(`${item}.uta-lyrics.json`)
);

if (!base) {
  console.error(`找不到 ${name}.txt / ${name}.uta-lyrics.json\n已尝试：`);
  candidates.forEach((item) => console.error(`  ${item}.*`));
  process.exit(1);
}

const lrcPath = `${base}.txt`;
const jsonPath = `${base}.uta-lyrics.json`;

for (const [file, label] of [
  [lrcPath, '带时间轴的歌词'],
  [jsonPath, 'uta-lyrics JSON']
]) {
  if (!fs.existsSync(file)) {
    console.error(`缺少${label}：${file}`);
    process.exit(1);
  }
}

// 主比较：NFKC 折半角、去空白、去标点/符号/emoji，只留文字与数字
const normText = (s = '') => s.normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');
// 兜底比较：只去空白，供「♪♪」这类纯符号行使用
const normLoose = (s = '') => s.replace(/[\s\u3000]+/g, '');
const round2 = (n) => Math.round(n * 100) / 100;

function parseLrc(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]\s*(.*)$/);
    if (!m) continue;
    out.push({
      time: round2(Number(m[1]) * 60 + Number(m[2])),
      text: m[3].trim()
    });
  }
  return out;
}

const lrc = parseLrc(fs.readFileSync(lrcPath, 'utf8'));
const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const lines = doc.lines || [];

const used = new Set();
const picked = new Array(lines.length).fill(-1);
let cursor = 0;

const nextMatch = (line, from) => {
  for (const norm of [normText, normLoose]) {
    const target = norm(line);
    if (!target) continue;
    for (let i = from; i < lrc.length; i++) {
      if (!used.has(i) && norm(lrc[i].text) === target) return i;
    }
  }
  return -1;
};

// 第一遍：完全一致（忽略空白与符号）
lines.forEach((line, i) => {
  let idx = nextMatch(line.text, cursor);
  // 顺序匹配失败时回退：全局找未使用的同文本，避免因个别行错位导致后面全丢
  if (idx === -1) idx = nextMatch(line.text, 0);
  if (idx === -1) return;

  used.add(idx);
  picked[i] = idx;
  cursor = idx + 1;
});

/* 第二遍：兜底相似度匹配
 * LRC 与站点文本常有字符级差异（時間/タイム、错别字、ー/―），
 * 只在这一行「前后两个已匹配时间点之间」找，避免跨段错配。 */
const bigrams = (s) => {
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
};

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const left = bigrams(a);
  const right = bigrams(b);
  if (!left.length || !right.length) return 0;

  const counts = new Map();
  for (const g of left) counts.set(g, (counts.get(g) || 0) + 1);

  let hit = 0;
  for (const g of right) {
    const n = counts.get(g) || 0;
    if (n > 0) {
      hit++;
      counts.set(g, n - 1);
    }
  }
  return (2 * hit) / (left.length + right.length);
}

const FUZZY_THRESHOLD = 0.75;
const fuzzy = [];

lines.forEach((line, i) => {
  if (picked[i] !== -1) return;

  const target = normText(line.text) || normLoose(line.text);
  if (!target) return;

  // 期望区间：上一句与下一句已匹配的位置之间
  let lo = -1;
  let hi = lrc.length;
  for (let j = i - 1; j >= 0; j--) if (picked[j] !== -1) { lo = picked[j]; break; }
  for (let j = i + 1; j < lines.length; j++) if (picked[j] !== -1) { hi = picked[j]; break; }

  const inWindow = (from, to) => {
    let best = -1;
    let bestScore = 0;
    let count = 0;
    for (let k = from; k <= to; k++) {
      if (k < 0 || k >= lrc.length || used.has(k) || !lrc[k].text) continue;
      count++;
      const score = similarity(target, normText(lrc[k].text) || normLoose(lrc[k].text));
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    }
    return { best, bestScore, count };
  };

  let { best, bestScore, count } = inWindow(lo + 1, hi - 1);
  const inWindowOnly = best !== -1;
  if (!inWindowOnly) ({ best, bestScore, count } = inWindow(0, lrc.length - 1));
  if (best === -1) return;

  // 区间里只剩一条未用时间点时，位置本身就是强证据，阈值可放宽；退到全局时要求更严
  const floor = inWindowOnly && count === 1 ? 0.3 : 0.5;
  if (!(bestScore >= FUZZY_THRESHOLD || (count === 1 && bestScore >= floor))) return;

  used.add(best);
  picked[i] = best;
  fuzzy.push({ index: i + 1, score: bestScore, json: line.text, lrc: lrc[best].text, time: lrc[best].time });
});

const timed = lines.map((line, i) => (picked[i] === -1 ? { ...line } : { start: lrc[picked[i]].time, ...line }));
const unmatched = lines
  .map((line, i) => ({ index: i + 1, text: line.text, missing: picked[i] === -1 }))
  .filter((item) => item.missing);

// 时间轴是否单调递增（重复段落可能拿到同一时间点，这里只看是否倒退）
let backwards = 0;
for (let i = 1; i < timed.length; i++) {
  if (typeof timed[i].start !== 'number') continue;
  const prev = [...timed.slice(0, i)].reverse().find((l) => typeof l.start === 'number');
  if (prev && timed[i].start < prev.start) backwards++;
}

const out = { ...doc, timed: unmatched.length === 0 ? true : doc.timed, lines: timed };
const target = inPlace
  ? jsonPath
  : path.join(path.dirname(jsonPath), `${path.basename(jsonPath, '.json')}.timed.json`);

fs.writeFileSync(target, JSON.stringify(out, null, 2) + '\n', 'utf8');

const mmss = (sec) => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(2).padStart(5, '0')}`;
const matched = lines.length - unmatched.length;

console.log(`输入 ${path.relative(process.cwd(), lrcPath)} + ${path.relative(process.cwd(), jsonPath)}`);
console.log(`LRC ${lrc.length} 条（非空 ${lrc.filter((e) => e.text).length} 条） / JSON ${lines.length} 行`);
console.log(`匹配 ${matched}/${lines.length}${unmatched.length ? '，未匹配见下' : ''}`);
if (fuzzy.length) {
  console.log(`其中 ${fuzzy.length} 行靠相似度兜底，字符有出入，建议核对：`);
  fuzzy.forEach((f) => {
    console.log(`  ≈ 第 ${f.index} 行 → ${mmss(f.time)}（相似度 ${f.score.toFixed(2)}）`);
    console.log(`      json: ${f.json}`);
    console.log(`      lrc : ${f.lrc}`);
  });
}
unmatched.forEach((u) => console.log(`  ✗ 第 ${u.index} 行: ${u.text}`));
if (backwards) console.log(`⚠ 有 ${backwards} 处时间倒退`);
console.log(`已写入 ${path.relative(process.cwd(), target)}`);
