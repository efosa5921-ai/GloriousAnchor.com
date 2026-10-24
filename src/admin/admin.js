/* Glorious Anchor admin: edits picks.json, feeds.json and articles/ in the GitHub repository via the Contents API.
   The access token lives only in this browser (localStorage). Every save is a commit; the site rebuilds on push. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const API = localStorage.getItem('ga:admin:api') || 'https://api.github.com';
  const store = {
    get token() { return localStorage.getItem('ga:admin:token') || ''; },
    set token(v) { v ? localStorage.setItem('ga:admin:token', v) : localStorage.removeItem('ga:admin:token'); },
    get repo() { return localStorage.getItem('ga:admin:repo') || 'efosa5921-ai/GloriousAnchor.com'; },
    set repo(v) { localStorage.setItem('ga:admin:repo', v); },
  };
  const BRANCH = 'main';
  const state = { view: 'dashboard', files: {}, dirty: new Set(), articles: null, editing: null };

  /* ---------- helpers ---------- */
  const h = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  };
  const icon = (d) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = `<path d="${d}"/>`; return s; };
  const ICONS = { edit: 'M4 20h4l10-10-4-4L4 16zM13 7l4 4', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z', up: 'M12 19V5M5 12l7-7 7 7', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' };
  let toastTimer;
  const toast = (msg, isError) => { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (isError ? ' toast--error' : ''); t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 7000 : 3500); };
  let busyCount = 0;
  const busy = (on) => { busyCount += on ? 1 : -1; $('#busy').hidden = busyCount <= 0; };
  const b64encode = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const b64decode = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
  const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'untitled';
  const today = () => new Date().toISOString().slice(0, 10);

  /* ---------- GitHub API ---------- */
  async function api(path, opts = {}) {
    busy(true);
    try {
      const res = await fetch(API + path, { ...opts, headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${store.token}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } });
      if (res.status === 204) return null;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data.message || `HTTP ${res.status}`;
        if (res.status === 401) throw new Error('The token was rejected. It may have expired; sign out and connect with a new one.');
        if (res.status === 403 && /resource not accessible|permission/i.test(msg)) throw new Error('The token lacks permission for this. It needs Contents: Read and write (and Actions: Read and write for rebuilds).');
        throw new Error(msg);
      }
      return data;
    } finally { busy(false); }
  }
  const repoPath = (p) => `/repos/${store.repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}`;

  async function loadFile(path) {
    const data = await api(`${repoPath(path)}?ref=${BRANCH}&t=${Date.now()}`, { headers: { 'If-None-Match': '' } });
    return { sha: data.sha, text: b64decode(data.content) };
  }
  async function saveFile(path, text, message, knownSha) {
    // Always use the latest sha so a concurrent edit (e.g. on GitHub.com) is not silently overwritten.
    let sha = knownSha;
    try { sha = (await loadFile(path)).sha; } catch (e) { if (!/not found/i.test(e.message)) throw e; sha = undefined; }
    const res = await api(repoPath(path), { method: 'PUT', body: JSON.stringify({ message, content: b64encode(text), branch: BRANCH, ...(sha ? { sha } : {}) }) });
    return res.content?.sha;
  }
  async function deleteFile(path, message) {
    const { sha } = await loadFile(path);
    await api(repoPath(path), { method: 'DELETE', body: JSON.stringify({ message, sha, branch: BRANCH }) });
  }
  async function loadJson(name) {
    if (state.files[name] && !state.files[name].stale) return state.files[name].data;
    const { sha, text } = await loadFile(name);
    state.files[name] = { sha, data: JSON.parse(text) };
    state.dirty.delete(name);
    return state.files[name].data;
  }
  async function saveJson(name, message) {
    const f = state.files[name];
    f.sha = await saveFile(name, JSON.stringify(f.data, null, 2) + '\n', message, f.sha);
    state.dirty.delete(name);
    toast(`Saved. The site rebuilds in a few minutes.`);
    renderSaveBar();
  }
  const markDirty = (name) => { state.dirty.add(name); renderSaveBar(); };

  /* ---------- views ---------- */
  const view = $('#view');
  function setView(name) {
    if (state.dirty.size && !confirm('You have unsaved changes. Leave without saving?')) return;
    state.dirty.clear(); state.editing = null;
    for (const n of Object.keys(state.files)) state.files[n].stale = true;
    state.view = name;
    for (const b of document.querySelectorAll('#adminNav .cat')) b.setAttribute('aria-current', String(b.dataset.view === name));
    history.replaceState(null, '', `#${name}`);
    render();
  }
  async function render() {
    view.innerHTML = '';
    try {
      await ({ dashboard: renderDashboard, picks: renderPicks, sources: renderSources, articles: renderArticles, churches: renderChurches, quizzes: renderQuizzes, settings: renderSettings }[state.view] || renderDashboard)();
    } catch (err) {
      view.append(h('p', { class: 'form__error' }, `Could not load: ${err.message}`), h('button', { class: 'btn btn--ghost', onclick: render }, 'Try again'));
    }
  }
  function renderSaveBar() {
    let bar = $('.savebar', view);
    if (!bar) return;
    const dirty = state.dirty.size > 0;
    $('button', bar).disabled = !dirty;
    $('.muted', bar).textContent = dirty ? 'Unsaved changes' : 'All changes saved';
  }
  const saveBar = (name, message) => h('div', { class: 'savebar' },
    h('button', { class: 'btn', disabled: true, onclick: async () => { try { await saveJson(name, message); render(); } catch (e) { toast(e.message, true); } } }, 'Save changes'),
    h('span', { class: 'muted' }, 'All changes saved'));

  /* Dashboard */
  async function renderDashboard() {
    view.append(h('h1', {}, 'Dashboard'));
    const [meta, runs] = await Promise.all([
      fetch(`../data/meta.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      api(`/repos/${store.repo}/actions/workflows/build.yml/runs?per_page=1&branch=${BRANCH}`).catch(() => null),
    ]);
    const run = runs?.workflow_runs?.[0];
    const ok = meta?.sourceStatus?.filter((s) => s.ok && !['picks', 'ours'].includes(s.id)).length ?? 0;
    const total = meta?.sourceStatus?.filter((s) => !s.skipped && !['picks', 'ours'].includes(s.id)).length ?? 0;
    const failing = meta?.sourceStatus?.filter((s) => !s.ok && !s.skipped) || [];
    view.append(h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', {}, meta ? meta.articleCount.toLocaleString() : '–'), h('span', {}, 'items on the site')),
      h('div', { class: 'stat' }, h('b', {}, `${ok}/${total}`), h('span', {}, 'feeds delivering')),
      h('div', { class: 'stat' }, h('b', {}, meta ? timeAgo(Date.parse(meta.generatedAt)) : '–'), h('span', {}, 'last published')),
      h('div', { class: 'stat' }, run ? h('span', { class: `pill ${run.conclusion === 'success' ? 'pill--ok' : run.status !== 'completed' ? 'pill--run' : 'pill--bad'}` }, run.status !== 'completed' ? 'building…' : run.conclusion) : h('b', {}, '–'), h('span', {}, run ? h('a', { href: run.html_url, target: '_blank', rel: 'noopener' }, `latest build, ${timeAgo(Date.parse(run.created_at))}`) : 'latest build')),
    ));
    view.append(h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => setView('picks') }, 'Add a pick'),
      h('button', { class: 'btn', onclick: () => { setView('articles'); } }, 'Write an article'),
      h('button', { class: 'btn', onclick: () => setView('churches') }, 'List a church'),
      h('button', { class: 'btn', onclick: () => setView('quizzes') }, 'Write a quiz'),
      h('a', { class: 'btn btn--ghost', href: '../', target: '_blank', rel: 'noopener' }, 'Open the site ↗'),
    ));
    if (failing.length) {
      view.append(h('h2', {}, `Sources not delivering (${failing.length})`), h('p', {}, 'These failed on the last build. Sites that block GitHub\'s network start working once the feed server is set up; a wrong address can be fixed under Sources.'));
      view.append(h('ul', { class: 'list' }, failing.map((s) => h('li', { class: 'item' }, h('span', { class: 'pill pill--bad' }, 'down'), h('div', { class: 'item__main' }, h('div', { class: 'item__title' }, s.name), h('div', { class: 'item__sub' }, s.error || '')), h('span')))));
    }
  }
  const timeAgo = (t) => { const m = Math.round((Date.now() - t) / 60000); if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`; const hr = Math.round(m / 60); if (hr < 48) return `${hr} h ago`; return `${Math.round(hr / 24)} d ago`; };

  /* Picks */
  async function renderPicks() {
    const data = await loadJson('picks.json');
    data.picks ||= [];
    const feeds = await loadJson('feeds.json');
    const pickCats = (feeds.categories || []).filter((c) => !['top', 'picks', 'ours'].includes(c.id));
    view.append(h('h1', {}, 'Picks'), h('p', {}, 'Hand-picked links: articles, X posts, TikToks, videos, Instagram or Facebook posts. They stay on the site until you remove them. Every pick appears in Picks and Top Stories; tick a tab to show it there too.'));
    const form = pickForm(null, (pick) => { data.picks.unshift(pick); markDirty('picks.json'); render(); }, pickCats);
    view.append(form);
    view.append(h('h2', {}, `Current picks (${data.picks.length})`));
    view.append(h('ul', { class: 'list' }, data.picks.map((p, i) => h('li', { class: 'item' + (p.enabled === false ? ' item--off' : '') },
      h('label', { class: 'check', title: 'Shown on the site' }, h('input', { type: 'checkbox', checked: p.enabled !== false, onchange: (e) => { if (e.target.checked) delete p.enabled; else p.enabled = false; markDirty('picks.json'); render(); } })),
      h('div', { class: 'item__main' }, h('div', { class: 'item__title' }, p.title || p.url), h('div', { class: 'item__sub' }, [p.title ? p.url : null, p.note ? `Note: ${p.note}` : null].filter(Boolean).join(' · '))),
      h('div', { class: 'item__actions' },
        h('button', { title: p.pinned ? 'Unpin' : 'Pin to the top of the front page', 'aria-pressed': String(!!p.pinned), onclick: () => { p.pinned = !p.pinned; if (!p.pinned) delete p.pinned; markDirty('picks.json'); render(); } }, icon(ICONS.star)),
        h('button', { title: 'Edit', onclick: () => { const f = pickForm(p, (upd) => { Object.keys(p).forEach((k) => delete p[k]); Object.assign(p, upd); markDirty('picks.json'); render(); }, pickCats); view.querySelector('form.form')?.replaceWith(f); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, icon(ICONS.edit)),
        h('button', { title: 'Remove', onclick: () => { if (confirm('Remove this pick from the site?')) { data.picks.splice(i, 1); markDirty('picks.json'); render(); } } }, icon(ICONS.trash)),
      )))));
    view.append(saveBar('picks.json', 'Update picks (admin)'));
    renderSaveBar();
  }
  function pickForm(existing, onSubmit, pickCats = []) {
    const p = existing || {};
    const chosen = new Set(Array.isArray(p.categories) ? p.categories : []);
    const f = h('form', { class: 'form' },
      h('h2', {}, existing ? 'Edit pick' : 'Add a pick'),
      h('label', {}, 'Link', h('input', { name: 'url', type: 'url', required: true, value: p.url || '', placeholder: 'https://…' })),
      h('label', {}, 'Editor\'s note ', h('span', { class: 'help' }, '(optional, shown on the card)'), h('input', { name: 'note', value: p.note || '' })),
      h('details', {}, h('summary', { class: 'muted' }, 'Title, summary and image (only needed for Instagram/Facebook posts, or to override what the site fetches)'),
        h('div', { class: 'form' },
          h('label', {}, 'Title', h('input', { name: 'title', value: p.title || '' })),
          h('label', {}, 'Summary', h('input', { name: 'summary', value: p.summary || '' })),
          h('label', {}, 'Image URL', h('input', { name: 'image', type: 'url', value: p.image || '' })),
          h('label', {}, 'Source label ', h('span', { class: 'help' }, 'e.g. "Instagram · @yourchurch"'), h('input', { name: 'source', value: p.source || '' })),
          h('label', {}, 'Date', h('input', { name: 'added', type: 'date', value: p.added || '' })))),
      pickCats.length ? h('fieldset', { class: 'cats' }, h('legend', {}, 'Also show in'),
        ...pickCats.map((c) => h('label', { class: 'check' }, h('input', { name: 'cat', type: 'checkbox', value: c.id, checked: chosen.has(c.id) }), c.label))) : null,
      h('label', { class: 'check' }, h('input', { name: 'pinned', type: 'checkbox', checked: !!p.pinned }), 'Pin to the top of the front page (three days)'),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, existing ? 'Apply' : 'Add'), existing ? h('button', { class: 'btn btn--ghost', type: 'button', onclick: render }, 'Cancel') : null),
    );
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(f); const out = {};
      for (const k of ['url', 'note', 'title', 'summary', 'image', 'source', 'added']) { const v = String(fd.get(k) || '').trim(); if (v) out[k] = v; }
      const cats = fd.getAll('cat').map(String).filter(Boolean);
      if (cats.length) out.categories = cats;
      if (fd.get('pinned')) out.pinned = true;
      if (p.enabled === false) out.enabled = false;
      if (/instagram\.com|facebook\.com|fb\.watch/.test(out.url) && !out.title) { toast('Instagram and Facebook posts need a title (open the details section).', true); return; }
      onSubmit(out);
    });
    return f;
  }

  /* Sources */
  const TYPES = {
    rss: { label: 'Website / blog / Substack feed', fields: [['url', 'Feed URL', 'https://example.com/feed/'], ['homepage', 'Homepage (optional)', 'https://example.com']] },
    youtube: { label: 'YouTube channel', fields: [['handle', 'Channel handle', '@channelname']] },
    instagram: { label: 'Instagram account (official API)', fields: [['username', 'Username', 'accountname']] },
    reddit: { label: 'Reddit community', fields: [['subreddit', 'Subreddit', 'Christianity']] },
    bluesky: { label: 'Bluesky account', fields: [['handle', 'Handle', 'name.bsky.social']] },
    mastodon: { label: 'Mastodon account', fields: [['instance', 'Instance', 'mastodon.social'], ['user', 'Username', 'name']] },
    rsshub: { label: 'X / TikTok via feed server (RSSHub route)', fields: [['route', 'Route', '/twitter/user/Name'], ['profile', 'Profile link', 'https://x.com/Name']] },
    rssbridge: { label: 'Facebook via feed server (RSS-Bridge)', fields: [['bridge', 'Bridge', 'Facebook'], ['profile', 'Profile link', 'https://www.facebook.com/Name']] },
  };
  const KINDS = { news: 'News', article: 'Article', video: 'Video', audio: 'Audio (podcast)', social: 'Post' };
  function sourceLabel(s) {
    return s.url || s.handle || s.username || (s.subreddit && `r/${s.subreddit}`) || s.route || (s.bridge && `${s.bridge} bridge`) || (s.user && `@${s.user}@${s.instance}`) || '';
  }
  async function renderSources() {
    const data = await loadJson('feeds.json');
    const cats = data.categories.filter((c) => !['top', 'picks', 'ours'].includes(c.id));
    view.append(h('h1', {}, 'Sources'), h('p', {}, 'The publishers, writers, channels and communities the site follows. Untick to pause one without deleting it; star the ones that deserve more room on the front page.'));
    view.append(sourceForm(null, cats, (src) => { data.sources.push(src); markDirty('feeds.json'); render(); }, data.sources));
    for (const c of cats) {
      const list = data.sources.filter((s) => (s.categories || [s.category]).includes(c.id));
      if (!list.length) continue;
      view.append(h('div', { class: 'group' }, h('h3', {}, `${c.label} (${list.length})`),
        h('ul', { class: 'list' }, list.map((s) => h('li', { class: 'item' + (s.enabled === false ? ' item--off' : '') },
          h('label', { class: 'check', title: 'Enabled' }, h('input', { type: 'checkbox', checked: s.enabled !== false, onchange: (e) => { if (e.target.checked) { delete s.enabled; delete s._note; } else s.enabled = false; markDirty('feeds.json'); render(); } })),
          h('div', { class: 'item__main' }, h('div', { class: 'item__title' }, s.name), h('div', { class: 'item__sub' }, `${TYPES[s.type || 'rss']?.label || s.type} · ${sourceLabel(s)}${s._note ? ` · ${s._note}` : ''}`)),
          h('div', { class: 'item__actions' },
            h('button', { title: s.featured ? 'Featured (click to unfeature)' : 'Feature on the front page', 'aria-pressed': String(!!s.featured), onclick: () => { s.featured = !s.featured; if (!s.featured) delete s.featured; markDirty('feeds.json'); render(); } }, icon(ICONS.star)),
            h('button', { title: 'Edit', onclick: () => { const f = sourceForm(s, cats, (upd) => { Object.keys(s).forEach((k) => delete s[k]); Object.assign(s, upd); markDirty('feeds.json'); render(); }, data.sources); view.querySelector('form.form')?.replaceWith(f); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, icon(ICONS.edit)),
            h('button', { title: 'Delete', onclick: () => { if (confirm(`Delete "${s.name}" from the site?`)) { data.sources.splice(data.sources.indexOf(s), 1); markDirty('feeds.json'); render(); } } }, icon(ICONS.trash)),
          ))))));
    }
    view.append(saveBar('feeds.json', 'Update sources (admin)'));
    renderSaveBar();
  }
  function sourceForm(existing, cats, onSubmit, all) {
    const s = existing || { type: 'rss', category: cats[0]?.id, kind: 'news' };
    const type = s.type || 'rss';
    const fieldsBox = h('div', { class: 'form' });
    const renderFields = (t) => { fieldsBox.innerHTML = ''; for (const [name, label, ph] of TYPES[t].fields) fieldsBox.append(h('label', {}, label, h('input', { name, value: s[name] || '', placeholder: ph, required: name !== 'homepage' && name !== 'profile' }))); if (t === 'rsshub' || t === 'rssbridge') fieldsBox.append(h('p', { class: 'help' }, 'Needs the feed server (see server/README.md in the repository).')); if (t === 'instagram') fieldsBox.append(h('p', { class: 'help' }, 'Needs the IG_USER_ID and IG_ACCESS_TOKEN secrets (run scripts/instagram-setup.js once).')); };
    const typeSel = h('select', { name: 'type', onchange: (e) => renderFields(e.target.value) }, Object.entries(TYPES).map(([k, v]) => h('option', { value: k, selected: k === type }, v.label)));
    renderFields(type);
    const f = h('form', { class: 'form' },
      h('h2', {}, existing ? `Edit: ${existing.name}` : 'Add a source'),
      h('label', {}, 'Kind of source', typeSel),
      fieldsBox,
      h('label', {}, 'Display name', h('input', { name: 'name', required: true, value: s.name || '', placeholder: 'Shown on cards' })),
      h('div', { class: 'editor__grid' },
        h('label', {}, 'Section', h('select', { name: 'category' }, cats.map((c) => h('option', { value: c.id, selected: c.id === s.category }, c.label)))),
        h('label', {}, 'Shows as', h('select', { name: 'kind' }, Object.entries(KINDS).map(([k, v]) => h('option', { value: k, selected: k === (s.kind || 'news') }, v))))),
      h('div', { class: 'field' }, 'Also show in ', h('span', { class: 'help' }, 'optional extra sections'), h('div', { class: 'row' }, cats.map((c) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'also', value: c.id, checked: !!(s.categories || []).slice(1).includes(c.id) }), c.label)))),
      h('label', { class: 'check' }, h('input', { name: 'featured', type: 'checkbox', checked: !!s.featured }), 'Featured: more room on the front page'),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, existing ? 'Apply' : 'Add'), existing ? h('button', { class: 'btn btn--ghost', type: 'button', onclick: render }, 'Cancel') : null),
    );
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(f); const t = fd.get('type');
      const out = { id: s.id, name: String(fd.get('name')).trim(), type: t === 'rss' ? undefined : t, category: fd.get('category'), kind: fd.get('kind') };
      for (const [name] of TYPES[t].fields) { const v = String(fd.get(name) || '').trim(); if (v) out[name] = v; }
      if (t === 'rssbridge') out.params = existing?.params || { context: 'User', u: (out.profile || '').split('/').filter(Boolean).pop() || '' };
      if (t === 'rss' && out.url && !/^https?:\/\//.test(out.url)) { toast('The feed URL must start with http:// or https://', true); return; }
      const also = fd.getAll('also').filter((c) => c !== out.category);
      if (also.length) out.categories = [out.category, ...also];
      if (fd.get('featured')) out.featured = true;
      if (s.enabled === false) out.enabled = false;
      if (s.fallbacks) out.fallbacks = s.fallbacks;
      if (!out.id) { const base = slugify(out.name); let id = base, n = 2; while (all.some((x) => x.id === id)) id = `${base}-${n++}`; out.id = id; }
      for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
      onSubmit(out);
    });
    return f;
  }

  /* Articles */
  async function renderArticles() {
    if (!state.articleCats) { const feeds = await loadJson('feeds.json'); state.articleCats = (feeds.categories || []).filter((c) => !['top', 'picks', 'ours'].includes(c.id)); }
    if (state.editing) return renderArticleEditor();
    view.append(h('h1', {}, 'Articles'), h('p', {}, 'Your own writing, published at gloriousanchor.com/articles/. Each article is a file; edits go live with the next build.'));
    view.append(h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { state.editing = { isNew: true, meta: { date: today(), author: '' }, body: '' }; render(); } }, 'New article')));
    const files = (await api(`${repoPath('articles')}?ref=${BRANCH}&t=${Date.now()}`)).filter((f) => f.type === 'file' && /\.(md|markdown)$/i.test(f.name)).sort((a, b) => b.name.localeCompare(a.name));
    state.articles = files;
    view.append(h('h2', {}, `Published files (${files.length})`));
    view.append(h('ul', { class: 'list' }, files.map((f) => h('li', { class: 'item' },
      h('span', { class: 'pill' }, f.name.slice(0, 10)),
      h('div', { class: 'item__main' }, h('div', { class: 'item__title' }, f.name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.(md|markdown)$/i, '').replace(/-/g, ' ')), h('div', { class: 'item__sub' }, h('a', { href: `../articles/${slugify(f.name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.(md|markdown)$/i, ''))}/`, target: '_blank', rel: 'noopener' }, 'View on the site ↗'))),
      h('div', { class: 'item__actions' },
        h('button', { title: 'Edit', onclick: async () => { try { const { sha, text } = await loadFile(`articles/${f.name}`); const { meta, body } = parseFrontMatter(text); state.editing = { name: f.name, sha, meta, body }; render(); } catch (e) { toast(e.message, true); } } }, icon(ICONS.edit)),
        h('button', { title: 'Delete', onclick: async () => { if (!confirm(`Unpublish and delete "${f.name}"?`)) return; try { await deleteFile(`articles/${f.name}`, `Delete article ${f.name} (admin)`); toast('Deleted. The site rebuilds in a few minutes.'); render(); } catch (e) { toast(e.message, true); } } }, icon(ICONS.trash)),
      )))));
  }
  function parseFrontMatter(text) {
    const m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) return { meta: {}, body: text };
    const meta = {};
    for (const line of m[1].split(/\r?\n/)) { const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/); if (kv) { let v = kv[2].trim(); if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1); meta[kv[1].toLowerCase()] = v === 'true' ? true : v === 'false' ? false : v; } }
    return { meta, body: m[2] };
  }
  const yamlValue = (v) => (typeof v === 'boolean' ? String(v) : /[:#"'\n]|^\s|\s$/.test(String(v)) ? JSON.stringify(String(v)) : String(v));
  function renderArticleEditor() {
    const ed = state.editing; const m = ed.meta;
    const field = (label, name, attrs = {}, help) => h('label', { class: 'field' }, label, help ? h('span', { class: 'help' }, help) : null, h('input', { name, value: m[name] ?? '', ...attrs }));
    const body = h('textarea', { name: 'body', class: 'body', placeholder: 'Write here. Plain text works. **bold**, *italic*, ## Heading, - list item, > quote, [link text](https://…)' }, ed.body);
    const preview = h('div', { class: 'preview', hidden: true });
    const imgInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => {
      const file = e.target.files[0]; if (!file) return;
      if (file.size > 4 * 1024 * 1024) { toast('Please use an image under 4 MB.', true); return; }
      try {
        const name = `${today()}-${slugify(file.name.replace(/\.[^.]+$/, ''))}.${(file.name.split('.').pop() || 'jpg').toLowerCase()}`;
        const buf = new Uint8Array(await file.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        await api(repoPath(`articles/images/${name}`), { method: 'PUT', body: JSON.stringify({ message: `Upload image ${name} (admin)`, content: btoa(bin), branch: BRANCH }) });
        form.elements.image.value = `images/${name}`; toast('Image uploaded.');
      } catch (err) { toast(err.message, true); }
    } });
    const form = h('form', { class: 'editor' },
      h('div', { class: 'row row--between' }, h('h1', {}, ed.isNew ? 'New article' : 'Edit article'), h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => { if (!state.dirtyEditor || confirm('Discard changes?')) { state.editing = null; state.dirtyEditor = false; render(); } } }, 'Back to list')),
      field('Title', 'title', { required: true }),
      h('div', { class: 'editor__grid' }, field('Date', 'date', { type: 'date', required: true }), field('Author', 'author', { placeholder: 'The Glorious Anchor team' })),
      field('Summary', 'summary', {}, 'One or two sentences for the card. Taken from the text if empty.'),
      h('div', { class: 'row' }, field('Image', 'image', { placeholder: 'images/photo.jpg or https://…' }), h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => imgInput.click() }, 'Upload image'), imgInput),
      (state.articleCats || []).length ? h('fieldset', { class: 'cats' }, h('legend', {}, 'Also show in'),
        ...state.articleCats.map((c) => h('label', { class: 'check' }, h('input', { name: 'cat', type: 'checkbox', value: c.id, checked: String(m.categories || '').split(/[,\s]+/).includes(c.id) }), c.label))) : null,
      h('div', { class: 'row' }, h('label', { class: 'check' }, h('input', { name: 'pinned', type: 'checkbox', checked: m.pinned === true }), 'Pin to the top of the front page (three days)'), h('label', { class: 'check' }, h('input', { name: 'draft', type: 'checkbox', checked: m.draft === true }), 'Draft (not published)')),
      h('div', { class: 'row row--between' }, h('span', { class: 'muted' }, 'Body'), h('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: () => { preview.hidden = !preview.hidden; if (!preview.hidden) preview.innerHTML = window.marked ? window.marked.parse(body.value) : '<p>Preview unavailable (offline).</p>'; } }, 'Preview')),
      body, preview,
      h('div', { class: 'savebar' }, h('button', { class: 'btn', type: 'submit' }, ed.isNew ? 'Publish' : 'Save'), h('span', { class: 'muted' }, ed.isNew ? 'Creates a new file in articles/' : `Editing ${ed.name}`)),
    );
    form.addEventListener('input', () => { state.dirtyEditor = true; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const meta = {};
      for (const k of ['title', 'date', 'author', 'summary', 'image']) { const v = String(fd.get(k) || '').trim(); if (v) meta[k] = v; }
      const cats = fd.getAll('cat').map(String).filter(Boolean);
      if (cats.length) meta.categories = cats.join(', ');
      if (fd.get('pinned')) meta.pinned = true;
      if (fd.get('draft')) meta.draft = true;
      for (const k of Object.keys(m)) if (!(k in meta) && !['pinned', 'draft', 'title', 'date', 'author', 'summary', 'image', 'categories'].includes(k)) meta[k] = m[k]; // keep unknown keys (slug, tags…)
      const text = `---\n${Object.entries(meta).map(([k, v]) => `${k}: ${yamlValue(v)}`).join('\n')}\n---\n\n${String(fd.get('body')).replace(/\r\n/g, '\n').trim()}\n`;
      const name = ed.name || `${meta.date}-${slugify(meta.title)}.md`;
      try {
        if (ed.isNew && state.articles?.some((f) => f.name === name)) throw new Error(`A file named ${name} already exists. Change the title or date.`);
        ed.sha = await saveFile(`articles/${name}`, text, `${ed.isNew ? 'Publish' : 'Update'} article: ${meta.title} (admin)`, ed.sha);
        ed.name = name; ed.isNew = false; ed.meta = meta; ed.body = String(fd.get('body')); state.dirtyEditor = false;
        toast(meta.draft ? 'Saved as a draft.' : 'Saved. It appears on the site after the next build.');
        render();
      } catch (err) { toast(err.message, true); }
    });
    view.append(form);
  }

  /* Churches */
  async function renderChurches() {
    const data = await loadJson('churches.json');
    data.churches ||= [];
    const built = await fetch(`../data/churches.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const located = new Map((built?.churches || []).map((c) => [c.name, c]));
    view.append(h('h1', {}, 'Churches'), h('p', {}, 'Churches listed directly with Glorious Anchor. They appear first, with a "Listed" badge, in the church finder, alongside OpenStreetMap results. Addresses are located automatically after you save.'));
    view.append(churchForm(null, (c) => { data.churches.unshift(c); markDirty('churches.json'); render(); }));
    view.append(h('h2', {}, `Listed churches (${data.churches.length})`));
    if (built?.problems?.length) view.append(h('p', { class: 'form__error' }, `Could not locate: ${built.problems.join('; ')}. Add more address detail or give latitude/longitude.`));
    view.append(h('ul', { class: 'list' }, data.churches.map((c, i) => { const loc = located.get(c.name); return h('li', { class: 'item' + (c.enabled === false ? ' item--off' : '') },
      h('label', { class: 'check', title: 'Shown in the finder' }, h('input', { type: 'checkbox', checked: c.enabled !== false, onchange: (e) => { if (e.target.checked) delete c.enabled; else c.enabled = false; markDirty('churches.json'); render(); } })),
      h('div', { class: 'item__main' }, h('div', { class: 'item__title' }, c.name), h('div', { class: 'item__sub' }, [c.denomination, [c.address, c.city, c.country].filter(Boolean).join(', '), (c.lat && c.lng) || loc?.lat != null ? '📍 located' : 'not located yet (next build)'].filter(Boolean).join(' · '))),
      h('div', { class: 'item__actions' },
        h('button', { title: 'Edit', onclick: () => { const f = churchForm(c, (upd) => { Object.keys(c).forEach((k) => delete c[k]); Object.assign(c, upd); markDirty('churches.json'); render(); }); view.querySelector('form.form')?.replaceWith(f); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, icon(ICONS.edit)),
        h('button', { title: 'Remove', onclick: () => { if (confirm(`Remove "${c.name}" from the directory?`)) { data.churches.splice(i, 1); markDirty('churches.json'); render(); } } }, icon(ICONS.trash)),
      )); })));
    view.append(saveBar('churches.json', 'Update church directory (admin)'));
    renderSaveBar();
  }
  /* ---------- Bible quizzes ---------- */
  const QUIZ_HELP = `One question per block, blank line between blocks. Mark the correct option with a * at the end. Ref and Note are optional.

Q: Who built the ark?
A: Noah *
A: Moses
A: Abraham
A: Jonah
Ref: Genesis 6:13–22
Note: Anything extra to show after answering.`;
  function quizToText(questions) {
    return (questions || []).map((qu) => [`Q: ${qu.q}`, ...qu.options.map((o, i) => `A: ${o}${i === qu.answer ? ' *' : ''}`), qu.ref ? `Ref: ${qu.ref}` : '', qu.note ? `Note: ${qu.note}` : ''].filter(Boolean).join('\n')).join('\n\n');
  }
  function textToQuiz(text) {
    const out = []; let cur = null;
    const flush = () => { if (cur) { out.push(cur); cur = null; } };
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) { flush(); continue; }
      const m = line.match(/^(Q|A|Ref|Note)\s*:\s*(.*)$/i);
      if (!m) throw new Error(`Could not read this line: "${line}". Start lines with Q:, A:, Ref: or Note:.`);
      const [, key, val] = m; const k = key.toLowerCase();
      if (k === 'q') { flush(); cur = { q: val, options: [], answer: -1 }; continue; }
      if (!cur) throw new Error(`"${line}" appears before any Q: line.`);
      if (k === 'a') { if (/\s*\*$/.test(val)) { cur.answer = cur.options.length; cur.options.push(val.replace(/\s*\*$/, '').trim()); } else cur.options.push(val); }
      else if (k === 'ref') cur.ref = val; else cur.note = val;
    }
    flush();
    out.forEach((qu, i) => {
      if (qu.options.length < 2 || qu.options.length > 6) throw new Error(`Question ${i + 1} needs 2 to 6 answers.`);
      if (qu.answer < 0) throw new Error(`Question ${i + 1} has no correct answer marked with *.`);
    });
    if (out.length < 3) throw new Error('A quiz needs at least 3 questions.');
    return out;
  }
  async function renderQuizzes() {
    const data = await loadJson('quizzes.json');
    data.quizzes ||= [];
    view.append(h('h1', {}, 'Bible quizzes'), h('p', {}, 'Played at /quiz/. The quiz of the day rotates through the enabled quizzes, one per day. Answers show the reference so readers can look it up.'));
    view.append(quizForm(null, (qz) => { data.quizzes.push(qz); markDirty('quizzes.json'); render(); }, data.quizzes));
    view.append(h('h2', {}, `Quizzes (${data.quizzes.length})`));
    view.append(h('ul', { class: 'list' }, data.quizzes.map((qz, i) => h('li', { class: 'item' + (qz.enabled === false ? ' item--off' : '') },
      h('label', { class: 'check', title: 'Enabled' }, h('input', { type: 'checkbox', checked: qz.enabled !== false, onchange: (e) => { if (e.target.checked) delete qz.enabled; else qz.enabled = false; markDirty('quizzes.json'); render(); } })),
      h('div', { class: 'item__body' }, h('strong', {}, qz.title), h('span', { class: 'muted' }, ` · ${(qz.questions || []).length} questions · ${qz.difficulty || 'medium'} · `, h('a', { href: `../quiz/?q=${encodeURIComponent(qz.id)}`, target: '_blank' }, 'play ↗')), qz.description ? h('div', { class: 'muted' }, qz.description) : null),
      h('div', { class: 'item__actions' },
        h('button', { title: 'Create video', onclick: () => renderVideo(qz.id) }, '▶'),
        h('button', { title: 'Edit', onclick: () => { const f = quizForm(qz, (upd) => { Object.keys(qz).forEach((k) => delete qz[k]); Object.assign(qz, upd); markDirty('quizzes.json'); render(); }, data.quizzes); view.querySelector('form.form')?.replaceWith(f); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, icon(ICONS.edit)),
        h('button', { title: 'Delete', onclick: () => { if (confirm(`Delete the quiz "${qz.title}"?`)) { data.quizzes.splice(i, 1); markDirty('quizzes.json'); render(); } } }, icon(ICONS.trash)),
      )))));
    view.append(h('div', { class: 'row' },
      h('button', { class: 'btn btn--ghost', onclick: () => renderVideo('all') }, 'Create videos for all quizzes'),
      h('span', { class: 'help' }, 'Makes a vertical video of each quiz (question, countdown, answer with reference) for YouTube Shorts, TikTok, Reels or WhatsApp status. Takes about five minutes; it then appears on the quiz page as "Watch or download".')));
    view.append(saveBar('quizzes.json', 'Update Bible quizzes (admin)'));
  }
  function quizForm(existing, onSubmit, all) {
    const qz = existing || {};
    const f = h('form', { class: 'form' },
      h('h2', {}, existing ? 'Edit quiz' : 'New quiz'),
      h('div', { class: 'editor__grid' },
        h('label', {}, 'Title', h('input', { name: 'title', required: true, value: qz.title || '', placeholder: 'e.g. The Parables of Jesus' })),
        h('label', {}, 'Difficulty', h('select', { name: 'difficulty' }, ['easy', 'medium', 'hard'].map((d) => h('option', { value: d, selected: d === (qz.difficulty || 'medium') }, d))))),
      h('label', {}, 'Description ', h('span', { class: 'help' }, 'One sentence shown above the quiz.'), h('input', { name: 'description', value: qz.description || '' })),
      h('label', {}, 'Questions ', h('span', { class: 'help' }, 'Q: question, then A: lines (mark the right one with *), then Ref: and Note: if wanted. Blank line between questions.'),
        h('textarea', { name: 'questions', class: 'body', rows: 18, required: true, placeholder: QUIZ_HELP }, quizToText(qz.questions))),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, existing ? 'Apply' : 'Add quiz'), existing ? h('button', { class: 'btn btn--ghost', type: 'button', onclick: render }, 'Cancel') : null),
    );
    f.addEventListener('submit', (e) => {
      e.preventDefault(); const fd = new FormData(f);
      try {
        const title = String(fd.get('title') || '').trim();
        const id = qz.id || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!id) throw new Error('Give the quiz a title.');
        if (!qz.id && all.some((o) => o.id === id)) throw new Error('A quiz with that title already exists.');
        const out = { id, title, difficulty: String(fd.get('difficulty')), questions: textToQuiz(String(fd.get('questions') || '')) };
        const description = String(fd.get('description') || '').trim(); if (description) out.description = description;
        if (qz.enabled === false) out.enabled = false;
        onSubmit(out);
      } catch (err) { toast(err.message, true); }
    });
    return f;
  }

  function churchForm(existing, onSubmit) {
    const c = existing || {};
    const f = h('form', { class: 'form' },
      h('h2', {}, existing ? 'Edit church' : 'Add a church'),
      h('label', {}, 'Church name', h('input', { name: 'name', required: true, value: c.name || '' })),
      h('label', {}, 'Street address', h('input', { name: 'address', required: !(c.lat && c.lng), value: c.address || '', placeholder: '12 Example Road' })),
      h('div', { class: 'editor__grid' }, h('label', {}, 'City / town', h('input', { name: 'city', value: c.city || '' })), h('label', {}, 'Country', h('input', { name: 'country', value: c.country || '' }))),
      h('div', { class: 'editor__grid' }, h('label', {}, 'Denomination', h('input', { name: 'denomination', value: c.denomination || '', placeholder: 'e.g. Anglican, Pentecostal, Catholic' })), h('label', {}, 'Service times', h('input', { name: 'serviceTimes', value: c.serviceTimes || '', placeholder: 'Sundays 9:00 and 11:00' }))),
      h('div', { class: 'editor__grid' }, h('label', {}, 'Website', h('input', { name: 'website', value: c.website || '', placeholder: 'https://…' })), h('label', {}, 'Phone', h('input', { name: 'phone', value: c.phone || '' }))),
      h('label', {}, 'Notes ', h('span', { class: 'help' }, '(optional, shown in the finder)'), h('input', { name: 'notes', value: c.notes || '' })),
      h('details', {}, h('summary', { class: 'muted' }, 'Exact coordinates (optional: fill if the address cannot be located)'),
        h('div', { class: 'editor__grid' }, h('label', {}, 'Latitude', h('input', { name: 'lat', type: 'number', step: 'any', value: c.lat ?? '' })), h('label', {}, 'Longitude', h('input', { name: 'lng', type: 'number', step: 'any', value: c.lng ?? '' })))),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, existing ? 'Apply' : 'Add'), existing ? h('button', { class: 'btn btn--ghost', type: 'button', onclick: render }, 'Cancel') : null),
    );
    f.addEventListener('submit', (e) => {
      e.preventDefault(); const fd = new FormData(f); const out = {};
      for (const k of ['name', 'address', 'city', 'country', 'denomination', 'serviceTimes', 'website', 'phone', 'notes']) { const v = String(fd.get(k) || '').trim(); if (v) out[k] = v; }
      const lat = parseFloat(fd.get('lat')), lng = parseFloat(fd.get('lng'));
      if (Number.isFinite(lat) && Number.isFinite(lng)) { out.lat = lat; out.lng = lng; }
      if (!out.address && !(out.lat != null)) { toast('Give a street address or exact coordinates.', true); return; }
      if (c.enabled === false) out.enabled = false;
      if (c.id) out.id = c.id;
      onSubmit(out);
    });
    return f;
  }

  /* Settings */
  async function renderSettings() {
    const data = await loadJson('feeds.json');
    data.site ||= {}; data.limits ||= {};
    view.append(h('h1', {}, 'Settings'));
    const f = h('form', { class: 'form' },
      h('h2', {}, 'Site'),
      h('label', {}, 'Name', h('input', { name: 'name', value: data.site.name || '' })),
      h('label', {}, 'Tagline', h('input', { name: 'tagline', value: data.site.tagline || '' })),
      h('label', {}, 'Verse (footer)', h('input', { name: 'verse', value: data.site.verse || '' })),
      h('label', {}, 'Site address', h('input', { name: 'url', type: 'url', value: data.site.url || '' })),
      h('label', {}, 'Google Search Console verification code ', h('span', { class: 'help' }, 'Optional. From Search Console → URL-prefix property → HTML tag: paste only the content value.'), h('input', { name: 'googleSiteVerification', value: data.site.googleSiteVerification || '' })),
      h('h2', {}, 'Growth'),
      h('label', {}, 'GoatCounter site code ', h('span', { class: 'help' }, 'Optional, free visitor statistics without cookies. Sign up at goatcounter.com and paste the code you chose (the part before .goatcounter.com).'), h('input', { name: 'goatcounter', value: data.site.goatcounter || '' })),
      h('label', {}, 'Cloudflare Web Analytics token ', h('span', { class: 'help' }, 'Optional alternative: Cloudflare dashboard → Web Analytics → Add a site → copy the token from the snippet.'), h('input', { name: 'cloudflareAnalytics', value: data.site.cloudflareAnalytics || '' })),
      h('label', {}, 'Newsletter sign-up page ', h('span', { class: 'help' }, 'Optional. Your Buttondown page (https://buttondown.com/yourname) puts a subscribe form on the site; any other address becomes a Subscribe button.'), h('input', { name: 'newsletter', type: 'url', value: data.site.newsletter || '' })),
      h('label', {}, 'Contact email ', h('span', { class: 'help' }, 'Shown as a Contact link in the footer.'), h('input', { name: 'contactEmail', type: 'email', value: data.site.contactEmail || '' })),
      h('div', { class: 'editor__grid' },
        h('label', {}, 'WhatsApp channel link', h('input', { name: 'whatsappChannel', type: 'url', value: data.site.whatsappChannel || '', placeholder: 'https://whatsapp.com/channel/…' })),
        h('label', {}, 'Telegram channel link', h('input', { name: 'telegramChannel', type: 'url', value: data.site.telegramChannel || '', placeholder: 'https://t.me/…' }))),
      h('label', {}, 'X (Twitter) handle ', h('span', { class: 'help' }, 'Added as "via @handle" when items are shared or auto-posted.'), h('input', { name: 'xHandle', value: data.site.xHandle || '' })),
      h('h2', {}, 'Feeds'),
      h('label', {}, 'Hidden stories ', h('span', { class: 'help' }, 'One per line: a story id (the part after /s/ in a story link, e.g. 1viixrk), a full story link, or a publisher link to hide everything under it. Hidden stories vanish from the site at the next build.'), h('textarea', { name: 'hidden', rows: 4, placeholder: '1viixrk\nhttps://example.com/section/' }, (data.hidden || []).join('\n'))),
      h('label', {}, 'Keep stories for (hours) ', h('span', { class: 'help' }, 'Feed stories older than this drop off. Picks and your articles never expire.'), h('input', { name: 'maxAgeHours', type: 'number', min: 6, max: 720, value: data.limits.maxAgeHours || 96 })),
      h('label', {}, 'Items per feed', h('input', { name: 'perSource', type: 'number', min: 5, max: 100, value: data.limits.perSource || 25 })),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, 'Apply')),
    );
    f.addEventListener('submit', (e) => {
      e.preventDefault(); const fd = new FormData(f);
      for (const k of ['name', 'tagline', 'verse', 'url', 'googleSiteVerification', 'goatcounter', 'cloudflareAnalytics', 'xHandle', 'newsletter', 'contactEmail', 'whatsappChannel', 'telegramChannel']) { const v = String(fd.get(k) || '').trim(); if (v) data.site[k] = v; else delete data.site[k]; }
      data.limits.maxAgeHours = Number(fd.get('maxAgeHours')) || 96; data.limits.perSource = Number(fd.get('perSource')) || 25;
      const hidden = String(fd.get('hidden') || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      if (hidden.length) data.hidden = hidden; else delete data.hidden;
      markDirty('feeds.json'); toast('Applied. Click Save changes to publish.');
    });
    view.append(f);
    view.append(h('h2', {}, 'This admin'), h('p', {}, `Connected to ${store.repo}. The token is stored only in this browser.`), h('div', { class: 'row' }, h('button', { class: 'btn btn--ghost', onclick: signOut }, 'Sign out / change token')));
    view.append(saveBar('feeds.json', 'Update site settings (admin)'));
    renderSaveBar();
  }

  /* ---------- rebuild, sign in/out, boot ---------- */
  async function renderVideo(quizId) {
    if (state.dirty.size && !confirm('You have unsaved changes; the video uses what is saved. Continue?')) return;
    try {
      await api(`/repos/${store.repo}/actions/workflows/quiz-video.yml/dispatches`, { method: 'POST', body: JSON.stringify({ ref: BRANCH, inputs: { quiz: quizId, limit: '0' } }) });
      toast('Video rendering started. In about five minutes it is on the quiz page under "Watch or download".');
    } catch (e) { toast(e.message, true); }
  }
  async function rebuild() {
    try {
      await api(`/repos/${store.repo}/actions/workflows/build.yml/dispatches`, { method: 'POST', body: JSON.stringify({ ref: BRANCH }) });
      toast('Rebuild started. The site updates in about two minutes.');
    } catch (e) { toast(e.message, true); }
  }
  function signOut() { if (confirm('Sign out of the admin on this browser?')) { store.token = ''; location.reload(); } }
  async function connect(repo, token) {
    const prevToken = store.token, prevRepo = store.repo;
    store.repo = repo.trim(); store.token = token.trim();
    try {
      const r = await api(`/repos/${store.repo}`);
      if (!r.permissions?.push) throw new Error('This token cannot write to the repository. Check "Contents: Read and write" under its permissions.');
      return true;
    } catch (e) { store.token = prevToken; store.repo = prevRepo; throw e; }
  }
  async function boot() {
    $('#rebuildBtn').addEventListener('click', rebuild);
    $('#signOutBtn').addEventListener('click', signOut);
    for (const b of document.querySelectorAll('#adminNav .cat')) b.addEventListener('click', () => setView(b.dataset.view));
    $('#setupForm').addEventListener('submit', async (e) => {
      e.preventDefault(); const err = $('#setupError'); err.hidden = true;
      try { await connect($('#repoInput').value, $('#tokenInput').value); showAdmin(); } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
    window.addEventListener('beforeunload', (e) => { if (state.dirty.size || state.dirtyEditor) { e.preventDefault(); e.returnValue = ''; } });
    if (store.token) showAdmin(); else { $('#setup').hidden = false; $('#repoInput').value = store.repo; }
  }
  function showAdmin() {
    $('#setup').hidden = true; $('#view').hidden = false; $('#topTools').hidden = false; $('#adminNav').hidden = false;
    const initial = location.hash.replace('#', '');
    state.view = ['dashboard', 'picks', 'sources', 'articles', 'churches', 'quizzes', 'settings'].includes(initial) ? initial : 'dashboard';
    for (const b of document.querySelectorAll('#adminNav .cat')) b.setAttribute('aria-current', String(b.dataset.view === state.view));
    render();
  }
  boot();
})();
