import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 读取可选的 .env（不引入第三方依赖），已存在的环境变量优先
function loadEnvFile() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadEnvFile();

const BASE = process.env.UTATEN_BASE_URL || 'https://utaten.com';

export default {
  base: BASE.replace(/\/+$/, ''),

  // 抓取节流：任何两个请求之间至少间隔这么久，避免给对方服务器造成压力
  minIntervalMs: Number(process.env.UTATEN_MIN_INTERVAL_MS || 500),

  // 同时最多几个请求在飞
  concurrency: 2,

  // 超时与重试
  timeoutMs: 10000,
  retries: 1,

  // 缓存有效期
  cacheTtlMs: {
    search: 30 * 60 * 1000,
    lyric: 6 * 60 * 60 * 1000
  },

  userAgent:
    process.env.UTATEN_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',

  port: Number(process.env.PORT || 3000)
};
