/**
 * How long a pin lasts. A pinned item leads Top Stories, so a pin that never expires keeps a stale story in first
 * place for weeks. The value of "pinned" decides:
 *   true            three days from the item's own date (an article's date, a pick's "added")
 *   "2026-10-30"    until the end of that day (UTC)
 *   "always"        never expires
 */
export const PIN_DAYS = 3;
const DAY = 24 * 3600 * 1000;

export function pinActive(value, sinceMs, now = Date.now()) {
  if (value === 'always') return true;
  if (value === true) return Number.isFinite(sinceMs) ? sinceMs + PIN_DAYS * DAY > now : true;
  if (typeof value === 'string') {
    const until = Date.parse(value);
    return Number.isFinite(until) ? until + DAY > now : false;
  }
  return false;
}
