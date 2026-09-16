// A small SVG line chart with a crosshair tooltip, written by hand so the site has
// no third-party dependencies. Used for the Compare tab (full chart with axes) and
// for the sparklines on game cards (compact: no axes).

import { formatNumber, formatCompact, dayLabel, fullDayLabel, shortMonthLabel, monthLabel } from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** Evenly spaced "round" tick values from 0 up to at least max (0, 250K, 500K, ...). */
export function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const rough = max / count;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough));
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let i = 0; i * step <= top; i++) ticks.push(i * step);
  return ticks;
}

/** Powers of ten covering [min, max] for a log scale (10, 100, 1K, ...). */
export function logTicks(min, max) {
  let lo = Math.floor(Math.log10(Math.max(1, min)));
  let hi = Math.ceil(Math.log10(Math.max(1, max)));
  if (hi === lo) hi += 1;
  const ticks = [];
  for (let e = lo; e <= hi; e++) ticks.push(10 ** e);
  return ticks;
}

/** Which points get an x-axis label, and what the label says. */
function xLabels(dates, granularity, plotWidth) {
  const n = dates.length;
  let candidates;
  if (granularity === 'monthly') {
    candidates = dates.map((d, i) => (d.getUTCMonth() === 0 ? i : -1)).filter((i) => i >= 0);
    if (candidates.length < 2) candidates = dates.map((_, i) => i).filter((i) => i % 3 === 0);
  } else if (n > 120) {
    candidates = dates.map((d, i) => (d.getUTCDate() === 1 ? i : -1)).filter((i) => i >= 0);
  } else {
    const every = Math.max(1, Math.ceil(n / 6));
    candidates = dates.map((_, i) => i).filter((i) => i % every === 0);
  }
  const maxLabels = Math.max(2, Math.floor(plotWidth / 84));
  const stride = Math.ceil(candidates.length / maxLabels);
  const chosen = candidates.filter((_, k) => k % stride === 0);

  return chosen.map((i, k) => {
    const d = dates[i];
    let text;
    if (granularity === 'monthly') text = d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : shortMonthLabel(d);
    else if (n > 120) text = k === 0 || d.getUTCMonth() === 0 ? shortMonthLabel(d) : shortMonthLabel(d).split(' ')[0];
    else text = dayLabel(d);
    return { index: i, text };
  });
}

/**
 * Draw (or redraw) a chart into `host`. Redraws itself when the host is resized.
 * @param {HTMLElement} host
 * @param {{
 *   series: Array<{label: string, color: string, points: Array<{date: Date, views: number}>}>,
 *   granularity: 'daily'|'monthly',
 *   scale?: 'linear'|'log',
 *   compact?: boolean,
 *   ariaLabel: string,
 * }} config
 */
export function renderLineChart(host, config) {
  host._chartConfig = config;
  if (!host._chartObserver && 'ResizeObserver' in window) {
    host._chartObserver = new ResizeObserver(() => {
      const width = Math.round(host.clientWidth);
      if (host._chartConfig && width > 0 && width !== host._chartWidth) draw(host, host._chartConfig);
    });
    host._chartObserver.observe(host);
  }
  draw(host, config);
}

