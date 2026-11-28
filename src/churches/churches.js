/* Church finder: OpenStreetMap (Overpass) churches around a point, merged with the site's own listed churches. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const els = { finder: $('#finder'), locate: $('#locateBtn'), place: $('#placeInput'), radius: $('#radiusSel'), unit: $('#unitSel'), listedOnly: $('#listedOnly'), status: $('#status'), more: $('#moreBtn'), map: $('#map'), results: $('#results') };
  // Public OpenStreetMap query servers, tried in this order. On 28 Nov 2026 the main one (overpass-api.de) took
  // 35 s or failed and the French one refused browsers, so on such days the quick answer below is what visitors see.
  // A Russian-hosted mirror (maps.mail.ru) was faster but was removed at the owner's wish.
  // `node scripts/finder-check.js` (the "Check the church finder" workflow) measures them from a real browser.
  const OVERPASS = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass-api.de/api/interpreter'];
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=';
  const state = { center: null, label: '', results: [], listed: [], map: null, markers: null, busy: false };

  const km = (lat1, lon1, lat2, lon2) => { const R = 6371, r = (d) => (d * Math.PI) / 180; const dLat = r(lat2 - lat1), dLon = r(lon2 - lon1); const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(a)); };
  /* Distances are shown in miles to visitors in the countries that use them (the United States and its territories,
     the United Kingdom, Liberia and Myanmar), judged by the device's time zone, and in kilometres to everyone else.
     The visitor can switch, and the choice is remembered. Searches themselves are always made in kilometres. */
  const MILE = 1.609344;
  const MILE_ZONES = /^(America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Juneau|Sitka|Metlakatla|Yakutat|Nome|Adak|Detroit|Boise|Menominee|Indianapolis|Louisville|Fort_Wayne|Knox_IN|Shiprock|Indiana\/.+|Kentucky\/.+|North_Dakota\/.+|Puerto_Rico|St_Thomas|St_Croix|Virgin)|Pacific\/(Honolulu|Guam|Saipan|Pago_Pago|Midway|Wake|Johnston)|US\/.+|Europe\/(London|Belfast|Jersey|Guernsey|Isle_of_Man)|GB|GB-Eire|Africa\/Monrovia|Asia\/(Yangon|Rangoon))$/;
  const RADII = { km: [3, 10, 25, 50], mi: [2, 5, 15, 30] };
  function defaultUnit() {
    try { const saved = localStorage.getItem('ga_unit'); if (saved === 'km' || saved === 'mi') return saved; } catch { /* storage unavailable */ }
    try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; if (tz) return MILE_ZONES.test(tz) ? 'mi' : 'km'; } catch { /* fall through to the language */ }
    return /[-_](US|GB|LR|MM)\b/i.test(navigator.language || '') ? 'mi' : 'km';
  }
  let unit = defaultUnit();
  const fmtDist = (d) => {
    if (unit === 'km') return d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(d < 10 ? 1 : 0)} km`;
    const m = d / MILE;
    return m < 0.1 ? `${Math.max(50, Math.round((m * 5280) / 50) * 50)} ft` : `${m.toFixed(m < 10 ? 1 : 0)} mi`;
  };
  /** Fill the radius menu for the unit in use, keeping the same position selected (or the one nearest a given km). */
  function setUnit(next, nearKm) {
    unit = next;
    const keep = nearKm == null ? Math.max(0, els.radius.selectedIndex) : null;
    els.radius.innerHTML = RADII[unit].map((n) => `<option value="${unit === 'km' ? n : +(n * MILE).toFixed(3)}">within ${n} ${unit === 'km' ? 'km' : n === 1 ? 'mile' : 'miles'}</option>`).join('');
    const kms = [...els.radius.options].map((o) => Number(o.value));
    els.radius.selectedIndex = keep != null ? Math.min(keep, kms.length - 1) : kms.reduce((best, v, i) => (Math.abs(v - nearKm) < Math.abs(kms[best] - nearKm) ? i : best), 0);
    if (els.unit) els.unit.value = unit;
  }
  const radiusLabel = () => (els.radius.selectedOptions[0]?.textContent || '').replace(/^within /, '');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const setStatus = (t) => { els.status.textContent = t; };
  els.submit = els.finder.querySelector('button[type=submit]');
  const labels = new Map([[els.locate, els.locate.innerHTML], [els.submit, els.submit.innerHTML]]);
  let slowTimer = null;
  const SKELETON = '<li class="church church--skeleton" aria-hidden="true"><span></span><span></span><span></span></li>';
  /* While a search runs, everything says so: the pressed button spins and reads "Searching…", the status line
     turns into a banner, grey placeholders stand where the results will appear, and after a few seconds a note
     explains that the map service can be slow, so nobody thinks the page has stopped. */
  const setBusy = (on, button, text) => {
    state.busy = on; els.locate.disabled = on; els.submit.disabled = on;
    for (const [b, html] of labels) { b.classList.remove('is-busy'); b.innerHTML = html; }
    els.status.classList.toggle('status--busy', on);
    els.results.setAttribute('aria-busy', on ? 'true' : 'false');
    clearTimeout(slowTimer);
    if (!on) { els.results.querySelectorAll('.church--skeleton').forEach((e) => e.remove()); return; }
    if (button) { button.classList.add('is-busy'); button.textContent = text || 'Searching…'; }
    if (!els.results.querySelector('.church--skeleton')) els.results.innerHTML = SKELETON.repeat(4);
    slowTimer = setTimeout(() => { if (state.busy) setStatus(`${els.status.textContent.replace(/…$/, '')}… still working. This can take up to half a minute, please wait.`); }, 6000);
    if (els.status.getBoundingClientRect().bottom > innerHeight) els.status.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  /* ---------- data ---------- */
  async function loadListed() {
    try { const r = await fetch('../data/churches.json', { cache: 'no-cache' }); if (r.ok) state.listed = (await r.json()).churches.filter((c) => c.lat != null); } catch { state.listed = []; }
  }
  async function geocode(q) {
    const r = await fetch(NOMINATIM + encodeURIComponent(q), { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('The place search is busy. Please try again in a moment.');
    const hit = (await r.json())[0];
    if (!hit) throw new Error(`Couldn't find "${q}". Try adding the country, e.g. "Benin City, Nigeria".`);
    return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon), label: hit.display_name.split(',').slice(0, 2).join(',') };
  }
  /* The full list comes from Overpass, the free public query servers of OpenStreetMap, which the whole world shares
     and which are sometimes slow or stalled. The question goes to the first server, and if it has not answered within
     1.5 seconds (or it fails) the next is asked as well; whichever answers first is used and the others are dropped.
     No server is waited on for more than 20 seconds. `ctrls` collects the requests so a newer search can stop them. */
  const CAP = 500; // the most churches asked for in one search
  function overpass(lat, lng, radiusKm, ctrls = []) {
    const q = `[out:json][timeout:25];nwr["amenity"="place_of_worship"]["religion"="christian"](around:${Math.round(radiusKm * 1000)},${lat.toFixed(3)},${lng.toFixed(3)});out center tags qt ${CAP};`; // the spot is rounded to about 100 m: near enough to search from, and no server is told exactly where the visitor stands
    const query = '?data=' + encodeURIComponent(q); // a plain GET: one of the servers refuses a POST from a web page
    const errors = [];
    let next = 0, live = 0, done = false, hedge = null;
    return new Promise((resolve, reject) => {
      const launch = () => {
        if (done || next >= OVERPASS.length) return;
        const url = OVERPASS[next++], c = new AbortController();
        ctrls.push(c); live += 1;
        const kill = setTimeout(() => c.abort(), 20000);
        fetch(url + query, { signal: c.signal })
          .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
          .then((j) => { if (!done) { done = true; resolve(j.elements || []); } })
          .catch((e) => {
            errors.push(e); live -= 1;
            if (done) return;
            if (next < OVERPASS.length) launch();
            else if (!live) { done = true; reject(new Error('The map service did not answer.')); }
          })
          .finally(() => clearTimeout(kill));
      };
      launch();
      hedge = setInterval(launch, 1500);
    }).finally(() => { clearInterval(hedge); for (const c of ctrls) c.abort(); });
  }
  /* With a key, the churches come from Geoapify (a German company serving the same OpenStreetMap data from its own
     dependable servers): the hundred nearest Christian places of worship, already sorted by distance, with a button
     for the next hundred. One page of a hundred costs six of the free plan's 3,000 daily credits. Without a key,
     or if Geoapify cannot be reached, the public services below are used instead. */
  const GEOAPIFY = document.querySelector('meta[name="geoapify-key"]')?.content || '';
  const PAGE = 100;
  async function geoapify(lat, lng, radiusKm, offset, signal) {
    const where = `filter=circle:${lng.toFixed(4)},${lat.toFixed(4)},${Math.round(radiusKm * 1000)}&bias=proximity:${lng.toFixed(4)},${lat.toFixed(4)}&limit=${PAGE}&offset=${offset}&apiKey=${encodeURIComponent(GEOAPIFY)}`;
    let res = await fetch(`https://api.geoapify.com/v2/places?categories=religion.place_of_worship.christianity&${where}`, { signal });
    // Should the Christian sub-category ever be renamed, ask for all places of worship and keep the Christian ones.
    if (res.status === 400) res = await fetch(`https://api.geoapify.com/v2/places?categories=religion.place_of_worship&${where}`, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const features = (await res.json()).features || [];
    return { list: features.map(fromGeoapify).filter(Boolean), full: features.length >= PAGE };
  }
  function fromGeoapify(f) {
    const p = f.properties || {}, raw = p.datasource?.raw || {};
    const cats = (p.categories || []).join(' ');
    const faith = raw.religion || (/place_of_worship\.(\w+)/.exec(cats) || [])[1] || '';
    if (faith && !/^christian/.test(faith)) return null;
    if (!faith && (OTHER_FAITH.test(p.name || '') || !CHURCHY.test(p.name || ''))) return null;
    const lat = Number(p.lat ?? f.geometry?.coordinates?.[1]), lng = Number(p.lon ?? f.geometry?.coordinates?.[0]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const type = { n: 'node', w: 'way', r: 'relation', node: 'node', way: 'way', relation: 'relation' }[String(raw.osm_type || '').toLowerCase()];
    const name = p.name || raw.name || '';
    const site = p.website || raw.website || raw['contact:website'] || null;
    return {
      id: type && raw.osm_id ? `osm-${type}-${raw.osm_id}` : `geo-${p.place_id || `${lat},${lng}`}`, name: name || 'Church (name not recorded)', unnamed: !name,
      denomination: raw.denomination ? String(raw.denomination).replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()) : null,
      address: [p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street, p.suburb || p.district, p.city].filter(Boolean).join(', ') || (p.address_line2 || null),
      website: site && /^https?:\/\//i.test(site) ? site : site ? `https://${site}` : null, phone: p.contact?.phone || raw.phone || raw['contact:phone'] || null,
      serviceTimes: raw.service_times || p.opening_hours || raw.opening_hours || null, lat, lng, listed: false,
      osmUrl: type && raw.osm_id ? `https://www.openstreetmap.org/${type}/${raw.osm_id}` : null,
    };
  }

  /* The quick answer, usually in under a second, comes from two free services that hold the same OpenStreetMap
     data and are far less crowded: Photon (run by Komoot, in Germany) gives the fifty places of worship nearest a
     point, and OpenStreetMap's own place search (Nominatim) gives up to forty of the better-known churches of an
     area together with their denomination and website. They are shown at once. When the full list arrives it
     replaces them; when it cannot be had, they are the answer. */
  const CHURCHY = /church|chapel|cathedral|basilica|parish|ministr|assembl|baptist|methodist|catholic|pentecost|presbyter|lutheran|anglican|episcopal|apostolic|adventist|gospel|christ|tabernacle|fellowship|evangel|orthodox|nazarene|wesleyan|mennonite|quaker|salvation army|kingdom hall|bible|jesus|saint|\bst\.? |holy|trinity|calvary|redeemer|our lady|sacred heart|abbey|priory|minster|\bkirk\b|iglesia|[eé]glise|kirche|chiesa|igreja|kerk|kapelle|capilla|parroquia|par[oó]quia|templo|notre.dame|\bsan(ta|to)? |\bs[aã]o /i;
  const OTHER_FAITH = /mosque|masjid|islam|muslim|synagog|\bshul\b|chabad|jewish|hebrew|\bbeth\b|gurdwara|sikh|mandir|hindu|buddh|vihara|\bzen\b|bah[aá].?[ií]|scientolog|krishna/i;
  const otherFaith = new Set(); // places the map itself says belong to another faith, whatever their name
  async function nearest(lat, lng, radiusKm, signal) {
    const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat.toFixed(3)}&lon=${lng.toFixed(3)}&radius=${Math.max(1, Math.round(radiusKm))}&limit=50&osm_tag=amenity:place_of_worship`, { signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return ((await r.json()).features || []).map(fromPhoton).filter(Boolean);
  }
  function fromPhoton(f) {
    const p = f.properties || {}, g = f.geometry?.coordinates;
    const type = { N: 'node', W: 'way', R: 'relation' }[p.osm_type];
    // Photon does not say which faith a place belongs to, so only places whose name is plainly a church's are taken.
    if (!g || !type || p.osm_value !== 'place_of_worship' || !p.name || OTHER_FAITH.test(p.name) || !CHURCHY.test(p.name)) return null;
    return {
      id: `osm-${type}-${p.osm_id}`, name: p.name, unnamed: false, denomination: null,
      address: [p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street, p.locality || p.district, p.city].filter(Boolean).join(', ') || null,
      website: null, phone: null, serviceTimes: null, lat: g[1], lng: g[0], listed: false, osmUrl: `https://www.openstreetmap.org/${type}/${p.osm_id}`,
    };
  }
  async function quick(lat, lng, radiusKm, signal) {
    lat = Number(lat.toFixed(3)); lng = Number(lng.toFixed(3));
    const dLat = radiusKm / 111.32, dLng = radiusKm / (111.32 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
    const url = `https://nominatim.openstreetmap.org/search?q=church&format=jsonv2&limit=40&bounded=1&extratags=1&addressdetails=1&viewbox=${(lng - dLng).toFixed(5)},${(lat + dLat).toFixed(5)},${(lng + dLng).toFixed(5)},${(lat - dLat).toFixed(5)}`;
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()).map(fromNominatim).filter(Boolean);
  }
  function fromNominatim(h) {
    const x = h.extratags || {}, a = h.address || {};
    const worship = h.category === 'amenity' && h.type === 'place_of_worship';
    const building = h.category === 'building' && /^(church|chapel|cathedral)$/.test(h.type);
    if (!worship && !building) return null;
    if (x.religion && x.religion !== 'christian') { otherFaith.add(`osm-${h.osm_type}-${h.osm_id}`); return null; } // other faiths' places of worship are left out
    if (!x.religion && !building && (OTHER_FAITH.test(h.name || '') || !CHURCHY.test(h.name || ''))) return null;
    const lat = parseFloat(h.lat), lng = parseFloat(h.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const site = x.website || x['contact:website'] || x.url || null;
    return {
      id: `osm-${h.osm_type}-${h.osm_id}`, name: h.name || 'Church (name not recorded)', unnamed: !h.name,
      denomination: x.denomination ? x.denomination.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()) : null,
      address: [a.house_number && a.road ? `${a.house_number} ${a.road}` : a.road, a.suburb || a.neighbourhood, a.city || a.town || a.village].filter(Boolean).join(', ') || null,
      website: site && /^https?:\/\//i.test(site) ? site : site ? `https://${site}` : null, phone: x.phone || x['contact:phone'] || null,
      serviceTimes: x.service_times || x.opening_hours || null, lat, lng, listed: false, osmUrl: `https://www.openstreetmap.org/${h.osm_type}/${h.osm_id}`,
    };
  }
  /* A search already made on this device in the last day is answered from memory, at once. */
  const CACHE = 'ga_church_searches';
  const cacheKey = (lat, lng, radiusKm) => `${lat.toFixed(3)},${lng.toFixed(3)},${Math.round(radiusKm * 10)}`;
  function cached(key) {
    try { const hit = JSON.parse(localStorage.getItem(CACHE) || '{}')[key]; return hit && Date.now() - hit.at < 86400000 ? hit.list : null; } catch { return null; }
  }
  function remember(key, list) {
    try {
      const all = JSON.parse(localStorage.getItem(CACHE) || '{}');
      all[key] = { at: Date.now(), list };
      const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 6);
      localStorage.setItem(CACHE, JSON.stringify(Object.fromEntries(keep)));
    } catch { /* storage full or unavailable: the next search simply asks again */ }
  }
  function fromOsm(el) {
    const t = el.tags || {};
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) return null;
    const addr = [t['addr:housenumber'] && t['addr:street'] ? `${t['addr:housenumber']} ${t['addr:street']}` : t['addr:street'], t['addr:suburb'] || t['addr:neighbourhood'], t['addr:city'] || t['addr:town'] || t['addr:village']].filter(Boolean).join(', ');
    const site = t.website || t['contact:website'] || t.url || null;
    return {
      id: `osm-${el.type}-${el.id}`, name: t.name || t['name:en'] || 'Church (name not recorded)', unnamed: !t.name && !t['name:en'],
      denomination: t.denomination ? t.denomination.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()) : null, address: addr || null,
      website: site && /^https?:\/\//i.test(site) ? site : site ? `https://${site}` : null, phone: t.phone || t['contact:phone'] || null,
      serviceTimes: t.service_times || t.opening_hours || null, lat, lng, listed: false, osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    };
  }

  /* ---------- search ---------- */
  let run = 0, pending = [], paging = null;
  async function search(center, label, button) {
    const mine = ++run;
    for (const c of pending.splice(0)) c.abort(); // a new search replaces one that is still loading
    state.center = center; state.label = label;
    const radius = Number(els.radius.value);
    els.status.classList.remove('status--more');
    setStatus(`Looking for churches within ${radiusLabel()} of ${label}…`);
    setBusy(true, button || els.submit);
    history.replaceState(null, '', `${location.pathname}?lat=${center.lat.toFixed(5)}&lng=${center.lng.toFixed(5)}&r=${+radius.toFixed(1)}&q=${encodeURIComponent(label)}`);
    const listedHere = state.listed.filter((c) => km(center.lat, center.lng, c.lat, c.lng) <= radius);
    const show = (osm) => {
      // Listed churches replace a map entry at (nearly) the same spot.
      const others = osm.filter((o) => !listedHere.some((l) => km(l.lat, l.lng, o.lat, o.lng) < 0.08));
      const all = [...listedHere, ...others].map((c) => ({ ...c, distance: km(center.lat, center.lng, c.lat, c.lng) })).filter((c) => c.distance <= radius);
      all.sort((a, b) => (b.listed - a.listed) || a.distance - b.distance);
      state.results = all;
      renderResults();
    };
    paging = null; els.more.hidden = true;
    const key = cacheKey(center.lat, center.lng, radius);
    const known = cached(key);
    if (known) {
      show(known); setBusy(false);
      // A remembered Geoapify list that ended on a full page may have more behind it.
      if (GEOAPIFY && known.length && known.length % PAGE === 0) { paging = { center, radius, key, offset: known.length, list: known, show }; els.more.hidden = false; }
      return;
    }
    // Our own listed churches need no map service, so they are shown straight away while the rest are fetched.
    if (listedHere.length) {
      show([]);
      els.results.insertAdjacentHTML('beforeend', SKELETON.repeat(3));
      setStatus(`${listedHere.length} listed ${listedHere.length === 1 ? 'church' : 'churches'} found. Looking for more on the map…`);
    }
    if (GEOAPIFY) {
      const g = new AbortController(); pending = [g];
      const stop = setTimeout(() => g.abort(), 12000);
      try {
        const page = await geoapify(center.lat, center.lng, radius, 0, g.signal);
        if (mine !== run) return;
        remember(key, page.list); show(page.list); setBusy(false);
        if (page.full) { paging = { center, radius, key, offset: PAGE, list: page.list, show }; els.more.hidden = false; setStatus(`${els.status.textContent.replace(/^\d+ churches/, `The ${state.results.length} nearest churches`)} Press "Show more churches" below for the next ${PAGE}.`); }
        return;
      } catch { if (mine !== run) return; /* Geoapify could not be reached: carry on with the public services */ } finally { clearTimeout(stop); }
    }
    const ops = [], fast = new AbortController(); // kept apart: the full-list search drops its own requests when it ends, and must not drop the quick one
    pending = [fast, { abort: () => ops.forEach((c) => c.abort()) }];
    let complete = false;
    const early = new Map(); // id → church, gathered from the quick sources as they answer
    const filled = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== false));
    const gather = (list) => {
      for (const c of list) early.set(c.id, { ...c, ...filled(early.get(c.id) || {}), ...filled(c.denomination || c.website ? c : {}) });
      for (const id of otherFaith) early.delete(id);
      if (mine !== run || complete || !early.size) return;
      show([...early.values()]);
      if (!state.results.length) return;
      setBusy(false); // the first churches are on the page: the buttons work again while the rest load
      els.status.classList.add('status--more');
      setStatus(`${els.status.textContent.replace(/, nearest first\.$/, ' so far.')} Looking for more…`);
    };
    const around = (lat, lng) => nearest(lat, lng, radius, fast.signal).then(gather).catch(() => {});
    const dLat = (radius / 2) / 111.32, dLng = dLat / Math.max(0.1, Math.cos((center.lat * Math.PI) / 180));
    const quickDone = Promise.allSettled([
      // The fifty nearest to the visitor first, then, for a wide search, the fifty nearest to four points around them.
      around(center.lat, center.lng).then(() => (radius >= 5 && mine === run && !complete
        ? Promise.allSettled([[dLat, 0], [-dLat, 0], [0, dLng], [0, -dLng]].map(([a, b]) => around(center.lat + a, center.lng + b))) : null)),
      quick(center.lat, center.lng, radius, fast.signal).then(gather).catch(() => {}),
    ]);
    setTimeout(() => fast.abort(), 15000); // the quick sources are not waited on for longer than this
    try {
      const osm = (await overpass(center.lat, center.lng, radius, ops)).map(fromOsm).filter(Boolean);
      if (mine !== run) return;
      complete = true;
      // The servers cannot sort by distance, so where an area holds more churches than one search may fetch, the
      // nearest and better-known ones from the quick answer are kept in, and the visitor is told the list is not complete.
      const all = osm.length >= CAP ? [...osm, ...[...early.values()].filter((e) => !osm.some((o) => o.id === e.id))] : osm;
      remember(key, all); show(all);
      if (osm.length >= CAP) setStatus(`${els.status.textContent} This area has more churches than we can list at once, so choose a smaller distance to be sure of seeing every church close to you.`);
    } catch {
      await quickDone; // the full list failed: let the quick sources finish, for they are now the answer
      if (mine !== run) return;
      complete = true;
      if (state.results.length) { renderResults(); setStatus(`${els.status.textContent} There may be more: the complete map list is busy just now, so try again later, or search a smaller distance, to see the rest.`); }
      else { els.results.innerHTML = ''; els.map.hidden = true; setStatus('We could not reach the map service just now, so we cannot show the churches near you. Please try again in a minute.'); }
    } finally {
      if (mine === run) { setBusy(false); els.status.classList.remove('status--more'); }
    }
  }

  /* ---------- render ---------- */
  function renderResults() {
    const listedOnly = els.listedOnly.checked;
    const list = state.results.filter((c) => !listedOnly || c.listed);
    const radius = Number(els.radius.value);
    setStatus(list.length ? `${list.length} ${list.length === 1 ? 'church' : 'churches'} within ${radiusLabel()} of ${state.label}, nearest first.` : `No ${listedOnly ? 'listed ' : ''}churches found within ${radiusLabel()} of ${state.label}. Try a larger radius.`);
    els.results.innerHTML = '';
    for (const c of list) {
      const li = document.createElement('li'); li.className = 'church' + (c.listed ? ' church--listed' : ''); li.dataset.id = c.id;
      const dir = `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`;
      li.innerHTML = `
        <div class="church__head"><h2 class="church__name">${esc(c.name)}</h2><span class="church__dist">${fmtDist(c.distance)}</span></div>
        <p class="church__meta">${[c.listed ? '<span class="pill pill--gold">Listed</span>' : '', c.denomination ? esc(c.denomination) : '', c.address ? esc(c.address) : ''].filter(Boolean).join(' · ')}</p>
        ${c.serviceTimes ? `<p class="church__times">Services: ${esc(c.serviceTimes)}</p>` : ''}
        ${c.notes ? `<p class="church__notes">${esc(c.notes)}</p>` : ''}
        <p class="church__links">
          <a href="${dir}" target="_blank" rel="noopener">Directions ↗</a>
          ${c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener">Website ↗</a>` : ''}
          ${c.phone ? `<a href="tel:${esc(c.phone.replace(/\s+/g, ''))}">${esc(c.phone)}</a>` : ''}
          ${c.osmUrl ? `<a class="muted" href="${c.osmUrl}" target="_blank" rel="noopener">OpenStreetMap ↗</a>` : ''}
        </p>`;
      li.addEventListener('click', (e) => { if (e.target.closest('a')) return; focusMarker(c); });
      els.results.appendChild(li);
    }
    renderMap(list);
  }
  function renderMap(list) {
    if (!window.L) { els.map.hidden = true; return; }
    els.map.hidden = false;
    if (!state.map) {
      state.map = L.map(els.map, { scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(state.map);
      state.markers = L.layerGroup().addTo(state.map);
    }
    state.markers.clearLayers();
    const you = L.circleMarker([state.center.lat, state.center.lng], { radius: 7, color: '#0b4a8b', fillColor: '#0b4a8b', fillOpacity: .9 }).bindPopup('You are here').addTo(state.markers);
    const pts = [[state.center.lat, state.center.lng]];
    for (const c of list) {
      const m = L.circleMarker([c.lat, c.lng], { radius: c.listed ? 9 : 6, color: c.listed ? '#c9961f' : '#b42318', fillColor: c.listed ? '#c9961f' : '#e53e3e', fillOpacity: .85, weight: 2 })
        .bindPopup(`<strong>${esc(c.name)}</strong><br>${fmtDist(c.distance)}${c.denomination ? ' · ' + esc(c.denomination) : ''}<br><a href="https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}" target="_blank" rel="noopener">Directions</a>`);
      m.on('click', () => { document.querySelector(`.church[data-id="${c.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
      c._marker = m; m.addTo(state.markers); pts.push([c.lat, c.lng]);
    }
    setTimeout(() => { state.map.invalidateSize(); if (pts.length > 1) state.map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 }); else state.map.setView(pts[0], 13); }, 50);
    void you;
  }
  function focusMarker(c) { if (c._marker && state.map) { state.map.setView([c.lat, c.lng], 16); c._marker.openPopup(); els.map.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } }

  /* ---------- events ---------- */
  els.locate.addEventListener('click', () => {
    const typeInstead = 'Type your town, city or postcode in the box and press Search.';
    if (!navigator.geolocation) { setStatus(`This browser cannot share your location. ${typeInstead}`); els.place.focus(); return; }
    setStatus('Getting your location… if your browser asks, please choose Allow.'); setBusy(true, els.locate, 'Locating…');
    let settled = false;
    const finish = () => { if (settled) return false; settled = true; clearTimeout(watch); setBusy(false); return true; };
    const fail = (msg) => { if (finish()) { els.results.innerHTML = ''; setStatus(msg); els.place.focus(); } };
    // Some phones and in-app browsers (inside WhatsApp, Telegram or Facebook) never answer at all, so we stop waiting ourselves.
    const watch = setTimeout(() => fail(`Your device did not give us a location. Check that location is switched on and allowed for this site, or open this page in your normal browser. ${typeInstead}`), 20000);
    navigator.geolocation.getCurrentPosition(
      (pos) => { if (finish()) search({ lat: pos.coords.latitude, lng: pos.coords.longitude }, 'your location', els.locate); },
      (err) => fail(err.code === 1 ? `Location is not allowed for this site. Allow it in your browser's settings, or: ${typeInstead}` : `We could not get your location. ${typeInstead}`),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  });
  els.finder.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = els.place.value.trim(); if (!q) { els.place.focus(); return; }
    setStatus(`Finding ${q}…`); setBusy(true, els.submit);
    try { const c = await geocode(q); setBusy(false); search({ lat: c.lat, lng: c.lng }, c.label, els.submit); } catch (err) { setBusy(false); els.results.innerHTML = ''; setStatus(err.message); }
  });
  els.more.addEventListener('click', async () => {
    const p = paging; if (!p) return;
    const was = els.more.textContent; els.more.disabled = true; els.more.textContent = 'Loading…';
    try {
      const page = await geoapify(p.center.lat, p.center.lng, p.radius, p.offset, AbortSignal.timeout(12000));
      if (paging !== p) return;
      p.list = [...p.list, ...page.list.filter((c) => !p.list.some((o) => o.id === c.id))]; p.offset += PAGE;
      remember(p.key, p.list); p.show(p.list);
      if (page.full) setStatus(`${els.status.textContent.replace(/^\d+ churches/, `The ${state.results.length} nearest churches`)} Press "Show more churches" below for the next ${PAGE}.`);
      else { paging = null; els.more.hidden = true; }
    } catch { setStatus(`${els.status.textContent} More could not be loaded just now. Please try again.`); }
    finally { els.more.disabled = false; els.more.textContent = was; }
  });
  els.radius.addEventListener('change', () => { if (state.center) search(state.center, state.label); });
  els.unit?.addEventListener('change', () => {
    setUnit(els.unit.value === 'mi' ? 'mi' : 'km');
    try { localStorage.setItem('ga_unit', unit); } catch { /* not remembered, still switched */ }
    if (state.center) search(state.center, state.label);
  });
  els.listedOnly.addEventListener('change', () => { if (state.results.length || state.center) renderResults(); });

  if (GEOAPIFY) document.querySelector('.churches__foot')?.insertAdjacentHTML('beforeend', ' Search powered by <a href="https://www.geoapify.com/" target="_blank" rel="noopener">Geoapify</a>.');

  /* ---------- boot ---------- */
  (async () => {
    setUnit(unit, 10);
    await loadListed();
    const p = new URLSearchParams(location.search);
    if (p.get('lat') && p.get('lng')) { if (Number(p.get('r')) > 0) setUnit(unit, Number(p.get('r'))); search({ lat: parseFloat(p.get('lat')), lng: parseFloat(p.get('lng')) }, p.get('q') || 'the chosen place'); }
    else if (p.get('q')) { els.place.value = p.get('q'); els.finder.requestSubmit(); }
  })();
})();
