// Tests for api.js with fetch() replaced by fakes, so no network is needed.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, getArticleViews, resolveTitles, getTopPages, getSiteInfo } from '../js/api.js';
import { utcDate } from '../js/format.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('a network failure becomes a friendly "offline" error', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(getTopPages('en', 2020, 1), (err) => err instanceof ApiError && err.kind === 'offline');
});

test('HTTP 429 becomes a rate-limit error, and failures are not cached', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1 ? jsonResponse(429, {}) : jsonResponse(200, { items: [{ articles: [{ article: 'X', views: 5, rank: 1 }] }] });
  };
  await assert.rejects(getTopPages('en', 2020, 2), (err) => err.kind === 'rate-limit');
  const retry = await getTopPages('en', 2020, 2);
  assert.deepEqual(retry, [{ key: 'X', views: 5, rank: 1 }]);
  assert.equal(calls, 2);
});

test('a 404 for article views means "no data", not a crash', async () => {
  globalThis.fetch = async () => jsonResponse(404, { detail: 'The date(s) you used are valid, but we either do not have data...' });
  const points = await getArticleViews('en', 'Blakc_hole', 'daily', utcDate(2026, 8, 1), utcDate(2026, 8, 3));
  assert.deepEqual(points, []);
});

test('article titles in URLs are escaped (AC/DC has a slash)', async () => {
  let seen = '';
  globalThis.fetch = async (url) => { seen = url; return jsonResponse(200, { items: [] }); };
  await getArticleViews('en', 'AC/DC', 'monthly', utcDate(2026, 8, 1), utcDate(2026, 8, 31));
  assert.match(seen, /\/AC%2FDC\/monthly\/20260801\/20260831$/);
});

test('resolveTitles follows redirects and flags missing pages (real response shape)', async () => {
  globalThis.fetch = async () => jsonResponse(200, {
    batchcomplete: true,
    query: {
      normalized: [{ from: 'obama', to: 'Obama' }, { from: 'blakc hole', to: 'Blakc hole' }],
      redirects: [{ from: 'Obama', to: 'Barack Obama' }],
      pages: [
        { ns: 0, title: 'Blakc hole', missing: true },
        { pageid: 534366, ns: 0, title: 'Barack Obama' },
      ],
    },
  });
  const [obama, typo] = await resolveTitles('en', ['obama', 'blakc hole']);
  assert.equal(obama.key, 'Barack_Obama');
  assert.equal(obama.redirectedFrom, 'Obama');
  assert.equal(obama.missing, false);
  assert.equal(typo.missing, true);
});

test('getSiteInfo collects translated namespace prefixes', async () => {
  globalThis.fetch = async () => jsonResponse(200, {
    query: {
      general: { mainpage: 'Wikipedia:Hauptseite' },
      namespaces: {
        '-1': { id: -1, name: 'Spezial', canonical: 'Special' },
        0: { id: 0, name: '' },
        6: { id: 6, name: 'Datei', canonical: 'File' },
        101: { id: 101, name: 'Portal Diskussion', canonical: 'Portal talk' },
      },
      namespacealiases: [{ id: 6, alias: 'Bild' }],
    },
  });
  const info = await getSiteInfo('de-test');
  assert.equal(info.mainPageKey, 'Wikipedia:Hauptseite');
  for (const p of ['spezial', 'special', 'datei', 'file', 'bild', 'portal_diskussion']) assert.ok(info.namespacePrefixes.has(p), p);
});
