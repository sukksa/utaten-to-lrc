import config from './config.js';

/** 简单 TTL 缓存 */
class TTLCache {
  constructor() {
    this.map = new Map();
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key, value, ttl) {
    this.map.set(key, { value, expires: Date.now() + ttl });
    // 粗略清理，防止无限增长
    if (this.map.size > 500) {
      const now = Date.now();
      for (const [k, v] of this.map) if (v.expires < now) this.map.delete(k);
    }
  }
}

export const cache = new TTLCache();

let running = 0;
const waiting = [];
let lastRequestAt = 0;

function schedule(fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      running++;
      try {
        const wait = config.minIntervalMs - (Date.now() - lastRequestAt);
        if (wait > 0) await sleep(wait);
        lastRequestAt = Date.now();
        resolve(await fn());
      } catch (err) {
        reject(err);
      } finally {
        running--;
        const next = waiting.shift();
        if (next) next();
      }
    };
    if (running < config.concurrency) run();
    else waiting.push(run);
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 抓取一个 utaten 页面，返回 HTML 文本。
 * - 带浏览器 UA / 日语 Accept-Language
 * - 全局节流 + 并发控制
 * - 5xx / 网络错误时指数退避重试
 */
export async function fetchHtml(url, { method = 'GET', body, headers = {} } = {}) {
  return schedule(async () => {
    let lastErr;
    for (let attempt = 0; attempt <= config.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const res = await fetch(url, {
          method,
          body,
          signal: controller.signal,
          redirect: 'follow',
          headers: {
            'User-Agent': config.userAgent,
            'Accept-Language': 'ja,en;q=0.8,zh-CN;q=0.6',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            Referer: `${config.base}/`,
            ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
            ...headers
          }
        });
        clearTimeout(timer);

        if (res.status === 404) {
          const err = new Error('页面不存在（404）');
          err.status = 404;
          throw err;
        }
        if (!res.ok) {
          const err = new Error(`utaten 返回 ${res.status}`);
          err.status = res.status;
          err.retryable = res.status >= 500 || res.status === 429;
          throw err;
        }
        return await res.text();
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        if (err.status === 404) throw err;
        const retryable = err.retryable ?? true;
        if (!retryable || attempt === config.retries) break;
        await sleep(600 * (attempt + 1) ** 2);
      }
    }
    const raw = lastErr?.name === 'AbortError' ? '请求超时' : lastErr?.message || '网络错误';
    const message = /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket/i.test(raw)
      ? '无法连接到 utaten.com（网络不通，可能需要设置 HTTPS_PROXY）'
      : raw;
    const err = new Error(`抓取失败：${message}`);
    err.status = 502;
    throw err;
  });
}
