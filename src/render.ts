import MarkdownIt from 'markdown-it';
import type { Entry, TagCount } from './queries.js';
import { KINDS } from './queries.js';

/**
 * Server-rendered views. No client framework, no hydration, no webfont.
 * Layout and palette are in public/style.css; this file only produces markup.
 * UI copy is Indonesian, code and comments are English.
 */

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** ISO timestamp to a fixed, sortable "YYYY-MM-DD HH:MM" in the reader's own zone. */
function stamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** One line of plain prose for a row excerpt: markdown syntax is noise there. */
function plainExcerpt(body: string, max: number): string {
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, max);
}

function tagList(tags: string): string[] {
  return tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function chips(tags: string, withCounts: boolean, counts?: Map<string, number>): string {
  const items = tagList(tags);
  if (items.length === 0) return '';
  const links = items
    .map((tag) => {
      const n = withCounts && counts ? `<span class="n">${counts.get(tag) ?? 0}</span>` : '';
      return `<li><a class="chip" href="/?tag=${encodeURIComponent(tag)}">${escapeHtml(tag)}${n}</a></li>`;
    })
    .join('');
  return `<ul class="chips">${links}</ul>`;
}

// A fence gets a copy button: a command you cannot copy is a command you retype.
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const info = token?.info.trim() ?? '';
  const lang = info.split(/\s+/)[0] ?? '';
  const code = escapeHtml(token?.content ?? '');
  const label = lang ? ` class="language-${escapeHtml(lang)}"` : '';
  return `<div class="code-block"><button class="copy" type="button" aria-label="Salin blok kode">salin</button><pre><code${label}>${code}</code></pre></div>\n`;
};

const THEME_BOOT = `(function(){try{var s=localStorage.getItem('notulen-theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var t=s==='light'||s==='dark'?s:(m?'dark':'light');document.documentElement.setAttribute('data-theme',t);document.documentElement.style.colorScheme=t;}catch(e){}})();`;

const PAGE_SCRIPT = `(function(){
  var root=document.documentElement;
  var toggle=document.querySelector('[data-theme-toggle]');
  var label=toggle&&toggle.querySelector('[data-theme-label]');
  // the label names the theme in use, so it must match the one applied before paint
  if(label){label.textContent=root.getAttribute('data-theme')==='dark'?'gelap':'terang';}
  if(toggle){toggle.addEventListener('click',function(){
    var next=root.getAttribute('data-theme')==='dark'?'light':'dark';
    root.setAttribute('data-theme',next);root.style.colorScheme=next;
    try{localStorage.setItem('notulen-theme',next);}catch(e){}
    if(label){label.textContent=next==='dark'?'gelap':'terang';}
  });}
  var copyButtons=document.querySelectorAll('.copy');
  for(var i=0;i<copyButtons.length;i++){(function(btn){
    btn.addEventListener('click',function(){
      var block=btn.parentNode;var code=block.querySelector('code');if(!code)return;
      var text=code.innerText;
      var done=function(){btn.textContent='tersalin';btn.setAttribute('data-copied','1');setTimeout(function(){btn.textContent='salin';btn.removeAttribute('data-copied');},1600);};
      var fallback=function(){
        var ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');
        ta.style.position='fixed';ta.style.top='-1000px';document.body.appendChild(ta);
        ta.select();var ok=false;try{ok=document.execCommand('copy');}catch(e){ok=false;}
        document.body.removeChild(ta);if(ok){done();}
      };
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(done,fallback);}else{fallback();}
    });
  })(copyButtons[i]);}
})();`;

interface PageOptions {
  title: string;
  body: string;
  active?: 'list' | 'tags' | 'admin' | undefined;
  /** the shell needs no stylesheet when the dashboard owns the page */
  bare?: boolean;
}

