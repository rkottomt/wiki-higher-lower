// Turns a raw "top 1000 pages" list into a clean pool of real articles, and picks
// fair pairs of articles for the higher-or-lower game. Pure functions, no network.

import { titleFromKey } from './format.js';

// Real human interest is split between phones and computers. When nearly all of a
// page's views come from one device type, it's almost always automated traffic
// that Wikimedia's bot filter missed (see docs/api-notes.md for examples).
export const MAX_DESKTOP_SHARE = 0.9;
export const MAX_MOBILE_SHARE = 0.95;

/**
 * Why a page from the top list should be left out of the game, or null if it's fine.
 * @param {{key: string, views: number}} page
 * @param {{mainPageKey: string, namespacePrefixes: Set<string>}} siteInfo
 * @param {{desktop?: number, mobile?: number}} shares fraction of views from each device, when known
 */
export function exclusionReason(page, siteInfo, shares = {}) {
  if (page.key === siteInfo.mainPageKey) return { code: 'main-page', label: 'Main Page' };
  if (page.key === '-' || page.key === '') return { code: 'not-article', label: 'Not an article' };
  // Old-style links like "wiki.phtml" are counted as if they were titles on several wikis.
  if (/\.(php|phtml)$/i.test(page.key)) return { code: 'not-article', label: 'Not an article (old URL format)' };

  const colon = page.key.indexOf(':');
  if (colon > 0) {
    const prefix = page.key.slice(0, colon).toLowerCase();
    // "Spider-Man:_No_Way_Home" is an article; "File:Logo.svg" is not.
    if (siteInfo.namespacePrefixes.has(prefix)) {
      return { code: 'not-article', label: `Not an article (${titleFromKey(page.key.slice(0, colon))} page)` };
    }
  }
  if (shares.desktop !== undefined && shares.desktop > MAX_DESKTOP_SHARE) {
    return { code: 'bot', label: `Likely automated traffic (${Math.round(shares.desktop * 100)}% desktop)` };
  }
  if (shares.mobile !== undefined && shares.mobile > MAX_MOBILE_SHARE) {
    return { code: 'bot', label: `Likely automated traffic (${Math.round(shares.mobile * 100)}% mobile web)` };
  }
  return null;
}

/**
 * Split the monthly top list into playable articles and filtered-out pages.
 * @param {{all, desktop, mobile}} top result of api.getTopPagesByDevice
 */
export function buildPool(top, siteInfo) {
  const desktopViews = new Map(top.desktop.map((p) => [p.key, p.views]));
  const mobileViews = new Map(top.mobile.map((p) => [p.key, p.views]));

  const articles = [];
  const removed = [];
  for (const page of top.all) {
    // A page missing from a device's top-1000 list has an unknown (but small) share there.
    const shares = {
      desktop: desktopViews.has(page.key) ? desktopViews.get(page.key) / page.views : undefined,
      mobile: mobileViews.has(page.key) ? mobileViews.get(page.key) / page.views : undefined,
    };
    const entry = { ...page, title: titleFromKey(page.key), ...shareFields(shares) };
    const reason = exclusionReason(page, siteInfo, shares);
    if (reason) removed.push({ ...entry, reason });
    else articles.push(entry);
  }
  return { articles, removed };
}

const shareFields = ({ desktop, mobile }) => ({
  desktopShare: desktop ?? null,
  mobileShare: mobile ?? null,
});

// ---------------------------------------------------------------------------
// Picking the next article
// ---------------------------------------------------------------------------

/**
 * How far apart two view counts must be. The ratio is always bigger / smaller,
 * so 1.0 means identical and 2.0 means one had twice the views.
 */
export const DIFFICULTIES = {
  easy: { label: 'Easy', minRatio: 2.5, maxRatio: Infinity, hint: 'One side has at least 2.5× the views' },
  normal: { label: 'Normal', minRatio: 1.25, maxRatio: Infinity, hint: 'At least a 25% gap' },
  hard: { label: 'Hard', minRatio: 1.02, maxRatio: 1.3, hint: 'Within 30% of each other' },
};

const ratio = (a, b) => Math.max(a, b) / Math.min(a, b);

/**
 * Choose the next article to compare against `current`.
 * Flips a coin for "higher" or "lower" first so the answer isn't predictable, then
 * relaxes the rules step by step if nothing fits (e.g. near the top of the list).
 * @param {Array} articles the pool
 * @param {Set<string>} used article keys already shown this game
 * @param {() => number} rng random number source, replaceable in tests
 */
export function pickOpponent(articles, current, difficulty, used, rng = Math.random) {
  const band = DIFFICULTIES[difficulty] ?? DIFFICULTIES.normal;
  const fresh = articles.filter((a) => a.key !== current.key && !used.has(a.key) && a.views !== current.views);
  const wantHigher = rng() < 0.5;

  const inBand = (a) => {
    const r = ratio(a.views, current.views);
    return r >= band.minRatio && r <= band.maxRatio;
  };
  const isHigher = (a) => a.views > current.views;

  const attempts = [
    (a) => inBand(a) && isHigher(a) === wantHigher,
    (a) => inBand(a),
    (a) => ratio(a.views, current.views) >= 1.01,
    () => true,
  ];
  for (const test of attempts) {
    const options = fresh.filter(test);
    if (options.length > 0) return options[Math.floor(rng() * options.length)];
  }
  return null; // every article has been used
}

/** A random starting article, skipping the few extremely popular outliers at the very top. */
export function pickStart(articles, rng = Math.random) {
  const from = Math.min(10, Math.floor(articles.length / 4));
  const slice = articles.slice(from);
  return slice[Math.floor(rng() * slice.length)] ?? articles[0] ?? null;
}
