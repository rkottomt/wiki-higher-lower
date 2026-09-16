import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exclusionReason, buildPool, pickOpponent, DIFFICULTIES } from '../js/pool.js';

const siteInfo = {
  mainPageKey: 'Main_Page',
  namespacePrefixes: new Set(['special', 'file', 'wikipedia', 'portal', 'help']),
};

// A seeded random number generator so the tests are repeatable.
function seeded(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

test('non-articles are excluded but titles with colons are kept', () => {
  assert.equal(exclusionReason({ key: 'Main_Page' }, siteInfo).code, 'main-page');
  assert.equal(exclusionReason({ key: 'Special:Search' }, siteInfo).code, 'not-article');
  assert.equal(exclusionReason({ key: 'File:WhatsApp.svg' }, siteInfo).code, 'not-article');
  assert.equal(exclusionReason({ key: 'Spider-Man:_No_Way_Home' }, siteInfo), null);
  assert.equal(exclusionReason({ key: 'XXX:_State_of_the_Union' }, siteInfo), null);
});

test('one-device traffic is flagged as likely bots', () => {
  assert.equal(exclusionReason({ key: '.xyz' }, siteInfo, { desktop: 0.96 }).code, 'bot');
  assert.equal(exclusionReason({ key: '.xxx' }, siteInfo, { desktop: 0.02, mobile: 0.98 }).code, 'bot');
  assert.equal(exclusionReason({ key: 'ChatGPT' }, siteInfo, { desktop: 0.64, mobile: 0.35 }), null);
  assert.equal(exclusionReason({ key: 'Obscure' }, siteInfo, {}), null); // unknown shares are not held against it
});

test('buildPool splits the top list using real August 2026 examples', () => {
  const top = {
    all: [
      { key: 'Main_Page', views: 216848380, rank: 1 },
      { key: 'Dolly_Parton', views: 12589565, rank: 5 },
      { key: '.xyz', views: 3340171, rank: 14 },
      { key: 'Neatsville,_Kentucky', views: 2654312, rank: 15 },
      { key: 'Portal:Current_events', views: 1628741, rank: 33 },
      { key: 'ChatGPT', views: 1618890, rank: 34 },
    ],
    desktop: [
      { key: 'Main_Page', views: 145000000 },
      { key: 'Dolly_Parton', views: 2014330 },
      { key: '.xyz', views: 3206564 },
      { key: 'Neatsville,_Kentucky', views: 2627769 },
      { key: 'ChatGPT', views: 1036090 },
    ],
    mobile: [{ key: 'Dolly_Parton', views: 10197548 }, { key: 'ChatGPT', views: 566611 }],
  };
  const { articles, removed } = buildPool(top, siteInfo);
  assert.deepEqual(articles.map((a) => a.key), ['Dolly_Parton', 'ChatGPT']);
  assert.deepEqual(removed.map((r) => r.reason.code), ['main-page', 'bot', 'bot', 'not-article']);
  assert.equal(articles[0].title, 'Dolly Parton');
  assert.ok(Math.abs(articles[1].desktopShare - 0.64) < 0.01);
});

// Around the 200-view article there are close, medium and far neighbours in both directions.
const pool = [50, 70, 100, 180, 190, 200, 210, 230, 240, 600, 900, 5000].map((views, i) => ({ key: `A${i}`, views }));
const at = (views) => pool.find((a) => a.views === views);

test('pickOpponent respects each difficulty band', () => {
  const current = at(200);
  for (const [name, band] of Object.entries(DIFFICULTIES)) {
    const rng = seeded(7);
    for (let i = 0; i < 25; i++) {
      const pick = pickOpponent(pool, current, name, new Set(), rng);
      const r = Math.max(pick.views, current.views) / Math.min(pick.views, current.views);
      assert.ok(r >= band.minRatio && r <= band.maxRatio, `${name}: ratio ${r} out of band`);
    }
  }
});

test('pickOpponent never repeats an article and relaxes rules when it must', () => {
  const current = at(5000); // nothing is "hard"-close to it
  const pick = pickOpponent(pool, current, 'hard', new Set(), seeded(3));
  assert.ok(pick && pick.key !== current.key);

  const allUsed = new Set(pool.map((a) => a.key));
  assert.equal(pickOpponent(pool, current, 'normal', allUsed, seeded(3)), null);
});

test('pickOpponent produces both higher and lower answers', () => {
  const rng = seeded(11);
  const current = at(200);
  const outcomes = new Set();
  for (let i = 0; i < 40; i++) outcomes.add(pickOpponent(pool, current, 'normal', new Set(), rng).views > current.views);
  assert.equal(outcomes.size, 2);
});
