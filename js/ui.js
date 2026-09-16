// Shared DOM helpers: element builder, loading/error states, month picker, storage.

import { ApiError } from './api.js';
import { formatNumber, utcDate, FIRST_DATA_MONTH } from './format.js';

/**
 * Create an element. Strings become text nodes (never HTML), so article titles
 * from the API can't inject markup.
 *   h('a', { href: url, class: 'link', onClick: fn }, 'Label')
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') el.className = value;
    else if (name === 'text') el.textContent = value;
    else if (name === 'dataset') Object.assign(el.dataset, value);
    else if (name === 'style') Object.assign(el.style, value);
    else if (name.startsWith('on') && typeof value === 'function') el.addEventListener(name.slice(2).toLowerCase(), value);
    else el.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const ERROR_TITLES = {
  offline: "Can't reach Wikipedia",
  timeout: 'Wikipedia is slow right now',
  'rate-limit': 'Too many requests',
  'not-found': 'No data for that',
  'bad-request': 'That request didn’t work',
  server: 'Wikipedia had a hiccup',
  'bad-response': 'Unexpected response',
};

/** Turn any thrown error into a short title and a sentence a player can act on. */
export function describeError(err) {
  if (err instanceof ApiError) {
    if (err.kind === 'offline' && navigator.onLine === false) {
      return { title: "You're offline", message: 'Reconnect to the internet, then try again.' };
    }
    return { title: ERROR_TITLES[err.kind] ?? 'Something went wrong', message: err.message };
  }
  console.error(err); // a bug in this app, not an API problem, so keep the details for debugging
  return { title: 'Something went wrong', message: 'An unexpected error happened. Try again, or reload the page.' };
}

export function errorPanel(err, onRetry) {
  const { title, message } = describeError(err);
  return h('div', { class: 'state state--error', role: 'alert' },
    h('span', { class: 'state-icon', 'aria-hidden': 'true' }, '!'),
    h('h2', { class: 'state-title', text: title }),
    h('p', { class: 'state-text', text: message }),
    onRetry && h('button', { type: 'button', class: 'btn btn-primary', onClick: onRetry }, 'Try again'),
  );
}

export function loadingPanel(text) {
  return h('div', { class: 'state state--loading', role: 'status' },
    h('span', { class: 'spinner', 'aria-hidden': 'true' }),
    h('p', { class: 'state-text', text }),
  );
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Count a number up from 0. Resolves when finished. */
export function animateNumber(el, to, { duration = 900, format = formatNumber } = {}) {
  return new Promise((resolve) => {
    if (prefersReducedMotion() || document.hidden) {
      el.textContent = format(to);
      resolve();
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      el.textContent = format(to * (1 - (1 - t) ** 3));
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

/** localStorage that never throws (private windows and blocked storage just fall back). */
export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable; not important */
    }
  },
};

const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });
const monthIndex = ({ year, month }) => year * 12 + (month - 1);

/**
 * Month + year dropdowns limited to the months the API has data for.
 * Call setRange(latest) once the newest available month is known.
 */
export function createMonthPicker({ monthSelect, yearSelect, onChange }) {
  const min = FIRST_DATA_MONTH;
  let max = null;
  let value = null;

  const clamp = (v) => {
    if (monthIndex(v) < monthIndex(min)) return { ...min };
    if (monthIndex(v) > monthIndex(max)) return { ...max };
    return v;
  };

  function render() {
    yearSelect.replaceChildren();
    for (let y = max.year; y >= min.year; y--) yearSelect.append(h('option', { value: y }, y));
    monthSelect.replaceChildren();
    for (let m = 1; m <= 12; m++) {
      const outOfRange = monthIndex({ year: value.year, month: m }) < monthIndex(min) || monthIndex({ year: value.year, month: m }) > monthIndex(max);
      monthSelect.append(h('option', { value: m, disabled: outOfRange }, monthName.format(utcDate(2000, m))));
    }
    yearSelect.value = String(value.year);
    monthSelect.value = String(value.month);
  }

  const handleChange = () => {
    value = clamp({ year: Number(yearSelect.value), month: Number(monthSelect.value) });
    render();
    onChange?.(value);
  };
  monthSelect.addEventListener('change', handleChange);
  yearSelect.addEventListener('change', handleChange);

  return {
    get value() {
      return { ...value };
    },
    setRange(latest) {
      max = latest;
      value = value ? clamp(value) : { ...latest };
      render();
      monthSelect.disabled = false;
      yearSelect.disabled = false;
    },
    randomize(rng = Math.random) {
      const span = monthIndex(max) - monthIndex(min);
      const i = monthIndex(min) + Math.floor(rng() * (span + 1));
      value = { year: Math.floor(i / 12), month: (i % 12) + 1 };
      render();
      return this.value;
    },
  };
}

/** One floating tooltip shared by any element that calls attachTooltip. */
let floating;
export function attachTooltip(target, getContent) {
  const open = () => {
    floating ??= document.body.appendChild(h('div', { class: 'floating-tooltip', role: 'tooltip' }));
    floating.replaceChildren(...[].concat(getContent()));
    floating.hidden = false;
    const box = target.getBoundingClientRect();
    const tip = floating.getBoundingClientRect();
    const left = Math.min(window.innerWidth - tip.width - 8, Math.max(8, box.left + box.width / 2 - tip.width / 2));
    const top = box.top - tip.height - 8 < 8 ? box.bottom + 8 : box.top - tip.height - 8;
    floating.style.left = `${left + window.scrollX}px`;
    floating.style.top = `${top + window.scrollY}px`;
  };
  const close = () => {
    if (floating) floating.hidden = true;
  };
  target.addEventListener('pointerenter', open);
  target.addEventListener('pointerleave', close);
  target.addEventListener('focus', open);
  target.addEventListener('blur', close);
}