function draw(host, { series, granularity, scale = 'linear', compact = false, ariaLabel }) {
  host.replaceChildren();
  host.classList.add('chart');
  host.classList.toggle('chart--compact', compact);

  const dates = series[0]?.points.map((p) => p.date) ?? [];
  const n = dates.length;
  const width = Math.max(200, Math.round(host.clientWidth));
  host._chartWidth = Math.round(host.clientWidth);
  if (n === 0) return;

  const height = compact ? 64 : width < 560 ? 240 : 320;
  const values = series.flatMap((s) => s.points.map((p) => p.views));
  const maxValue = Math.max(...values);

  // ---- y scale ----
  let yTicks;
  let toUnit; // value -> 0..1 (bottom..top)
  if (scale === 'log') {
    const positive = values.filter((v) => v > 0);
    yTicks = logTicks(positive.length ? Math.min(...positive) : 1, maxValue);
    const lo = Math.log10(yTicks[0]);
    const hi = Math.log10(yTicks[yTicks.length - 1]);
    toUnit = (v) => (Math.log10(Math.max(v, yTicks[0])) - lo) / (hi - lo);
  } else {
    yTicks = compact ? [0, maxValue || 1] : niceTicks(maxValue);
    const top = yTicks[yTicks.length - 1] || 1;
    toUnit = (v) => v / top;
  }

  const tickText = yTicks.map((t) => formatCompact(t));
  const margin = compact
    ? { top: 6, right: 6, bottom: 6, left: 6 }
    : { top: 12, right: 16, bottom: 30, left: Math.max(...tickText.map((t) => t.length)) * 7.5 + 14 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const xOf = (i) => margin.left + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const yOf = (v) => margin.top + plotH * (1 - toUnit(v));

  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img', 'aria-label': ariaLabel });

  // ---- grid and axes (recessive hairlines) ----
  if (!compact) {
    yTicks.forEach((t, k) => {
      const y = yOf(t);
      root.append(svg('line', { class: k === 0 && scale !== 'log' ? 'axis' : 'grid', x1: margin.left, x2: width - margin.right, y1: y, y2: y }));
      const label = svg('text', { class: 'tick', x: margin.left - 8, y: y + 4, 'text-anchor': 'end' });
      label.textContent = tickText[k];
      root.append(label);
    });
    if (scale === 'log') {
      root.append(svg('line', { class: 'axis', x1: margin.left, x2: width - margin.right, y1: margin.top + plotH, y2: margin.top + plotH }));
    }
    for (const { index, text } of xLabels(dates, granularity, plotW)) {
      const x = xOf(index);
      const anchor = x - margin.left < 24 ? 'start' : width - margin.right - x < 24 ? 'end' : 'middle';
      const label = svg('text', { class: 'tick', x, y: height - 8, 'text-anchor': anchor });
      label.textContent = text;
      root.append(label);
    }
  }

  // ---- series ----
  for (const s of series) {
    const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(p.views).toFixed(1)}`).join('');
    if (compact) {
      const area = svg('path', { class: 'area', d: `${d}L${xOf(n - 1).toFixed(1)},${margin.top + plotH}L${xOf(0).toFixed(1)},${margin.top + plotH}Z` });
      area.style.fill = s.color;
      root.append(area);
    }
    const line = svg('path', { class: 'line', d });
    line.style.stroke = s.color;
    root.append(line);
  }

  // Mark the peak on sparklines and the latest value on full charts.
  for (const s of series) {
    let i = n - 1;
    if (compact) s.points.forEach((p, k) => { if (p.views > s.points[i].views) i = k; });
    const dot = svg('circle', { class: 'dot', cx: xOf(i), cy: yOf(s.points[i].views), r: 4 });
    dot.style.fill = s.color;
    root.append(dot);
  }

  // ---- hover layer: crosshair + one tooltip listing every series ----
  const crosshair = svg('line', { class: 'crosshair', y1: margin.top, y2: margin.top + plotH, visibility: 'hidden' });
  root.append(crosshair);
  const hoverDots = series.map((s) => {
    const dot = svg('circle', { class: 'dot', r: 4, visibility: 'hidden' });
    dot.style.fill = s.color;
    root.append(dot);
    return dot;
  });
  const overlay = svg('rect', { class: 'overlay', x: margin.left - 8, y: 0, width: plotW + 16, height });
  root.append(overlay);

  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  tooltip.hidden = true;
  host.append(root, tooltip);

  let current = null;
  const show = (i) => {
    current = i;
    if (i === null) {
      crosshair.setAttribute('visibility', 'hidden');
      hoverDots.forEach((dot) => dot.setAttribute('visibility', 'hidden'));
      tooltip.hidden = true;
      return;
    }
    const x = xOf(i);
    crosshair.setAttribute('x1', x);
    crosshair.setAttribute('x2', x);
    crosshair.setAttribute('visibility', 'visible');
    hoverDots.forEach((dot, k) => {
      dot.setAttribute('cx', x);
      dot.setAttribute('cy', yOf(series[k].points[i].views));
      dot.setAttribute('visibility', 'visible');
    });

    const heading = document.createElement('p');
    heading.className = 'chart-tooltip-date';
    heading.textContent = granularity === 'monthly' ? monthLabel(dates[i].getUTCFullYear(), dates[i].getUTCMonth() + 1) : fullDayLabel(dates[i]);
    const rows = series
      .map((s) => ({ s, views: s.points[i].views }))
      .sort((a, b) => b.views - a.views)
      .map(({ s, views }) => {
        const row = document.createElement('p');
        row.className = 'chart-tooltip-row';
        const key = document.createElement('span');
        key.className = 'line-key';
        key.style.background = s.color;
        const value = document.createElement('strong');
        value.textContent = formatNumber(views);
        const name = document.createElement('span');
        name.textContent = series.length > 1 || !compact ? s.label : 'views';
        row.append(key, value, name);
        return row;
      });
    tooltip.replaceChildren(heading, ...rows);
    tooltip.hidden = false;

    const hostWidth = host.clientWidth;
    const scaleX = hostWidth / width;
    const tipWidth = tooltip.offsetWidth;
    let left = x * scaleX + 14;
    if (left + tipWidth > hostWidth) left = x * scaleX - 14 - tipWidth;
    tooltip.style.left = `${Math.max(0, left)}px`;
    tooltip.style.top = compact ? `${height + 4}px` : `${margin.top}px`;
  };

  const indexAt = (clientX) => {
    const box = root.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * width;
    return Math.min(n - 1, Math.max(0, Math.round(((px - margin.left) / plotW) * (n - 1))));
  };
  overlay.addEventListener('pointermove', (e) => show(indexAt(e.clientX)));
  overlay.addEventListener('pointerdown', (e) => show(indexAt(e.clientX)));
  overlay.addEventListener('pointerleave', () => show(null));

  // Keyboard: focus the chart, then use the arrow keys to move the crosshair.
  host.tabIndex = 0;
  host.onfocus = () => show(current ?? n - 1);
  host.onblur = () => show(null);
  host.onkeydown = (e) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
    if (e.key === 'Escape') return show(null);
    if (!(e.key in moves)) return;
    e.preventDefault();
    show(Math.min(n - 1, Math.max(0, (current ?? n - 1) + moves[e.key])));
  };
}
