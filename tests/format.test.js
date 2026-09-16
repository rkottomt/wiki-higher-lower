import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ymd, parseApiTimestamp, utcDate, fillSeries, summarize, ratioText, keyFromTitle, titleFromKey, formatNumber,
} from '../js/format.js';

test('dates round-trip through the API formats', () => {
  const d = utcDate(2026, 8, 3);
  assert.equal(ymd(d), '20260803');
  assert.equal(parseApiTimestamp('2026080300').getTime(), d.getTime());
});

test('titles convert between display and URL form', () => {
  assert.equal(keyFromTitle('  Black   hole '), 'Black_hole');
  assert.equal(titleFromKey('Spider-Man:_No_Way_Home'), 'Spider-Man: No Way Home');
});

test('fillSeries adds zero-view days the API leaves out', () => {
  const items = [
    { date: utcDate(2026, 8, 1), views: 10 },
    { date: utcDate(2026, 8, 4), views: 40 },
  ];
  const filled = fillSeries(items, utcDate(2026, 8, 1), utcDate(2026, 8, 5), 'daily');
  assert.deepEqual(filled.map((p) => p.views), [10, 0, 0, 40, 0]);
});

test('fillSeries steps by calendar month for monthly data', () => {
  const items = [{ date: utcDate(2026, 3, 1), views: 5 }];
  const filled = fillSeries(items, utcDate(2026, 1, 15), utcDate(2026, 4, 30), 'monthly');
  assert.deepEqual(filled.map((p) => ymd(p.date)), ['20260101', '20260201', '20260301', '20260401']);
  assert.deepEqual(filled.map((p) => p.views), [0, 0, 5, 0]);
});

test('summarize finds the total, average and peak', () => {
  const s = summarize([{ views: 2 }, { views: 9 }, { views: 4 }]);
  assert.equal(s.total, 15);
  assert.equal(s.average, 5);
  assert.equal(s.peak.views, 9);
  assert.equal(summarize([]).peak, null);
});

test('ratioText describes the gap between two counts', () => {
  assert.equal(ratioText(240, 100), '2.4× as many views as');
  assert.equal(ratioText(100, 104), '4% more views than');
  assert.equal(ratioText(1000, 1001), '1% more views than');
  assert.equal(ratioText(5, 0), 'more views than');
  assert.equal(formatNumber(1234567.4), '1,234,567');
});
