// The "Top charts" tab: the most-read articles for a month, plus the pages that
// were filtered out (and why), which shows how the game's article pool is built.

import { getTopPagesByDevice, getSiteInfo, getPageInfo } from './api.js';
import { buildPool } from './pool.js';
import { formatNumber, formatCompact, monthLabel, articleUrl } from './format.js';
import { h, errorPanel, loadingPanel, createMonthPicker, attachTooltip } from './ui.js';

const PAGE_SIZES = [25, 50, 100];

export function createTopView(root, ctx) {
  const body = root.querySelector('#top-body');
  const showRemoved = root.querySelector('#top-show-removed');
  const picker = createMonthPicker({
    monthSelect: root.querySelector('#top-month'),
    yearSelect: root.querySelector('#top-year'),
    onChange: () => load(),
  });

  let loadedLang = null;
  let token = 0;
  let data = null;
  let limit = PAGE_SIZES[0];

  showRemoved.addEventListener('change', () => data && render());

  async function prepare() {
    loadedLang = ctx.lang;
    const my = ++token;
    data = null;
    body.replaceChildren(loadingPanel('Checking the latest month of data…'));
    try {
      const latest = await ctx.latestMonth();
      if (my !== token) return;
      picker.setRange(latest);
      await load();
    } catch (err) {
      if (my === token) body.replaceChildren(errorPanel(err, prepare));
    }
  }

  async function load() {
    const my = ++token;
    const { year, month } = picker.value;
    const lang = ctx.lang;
    limit = PAGE_SIZES[0];
    if (data) body.classList.add('is-refreshing');
    else body.replaceChildren(loadingPanel(`Loading the most-viewed articles of ${monthLabel(year, month)}…`));
    try {
      const [top, siteInfo] = await Promise.all([getTopPagesByDevice(lang, year, month), getSiteInfo(lang)]);
      const pool = buildPool(top, siteInfo);
      if (my !== token) return;
      data = { ...pool, year, month, lang, info: new Map() };
      await loadInfo(my);
      if (my === token) render();
    } catch (err) {
      if (my !== token) return;
      data = null;
      body.replaceChildren(errorPanel(err, load));
    } finally {
      if (my === token) body.classList.remove('is-refreshing');
    }
  }

  /** Thumbnails and descriptions for the rows on screen. Optional, so errors are ignored. */
  async function loadInfo(my) {
    const keys = data.articles.slice(0, limit).map((a) => a.key).filter((k) => !data.info.has(k));
    if (keys.length === 0) return;
    try {
      const info = await getPageInfo(data.lang, keys, { thumbSize: 120 });
      if (my === token) info.forEach((v, k) => data.info.set(k, v));
    } catch {
      /* rows still show titles and numbers */
    }
  }

  async function showMore() {
    limit = PAGE_SIZES[PAGE_SIZES.indexOf(limit) + 1] ?? limit;
    const my = token;
    await loadInfo(my);
    if (my === token) render();
  }

  function render() {
    const { articles, removed, year, month, lang, info } = data;
    const shown = articles.slice(0, limit);
    const max = shown[0]?.views ?? 1;
    const period = monthLabel(year, month);

    const rows = shown.map((a, i) => {
      const meta = info.get(a.key);
      const bar = h('div', { class: 'bar-track', tabindex: '0', 'aria-label': `${a.title}: ${formatNumber(a.views)} views` },
        h('span', { class: 'bar', style: { width: `${Math.max(0.5, (a.views / max) * 100)}%` } }),
        h('span', { class: 'bar-value', text: formatCompact(a.views) }));
      attachTooltip(bar, () => [
        h('strong', { text: formatNumber(a.views) }), ' views',
        h('br'),
        h('span', { class: 'muted' }, deviceSplit(a)),
      ]);
      return h('li', { class: 'top-row' },
        h('span', { class: 'top-rank', text: i + 1 }),
        meta?.thumbnail
          ? h('img', { class: 'top-thumb', src: meta.thumbnail, alt: '', loading: 'lazy', decoding: 'async' })
          : h('span', { class: 'top-thumb top-thumb--empty', 'aria-hidden': 'true', text: a.title.charAt(0) }),
        h('div', { class: 'top-main' },
          h('a', { class: 'top-title', href: articleUrl(lang, a.key), target: '_blank', rel: 'noopener', text: meta?.title ?? a.title }),
          meta?.description && h('span', { class: 'top-desc', text: meta.description }),
          bar),
        h('a', { class: 'btn btn-secondary btn-sm top-compare', href: `#compare?lang=${lang}&add=${encodeURIComponent(a.key)}`, 'aria-label': `Compare ${a.title} over time` }, 'Chart it'),
      );
    });

    const nextSize = PAGE_SIZES[PAGE_SIZES.indexOf(limit) + 1];
    body.replaceChildren(
      h('section', { class: 'panel' },
        h('div', { class: 'panel-head' },
          h('h2', { class: 'panel-title' }, `Most-read articles, ${period}`),
          h('p', { class: 'panel-sub' },
            `${ctx.langName} Wikipedia · top ${shown.length} of ${formatNumber(articles.length)} articles · ` +
            `${removed.length} pages removed from the top 1,000`)),
        h('ol', { class: 'top-list' }, rows),
        nextSize && articles.length > limit && h('button', { type: 'button', class: 'btn btn-secondary show-more', onClick: showMore }, `Show top ${nextSize}`),
      ),
      showRemoved.checked && removedPanel(removed, lang),
    );
  }

  function removedPanel(removed, lang) {
    return h('section', { class: 'panel' },
      h('div', { class: 'panel-head' },
        h('h2', { class: 'panel-title' }, 'Filtered out'),
        h('p', { class: 'panel-sub' },
          'These pages were in the raw top 1,000 but aren’t used by the game. Pages where more than 90% of views came from ' +
          'desktop, or more than 95% from mobile web, are almost always inflated by bots, since real readers use both.')),
      h('div', { class: 'table-wrap' },
        h('table', { class: 'data-table' },
          h('thead', {}, h('tr', {},
            h('th', { scope: 'col', class: 'num' }, 'Raw rank'),
            h('th', { scope: 'col' }, 'Page'),
            h('th', { scope: 'col', class: 'num' }, 'Views'),
            h('th', { scope: 'col' }, 'Why it was removed'))),
          h('tbody', {}, removed.map((r) => h('tr', {},
            h('td', { class: 'num' }, r.rank),
            h('th', { scope: 'row' }, h('a', { href: articleUrl(lang, r.key), target: '_blank', rel: 'noopener', text: r.title })),
            h('td', { class: 'num' }, formatNumber(r.views)),
            h('td', {}, h('span', { class: `reason reason--${r.reason.code}`, text: r.reason.label })),
          ))),
        ),
      ),
    );
  }

  const deviceSplit = (a) => {
    const part = (share, name) => (share === null ? `${name}: too few to rank` : `${Math.round(share * 100)}% ${name}`);
    return `${part(a.desktopShare, 'desktop')} · ${part(a.mobileShare, 'mobile web')}`;
  };

  return {
    show() {
      if (loadedLang !== ctx.lang) prepare();
    },
    languageChanged() {
      if (root.hidden) loadedLang = null;
      else prepare();
    },
  };
}
