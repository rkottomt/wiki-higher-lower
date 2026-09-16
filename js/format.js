// Small pure helpers for numbers, dates, and Wikipedia titles.
// Nothing in here touches the network or the DOM, so it is easy to unit test.

const fullNumber = new Intl.NumberFormat('en-US');
const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export const formatNumber = (n) => fullNumber.format(Math.round(n));
export const formatCompact = (n) => compactNumber.format(n);

// Wikipedia titles use spaces for display and underscores in URLs ("keys").
export const titleFromKey = (key) => key.replace(/_/g, ' ');
export const keyFromTitle = (title) => title.trim().replace(/\s+/g, '_');

export const articleUrl = (lang, key) =>
  `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(key)}`;

// ---- Dates (always UTC, because the pageviews API counts days in UTC) ----

const DAY_MS = 24 * 60 * 60 * 1000;
export const pad2 = (n) => String(n).padStart(2, '0');

export const utcDate = (year, month, day = 1) => new Date(Date.UTC(year, month - 1, day));
export const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS);
export const addMonths = (date, months) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
export const startOfDay = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
export const endOfMonth = (year, month) => new Date(Date.UTC(year, month, 0));

/** 2026-08-01 -> "20260801", the format the pageviews API wants in URLs. */
export const ymd = (date) =>
  `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`;

/** "2026080100" (API timestamp) -> Date */
export const parseApiTimestamp = (ts) =>
  utcDate(Number(ts.slice(0, 4)), Number(ts.slice(4, 6)), Number(ts.slice(6, 8)));

const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortMonthFmt = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fullDayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export const monthLabel = (year, month) => monthFmt.format(utcDate(year, month));
export const shortMonthLabel = (date) => shortMonthFmt.format(date);
export const dayLabel = (date) => dayFmt.format(date);
export const fullDayLabel = (date) => fullDayFmt.format(date);

/** First month the pageviews API has data for. */
export const FIRST_DATA_MONTH = { year: 2015, month: 7 };

/**
 * The API leaves out days (or months) with zero views, which would make a chart
 * silently skip them. Return one point per step from start to end, using 0 for gaps.
 */
export function fillSeries(items, start, end, granularity) {
  const byTime = new Map(items.map((p) => [p.date.getTime(), p.views]));
  const points = [];
  let cursor = granularity === 'monthly' ? utcDate(start.getUTCFullYear(), start.getUTCMonth() + 1) : startOfDay(start);
  while (cursor <= end) {
    points.push({ date: cursor, views: byTime.get(cursor.getTime()) ?? 0 });
    cursor = granularity === 'monthly' ? addMonths(cursor, 1) : addDays(cursor, 1);
  }
  return points;
}

/** Summary numbers shown in the compare table and the game's reveal panel. */
export function summarize(points) {
  if (points.length === 0) return { total: 0, average: 0, peak: null };
  let total = 0;
  let peak = points[0];
  for (const p of points) {
    total += p.views;
    if (p.views > peak.views) peak = p;
  }
  return { total, average: total / points.length, peak };
}

/** "2.4× more" style comparison text for two positive numbers. */
export function ratioText(a, b) {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (lo <= 0) return 'infinitely more';
  const r = hi / lo;
  if (r < 1.1) return `${Math.round((r - 1) * 100)}% more`;
  return `${r < 10 ? r.toFixed(1) : formatNumber(r)}× as many`;
}
