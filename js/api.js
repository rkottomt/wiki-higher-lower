// Every network request in the app goes through this file.
//
// Three Wikimedia APIs are used, none of which needs a key:
//   1. Pageviews REST API  (wikimedia.org/api/rest_v1/metrics/pageviews): view counts
//   2. MediaWiki Action API ({lang}.wikipedia.org/w/api.php): title checks, images, site info
//   3. MediaWiki REST API  ({lang}.wikipedia.org/w/rest.php): search-as-you-type
//
// Functions here return plain objects, so the UI code never builds URLs or parses raw JSON.
// See docs/api-notes.md for sample requests and responses.

import { pad2, ymd, parseApiTimestamp, keyFromTitle, titleFromKey, addMonths, utcDate } from './format.js';

const PAGEVIEWS = 'https://wikimedia.org/api/rest_v1/metrics/pageviews';
const TIMEOUT_MS = 12000;

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'it', name: 'Italiano' },
  { code: 'ja', name: '日本語' },
  { code: 'pt', name: 'Português' },
];

/** A failed request, with a `kind` the UI can turn into a helpful message. */
export class ApiError extends Error {
  /**
   * @param {'offline'|'timeout'|'not-found'|'rate-limit'|'bad-request'|'server'|'bad-response'} kind
   */
  constructor(kind, message, { status = null, cause } = {}) {
    super(message, { cause });
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Low-level fetch with timeout, error classification, and an in-memory cache
// ---------------------------------------------------------------------------

const cache = new Map(); // url -> Promise<json>

async function fetchJson(url, { signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });

  let res;
  try {
    // A plain GET with no custom headers: wikimedia.org rejects CORS preflight requests.
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (signal?.aborted) throw err; // the caller cancelled on purpose (e.g. user kept typing)
    if (controller.signal.aborted) {
      throw new ApiError('timeout', 'Wikipedia took too long to respond. Try again in a moment.', { cause: err });
    }
    // fetch() only rejects like this when the request never got a response at all.
    throw new ApiError('offline', "Couldn't reach Wikipedia. Check your internet connection and try again.", { cause: err });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).detail ?? '';
    } catch {
      /* body wasn't JSON; the status code is enough */
    }
    if (res.status === 404) throw new ApiError('not-found', detail || 'No data found.', { status: 404 });
    if (res.status === 429) {
      throw new ApiError('rate-limit', 'Wikipedia is rate-limiting requests right now. Wait a few seconds and try again.', { status: 429 });
    }
    if (res.status >= 400 && res.status < 500) {
      throw new ApiError('bad-request', `The request was rejected (HTTP ${res.status}). ${detail}`.trim(), { status: res.status });
    }
    throw new ApiError('server', `Wikimedia's servers had a problem (HTTP ${res.status}). Try again shortly.`, { status: res.status });
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new ApiError('bad-response', 'Wikipedia sent back something unexpected.', { cause: err });
  }
  // The Action API reports errors inside a 200 response.
  if (data && data.error) {
    throw new ApiError('bad-request', data.error.info || 'The request was rejected.', { status: res.status });
  }
  return data;
}

/** Same as fetchJson, but repeated requests for the same URL reuse the first response. */
function cachedJson(url) {
  if (!cache.has(url)) {
    const promise = fetchJson(url).catch((err) => {
      cache.delete(url); // don't cache failures, so "Try again" really retries
      throw err;
    });
    cache.set(url, promise);
  }
  return cache.get(url);
}

const actionUrl = (lang, params) =>
  `https://${lang}.wikipedia.org/w/api.php?` +
  new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });

// ---------------------------------------------------------------------------
// Pageviews API
// ---------------------------------------------------------------------------

/**
 * The 1000 most-viewed pages on a wiki for one month.
 * @param {'all-access'|'desktop'|'mobile-web'} access which devices to count
 * @returns {Promise<Array<{key: string, views: number, rank: number}>>}
 */
