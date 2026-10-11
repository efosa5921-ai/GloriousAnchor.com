import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHealth, failingSources, alertBody } from '../scripts/lib/health.js';

test('computeHealth counts consecutive failures and resets on success', () => {
  const t1 = 1000;
  let h = computeHealth({}, [{ id: 'a', name: 'A', ok: true, count: 3 }, { id: 'b', name: 'B', ok: false, error: 'HTTP 500' }, { id: 'd', name: 'D', ok: false, skipped: true, error: 'disabled' }], t1);
  assert.equal(h.a.failures, 0); assert.equal(h.b.failures, 1); assert.equal(h.b.firstFailedAt, t1); assert.equal(h.d, undefined, 'skipped sources are not tracked');
  h = computeHealth(h, [{ id: 'a', name: 'A', ok: false, error: 'timeout' }, { id: 'b', name: 'B', ok: false, error: 'HTTP 500' }], 2000);
  assert.equal(h.a.failures, 1); assert.equal(h.a.lastOk, t1);
  assert.equal(h.b.failures, 2); assert.equal(h.b.firstFailedAt, t1, 'first failure time is kept');
  h = computeHealth(h, [{ id: 'a', name: 'A', ok: true, count: 1, via: 1 }, { id: 'b', name: 'B', ok: false, error: 'HTTP 500' }], 3000);
  assert.equal(h.a.failures, 0); assert.equal(h.a.via, 1);
  assert.equal(h.b.failures, 3);
  const failing = failingSources(h, 3);
  assert.deepEqual(failing.map((f) => f.id), ['b']);
  assert.deepEqual(failingSources(h, 4), []);
  const body = alertBody(failing, 'Site');
  assert.ok(body.includes('`b` (B) | 3 |'));
  assert.ok(body.includes('HTTP 500'));
});
