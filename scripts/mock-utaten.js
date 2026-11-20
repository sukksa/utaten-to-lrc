/**
 * 本地模拟 utaten，仅用于开发联调（不联网也能测通整条链路）。
 *   node scripts/mock-utaten.js
 *   UTATEN_BASE_URL=http://127.0.0.1:3999 npm start
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFile(path.join(__dirname, '..', 'test', 'fixtures', name), 'utf8');

const PORT = Number(process.env.MOCK_PORT || 3999);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/search/' || url.pathname === '/search') {
    // 模拟真实站点：GET 带 title 参数时连接被重置，迫使客户端改用 POST
    if (req.method === 'GET' && url.searchParams.has('title')) {
      req.socket.destroy();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(await fixture('search-page.html'));
  }

  if (/^\/lyric\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(await fixture('lyric-page.html'));
  }

  if (url.pathname === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('User-agent: *\nAllow: /\n');
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('mock: not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock utaten: http://127.0.0.1:${PORT}`);
});
