// The "Play" tab: a higher-or-lower game using real monthly Wikipedia pageviews.

import { getTopPagesByDevice, getSiteInfo, getPageInfo, getArticleViews, ApiError } from './api.js';
import { buildPool, pickOpponent, pickStart, DIFFICULTIES } from './pool.js';
import { formatNumber, formatCompact, monthLabel, utcDate, endOfMonth, fillSeries, summarize, ratioText, articleUrl, dayLabel } from './format.js';
import { h, errorPanel, loadingPanel, animateNumber, storage, createMonthPicker, prefersReducedMotion } from './ui.js';
import { renderLineChart } from './chart.js';

const SITE_URL = 'https://rkottomt.github.io/wiki-higher-lower/';
const bestKey = (difficulty) => `whl:best:${difficulty}`;

export function createPlayView(root, ctx) {
  const stage = root.querySelector('#play-stage');
  const form = root.querySelector('#play-setup');
  const picker = createMonthPicker({
    monthSelect: root.querySelector('#play-month'),
    yearSelect: root.querySelector('#play-year'),
  });
  const difficulty = () => form.elements.difficulty.value;

  let loadedLang = null;
  let token = 0; // bumped whenever the screen changes, so late network results are ignored
  let game = null;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    startGame();
  });
  root.querySelector('#play-random-month').addEventListener('click', () => {
    picker.randomize();
    startGame();
  });
  document.addEventListener('keydown', onKeydown);

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  async function prepare() {
    loadedLang = ctx.lang;
    const my = ++token;
    game = null;
    setFormEnabled(false);
    stage.replaceChildren(loadingPanel('Checking the latest month of data…'));
    try {
      const latest = await ctx.latestMonth();
      if (my !== token) return;
      picker.setRange(latest);
      setFormEnabled(true);
      renderIntro();
    } catch (err) {
      if (my === token) stage.replaceChildren(errorPanel(err, prepare));
    }
  }

  function setFormEnabled(enabled) {
    for (const el of form.elements) el.disabled = !enabled;
  }

  function renderIntro() {
    const { year, month } = picker.value;
    const bests = Object.entries(DIFFICULTIES)
      .map(([key, d]) => `${d.label} ${storage.get(bestKey(key), 0)}`)
      .join(' · ');
    stage.replaceChildren(
      h('div', { class: 'intro' },
        h('p', { class: 'eyebrow' }, 'How to play'),
        h('h2', { class: 'intro-title' }, 'Which Wikipedia article got more views?'),
        h('p', { class: 'intro-text' },
          `You'll see an article and how many times people read it on ${ctx.langName} Wikipedia in ${monthLabel(year, month)}. ` +
          'Guess whether the next article got more or fewer views. One wrong guess ends your streak.'),
        h('ul', { class: 'intro-facts' },
          h('li', {}, 'Articles come live from that month’s 1,000 most-viewed pages'),
          h('li', {}, 'Bot traffic and non-article pages are filtered out'),
          h('li', {}, h('span', {}, 'Keyboard: '), h('kbd', {}, '↑'), ' higher · ', h('kbd', {}, '↓'), ' lower · ', h('kbd', {}, 'Enter'), ' next'),
        ),
        h('button', { type: 'button', class: 'btn btn-primary btn-lg', onClick: startGame }, 'Start playing'),
        h('p', { class: 'intro-best' }, `Best streaks: ${bests}`),
      ),
    );
  }

  async function startGame() {
    const my = ++token;
    const { year, month } = picker.value;
    const level = difficulty();
    stage.replaceChildren(loadingPanel(`Loading the most-viewed articles of ${monthLabel(year, month)}…`));
    try {
      const [top, siteInfo] = await Promise.all([getTopPagesByDevice(ctx.lang, year, month), getSiteInfo(ctx.lang)]);
      const { articles } = buildPool(top, siteInfo);
      if (articles.length < 10) throw new ApiError('not-found', 'Not enough articles were found for that month. Try another one.');

      const used = new Set();
      const left = pickStart(articles);
      used.add(left.key);
      const right = pickOpponent(articles, left, level, used);
      used.add(right.key);
      await loadInfo(ctx.lang, [left, right]);
      if (my !== token) return;

      game = { lang: ctx.lang, year, month, difficulty: level, articles, used, left, right, next: null, streak: 0, rounds: [], phase: 'guessing', newBest: false };
      renderRound();
    } catch (err) {
      if (my === token) stage.replaceChildren(errorPanel(err, startGame));
    }
  }

  /** Attach descriptions and thumbnails. Pictures are a bonus, so failures are ignored. */
  async function loadInfo(lang, articles) {
    const missing = articles.filter((a) => a && !a.info);
    if (missing.length === 0) return;
    try {
      const info = await getPageInfo(lang, missing.map((a) => a.key));
      for (const a of missing) a.info = info.get(a.key);
    } catch {
      /* the game still works with titles only */
    }
  }

  // ---------------------------------------------------------------------------
  // A round
  // ---------------------------------------------------------------------------

  function renderRound() {
    const { left, right } = game;
    const period = monthLabel(game.year, game.month);
    game.phase = 'guessing';

    const higher = h('button', { type: 'button', class: 'btn btn-primary btn-guess', onClick: () => guess('higher') }, h('span', { 'aria-hidden': 'true' }, '▲'), ' Higher');
    const lower = h('button', { type: 'button', class: 'btn btn-secondary btn-guess', onClick: () => guess('lower') }, h('span', { 'aria-hidden': 'true' }, '▼'), ' Lower');
    const rightViews = h('p', { class: 'card-views', 'aria-live': 'polite' });
    const result = h('div', { class: 'round-result', 'aria-live': 'polite' });

    const leftCard = card(left, 'left', [
      h('p', { class: 'card-had' }, 'had'),
      h('p', { class: 'card-views', text: formatNumber(left.views) }),
      h('p', { class: 'card-unit' }, `views in ${period}`),
    ]);
    const rightCard = card(right, 'right', [
      h('p', { class: 'card-had' }, 'had'),
      h('div', { class: 'card-answer' }, h('div', { class: 'card-actions' }, higher, lower), rightViews),
      h('p', { class: 'card-unit' }, 'views than ', h('strong', { text: left.info?.title ?? left.title })),
    ]);

    stage.replaceChildren(
      hud(),
      h('div', { class: 'arena' }, leftCard, h('div', { class: 'versus', 'aria-hidden': 'true' }, 'VS'), rightCard),
      result,
    );
    game.ui = { leftCard, rightCard, rightViews, result, buttons: [higher, lower] };
    if (!prefersReducedMotion()) rightCard.classList.add('card--enter');

    // While the player thinks, pick and preload the article after this one.
    const upcoming = new Set(game.used);
    game.next = pickOpponent(game.articles, right, game.difficulty, upcoming);
    loadInfo(game.lang, [game.next]).then(() => {
      if (game?.next?.info?.thumbnail) new Image().src = game.next.info.thumbnail;
    });
  }

  function card(article, side, body) {
    const info = article.info ?? {};
    return h('article', { class: `card card--${side}` },
      // The whole picture is shown (no cropped-off faces) over a blurred copy that fills the frame.
      h('div', { class: 'card-media' },
        info.thumbnail
          ? [h('img', { class: 'card-media-fill', src: info.thumbnail, alt: '', 'aria-hidden': 'true' }),
             h('img', { class: 'card-media-main', src: info.thumbnail, alt: '', decoding: 'async' })]
          : h('span', { class: 'card-initial', 'aria-hidden': 'true', text: (info.title ?? article.title).charAt(0) }),
      ),
      h('div', { class: 'card-body' },
        h('h3', { class: 'card-title' },
          h('a', { href: articleUrl(game.lang, article.key), target: '_blank', rel: 'noopener' }, info.title ?? article.title)),
        h('p', { class: 'card-desc', text: info.description || 'Wikipedia article' }),
        ...body,
        h('div', { class: 'card-trend' }),
      ),
    );
  }

  function hud() {
    const best = storage.get(bestKey(game.difficulty), 0);
    return h('div', { class: 'hud' },
      h('p', { class: 'hud-stat' }, h('span', {}, 'Streak'), h('strong', { class: 'hud-streak', text: game.streak })),
      h('p', { class: 'hud-stat' }, h('span', {}, 'Best'), h('strong', { class: 'hud-best', text: Math.max(best, game.streak) })),
      h('p', { class: 'hud-context' }, `${monthLabel(game.year, game.month)} · ${ctx.langName} · ${DIFFICULTIES[game.difficulty].label}`),
    );
  }

  async function guess(choice) {
    if (!game || game.phase !== 'guessing') return;
    game.phase = 'revealing';
    const { left, right, ui } = game;
    const correct = (choice === 'higher') === right.views > left.views;

    ui.buttons.forEach((b) => (b.disabled = true));
    ui.rightCard.classList.add('card--revealed');

    // Start loading both sparklines while the number counts up.
    const period = monthLabel(game.year, game.month);
    loadTrend(left, ui.leftCard.querySelector('.card-trend'), period);
    loadTrend(right, ui.rightCard.querySelector('.card-trend'), period);

    await animateNumber(ui.rightViews, right.views);
    if (!game || game.ui !== ui) return; // a new game started meanwhile

    game.rounds.push({ left, right, choice, correct });
    ui.rightCard.classList.add(correct ? 'card--correct' : 'card--wrong');
    if (correct) {
      game.streak += 1;
      const best = storage.get(bestKey(game.difficulty), 0);
      if (game.streak > best) {
        storage.set(bestKey(game.difficulty), game.streak);
        game.newBest = true;
      }
      stage.querySelector('.hud-streak').textContent = game.streak;
      stage.querySelector('.hud-best').textContent = Math.max(best, game.streak);
    }

    const bigger = right.views > left.views ? right : left;
    const smaller = bigger === right ? left : right;
    const nextButton = h('button', { type: 'button', class: 'btn btn-primary btn-lg', onClick: correct ? nextRound : renderGameOver },
      correct ? 'Next round →' : 'See results');
    ui.result.replaceChildren(
      h('p', { class: `verdict verdict--${correct ? 'good' : 'bad'}` },
        h('span', { class: 'verdict-icon', 'aria-hidden': 'true' }, correct ? '✓' : '✗'),
        correct ? 'Correct!' : 'Not quite'),
      h('p', { class: 'result-text' },
        h('strong', { text: bigger.info?.title ?? bigger.title }),
        ` had ${ratioText(bigger.views, smaller.views)} `,
        h('strong', { text: smaller.info?.title ?? smaller.title }),
        ` (${formatCompact(bigger.views)} vs ${formatCompact(smaller.views)}).`),
      nextButton,
    );
    game.phase = correct ? 'correct' : 'wrong';
    nextButton.focus({ preventScroll: true });
    ui.result.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  async function loadTrend(article, slot, period) {
    const start = utcDate(game.year, game.month, 1);
    const end = endOfMonth(game.year, game.month);
    const lang = game.lang;
    slot.replaceChildren(h('p', { class: 'trend-note' }, 'Loading daily views…'));
    try {
      const points = fillSeries(await getArticleViews(lang, article.key, 'daily', start, end), start, end, 'daily');
      if (!slot.isConnected) return;
      const { peak } = summarize(points);
      const chartHost = h('div', { class: 'trend-chart' });
      slot.replaceChildren(chartHost, h('p', { class: 'trend-note' }, `Daily views in ${period} · peak ${dayLabel(peak.date)} (${formatCompact(peak.views)})`));
      const title = article.info?.title ?? article.title;
      renderLineChart(chartHost, {
        series: [{ label: title, color: 'var(--series-1)', points }],
        granularity: 'daily',
        compact: true,
        ariaLabel: `Daily views of ${title} in ${period}, peaking on ${dayLabel(peak.date)} with ${formatNumber(peak.views)} views`,
      });
    } catch {
      if (slot.isConnected) slot.replaceChildren(h('p', { class: 'trend-note' }, 'Couldn’t load the daily chart.'));
    }
  }

  async function nextRound() {
    if (!game) return;
    const my = ++token;
    const next = game.next ?? pickOpponent(game.articles, game.right, game.difficulty, game.used);
    if (!next) return renderGameOver({ ranOut: true });
    game.left = game.right;
    game.right = next;
    game.used.add(next.key);
    await loadInfo(game.lang, [next]);
    if (my === token) renderRound();
  }

  // ---------------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------------

  function renderGameOver({ ranOut = false } = {}) {
    if (!game) return;
    ++token;
    game.phase = 'over';
    const { streak, difficulty: level, rounds, newBest } = game;
    const best = storage.get(bestKey(level), 0);
    const period = monthLabel(game.year, game.month);
    const shareText = `I got a streak of ${streak} on Wiki Higher or Lower (${DIFFICULTIES[level].label}, ${ctx.langName} Wikipedia, ${period}). ${SITE_URL}`;

    const copyButton = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Copy result');
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(shareText);
        copyButton.textContent = 'Copied!';
      } catch {
        copyButton.textContent = 'Copy failed';
      }
    });

    stage.replaceChildren(
      h('div', { class: 'gameover' },
        h('p', { class: 'eyebrow' }, ranOut ? 'You ran out of articles!' : 'Game over'),
        h('p', { class: 'hero-number', text: streak }),
        h('p', { class: 'gameover-label' }, streak === 1 ? 'correct guess in a row' : 'correct guesses in a row'),
        h('p', { class: 'gameover-best' },
          newBest ? `New personal best on ${DIFFICULTIES[level].label}!` : `Your best on ${DIFFICULTIES[level].label}: ${best}`),
        h('div', { class: 'gameover-actions' },
          h('button', { type: 'button', class: 'btn btn-primary btn-lg', onClick: startGame }, 'Play again'),
          copyButton,
        ),
        rounds.length > 0 && h('div', { class: 'recap' },
          h('h3', { class: 'recap-title' }, `Your run · ${period}`),
          h('ol', { class: 'recap-list' },
            rounds.map((r) => h('li', { class: `recap-item recap-item--${r.correct ? 'good' : 'bad'}` },
              h('span', { class: 'recap-icon', 'aria-label': r.correct ? 'Correct' : 'Wrong' }, r.correct ? '✓' : '✗'),
              h('span', { class: 'recap-pair' },
                h('span', {}, h('strong', { text: r.right.info?.title ?? r.right.title }), ` ${formatCompact(r.right.views)}`),
                h('span', { class: 'recap-vs' }, ` ${r.right.views > r.left.views ? '>' : '<'} `),
                h('span', {}, h('strong', { text: r.left.info?.title ?? r.left.title }), ` ${formatCompact(r.left.views)}`)),
              h('span', { class: 'recap-choice' }, `you said ${r.choice}`),
            )),
          ),
        ),
      ),
    );
    stage.querySelector('.gameover .btn-primary').focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  function onKeydown(e) {
    if (root.hidden || !game || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input, select, textarea')) return; // typing in a form field
    // Enter/Space on a focused button or link already "clicks" it; don't do it twice.
    const onControl = e.target.closest?.('button, a');
    if (game.phase === 'guessing') {
      if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'h') { e.preventDefault(); guess('higher'); }
      if (e.key === 'ArrowDown' || e.key.toLowerCase() === 'l') { e.preventDefault(); guess('lower'); }
    } else if (game.phase === 'correct') {
      if (e.key === 'ArrowRight' || (!onControl && (e.key === 'Enter' || e.key === ' '))) {
        e.preventDefault();
        nextRound();
      }
    }
  }

  return {
    show() {
      if (loadedLang !== ctx.lang) prepare();
    },
    languageChanged() {
      if (root.hidden) loadedLang = null; // reload next time the tab is opened
      else prepare();
    },
  };
}