export async function getTopPages(lang, year, month, access = 'all-access') {
  const url = `${PAGEVIEWS}/top/${lang}.wikipedia/${access}/${year}/${pad2(month)}/all-days`;
  const data = await cachedJson(url);
  return data.items[0].articles.map((a) => ({ key: a.article, views: a.views, rank: a.rank }));
}

/** Top pages for all devices plus the desktop and mobile-web breakdowns (used to spot bots). */
export async function getTopPagesByDevice(lang, year, month) {
  const [all, desktop, mobile] = await Promise.all([
    getTopPages(lang, year, month, 'all-access'),
    getTopPages(lang, year, month, 'desktop'),
    getTopPages(lang, year, month, 'mobile-web'),
  ]);
  return { all, desktop, mobile };
}

/**
 * Newest month whose top list has been published. Monthly data usually appears a day
 * or two after the month ends, so try last month first and fall back one more.
 */
export async function getLatestMonth(lang, now = new Date()) {
  for (const back of [1, 2]) {
    const d = addMonths(utcDate(now.getUTCFullYear(), now.getUTCMonth() + 1), -back);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    try {
      await getTopPages(lang, year, month);
      return { year, month };
    } catch (err) {
      if (!(err instanceof ApiError) || err.kind !== 'not-found') throw err;
    }
  }
  throw new ApiError('not-found', 'Wikipedia has not published recent monthly rankings yet.');
}

/**
 * Views of one article between two dates (inclusive). Zero-view days are missing from
 * the response. Use fillSeries() from format.js to add them back.
 * Returns [] when the API has no data at all (for example, the article is newer than the range).
 * @param {'daily'|'monthly'} granularity
 */
export async function getArticleViews(lang, key, granularity, start, end) {
  const url =
    `${PAGEVIEWS}/per-article/${lang}.wikipedia/all-access/user/` +
    `${encodeURIComponent(key)}/${granularity}/${ymd(start)}/${ymd(end)}`;
  try {
    const data = await cachedJson(url);
    return data.items.map((i) => ({ date: parseApiTimestamp(i.timestamp), views: i.views }));
  } catch (err) {
    if (err instanceof ApiError && err.kind === 'not-found') return [];
    throw err;
  }
}

// ---------------------------------------------------------------------------
// MediaWiki Action API
// ---------------------------------------------------------------------------

/**
 * Namespace prefixes ("Special", "File", "Wikipedia", and their translations) and the
 * Main Page title for a wiki, so we can tell real articles from other pages.
 */
export async function getSiteInfo(lang) {
  const data = await cachedJson(actionUrl(lang, { action: 'query', meta: 'siteinfo', siprop: 'general|namespaces|namespacealiases' }));
  const { general, namespaces, namespacealiases } = data.query;
  const prefixes = new Set();
  for (const ns of Object.values(namespaces)) {
    if (ns.id === 0) continue; // the article namespace has no prefix
    for (const name of [ns.name, ns.canonical]) if (name) prefixes.add(keyFromTitle(name).toLowerCase());
  }
  for (const alias of namespacealiases) prefixes.add(keyFromTitle(alias.alias).toLowerCase());
  return { mainPageKey: keyFromTitle(general.mainpage), namespacePrefixes: prefixes };
}

/**
 * Check what the user typed against real article titles.
 * Fixes capitalization, follows redirects ("Obama" -> "Barack Obama"), and flags titles that don't exist.
 * @returns {Promise<Array<{input, key, title, redirectedFrom, missing, notArticle}>>}
 */
