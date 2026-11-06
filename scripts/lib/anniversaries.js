/**
 * Birth and homegoing anniversaries for the people our articles are about ("God's Generals").
 * An article with `born:` and/or `died:` in its front matter (YYYY-MM-DD) is featured on those days each year:
 * it leads the slider with a label such as "Born on this day in 1918", and is announced once per year.
 * Days are reckoned in the site's home time zone (West Africa Time, UTC+1).
 */
export const TZ = 'Africa/Lagos';

/** "YYYY-MM-DD" (or "YYYY" for a year alone, which never matches a day) → { year, month, day } or null. */
export function parseLifeDate(v) {
  const m = String(v ?? '').trim().match(/^(\d{4})(?:-(\d{2})-(\d{2}))?$/);
  if (!m) return null;
  return { year: Number(m[1]), month: m[2] ? Number(m[2]) : null, day: m[3] ? Number(m[3]) : null };
}

/** Today's date as "YYYY-MM-DD" in the given time zone. */
export function dayIn(now = Date.now(), tz = TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

/**
 * The anniversary that falls today, if any: `{ kind, label, headline, at }`.
 * `label` is short, for the card chip; `headline` prefixes the day's announcement; `at` is the end of today.
 * A homegoing anniversary wins over a birthday on the same day.
 */
export function anniversaryFor({ born, died } = {}, now = Date.now(), tz = TZ) {
  const today = dayIn(now, tz);
  const [y, m, d] = today.split('-').map(Number);
  // The end of the day, so the anniversary outranks anything else published the same day.
  const at = Date.parse(`${today}T23:59:59+01:00`);
  const hit = (v) => { const p = parseLifeDate(v); return p && p.month === m && p.day === d && p.year < y ? p : null; };
  const dd = hit(died);
  if (dd) {
    const n = y - dd.year;
    return { kind: 'died', label: `Went home this day, ${dd.year}`, headline: `Went home to the Lord ${n} year${n === 1 ? '' : 's'} ago today`, at };
  }
  const b = hit(born);
  if (b) return { kind: 'born', label: `Born this day, ${b.year}`, headline: `Born on this day in ${b.year}`, at };
  return null;
}
