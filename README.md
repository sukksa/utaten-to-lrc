# UtaTen 歌词下载器

从 [utaten.com](https://utaten.com/) 搜索歌词、查看假名注音，并导出为 TXT / JSON 的本地网页工具。

![界面](https://img.shields.io/badge/Node-%E2%89%A518-3c873a) ![license](https://img.shields.io/badge/%E7%94%A8%E9%80%94-%E4%B8%AA%E4%BA%BA%E5%AD%A6%E4%B9%A0-c8442e)

## 为什么需要一个小后端

utaten.com 没有公开 API，浏览器里直接 `fetch` 它的页面会被 **CORS** 拦住；而且歌词页的正文是带 `<ruby>` 注音的结构，直接取文本会把假名和汉字混在一起。

所以这里用一个几十行的 Node 服务做三件事：

1. 代理请求（顺便统一 UA、节流、重试、缓存）；
2. 解析 HTML，把注音从正文里剥离，只保留一份「汉字 + 假名位置」的结构；
3. 提供搜索 / 详情 / 下载三个接口给前端。

前端是纯静态页面，没有构建步骤。

## 快速开始

```bash
npm install
cp .env.example .env   # 首次使用：按需改里面的代理端口（本机 .env 已配好可跳过）
npm start
# 打开 http://localhost:3000
```

需要 Node 18+（用到了内置 `fetch`）。

代理写在根目录的 `.env` 里（已附带一份，值是 Clash Verge 默认的混合端口 `7897`，按「设置 → 端口」里的实际值改）：

```ini
PORT=3000
HTTPS_PROXY=http://127.0.0.1:7897
```

`src/config.js` 会自己读这个文件，同名环境变量优先，所以临时覆盖也行：

```bash
# Git Bash / macOS / Linux
HTTPS_PROXY=http://127.0.0.1:7897 npm start
# PowerShell
$env:HTTPS_PROXY="http://127.0.0.1:7897"; npm start
```

启动日志第二行会显示 `数据源：https://utaten.com（代理 http://127.0.0.1:7897）`，看到「代理」字样就说明生效了。Clash 开 TUN 模式时可以删掉这一行，直连也能通。

## 功能

- **搜索**：综合 / 曲名 / 歌手 / 歌词片段四种范围（对应站点表单的 `title`、`artist_name`、`body`）
- **详情**：曲名、歌手、作詞 / 作曲 / 編曲、发行日
- **注音**：可一键开关假名注音（数据来自页面里的 `.rb` / `.rt`）
- **导出**：纯文本 TXT、注音版 TXT（`漢字(かんじ)`）、JSON（含逐行 token，方便再做别的处理）
- **复制**：按当前注音开关状态复制
- 直接粘贴 `https://utaten.com/lyric/xxx/` 链接或歌词 id 也能打开

## 目录结构

```
src/
  server.js    Express 路由：/api/search、/api/lyric、/api/download
  fetcher.js   请求队列（并发 2、间隔 500ms）+ 重试 + TTL 缓存
  parse.js     搜索页 / 歌词页解析（核心）
  format.js    TXT / JSON 组装与文件名处理
  config.js    所有可调参数
  proxy.js     可选代理
public/        前端（原生 JS，无构建）
lrc-time.mjs   把 LRC 时间轴写进 JSON 的 lines[].start
scripts/
  probe.js          选择器自查：拿真实页面跑一遍解析
  mock-utaten.js    本地模拟站点，断网也能调 UI
  utaten-lyrics.mjs 导出 uta-lyrics JSON 的命令行工具
test/          解析单测 + fixtures
```

## 命令行导出 uta-annotated-lyrics

网页之外还有一个只做导出的 CLI（原 `assets/utaten_lyrics.py` 的 Node 移植，输出保持一致）：

```bash
node scripts/utaten-lyrics.mjs 'https://utaten.com/lyric/ym23010406/' --output '.tools/utaten/星座になれたら'
```

生成 `<名字>.uta-lyrics.json` 和一份对照用 `<名字>.txt`（原文 / 假名 / 罗马音三行一组）。

- 省略 `--output` 只打印统计，不写文件
- `--html 页面.html` 解析本地保存的页面，不联网
- 目标文件已存在会直接失败，不覆盖

JSON 里 `segments[].surface` 是原词面、`kana` 是假名；罗马音单独来自站点的 `.romaji` 区块，两个区块分词粒度不同，所以按整行文本匹配，对不上就留 `romaji: null` 并写入 `warnings`，不猜。

## 给 JSON 补时间轴

如果手上有同一首歌的 LRC（`[00:20.22] 歌词`）文件，可以直接把时间写进 `lines[].start`：

```bash
node lrc-time.mjs 星座になれたら --in-place
```

只认一对同名文件：`星座になれたら.txt` + `星座になれたら.uta-lyrics.json`，默认在当前目录找，找不到再去 `assets/` 找。

- 不加 `--in-place` 时输出到 `<名字>.uta-lyrics.timed.json`，原文件不动
- 比较时忽略空白与标点，`時間`/`タイム`、错别字这类字符差异会在相邻两句之间按相似度兜底，并在终端用 `≈` 标出来
- 时间写入每行第一个字段，单位秒（number），两位小数；全部命中才把顶层 `timed` 置为 `true`

## 接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/search?q=米津玄師&type=all` | `type`: `all` / `title` / `artist` / `body` |
| `GET /api/lyric?id=ks25070443` | 也支持 `?url=https://utaten.com/lyric/...` |
| `GET /api/download?id=...&format=txt` | `format`: `txt` / `furigana` / `json` |

`/api/lyric` 返回：

```json
{
  "title": "IRIS OUT",
  "subtitle": "劇場版「チェンソーマン レゼ篇」主題歌",
  "artist": "米津玄師",
  "lyrics": "…",
  "lines": [
    { "text": "駄目駄目駄目　脳みその中から…", "tokens": [{ "index": 0, "base": "駄目駄目駄目", "rt": "だめだめだめ" }] }
  ]
}
```

`tokens[].index` 是注音汉字在 `text` 中的字符下标，前端据此渲染 `<ruby>`。

## 配置

都在 `src/config.js`，或通过环境变量覆盖：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | 3000 | 服务端口 |
| `UTATEN_BASE_URL` | `https://utaten.com` | 换成本地 mock 用于联调 |
| `UTATEN_MIN_INTERVAL_MS` | 500 | 两次请求的最小间隔，别调太小 |
| `HTTPS_PROXY` | — | 出站代理（Clash Verge 默认 7897） |

以上都可以写在根目录 `.env` 里，模板见 `.env.example`。

## 站点改版了怎么办

歌词正文依赖 `div.hiragana`，注音依赖 `span.ruby > span.rb + span.rt`，标题在 `h2` 里（按 `歌詞` 切分）。这是当前站点的结构，改版后可能失效。

先用自查脚本定位问题：

```bash
npm run probe -- https://utaten.com/lyric/ks25070443/
npm run probe -- search 米津玄師 artist
```

它会打印抓到的字节数、各字段是否解析成功、正文前几行。哪一项是空的，就去 `src/parse.js` 对应的 `findTitleNode` / `extractLines` / `parseSearchPage` 里补一个候选选择器即可，其他逻辑不用动。

解析逻辑有单测覆盖，改完跑一下：

```bash
npm test
```

## 常见问题

**搜不到结果 / 全是热门歌**
搜索页在缺少 `sort` 参数时会返回默认榜单，代码里已经带上了 `sort=popular_sort_asc`。如果仍然如此，多半是关键词没匹配到，换「歌词」模式用一句歌词试试（`body` 是歌词全文检索，支持「沈むように溶けてゆくように」这样的片段）。

**返回 502 / 超时**
utaten 是日本站点，国内直连会失败。先确认代理端口：`curl -x http://127.0.0.1:7897 -I https://utaten.com/` 能返回 200，再用 `HTTPS_PROXY=…` 启动。服务端对网络错误有 1 次重试，仍失败才报错。

**代理明明是通的，Node 还是连不上**
Node 不会自动读取系统代理，必须显式传 `HTTPS_PROXY`。另外 Clash 若开了 TUN 模式，一般也能直连，此时不用设这个变量。

**429 / 被封**
说明请求太密。把 `UTATEN_MIN_INTERVAL_MS` 调大（比如 1500），并确认自己没有并发批量抓取。

**注音开关关掉后还有假名**
说明页面结构变了，`.rt` 没被识别到。跑 `npm run probe` 看看。

## 版权

歌词版权归原作者与版权方所有。这个工具只做「抓取 + 本地格式化」，请仅用于个人学习、语言学习与检索，**不要公开部署、不要批量分发、不要商用**。站点 `robots.txt` 目前只禁止 `/manage`、`/outsourcing`，但仍请自觉控制频率。