export async function resolveTitles(lang, inputs) {
  const data = await cachedJson(actionUrl(lang, { action: 'query', redirects: '1', titles: inputs.join('|') }));
  const q = data.query ?? {};
  const normalized = new Map((q.normalized ?? []).map((n) => [n.from, n.to]));
  const redirects = new Map((q.redirects ?? []).map((r) => [r.from, r.to]));
  const pages = new Map((q.pages ?? []).map((p) => [p.title, p]));

  return inputs.map((input) => {
    const cleaned = normalized.get(input) ?? input;
    const target = redirects.get(cleaned) ?? cleaned;
    const page = pages.get(target);
    const missing = !page || page.missing === true || page.invalid === true;
    return {
      input,
      title: target,
      key: keyFromTitle(target),
      redirectedFrom: redirects.has(cleaned) ? cleaned : null,
      missing,
      notArticle: !missing && page.ns !== 0,
    };
  });
}

/** A "did you mean…?" title for a misspelled search, or null. */
export async function getSuggestion(lang, text) {
  const data = await cachedJson(actionUrl(lang, { action: 'query', list: 'search', srsearch: text, srlimit: '1', srinfo: 'suggestion', srprop: '', srnamespace: '0' }));
  const q = data.query ?? {};
  return q.searchinfo?.suggestion ?? q.search?.[0]?.title ?? null;
}

/**
 * Run an Action API query, following MediaWiki's "continue" pages so nothing is lost
 * when a batch returns more data than fits in one response (categories, mainly).
 */
async function actionQueryAll(lang, params, { maxRounds = 6 } = {}) {
  const pages = new Map();
  const normalized = new Map();
  const redirects = new Map();
  let cont = {};

  for (let round = 0; round < maxRounds; round++) {
    const data = await cachedJson(actionUrl(lang, { ...params, ...cont }));
    const q = data.query ?? {};
    for (const n of q.normalized ?? []) normalized.set(n.from, n.to);
    for (const r of q.redirects ?? []) redirects.set(r.from, r.to);
    for (const page of q.pages ?? []) {
      const seen = pages.get(page.title);
      if (!seen) pages.set(page.title, { ...page });
      else seen.categories = [...(seen.categories ?? []), ...(page.categories ?? [])];
    }
    if (!data.continue) break;
    cont = data.continue;
  }
  return { pages, normalized, redirects };
}

/**
 * Short description, thumbnail, and categories for up to 50 articles in one request.
 * Categories are what the content filter leans on most, so they are fetched with the
 * rest of the page details rather than in a separate round trip.
 * @returns {Promise<Map<string, {title, description, thumbnail, categories: string[]}>>} keyed by article key
 */
export async function getPageInfo(lang, keys, { thumbSize = 640 } = {}) {
  const result = new Map();
  for (let i = 0; i < keys.length; i += 50) {
    const batch = keys.slice(i, i + 50);
    const { pages, normalized, redirects } = await actionQueryAll(lang, {
      action: 'query',
      prop: 'pageimages|description|categories',
      piprop: 'thumbnail',
      pithumbsize: String(thumbSize),
      clshow: '!hidden',
      cllimit: 'max',
      redirects: '1',
      titles: batch.join('|'),
    });
    for (const key of batch) {
      const cleaned = normalized.get(key) ?? key;
      const page = pages.get(redirects.get(cleaned) ?? cleaned);
      result.set(key, {
        title: page?.title ?? titleFromKey(key),
        description: page?.description ?? '',
        thumbnail: page?.thumbnail?.source ?? null,
        categories: (page?.categories ?? []).map((c) => c.title),
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// MediaWiki REST API
// ---------------------------------------------------------------------------

/**
 * Title suggestions for a search box. Not cached, and cancellable through `signal`,
 * because a new request is made on nearly every keystroke.
 */
export async function searchTitles(lang, query, { signal, limit = 6 } = {}) {
  const url = `https://${lang}.wikipedia.org/w/rest.php/v1/search/title?` + new URLSearchParams({ q: query, limit: String(limit) });
  const data = await fetchJson(url, { signal });
  return data.pages.map((p) => ({
    key: p.key,
    title: p.title,
    description: p.description ?? '',
    thumbnail: p.thumbnail?.url ? `https:${p.thumbnail.url.replace(/^https?:/, '')}` : null,
  }));
}