function page(options: PageOptions): string {
  const { title, body, active } = options;
  const current = (name: string) =>
    active === name ? ' aria-current="page"' : '';

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/style.css">
<script>${THEME_BOOT}</script>
</head>
<body>
<header class="masthead">
  <div class="masthead-inner">
    <a class="wordmark" href="/">notulen</a>
    <nav aria-label="Navigasi utama">
      <a href="/"${current('list')}>catatan</a>
      <a href="/tags"${current('tags')}>tag</a>
      <a href="/admin"${current('admin')}>tulis</a>
      <button class="theme-toggle" type="button" data-theme-toggle aria-label="Ganti tema">
        <span data-theme-label>terang</span>
      </button>
    </nav>
  </div>
</header>
<main class="page">
${body}
</main>
<script>${PAGE_SCRIPT}</script>
</body>
</html>`;
}

export interface ListView {
  entries: Entry[];
  kind?: string | undefined;
  tag?: string | undefined;
  q?: string | undefined;
  pinned?: boolean;
}

function kindOptions(selected: string | undefined): string {
  const options = KINDS.map(
    (kind) => `<option value="${kind}"${kind === selected ? ' selected' : ''}>${kind}</option>`,
  ).join('');
  return `<option value=""${selected ? '' : ' selected'}>semua jenis</option>${options}`;
}

function filterSummary(view: ListView): string {
  const parts: string[] = [];
  if (view.q) parts.push(`cari "${view.q}"`);
  if (view.kind) parts.push(`jenis ${view.kind}`);
  if (view.tag) parts.push(`tag ${view.tag}`);
  if (view.pinned) parts.push('hanya disematkan');
  return parts.join(' / ');
}

export function renderList(view: ListView): string {
  const rows = view.entries
    .map((entry) => {
      const excerpt = plainExcerpt(entry.body, 180);
      return `<li class="row" data-id="${entry.id}">
  <div class="row-meta">
    <span class="kind">${escapeHtml(entry.kind)}</span>
    ${entry.pinned ? '<span class="pin-mark">disematkan</span>' : ''}
    <time class="kind" datetime="${escapeHtml(entry.created_at)}">${escapeHtml(stamp(entry.created_at))}</time>
  </div>
  <a class="row-title" href="/entry/${entry.id}">${escapeHtml(entry.title)}</a>
  ${excerpt ? `<p class="row-excerpt">${escapeHtml(excerpt)}</p>` : ''}
  ${chips(entry.tags, false)}
</li>`;
    })
    .join('\n');

  const summary = filterSummary(view);
  const body = `<div class="sheet">
  <div class="page-head">
    <h1>catatan</h1>
    <span class="count">${view.entries.length}${summary ? ` / ${escapeHtml(summary)}` : ''}</span>
  </div>
  <form class="filters" method="get" action="/" role="search">
    <div class="field field-search">
      <label for="q">cari</label>
      <input id="q" type="search" name="q" value="${escapeHtml(view.q ?? '')}" placeholder="judul, tag, isi">
    </div>
    <div class="field">
      <label for="kind">jenis</label>
      <select id="kind" name="kind">${kindOptions(view.kind)}</select>
    </div>
    <div class="field">
      <label for="tag">tag</label>
      <input id="tag" type="text" name="tag" value="${escapeHtml(view.tag ?? '')}" placeholder="docker">
    </div>
    <div class="field field-actions">
      <label class="check"><input type="checkbox" name="pinned" value="1"${view.pinned ? ' checked' : ''}> hanya disematkan</label>
      <button class="button" type="submit">saring</button>
    </div>
  </form>
  ${
    view.entries.length === 0
      ? '<p class="empty">Belum ada catatan di tampilan ini. Hapus saringan atau tulis catatan pertama lewat menu tulis.</p>'
      : `<ul class="rows">\n${rows}\n</ul>`
  }
</div>`;

  return page({ title: summary ? `catatan / ${summary}` : 'catatan', body, active: 'list' });
}

export function renderEntry(entry: Entry): string {
  const body = `<article class="sheet entry">
  <p class="entry-meta">
    <span class="kind">${escapeHtml(entry.kind)}</span>
    <span>#${entry.id}</span>
    <time datetime="${escapeHtml(entry.created_at)}">dibuat ${escapeHtml(stamp(entry.created_at))}</time>
    <time datetime="${escapeHtml(entry.updated_at)}">diubah ${escapeHtml(stamp(entry.updated_at))}</time>
    ${entry.pinned ? '<span class="pin-mark">disematkan</span>' : ''}
  </p>
  <h1>${escapeHtml(entry.title)}</h1>
  <div class="prose">${entry.body.trim() ? md.render(entry.body) : '<p class="empty">Catatan ini belum punya isi.</p>'}</div>
  ${chips(entry.tags, false)}
  <div class="entry-foot">
    <a class="button quiet" href="/">kembali ke catatan</a>
    <a class="button quiet" href="/admin?entry=${entry.id}">ubah</a>
  </div>
</article>`;

  return page({ title: entry.title, body, active: 'list' });
}

export function renderTags(tagCounts: TagCount[]): string {
  const rows = tagCounts
    .map(
      (row) =>
        `<li><a href="/?tag=${encodeURIComponent(row.tag)}">${escapeHtml(row.tag)}</a><span class="n">${row.count}</span></li>`,
    )
    .join('\n');

  const body = `<div class="sheet">
  <div class="page-head">
    <h1>tag</h1>
    <span class="count">${tagCounts.length}</span>
  </div>
  ${
    tagCounts.length === 0
      ? '<p class="empty">Belum ada tag. Tag muncul di sini setelah kamu menulis catatan dan memberinya tag.</p>'
      : `<ul class="tag-list">\n${rows}\n</ul>`
  }
</div>`;

  return page({ title: 'tag', body, active: 'tags' });
}

/** Shown at /admin until public/admin/index.html exists. */
export function renderAdminPlaceholder(): string {
  const body = `<div class="sheet">
  <div class="page-head"><h1>tulis</h1></div>
  <p class="empty">Dasbor belum dibangun. Jalankan build dasbor ke public/admin, lalu muat ulang halaman ini.</p>
  <p><a class="button quiet" href="/">kembali ke catatan</a></p>
</div>`;
  return page({ title: 'tulis', body, active: 'admin' });
}

export function renderError(status: number, message: string): string {
  const body = `<div class="sheet error-page">
  <h1>${status}</h1>
  <p>${escapeHtml(message)}</p>
  <p><a class="button quiet" href="/">kembali ke catatan</a></p>
</div>`;
  return page({ title: `${status}`, body });
}
