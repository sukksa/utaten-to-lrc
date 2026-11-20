const $ = (sel) => document.querySelector(sel);

const el = {
  form: $('#search-form'),
  q: $('#q'),
  submit: $('#submit-btn'),
  segs: [...document.querySelectorAll('.seg')],
  results: $('#results'),
  count: $('#count'),
  moreWrap: $('#more-wrap'),
  more: $('#more-btn'),
  empty: $('#empty'),
  lyric: $('#lyric'),
  skeleton: $('#skeleton'),
  title: $('#l-title'),
  sub: $('#l-sub'),
  artist: $('#l-artist'),
  source: $('#l-source'),
  facts: $('#l-facts'),
  lyrics: $('#lyrics'),
  rubyToggle: $('#ruby-toggle'),
  copy: $('#copy-btn'),
  toast: $('#toast')
};

const state = {
  type: 'all',
  q: '',
  page: 1,
  nextPage: null,
  results: [],
  selectedId: null,
  lyric: null,
  searchToken: 0,
  lyricToken: 0
};

/* ---------------- 工具 ---------------- */

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let toastTimer;
function toast(message, kind = '') {
  el.toast.textContent = message;
  el.toast.className = `toast is-on ${kind === 'error' ? 'is-error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.className = 'toast';
  }, 2600);
}

async function api(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

/* ---------------- 搜索 ---------------- */

function setBusy(busy) {
  el.submit.disabled = busy;
  el.submit.textContent = busy ? '搜索中' : '搜索';
}

async function search({ append = false } = {}) {
  const q = el.q.value.trim();
  if (!q) {
    el.q.focus();
    return;
  }

  // 直接粘贴歌词页链接 / 纯 id
  const direct = q.match(/utaten\.com\/lyric\/([A-Za-z0-9_-]+)/);
  if (direct) {
    el.q.value = '';
    openLyric({ id: direct[1], url: `https://utaten.com/lyric/${direct[1]}/`, title: '', artist: '' });
    return;
  }

  state.q = q;
  state.page = append ? state.page + 1 : 1;
  const token = ++state.searchToken;
  setBusy(true);
  history.replaceState(null, '', `?q=${encodeURIComponent(q)}&type=${state.type}`);

  if (!append) {
    el.results.innerHTML = `<div class="list__state">正在搜索「${escapeHtml(q)}」…</div>`;
    el.count.textContent = '';
    el.moreWrap.hidden = true;
  }

  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}&type=${state.type}&page=${state.page}`);
    if (token !== state.searchToken) return;

    state.results = append ? [...state.results, ...data.results] : data.results;
    state.nextPage = data.nextPage;
    renderResults();
    el.count.textContent = `${state.results.length} 首`;

    if (!state.results.length) {
      el.results.innerHTML = `<div class="list__state">没有找到相关歌词。<br>换个关键词，或试试「歌词」模式用片段搜索。</div>`;
    } else if (!append) {
      // 换了关键词或搜索范围后，原选中项可能已不存在
      const stillListed = state.results.some((r) => r.id === state.selectedId);
      if (!state.lyric || !stillListed) openLyric(state.results[0]);
    }
  } catch (err) {
    if (token !== state.searchToken) return;
    el.results.innerHTML = `<div class="list__state">搜索失败：${escapeHtml(err.message)}</div>`;
    toast(err.message, 'error');
  } finally {
    if (token === state.searchToken) setBusy(false);
  }
}

function renderResults() {
  el.results.innerHTML = '';
  const frag = document.createDocumentFragment();

  state.results.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'item' + (item.id === state.selectedId ? ' is-active' : '');
    btn.innerHTML = `
      <p class="item__title">${escapeHtml(item.title)}</p>
      ${item.artist ? `<p class="item__artist">${escapeHtml(item.artist)}</p>` : ''}
      ${item.snippet ? `<p class="item__snippet">${escapeHtml(item.snippet)}</p>` : ''}
    `;
    btn.addEventListener('click', () => openLyric(item));
    frag.appendChild(btn);
  });

  el.results.appendChild(frag);

  if (state.nextPage) {
    el.moreWrap.hidden = false;
    el.more.textContent = `加载更多（第 ${state.nextPage} 页）`;
  } else {
    el.moreWrap.hidden = true;
  }
}

/* ---------------- 歌词详情 ---------------- */

async function openLyric(item) {
  const token = ++state.lyricToken;
  state.selectedId = item.id;
  state.lyric = null;

  [...el.results.children].forEach((node, i) => {
    node.classList.toggle('is-active', state.results[i]?.id === item.id);
  });

  el.empty.hidden = true;
  el.lyric.hidden = true;
  el.skeleton.hidden = false;

  try {
    const data = await api(`/api/lyric?id=${encodeURIComponent(item.id)}`);
    if (token !== state.lyricToken) return;
    state.lyric = data;
    renderLyric(data);
  } catch (err) {
    if (token !== state.lyricToken) return;
    el.skeleton.hidden = true;
    el.empty.hidden = false;
    toast(err.message, 'error');
  }
}

function renderLyric(data) {
  el.skeleton.hidden = true;
  el.lyric.hidden = false;

  el.title.textContent = data.title || '(无标题)';
  el.sub.textContent = data.subtitle || '';

  if (data.artist) {
    el.artist.textContent = data.artist;
    el.artist.href = data.artistUrl || data.url;
  } else {
    el.artist.textContent = '';
    el.artist.removeAttribute('href');
  }

  el.source.href = data.url;
  el.facts.innerHTML = [
    ['作詞', data.lyricist],
    ['作曲', data.composer],
    ['編曲', data.arranger],
    ['发行', data.releaseDate]
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join('');

  el.lyrics.innerHTML = buildLyricsHtml(data.lines);
  el.lyrics.classList.toggle('no-ruby', !el.rubyToggle.checked);

  const detail = document.getElementById('detail');
  detail.scrollTop = 0;
  // 窄屏下结果列表在上方，打开歌词后滚到详情
  if (window.matchMedia('(max-width: 980px)').matches) {
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function buildLyricsHtml(lines = []) {
  const stanzas = [];
  let current = [];

  for (const line of lines) {
    if (!line.text) {
      if (current.length) stanzas.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length) stanzas.push(current);

  return stanzas
    .map(
      (stanza) =>
        `<section class="stanza">${stanza
          .map((line) => `<div class="line">${renderLine(line)}</div>`)
          .join('')}</section>`
    )
    .join('');
}

function renderLine(line) {
  if (!line.tokens?.length) return escapeHtml(line.text) || '&nbsp;';

  let out = '';
  let cursor = 0;
  for (const token of line.tokens) {
    if (token.index < cursor) continue;
    out += escapeHtml(line.text.slice(cursor, token.index));
    out += `<ruby>${escapeHtml(token.base)}<rt>${escapeHtml(token.rt)}</rt></ruby>`;
    cursor = token.index + token.base.length;
  }
  out += escapeHtml(line.text.slice(cursor));
  return out || '&nbsp;';
}

/* ---------------- 操作 ---------------- */

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  search();
});

el.segs.forEach((btn) => {
  btn.addEventListener('click', () => {
    el.segs.forEach((b) => b.classList.toggle('is-active', b === btn));
    state.type = btn.dataset.type;
    if (state.q) search();
  });
});

el.more.addEventListener('click', () => search({ append: true }));

el.rubyToggle.addEventListener('change', () => {
  el.lyrics.classList.toggle('no-ruby', !el.rubyToggle.checked);
});

el.copy.addEventListener('click', async () => {
  if (!state.lyric) return;
  const text = el.rubyToggle.checked ? state.lyric.ruby : state.lyric.plain;
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制歌词');
  } catch {
    toast('浏览器不允许写入剪贴板，请手动选择复制', 'error');
  }
});

document.querySelectorAll('[data-dl]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const item = state.results.find((r) => r.id === state.selectedId);
    if (!item) return;
    const format = btn.dataset.dl;
    window.location.href = `/api/download?id=${encodeURIComponent(item.id)}&format=${format}`;
    toast('开始下载…');
  });
});

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    el.q.value = chip.dataset.q;
    search();
  });
});

/* ---------------- 初始化 ---------------- */

(function init() {
  const params = new URLSearchParams(location.search);
  const q = params.get('q');
  const type = params.get('type');
  if (type && ['all', 'title', 'artist', 'body'].includes(type)) {
    state.type = type;
    el.segs.forEach((b) => b.classList.toggle('is-active', b.dataset.type === type));
  }
  if (q) {
    el.q.value = q;
    search();
  }
})();
