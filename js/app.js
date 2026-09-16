// Entry point: language picker, tab routing (#play, #compare, #top), offline banner.

import { LANGUAGES, getLatestMonth } from './api.js';
import { h, storage } from './ui.js';
import { createPlayView } from './game.js';
import { createCompareView } from './compare.js';
import { createTopView } from './top.js';

const langSelect = document.getElementById('lang');
const latestMonthByLang = new Map();

function initialLanguage() {
  const saved = storage.get('whl:lang');
  if (LANGUAGES.some((l) => l.code === saved)) return saved;
  const browser = (navigator.language || 'en').slice(0, 2);
  return LANGUAGES.some((l) => l.code === browser) ? browser : 'en';
}

let lang = initialLanguage();

/** Shared state and helpers handed to every tab. */
const ctx = {
  get lang() {
    return lang;
  },
  get langName() {
    return LANGUAGES.find((l) => l.code === lang).name;
  },
  setLang(code) {
    if (code === lang || !LANGUAGES.some((l) => l.code === code)) return;
    lang = code;
    langSelect.value = code;
    storage.set('whl:lang', code);
    Object.values(views).forEach((v) => v.controller.languageChanged());
  },
  /** Newest month with published rankings for the current language (asked once per language). */
  latestMonth() {
    const code = lang;
    if (!latestMonthByLang.has(code)) {
      latestMonthByLang.set(code, getLatestMonth(code).catch((err) => {
        latestMonthByLang.delete(code); // allow a retry
        throw err;
      }));
    }
    return latestMonthByLang.get(code);
  },
};

for (const l of LANGUAGES) langSelect.append(h('option', { value: l.code }, l.name));
langSelect.value = lang;
langSelect.addEventListener('change', () => ctx.setLang(langSelect.value));

const views = {
  play: { tab: document.getElementById('tab-play'), section: document.getElementById('view-play') },
  compare: { tab: document.getElementById('tab-compare'), section: document.getElementById('view-compare') },
  top: { tab: document.getElementById('tab-top'), section: document.getElementById('view-top') },
};
views.play.controller = createPlayView(views.play.section, ctx);
views.compare.controller = createCompareView(views.compare.section, ctx);
views.top.controller = createTopView(views.top.section, ctx);

function route() {
  const [name, query = ''] = location.hash.slice(1).split('?');
  const current = views[name] ? name : 'play';
  const params = new URLSearchParams(query);

  for (const [key, view] of Object.entries(views)) {
    const active = key === current;
    view.section.hidden = !active;
    view.tab.setAttribute('aria-selected', String(active));
    view.tab.tabIndex = active ? 0 : -1;
  }
  // Shared links can carry a language. Switch after hiding other tabs so they don't load for nothing.
  if (params.has('lang')) ctx.setLang(params.get('lang'));
  document.title = current === 'play' ? 'Wiki Higher or Lower' : `${views[current].tab.textContent} · Wiki Higher or Lower`;
  views[current].controller.show(params);
}

window.addEventListener('hashchange', route);
route();

// Arrow keys move between tabs, as screen reader users expect from a tab list.
document.querySelector('.tabs').addEventListener('keydown', (e) => {
  const order = Object.keys(views);
  const index = order.findIndex((k) => views[k].tab === document.activeElement);
  if (index < 0 || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const next = views[order[(index + (e.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length]].tab;
  next.focus();
  next.click();
});

// Tell people right away when the connection drops, instead of waiting for a request to fail.
const banner = document.getElementById('offline-banner');
const updateOnline = () => { banner.hidden = navigator.onLine; };
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);
updateOnline();
