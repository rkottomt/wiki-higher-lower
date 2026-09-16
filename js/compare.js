// The "Compare" tab: chart the pageviews of up to four articles over time.

import { resolveTitles, getSuggestion, searchTitles, getArticleViews } from './api.js';
import { h, describeError, errorPanel, loadingPanel } from './ui.js';
import { renderLineChart } from './chart.js';
import {
  RANGES, rangeDates, fillSeries, summarize, formatNumber, formatCompact, fullDayLabel, monthLabel,
  articleUrl, titleFromKey, keyFromTitle,
} from './format.js';

const MAX_ARTICLES = 4;
const whenLabel = (date, granularity) =>
  granularity === 'daily' ? fullDayLabel(date) : monthLabel(date.getUTCFullYear(), date.getUTCMonth() + 1);
const EXAMPLES = {
  en: [['ChatGPT', 'Google'], ['Taylor Swift', 'Beyoncé'], ['Cat', 'Dog'], ['Mars', 'Moon', 'Sun']],
};

export function createCompareView(root, ctx) {
  const form = root.querySelector('#compare-form');
  const input = root.querySelector('#compare-input');
  const addButton = form.querySelector('button[type="submit"]');
  const listbox = root.querySelector('#compare-suggestions');
  const message = root.querySelector('#compare-message');
  const body = root.querySelector('#compare-body');

  /** @type {Array<{key: string, title: string, slot: number}>} */
  let items = [];
  let range = '90d';
  let scale = 'linear';
  let loadedLang = null;
  let refreshToken = 0;
  let hasChart = false;

  // ---- filters ----
  root.querySelectorAll('input[name="range"]').forEach((radio) =>
    radio.addEventListener('change', () => { range = radio.value; syncHash(); refresh(); }));
  root.querySelectorAll('input[name="scale"]').forEach((radio) =>
    radio.addEventListener('change', () => { scale = radio.value; syncHash(); refresh(); }));

  function syncControls() {
    root.querySelector(`input[name="range"][value="${range}"]`).checked = true;
    root.querySelector(`input[name="scale"][value="${scale}"]`).checked = true;
  }

  /** Keep the URL shareable: #compare?lang=en&range=90d&a=ChatGPT|Google */
  function syncHash() {
    const params = new URLSearchParams({ lang: ctx.lang, range });
    if (scale !== 'linear') params.set('scale', scale);
    if (items.length) params.set('a', items.map((i) => i.key).join('|'));
    history.replaceState(null, '', `#compare?${params}`);
  }

  // ---------------------------------------------------------------------------
  // Messages under the search box
  // ---------------------------------------------------------------------------

  function say(text, tone = 'info', ...extra) {
    message.className = `inline-message inline-message--${tone}`;
    message.replaceChildren(text, ...extra);
    message.hidden = !text;
  }
  const clearMessage = () => say('');

  // ---------------------------------------------------------------------------
  // Adding and removing articles
  // ---------------------------------------------------------------------------

  const freeSlot = () => [1, 2, 3, 4].find((s) => !items.some((i) => i.slot === s));

  async function addArticle(text) {
    const typed = text.trim();
    closeSuggestions();
    if (!typed) return say('Type the title of a Wikipedia article first.', 'warn');
    if (items.length >= MAX_ARTICLES) return say(`You can compare up to ${MAX_ARTICLES} articles. Remove one to add another.`, 'warn');

    addButton.disabled = true;
    say('Looking up that article…');
    try {
      const [match] = await resolveTitles(ctx.lang, [typed]);
      if (match.missing) {
        let suggestion = await getSuggestion(ctx.lang, typed).catch(() => null);
        if (suggestion) suggestion = suggestion.charAt(0).toUpperCase() + suggestion.slice(1); // titles start with a capital
        const hint = suggestion && suggestion.toLowerCase() !== typed.toLowerCase()
          ? h('button', { type: 'button', class: 'link-button', onClick: () => { input.value = ''; addArticle(suggestion); } }, `Did you mean “${suggestion}”?`)
          : ' Check the spelling, or pick a suggestion while you type.';
        return say(`There’s no ${ctx.langName} Wikipedia article called “${typed}”. `, 'warn', hint);
      }
      if (match.notArticle) return say(`“${match.title}” isn’t an article, so it has no pageview chart here.`, 'warn');
      if (items.some((i) => i.key === match.key)) return say(`${match.title} is already on the chart.`, 'warn');

      items.push({ key: match.key, title: match.title, slot: freeSlot() });
      input.value = '';
      if (match.redirectedFrom) {
        say(`“${match.redirectedFrom}” redirects to “${match.title}”, so the chart shows that article (redirects are counted separately).`);
      } else {
        clearMessage();
      }
      syncHash();
      refresh();
    } catch (err) {
      const { title, message: detail } = describeError(err);
      say(`${title}. ${detail} `, 'error', h('button', { type: 'button', class: 'link-button', onClick: () => addArticle(typed) }, 'Try again'));
    } finally {
      addButton.disabled = false;
    }
  }

  /** Replace the chart's articles in one request (used by examples and shared links). */
  async function setArticles(titles) {
    closeSuggestions();
    say('Looking up articles…');
    try {
      const matches = await resolveTitles(ctx.lang, titles.slice(0, MAX_ARTICLES));
      const found = [];
      for (const m of matches) if (!m.missing && !m.notArticle && !found.some((f) => f.key === m.key)) found.push(m);
      items = found.map((m, i) => ({ key: m.key, title: m.title, slot: i + 1 }));
      const skipped = matches.filter((m) => m.missing).map((m) => `“${m.input}”`);
      if (skipped.length) say(`Couldn’t find ${skipped.join(', ')} on ${ctx.langName} Wikipedia.`, 'warn');
      else clearMessage();
      syncHash();
      refresh();
    } catch (err) {
      const { title, message: detail } = describeError(err);
      say(`${title}. ${detail} `, 'error', h('button', { type: 'button', class: 'link-button', onClick: () => setArticles(titles) }, 'Try again'));
    }
  }

  function removeArticle(key) {
    items = items.filter((i) => i.key !== key); // other articles keep their colors
    clearMessage();
    syncHash();
    refresh();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const active = listbox.querySelector('[aria-selected="true"]');
    addArticle(active ? active.dataset.title : input.value);
  });

  // ---------------------------------------------------------------------------
  // Search-as-you-type suggestions
  // ---------------------------------------------------------------------------

  let searchTimer;
  let searchController;

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) return closeSuggestions();
    searchTimer = setTimeout(() => runSearch(q), 200); // wait for a pause in typing
  });

  async function runSearch(q) {
    searchController?.abort();
    searchController = new AbortController();
    try {
      const results = await searchTitles(ctx.lang, q, { signal: searchController.signal });
      if (input.value.trim() !== q) return;
      showSuggestions(results);
    } catch {
      closeSuggestions(); // suggestions are optional; errors show up when the user presses Add
    }
  }

  function showSuggestions(results) {
    listbox.replaceChildren(
      ...results.map((r, i) =>
        h('li', { id: `compare-option-${i}`, role: 'option', class: 'suggestion', 'aria-selected': 'false', dataset: { title: r.title } },
          h('span', { class: 'suggestion-title', text: r.title }),
          r.description && h('span', { class: 'suggestion-desc', text: r.description }),
        )),
    );
    const open = results.length > 0;
    listbox.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    input.removeAttribute('aria-activedescendant');
  }

  function closeSuggestions() {
    listbox.hidden = true;
    listbox.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function moveActive(delta) {
    const options = [...listbox.children];
    if (listbox.hidden || options.length === 0) return;
    const current = options.findIndex((o) => o.getAttribute('aria-selected') === 'true');
    // Positions cycle through -1 (the text box itself), 0, 1, ... options.length - 1.
    const next = ((current + 1 + delta + options.length + 1) % (options.length + 1)) - 1;
    options.forEach((o, i) => o.setAttribute('aria-selected', String(i === next)));
    if (next >= 0) input.setAttribute('aria-activedescendant', options[next].id);
    else input.removeAttribute('aria-activedescendant');
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
    else if (e.key === 'Escape') closeSuggestions();
  });
  listbox.addEventListener('pointerdown', (e) => {
    const option = e.target.closest('.suggestion');
    if (!option) return;
    e.preventDefault(); // keep focus in the input
    addArticle(option.dataset.title);
  });
  input.addEventListener('blur', () => setTimeout(closeSuggestions, 100));

  // ---------------------------------------------------------------------------
  // Loading data and drawing
  // ---------------------------------------------------------------------------

  async function refresh() {
    const my = ++refreshToken;
    if (items.length === 0) {
      hasChart = false;
      return renderEmpty();
    }
    const { granularity, start, end } = rangeDates(range);
    if (hasChart) body.classList.add('is-refreshing'); // keep the old chart visible while loading
    else body.replaceChildren(loadingPanel('Loading pageviews…'));

    try {
      const raw = await Promise.all(items.map((i) => getArticleViews(ctx.lang, i.key, granularity, start, end)));
      if (my !== refreshToken) return;

      // Yesterday's numbers are sometimes not published yet. Stop at the newest date any article has.
      const newest = Math.max(...raw.flat().map((p) => p.date.getTime()));
      const lastDate = Number.isFinite(newest) && newest < end.getTime() ? new Date(newest) : end;

      const series = items.map((item, k) => ({
        ...item,
        hasData: raw[k].length > 0,
        points: fillSeries(raw[k], start, lastDate, granularity),
      }));
      renderResults(series, granularity);
      hasChart = true;
    } catch (err) {
      if (my !== refreshToken) return;
      hasChart = false;
      body.replaceChildren(chipsPanel(), errorPanel(err, refresh));
    } finally {
      if (my === refreshToken) body.classList.remove('is-refreshing');
    }
  }

  const colorOf = (item) => `var(--series-${item.slot})`;

  function chipsPanel() {
    return h('ul', { class: 'chips', 'aria-label': 'Articles on the chart' },
      items.map((item) => h('li', { class: 'chip' },
        h('span', { class: 'line-key', style: { background: colorOf(item) }, 'aria-hidden': 'true' }),
        h('a', { href: articleUrl(ctx.lang, item.key), target: '_blank', rel: 'noopener', text: item.title }),
        h('button', { type: 'button', class: 'chip-remove', 'aria-label': `Remove ${item.title}`, onClick: () => removeArticle(item.key) }, '×'),
      )),
    );
  }

  function renderResults(series, granularity) {
    const unit = granularity === 'daily' ? 'day' : 'month';
    const period = `${RANGES[range].label}, ${whenLabel(series[0].points[0].date, granularity)} – ${whenLabel(series[0].points.at(-1).date, granularity)}`;

    const chartHost = h('div', { class: 'chart-host' });
    const stats = series.map((s) => ({ ...s, ...summarize(s.points) }));
    const grandTotal = stats.reduce((sum, s) => sum + s.total, 0);

    body.replaceChildren(
      h('section', { class: 'panel' },
        h('div', { class: 'panel-head' },
          h('h2', { class: 'panel-title' }, `Views per ${unit}`),
          h('p', { class: 'panel-sub' }, `${period} · ${ctx.langName} Wikipedia${scale === 'log' ? ' · log scale' : ''}`)),
        chipsPanel(),
        chartHost,
      ),
      insights(stats, granularity),
      h('section', { class: 'panel' },
        h('h2', { class: 'panel-title' }, 'The numbers'),
        h('div', { class: 'table-wrap' },
          h('table', { class: 'data-table' },
            h('thead', {}, h('tr', {},
              h('th', { scope: 'col' }, 'Article'),
              h('th', { scope: 'col', class: 'num' }, 'Total views'),
              h('th', { scope: 'col', class: 'num' }, `Average per ${unit}`),
              h('th', { scope: 'col', class: 'num' }, `Busiest ${unit}`),
              h('th', { scope: 'col', class: 'num' }, 'Share'))),
            h('tbody', {}, [...stats].sort((a, b) => b.total - a.total).map((s) => h('tr', {},
              h('th', { scope: 'row' }, h('span', { class: 'row-label' }, h('span', { class: 'line-key', style: { background: colorOf(s) }, 'aria-hidden': 'true' }), s.title)),
              h('td', { class: 'num' }, formatNumber(s.total)),
              h('td', { class: 'num' }, formatNumber(s.average)),
              h('td', { class: 'num' }, s.hasData && s.peak.views > 0
                ? `${formatNumber(s.peak.views)} (${whenLabel(s.peak.date, granularity)})`
                : '—'),
              h('td', { class: 'num' }, grandTotal > 0 ? `${((s.total / grandTotal) * 100).toFixed(1)}%` : '—'),
            ))),
          ),
        ),
        stats.filter((s) => !s.hasData).map((s) =>
          h('p', { class: 'table-note' }, `${s.title} has no recorded views in this range. The article may be newer than the range, or rarely read.`)),
      ),
    );

    renderLineChart(chartHost, {
      series: series.map((s) => ({ label: s.title, color: colorOf(s), points: s.points })),
      granularity,
      scale,
      ariaLabel: `Line chart of views per ${unit} for ${series.map((s) => s.title).join(', ')}. The table below lists the totals.`,
    });
  }

  /** One or two plain-English takeaways computed from the data. */
  function insights(stats, granularity) {
    const unit = granularity === 'daily' ? 'day' : 'month';
    const lines = [];
    const ranked = [...stats].filter((s) => s.total > 0).sort((a, b) => b.total - a.total);
    if (ranked.length >= 2) {
      const [first, second] = ranked;
      const r = first.total / second.total;
      lines.push(`${first.title} was read the most: ${r < 1.1 ? 'just ahead of' : `${r < 10 ? r.toFixed(1) : formatNumber(r)}× as many views as`} ${second.title}.`);
    }
    // Biggest spike: the busiest day compared with that article's typical (median) day.
    let spike = null;
    for (const s of stats) {
      if (!s.hasData || s.points.length < 7) continue;
      const sorted = s.points.map((p) => p.views).sort((a, b) => a - b);
      const median = Math.max(1, sorted[Math.floor(sorted.length / 2)]);
      const size = s.peak.views / median;
      if (!spike || size > spike.size) spike = { s, size };
    }
    if (spike && spike.size >= 3) {
      lines.push(`Biggest spike: ${spike.s.title} ${granularity === 'daily' ? 'on' : 'in'} ${whenLabel(spike.s.peak.date, granularity)}, with ${formatNumber(spike.s.peak.views)} views, ${spike.size < 10 ? spike.size.toFixed(1) : formatNumber(spike.size)}× a typical ${unit}.`);
    }
    return lines.length ? h('div', { class: 'insights' }, lines.map((text) => h('p', { class: 'insight', text }))) : null;
  }

  function renderEmpty() {
    const examples = EXAMPLES[ctx.lang];
    body.replaceChildren(
      h('div', { class: 'state state--empty' },
        h('h2', { class: 'state-title' }, 'Compare how much attention topics get'),
        h('p', { class: 'state-text' },
          `Add up to ${MAX_ARTICLES} ${ctx.langName} Wikipedia articles to chart their daily or monthly views, going back to July 2015.`),
        examples && h('div', { class: 'example-list' },
          h('span', { class: 'example-label' }, 'Try:'),
          examples.map((set) => h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onClick: () => setArticles(set) }, set.join(' vs ')))),
      ),
    );
  }

  // ---------------------------------------------------------------------------

  function resetForLanguage() {
    loadedLang = ctx.lang;
    const hadItems = items.length > 0;
    items = [];
    hasChart = false;
    input.value = '';
    closeSuggestions();
    if (hadItems) say(`Switched to ${ctx.langName} Wikipedia. Article titles differ between languages, so the chart was cleared.`);
    else clearMessage();
  }

  return {
    /** @param {URLSearchParams} params from the URL hash */
    show(params) {
      const langChanged = loadedLang !== ctx.lang;
      if (langChanged) resetForLanguage();
      const before = `${range}|${scale}`;
      if (RANGES[params.get('range')]) range = params.get('range');
      if (['linear', 'log'].includes(params.get('scale'))) scale = params.get('scale');
      syncControls();

      if (params.has('a')) {
        const keys = params.get('a').split('|').filter(Boolean);
        if (keys.join('|') !== items.map((i) => i.key).join('|')) return setArticles(keys.map(titleFromKey));
      } else if (params.has('add')) {
        const key = keyFromTitle(params.get('add'));
        if (!items.some((i) => i.key === key)) {
          // If the add fails, still draw whatever was already on the chart.
          return addArticle(titleFromKey(key)).then(() => { if (!hasChart) refresh(); });
        }
      }
      syncHash();
      if (langChanged || !hasChart || before !== `${range}|${scale}`) refresh();
    },
    languageChanged() {
      if (!root.hidden) {
        resetForLanguage();
        syncHash();
        refresh();
      }
    },
  };
}
