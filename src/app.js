/* Glorious Anchor — client. Loads data/articles.json + data/meta.json and renders. */
(() => {
  'use strict';

  const PAGE = 36;
  const HERO_COUNT = 4;
  const $ = (sel) => document.querySelector(sel);
  const els = {
    cats: $('#cats'), status: $('#status'), hero: $('#hero'), grid: $('#grid'), empty: $('#empty'),
    more: $('#moreBtn'), sourceSel: $('#sourceSel'), sortSel: $('#sortSel'), q: $('#q'), searchForm: $('#searchForm'),
    savedBtn: $('#savedBtn'), savedCount: $('#savedCount'), themeBtn: $('#themeBtn'), footerMeta: $('#footerMeta'),
    tpl: $('#cardTpl'),
    customizeBtn: $('#customizeBtn'), mySetup: $('#mySetup'), mySetupBtn: $('#mySetupBtn'),
    picker: $('#picker'), pickerList: $('#pickerList'), pickerSearch: $('#pickerSearch'), pickerCount: $('#pickerCount'),
    pickerAll: $('#pickerAll'), pickerNone: $('#pickerNone'),
  };
  const MINE = 'mine';
  // Branded entry pages (/tv/, /radio/) are the same app served one folder down, opening on their own category.
  const metaContent = (name) => document.querySelector(`meta[name="${name}"]`)?.content || '';
  const BRAND = metaContent('ga-brand');
  const BASE = BRAND ? '../' : '';
  const HOME_CAT = metaContent('ga-category') || 'top';
  const SITE_TITLE = document.title;

  const state = {
    articles: [], meta: null, sourceMap: new Map(), category: HOME_CAT, source: '', sort: 'newest', query: '', showSaved: false, shown: PAGE,
    saved: loadJSON('ga:saved', {}),
    followed: new Set(loadJSON('ga:myfeed', [])),
  };
  function persistFollowed() { saveJSON('ga:myfeed', [...state.followed]); }

  function loadJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
  function saveJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ } }

  /* ---------- Theme ---------- */
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
  }
  applyTheme(loadJSON('ga:theme', null));
  els.themeBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next); saveJSON('ga:theme', next);
  });

  /* ---------- URL state ---------- */
  function readUrl() {
    const p = new URLSearchParams(location.search);
    state.category = p.get('c') || HOME_CAT;
    state.source = p.get('s') || '';
    state.query = (p.get('q') || '').trim();
    state.sort = ['source', 'news', 'video', 'audio', 'social'].includes(p.get('sort')) ? p.get('sort') : 'newest';
    state.showSaved = p.get('saved') === '1';
  }
  function writeUrl() {
    const p = new URLSearchParams();
    if (state.category !== HOME_CAT) p.set('c', state.category);
    if (state.source) p.set('s', state.source);
    if (state.query) p.set('q', state.query);
    if (state.sort !== 'newest') p.set('sort', state.sort);
    if (state.showSaved) p.set('saved', '1');
    const qs = p.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  }

  /* ---------- Formatting ---------- */
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  function relTime(ts) {
    const diff = (ts - Date.now()) / 1000;
    const abs = Math.abs(diff);
    if (abs < 60) return 'just now';
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function highlight(text, q) {
    if (!q) return escapeHtml(text);
    const terms = q.split(/\s+/).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!terms.length) return escapeHtml(text);
    const re = new RegExp(`(${terms.join('|')})`, 'gi');
    return text.split(re).map((part, i) => (i % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part))).join('');
  }

  /* ---------- Filtering ---------- */
  function visibleArticles() {
    let list = state.articles;
    if (state.showSaved) list = list.filter((a) => state.saved[a.id]);
    else if (state.category === MINE) list = list.filter((a) => state.followed.has(a.sourceId));
    else if (state.category !== 'top') list = list.filter((a) => (a.categories || [a.category]).includes(state.category));
    else if (!state.query && !state.source) list = topMix(list);
    if (state.source) list = list.filter((a) => a.sourceId === state.source);
    if (['video', 'audio', 'social'].includes(state.sort)) list = list.filter((a) => a.kind === state.sort);
    else if (state.sort === 'news') list = list.filter((a) => a.kind === 'news' || a.kind === 'article');
    if (state.sort === 'newest' && !state.query && ['top', 'picks', 'ours'].includes(state.category)) {
      list = [...list.filter((a) => a.pinned), ...list.filter((a) => !a.pinned)];
    }
    if (state.query) {
      const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((a) => {
        const hay = `${a.title} ${a.summary} ${a.source}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }
    return list;
  }

  /**
   * "Top Stories" view: a time-sorted mix of everything, capped per source so one chatty feed,
   * channel or subreddit can't dominate the front page. Featured sources get more room.
   */
  const TOP_CAPS = { news: 5, article: 4, video: 3, audio: 2, social: 2, pick: 40 };
  function topMix(all) {
    const perSource = new Map();
    const out = [];
    for (const a of all) {
      const n = perSource.get(a.sourceId) || 0;
      const cap = (TOP_CAPS[a.kind] || 4) * (a.featured ?? srcInfo(a).featured ? 2 : 1);
      if (n >= cap) continue;
      perSource.set(a.sourceId, n + 1);
      out.push(a);
    }
    return out;
  }

  /* ---------- Rendering ---------- */
  function allCategories() {
    const cats = [...state.meta.categories];
    cats.splice(1, 0, { id: MINE, label: 'My Feed' });
    return cats;
  }
  function renderCats() {
    els.cats.innerHTML = '';
    for (const c of allCategories()) {
      const b = document.createElement('button');
      b.className = 'cat'; b.textContent = c.label; b.dataset.id = c.id;
      if (c.id === MINE) {
        b.classList.add('cat--mine');
        b.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/></svg>');
      }
      b.setAttribute('aria-current', String(!state.showSaved && c.id === state.category));
      b.addEventListener('click', () => { state.category = c.id; state.showSaved = false; state.shown = PAGE; update(); });
      els.cats.appendChild(b);
    }
    const link = document.createElement('a'); link.className = 'cat cat--link'; link.href = `${BASE}churches/`; link.textContent = '⛪ Find a church';
    els.cats.appendChild(link);
  }
  function renderSources() {
    const byCat = state.category === 'top' ? state.meta.sources
      : state.category === MINE ? state.meta.sources.filter((s) => state.followed.has(s.id))
      : state.meta.sources.filter((s) => (s.categories || [s.category]).includes(state.category));
    const names = new Map();
    for (const s of byCat) if (!names.has(s.id)) names.set(s.id, s);
    const current = state.source;
    els.sourceSel.innerHTML = '<option value="">All sources</option>';
    const sorted = [...names.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    for (const s of sorted) {
      const o = document.createElement('option');
      o.value = s.id;
      const dup = sorted.filter((x) => x.name === s.name).length > 1;
      const catLabel = state.meta.categories.find((c) => c.id === s.category)?.label;
      o.textContent = dup && catLabel ? `${s.name} — ${catLabel}` : s.name;
      els.sourceSel.appendChild(o);
    }
    els.sourceSel.value = names.has(current) ? current : '';
    if (!names.has(current)) state.source = '';
  }

  const KIND_LABEL = { news: 'News', article: 'Article', video: 'Video', audio: 'Audio', social: 'Post', pick: 'Pick' };
  function fmtDuration(sec) {
    if (!sec) return '';
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h ? `${h} h ${m} min` : `${Math.max(1, m)} min`;
  }
  /** Third-party images go through a resizing proxy (set in feeds.json → site.imageProxy); our own files are served as-is. */
  function imgUrl(url, w) {
    const t = state.meta?.site?.imageProxy;
    if (!t || !url || url.startsWith(location.origin) || /^https?:\/\/gloriousanchor\.com\//.test(url)) return url;
    return t.replace(/\{url\}/g, encodeURIComponent(url)).replace('{w}', String(w));
  }
  const srcInfo = (a) => state.sourceMap.get(a.sourceId) || {};
  function card(a, extraClass) {
    const node = els.tpl.content.firstElementChild.cloneNode(true);
    if (extraClass) node.classList.add(extraClass);
    node.classList.add(`card--${a.kind || 'news'}`);
    node.querySelector('.card__kind').textContent = KIND_LABEL[a.kind] || 'News';
    const media = node.querySelector('.card__media');
    const img = media.querySelector('img');
    if (a.image) {
      media.href = a.url; img.alt = '';
      const w = extraClass === 'lead' ? 960 : 480;
      const direct = a.image, viaProxy = imgUrl(direct, w);
      img.src = viaProxy;
      if (extraClass === 'lead') { img.loading = 'eager'; img.setAttribute('fetchpriority', 'high'); }
      img.addEventListener('error', () => { if (img.src !== direct) img.src = direct; else node.classList.add('card--noimg'); });
    } else node.classList.add('card--noimg');
    const src = node.querySelector('.card__source');
    src.textContent = a.source;
    if (a.audio) {
      // Podcast episodes play right on the card; the player is created on first tap so nothing loads until asked.
      const row = document.createElement('div'); row.className = 'card__audio';
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'listen';
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><span>Listen</span>';
      const dur = document.createElement('span'); dur.className = 'card__duration'; dur.textContent = fmtDuration(a.duration);
      row.append(btn, dur);
      node.querySelector('.card__body').appendChild(row);
      const play = (e) => {
        e.preventDefault();
        if (row.querySelector('audio')) return;
        const player = document.createElement('audio'); player.controls = true; player.preload = 'none'; player.src = a.audio;
        btn.replaceWith(player); player.play().catch(() => {});
        for (const other of document.querySelectorAll('.card__audio audio')) if (other !== player) other.pause();
      };
      btn.addEventListener('click', play);
      if (a.image) media.addEventListener('click', play);
    }
    if (a.author && a.kind !== 'video' && a.author.toLowerCase() !== a.source.toLowerCase()) {
      const by = document.createElement('span'); by.className = 'card__author'; by.textContent = ` · ${a.author}`;
      src.after(by);
    }
    const t = node.querySelector('.card__time');
    t.dateTime = new Date(a.publishedAt).toISOString();
    t.textContent = relTime(a.publishedAt);
    t.title = new Date(a.publishedAt).toLocaleString();
    const link = node.querySelector('.card__title a');
    link.href = a.url; link.innerHTML = highlight(a.title, state.query);
    if (a.internal) { link.removeAttribute('target'); media.removeAttribute('target'); }
    const sum = node.querySelector('.card__summary');
    if (a.summary) sum.innerHTML = highlight(a.summary, state.query); else sum.remove();
    if (a.note) { const n = document.createElement('p'); n.className = 'card__note'; n.innerHTML = highlight(a.note, state.query); node.querySelector('.card__body').appendChild(n); }
    if (a.pinned) { node.classList.add('card--pinned'); node.querySelector('.card__kind').textContent = a.internal ? 'Pinned' : 'Pinned pick'; }
    if (a.internal) node.querySelector('.card__kind').textContent = a.pinned ? 'Pinned' : 'Ours';
    const save = node.querySelector('.save');
    const setSaved = (on) => { save.setAttribute('aria-pressed', String(on)); save.title = on ? 'Remove from saved' : 'Save story'; };
    setSaved(Boolean(state.saved[a.id]));
    save.addEventListener('click', () => {
      if (state.saved[a.id]) delete state.saved[a.id]; else state.saved[a.id] = Date.now();
      saveJSON('ga:saved', state.saved); setSaved(Boolean(state.saved[a.id])); updateSavedBadge();
      if (state.showSaved) update();
    });
    return node;
  }

  function renderList(list) {
    els.hero.innerHTML = ''; els.grid.innerHTML = '';
    els.grid.classList.toggle('grid--grouped', state.sort === 'source');
    const useHero = state.sort === 'newest' && !state.query && !state.showSaved && list.length >= HERO_COUNT;
    let rest = list;
    if (useHero) {
      // Pinned items always lead; the remaining hero slots prefer stories with pictures.
      const pinnedFirst = list.filter((a) => a.pinned);
      const strong = list.filter((a) => !a.pinned && a.image && a.kind !== 'social');
      const withImg = list.filter((a) => !a.pinned && a.image);
      const rest0 = list.filter((a) => !a.pinned);
      const pool = strong.length + pinnedFirst.length >= HERO_COUNT ? strong : withImg.length + pinnedFirst.length >= HERO_COUNT ? withImg : rest0;
      const pick = [...pinnedFirst, ...pool].slice(0, HERO_COUNT);
      const picked = new Set(pick.map((a) => a.id));
      rest = list.filter((a) => !picked.has(a.id));
      pick.forEach((a, i) => els.hero.appendChild(card(a, i === 0 ? 'lead' : 'side')));
    }
    els.hero.hidden = !useHero;

    const slice = rest.slice(0, state.shown);
    if (state.sort === 'source') {
      const groups = new Map();
      for (const a of slice) { if (!groups.has(a.sourceId)) groups.set(a.sourceId, []); groups.get(a.sourceId).push(a); }
      for (const [, items] of groups) {
        const sec = document.createElement('section'); sec.className = 'group';
        const head = document.createElement('div'); head.className = 'group__head';
        const h = document.createElement('h2'); h.textContent = items[0].source;
        head.appendChild(h);
        const home = items[0].sourceHome || srcInfo(items[0]).homepage;
        if (home) { const a = document.createElement('a'); a.href = home; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Visit site ↗'; head.appendChild(a); }
        head.appendChild(followButton(items[0].sourceId));
        const g = document.createElement('div'); g.className = 'grid';
        items.forEach((a) => g.appendChild(card(a)));
        sec.append(head, g); els.grid.appendChild(sec);
      }
    } else {
      const frag = document.createDocumentFragment();
      slice.forEach((a) => frag.appendChild(card(a)));
      els.grid.appendChild(frag);
    }
    const needsSetup = state.category === MINE && !state.showSaved && state.followed.size === 0;
    els.mySetup.hidden = !needsSetup;
    els.empty.hidden = list.length > 0 || needsSetup;
    els.more.hidden = rest.length <= state.shown;
    const label = state.showSaved ? 'saved' : state.query ? `matching “${state.query}”` : '';
    const noun = state.sort === 'video' ? ['video', 'videos'] : state.sort === 'audio' ? ['episode', 'episodes'] : state.sort === 'social' ? ['post', 'posts'] : ['item', 'items'];
    els.status.textContent = `${list.length.toLocaleString()} ${list.length === 1 ? noun[0] : noun[1]} ${label}`.trim() +
      (state.meta?.generatedAt ? ` · updated ${relTime(Date.parse(state.meta.generatedAt))}` : '');
  }

  function updateSavedBadge() {
    const n = Object.keys(state.saved).length;
    els.savedCount.textContent = String(n); els.savedCount.hidden = n === 0;
    els.savedBtn.setAttribute('aria-pressed', String(state.showSaved));
  }

  function update() {
    for (const b of els.cats.children) b.setAttribute('aria-current', String(!state.showSaved && b.dataset.id === state.category));
    els.customizeBtn.hidden = !(state.category === MINE && !state.showSaved && state.followed.size > 0);
    renderSources();
    els.sortSel.value = state.sort; els.q.value = state.query;
    updateSavedBadge();
    renderList(visibleArticles());
    writeUrl();
  }

  /* ---------- My Feed: follow + source picker ---------- */
  function followButton(sourceId) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'follow';
    const paint = () => { const on = state.followed.has(sourceId); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '✓ Following' : '+ Follow'; };
    paint();
    b.addEventListener('click', () => { if (state.followed.has(sourceId)) state.followed.delete(sourceId); else state.followed.add(sourceId); persistFollowed(); paint(); if (state.category === MINE) update(); });
    return b;
  }

  function buildPicker() {
    els.pickerList.innerHTML = '';
    const cats = state.meta.categories.filter((c) => c.id !== 'top');
    for (const c of cats) {
      const sources = state.meta.sources.filter((s) => s.category === c.id).sort((a, b) => a.name.localeCompare(b.name));
      if (!sources.length) continue;
      const g = document.createElement('section'); g.className = 'pgroup'; g.dataset.cat = c.id;
      const head = document.createElement('div'); head.className = 'pgroup__head';
      const h = document.createElement('h3'); h.textContent = c.label;
      const all = document.createElement('button'); all.type = 'button'; all.className = 'link'; all.dataset.toggle = c.id;
      head.append(h, all); g.appendChild(head);
      for (const s of sources) {
        const label = document.createElement('label'); label.className = 'pitem'; label.dataset.name = s.name.toLowerCase();
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = s.id; cb.checked = state.followed.has(s.id);
        cb.addEventListener('change', () => { if (cb.checked) state.followed.add(s.id); else state.followed.delete(s.id); persistFollowed(); paintPicker(); });
        const name = document.createElement('span'); name.className = 'pitem__name'; name.textContent = s.name;
        const kind = document.createElement('span'); kind.className = 'pitem__kind'; kind.textContent = KIND_LABEL[s.kind] || s.kind;
        label.append(cb, name, kind); g.appendChild(label);
      }
      els.pickerList.appendChild(g);
    }
    paintPicker();
  }
  function paintPicker() {
    const n = state.followed.size;
    els.pickerCount.textContent = n ? `${n} source${n === 1 ? '' : 's'} selected` : 'Nothing selected yet';
    for (const g of els.pickerList.querySelectorAll('.pgroup')) {
      const boxes = [...g.querySelectorAll('input')];
      const allOn = boxes.every((b) => b.checked);
      g.querySelector('[data-toggle]').textContent = allOn ? 'Deselect all' : 'Select all';
    }
  }
  function setGroup(catId, on) {
    for (const cb of els.pickerList.querySelectorAll(`.pgroup[data-cat="${catId}"] input`)) { cb.checked = on; if (on) state.followed.add(cb.value); else state.followed.delete(cb.value); }
    persistFollowed(); paintPicker();
  }
  function openPicker() {
    buildPicker();
    els.pickerSearch.value = ''; filterPicker('');
    if (typeof els.picker.showModal === 'function') els.picker.showModal(); else els.picker.setAttribute('open', '');
    els.pickerSearch.focus();
  }
  function filterPicker(q) {
    q = q.trim().toLowerCase();
    for (const g of els.pickerList.querySelectorAll('.pgroup')) {
      let visible = 0;
      for (const item of g.querySelectorAll('.pitem')) { const show = !q || item.dataset.name.includes(q); item.hidden = !show; if (show) visible++; }
      g.hidden = visible === 0;
    }
  }
  els.pickerList.addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle]');
    if (!t) return;
    const boxes = [...els.pickerList.querySelectorAll(`.pgroup[data-cat="${t.dataset.toggle}"] input`)];
    setGroup(t.dataset.toggle, !boxes.every((b) => b.checked));
  });
  els.pickerAll.addEventListener('click', () => { for (const s of state.meta.sources) state.followed.add(s.id); for (const cb of els.pickerList.querySelectorAll('input')) cb.checked = true; persistFollowed(); paintPicker(); });
  els.pickerNone.addEventListener('click', () => { state.followed.clear(); for (const cb of els.pickerList.querySelectorAll('input')) cb.checked = false; persistFollowed(); paintPicker(); });
  els.pickerSearch.addEventListener('input', () => filterPicker(els.pickerSearch.value));
  els.picker.addEventListener('close', () => { state.category = MINE; state.showSaved = false; state.shown = PAGE; update(); });
  els.picker.addEventListener('click', (e) => { if (e.target === els.picker) els.picker.close(); });
  els.customizeBtn.addEventListener('click', openPicker);
  els.mySetupBtn.addEventListener('click', openPicker);

  /* ---------- Events ---------- */
  els.sourceSel.addEventListener('change', () => { state.source = els.sourceSel.value; state.shown = PAGE; update(); });
  els.sortSel.addEventListener('change', () => { state.sort = els.sortSel.value; state.shown = PAGE; update(); });
  els.more.addEventListener('click', () => { state.shown += PAGE; update(); });
  els.savedBtn.addEventListener('click', () => { state.showSaved = !state.showSaved; state.shown = PAGE; update(); });
  els.searchForm.addEventListener('submit', (e) => { e.preventDefault(); state.query = els.q.value.trim(); state.shown = PAGE; update(); });
  let debounce;
  els.q.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => { state.query = els.q.value.trim(); state.shown = PAGE; update(); }, 220); });
  els.q.addEventListener('focus', () => els.searchForm.classList.add('open'));
  els.q.addEventListener('blur', () => { if (!els.q.value) els.searchForm.classList.remove('open'); });
  document.addEventListener('keydown', (e) => { if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); els.q.focus(); } });
  // Refresh relative timestamps once a minute.
  setInterval(() => { document.querySelectorAll('time.card__time').forEach((t) => { t.textContent = relTime(Date.parse(t.dateTime)); }); }, 60000);

  /* ---------- PWA: install prompt, offline notice, updates ---------- */
  let installEvent = null;
  const installBtn = $('#installBtn');
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; installBtn.hidden = false; });
  installBtn.addEventListener('click', async () => { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice; installEvent = null; installBtn.hidden = true; });
  window.addEventListener('appinstalled', () => { installBtn.hidden = true; });
  const offlineBanner = $('#offlineBanner');
  const paintOnline = () => { offlineBanner.hidden = navigator.onLine !== false; };
  window.addEventListener('online', paintOnline); window.addEventListener('offline', paintOnline); paintOnline();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register(`${BASE}sw.js`);
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          sw?.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) $('#updateBanner').hidden = false;
          });
        });
        $('#reloadBtn').addEventListener('click', () => { reg.waiting?.postMessage('skipWaiting'); location.reload(); });
      } catch (err) { console.warn('Service worker not registered', err); }
    });
  }

  /* ---------- Boot ---------- */
  function skeleton(n) {
    if (els.grid.querySelector('.card')) return; // pre-rendered headlines are already there; keep them until data loads
    els.grid.innerHTML = '';
    for (let i = 0; i < n; i++) { const c = els.tpl.content.firstElementChild.cloneNode(true); c.classList.add('skeleton'); c.querySelector('.save').remove(); els.grid.appendChild(c); }
  }

  const getJson = (u) => fetch(u, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  async function boot() {
    readUrl(); skeleton(9);
    try {
      // Stage 1: meta + a small "latest" slice so the page is usable in one short round trip.
      const full = getJson(`${BASE}data/articles.json`);
      const [meta, latest] = await Promise.all([getJson(`${BASE}data/meta.json`), getJson(`${BASE}data/latest.json`).catch(() => null)]);
      state.meta = meta; state.sourceMap = new Map(meta.sources.map((s) => [s.id, s]));
      if (!allCategories().some((c) => c.id === state.category)) state.category = HOME_CAT;
      const needsFull = state.category !== 'top' || state.query || state.source || state.showSaved;
      state.articles = latest && !needsFull ? latest : await full;
      renderCats(); update();
      // Stage 2: the complete set for every tab and search, swapped in quietly.
      if (state.articles !== await full) { const all = await full; state.articles = all; update(); }
      const ok = meta.sourceStatus?.filter((s) => s.ok).length ?? 0;
      els.footerMeta.textContent = `Last refreshed ${new Date(meta.generatedAt).toLocaleString()} · ${ok}/${meta.sourceStatus?.length ?? 0} feeds live · ${state.articles.length.toLocaleString()} items`;
      if (meta.site?.verse) $('#footerVerse').textContent = meta.site.verse;
      document.title = state.query ? `“${state.query}” — ${BRAND ? SITE_TITLE.split(' — ')[0] : 'Glorious Anchor'}` : SITE_TITLE;
    } catch (err) {
      els.grid.innerHTML = '';
      els.status.textContent = 'Could not load headlines. Please try again shortly.';
      console.error(err);
    }
  }
  boot();
})();
