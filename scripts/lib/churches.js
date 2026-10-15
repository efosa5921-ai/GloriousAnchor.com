/**
 * Church directory helpers: distance maths, normalising entries from churches.json,
 * and parsing OpenStreetMap Nominatim geocoding responses. Pure functions, no I/O.
 */
import { stripHtml, makeId } from './articles.js';

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const num = (v) => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : null; };

/** Clean one entry from churches.json. Returns null for disabled or unusable entries. */
export function normaliseChurch(raw) {
  if (!raw || typeof raw !== 'object' || raw.enabled === false) return null;
  const name = stripHtml(raw.name || '');
  if (!name) return null;
  let lat = num(raw.lat), lng = num(raw.lng ?? raw.lon);
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) lat = lng = null;
  const address = stripHtml([raw.address, raw.city, raw.country].filter(Boolean).join(', '));
  if (!address && lat == null) return null;
  const site = raw.website ? String(raw.website).trim() : '';
  return {
    id: raw.id || makeId(name, address),
    name,
    denomination: stripHtml(raw.denomination || '') || null,
    address: address || null,
    website: /^https?:\/\//i.test(site) ? site : site ? `https://${site}` : null,
    phone: stripHtml(raw.phone || '') || null,
    serviceTimes: stripHtml(raw.serviceTimes || raw.services || '') || null,
    notes: stripHtml(raw.notes || '') || null,
    lat, lng,
    listed: true,
  };
}

/** The address string we geocode (and cache by). */
export const geocodeKey = (c) => (c.address || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function nominatimUrl(address) {
  return `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(address)}`;
}

export function parseNominatim(json) {
  let data;
  try { data = typeof json === 'string' ? JSON.parse(json) : json; } catch { return null; }
  const hit = Array.isArray(data) ? data[0] : null;
  if (!hit) return null;
  const lat = num(hit.lat), lng = num(hit.lon);
  if (lat == null || lng == null) return null;
  return { lat, lng, label: hit.display_name || '' };
}
