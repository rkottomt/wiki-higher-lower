import { getTopPagesByDevice, getSiteInfo, getPageInfo } from './js/api.js';
import { buildPool } from './js/pool.js';
import { assessArticle } from './js/safety.js';

const langs = ['de', 'es', 'fr', 'it', 'ja', 'pt'];
await new Promise(r => setTimeout(r, 120000));
const [year, month] = [2026, 8];
for (const lang of langs) { await new Promise(r => setTimeout(r, 45000));
  const [top, site] = await Promise.all([getTopPagesByDevice(lang, year, month), getSiteInfo(lang)]);
  const { articles, removed } = buildPool(top, site);
  const byTitle = removed.filter((r) => r.reason.code === 'adult');
  // Details check on the top 150 survivors (what a player is most likely to see)
  const sample = articles.slice(0, 150);
  const info = await getPageInfo(lang, sample.map((a) => a.key), { thumbSize: 120 });
  const byDetails = [];
  for (const a of sample) {
    const v = assessArticle({ ...a, ...(info.get(a.key) ?? {}) });
    if (v.blocked) byDetails.push(`${a.title} [${v.signal}]`);
  }
  console.log(`\n== ${lang} == pool ${articles.length}`);
  console.log('  blocked by title :', byTitle.map((r) => r.title).join(' | ') || '(none)');
  console.log('  blocked on detail:', byDetails.join(' | ') || '(none)');
}
