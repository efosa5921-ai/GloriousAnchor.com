import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, normaliseChurch, geocodeKey, nominatimUrl, parseNominatim } from '../scripts/lib/churches.js';

test('haversineKm measures real-world distances', () => {
  const lagosToIbadan = haversineKm(6.5244, 3.3792, 7.3775, 3.9470);
  assert.ok(lagosToIbadan > 110 && lagosToIbadan < 120, `got ${lagosToIbadan}`);
  assert.equal(haversineKm(1, 1, 1, 1), 0);
});

test('normaliseChurch cleans entries and rejects unusable ones', () => {
  const c = normaliseChurch({ name: ' Grace <b>Chapel</b> ', address: '12 Example Rd', city: 'Benin City', country: 'Nigeria', website: 'gracechapel.ng', phone: '+234 800 000', denomination: 'Pentecostal' });
  assert.equal(c.name, 'Grace Chapel');
  assert.equal(c.address, '12 Example Rd, Benin City, Nigeria');
  assert.equal(c.website, 'https://gracechapel.ng');
  assert.equal(c.lat, null); assert.equal(c.listed, true);
  assert.equal(geocodeKey(c), '12 example rd, benin city, nigeria');
  const d = normaliseChurch({ name: 'Pinned', lat: '6.5', lng: '3.4' });
  assert.equal(d.lat, 6.5); assert.equal(d.lng, 3.4); assert.equal(d.address, null);
  assert.equal(normaliseChurch({ name: 'No where' }), null, 'needs an address or coordinates');
  assert.equal(normaliseChurch({ name: 'Off', address: 'x', enabled: false }), null);
  assert.equal(normaliseChurch({ name: 'Bad coords', lat: 200, lng: 3 }), null);
});

test('nominatim helpers build the request and parse the first hit', () => {
  assert.equal(nominatimUrl('12 Example Rd, Benin City'), 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=12%20Example%20Rd%2C%20Benin%20City');
  assert.deepEqual(parseNominatim('[{"lat":"6.33","lon":"5.62","display_name":"Benin City, Edo, Nigeria"}]'), { lat: 6.33, lng: 5.62, label: 'Benin City, Edo, Nigeria' });
  assert.equal(parseNominatim('[]'), null);
  assert.equal(parseNominatim('not json'), null);
});
