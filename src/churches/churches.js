/* Church finder: OpenStreetMap (Overpass) churches around a point, merged with the site's own listed churches. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const els = { finder: $('#finder'), locate: $('#locateBtn'), place: $('#placeInput'), radius: $('#radiusSel'), unit: $('#unitSel'), listedOnly: $('#listedOnly'), status: $('#status'), map: $('#map'), results: $('#results') };
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
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
    if (!els.results.querySelector('.church--skeleton')) els.results.innerHTML = '<li class="church church--skeleton" aria-hidden="true"><span></span><span></span><span></span></li>'.repeat(4);
    slowTimer = setTimeout(() => { if (state.busy) setStatus(`${els.status.textContent.replace(/…$/, '')}… still searching. The map service can take up to half a minute, please wait.`); }, 6000);
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
  async function overpass(lat, lng, radiusKm) {
    const q = `[out:json][timeout:25];nwr["amenity"="place_of_worship"]["religion"="christian"](around:${Math.round(radiusKm * 1000)},${lat},${lng});out center tags 300;`;
    let lastErr;
    for (const url of OVERPASS) {
      try {
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()).elements || [];
      } catch (e) { lastErr = e; }
    }
    throw new Error(`The map service is busy (${lastErr?.message || 'no response'}). Try a smaller radius or try again shortly.`);
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
  async function search(center, label, button) {
    if (state.busy) return;
    state.center = center; state.label = label;
    const radius = Number(els.radius.value);
    setStatus(`Looking for churches within ${radiusLabel()} of ${label}…`);
    setBusy(true, button || els.submit);
    try {
      let osm = [];
      try { osm = (await overpass(center.lat, center.lng, radius)).map(fromOsm).filter(Boolean); } catch (e) { if (!state.listed.length) throw e; setStatus(e.message); }
      const listedHere = state.listed.filter((c) => km(center.lat, center.lng, c.lat, c.lng) <= radius);
      // Listed churches replace an OSM entry at (nearly) the same spot.
      const osmFiltered = osm.filter((o) => !listedHere.some((l) => km(l.lat, l.lng, o.lat, o.lng) < 0.08));
      const all = [...listedHere, ...osmFiltered].map((c) => ({ ...c, distance: km(center.lat, center.lng, c.lat, c.lng) })).filter((c) => c.distance <= radius);
      all.sort((a, b) => (b.listed - a.listed) || a.distance - b.distance);
      state.results = all;
      renderResults();
      history.replaceState(null, '', `${location.pathname}?lat=${center.lat.toFixed(5)}&lng=${center.lng.toFixed(5)}&r=${+radius.toFixed(1)}&q=${encodeURIComponent(label)}`);
    } catch (e) {
      setStatus(e.message); els.results.innerHTML = ''; els.map.hidden = true;
    } finally { setBusy(false); }
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
    if (!navigator.geolocation) { setStatus('Your browser cannot share location. Type a town instead.'); return; }
    setStatus('Getting your location…'); setBusy(true, els.locate, 'Locating…');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setBusy(false); search({ lat: pos.coords.latitude, lng: pos.coords.longitude }, 'your location', els.locate); },
      (err) => { setBusy(false); setStatus(err.code === 1 ? 'Location permission was denied. Type a town instead.' : 'Could not get your location. Type a town instead.'); },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 },
    );
  });
  els.finder.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = els.place.value.trim(); if (!q) { els.place.focus(); return; }
    setStatus(`Finding ${q}…`); setBusy(true, els.submit);
    try { const c = await geocode(q); setBusy(false); search({ lat: c.lat, lng: c.lng }, c.label, els.submit); } catch (err) { setBusy(false); setStatus(err.message); }
  });
  els.radius.addEventListener('change', () => { if (state.center) search(state.center, state.label); });
  els.unit?.addEventListener('change', () => {
    setUnit(els.unit.value === 'mi' ? 'mi' : 'km');
    try { localStorage.setItem('ga_unit', unit); } catch { /* not remembered, still switched */ }
    if (state.center) search(state.center, state.label);
  });
  els.listedOnly.addEventListener('change', () => { if (state.results.length || state.center) renderResults(); });

  /* ---------- boot ---------- */
  (async () => {
    setUnit(unit, 10);
    await loadListed();
    const p = new URLSearchParams(location.search);
    if (p.get('lat') && p.get('lng')) { if (Number(p.get('r')) > 0) setUnit(unit, Number(p.get('r'))); search({ lat: parseFloat(p.get('lat')), lng: parseFloat(p.get('lng')) }, p.get('q') || 'the chosen place'); }
    else if (p.get('q')) { els.place.value = p.get('q'); els.finder.requestSubmit(); }
  })();
})();
