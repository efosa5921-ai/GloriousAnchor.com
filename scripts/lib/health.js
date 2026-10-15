/**
 * Feed health: counts consecutive failed builds per source so the workflow can raise an alert
 * when something has been down for a while (an expired cookie, a changed site, a dead feed).
 */
export function computeHealth(previous, sourceStatus, now = Date.now()) {
  const health = {};
  for (const s of sourceStatus) {
    if (s.skipped || s.id === 'ours' || s.id === 'churches') continue;
    const prev = previous?.[s.id];
    if (s.ok) {
      health[s.id] = { name: s.name, ok: true, failures: 0, lastOk: now, via: s.via || 0 };
    } else {
      const failures = (prev?.ok === false ? prev.failures : 0) + 1;
      health[s.id] = { name: s.name, ok: false, failures, firstFailedAt: prev?.ok === false ? prev.firstFailedAt : now, lastOk: prev?.lastOk ?? null, error: s.error };
    }
  }
  return health;
}

export function failingSources(health, threshold = 3) {
  return Object.entries(health)
    .filter(([, h]) => !h.ok && h.failures >= threshold)
    .map(([id, h]) => ({ id, ...h }))
    .sort((a, b) => b.failures - a.failures);
}

export function alertBody(failing, siteName = 'Glorious Anchor') {
  const lines = [
    `These sources have failed on **${failing[0]?.failures ?? 0}+ consecutive builds** and have dropped off ${siteName} (older items stay until they age out).`,
    '',
    '| Source | Failed builds | Since | Last error |',
    '| --- | --- | --- | --- |',
    ...failing.map((f) => `| \`${f.id}\` (${f.name}) | ${f.failures} | ${f.firstFailedAt ? new Date(f.firstFailedAt).toISOString().slice(0, 16).replace('T', ' ') : '?'} | ${String(f.error || '').replace(/\|/g, '/').slice(0, 160)} |`),
    '',
    'Common fixes: refresh an expired X/Instagram cookie on the feed server, `docker compose pull && docker compose up -d` there, correct the URL in `feeds.json`, or add a `fallbacks` entry. This issue updates automatically and closes itself when everything recovers.',
  ];
  return lines.join('\n');
}
