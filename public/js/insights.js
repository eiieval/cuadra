// Insights: what the agent's widget proposals and the board look like. widgets.js decides every figure; this file only
// draws them: the HTML of an Insight card and of a board card, the AG Charts options (built from the :root tokens) and
// a small hub that keeps one live chart per card. Without the charts library every card keeps a plain table of the
// same figures. The HTML builders and chartOptions() are pure and run under Node for the tests.
import { esc } from './fmt.js';
import { countText, subtitle, widgetTableHtml } from './widgets.js';

// ---------- colours: the palette comes from the :root tokens, never from literals ----------

export function readTokens(root = document.documentElement) {
  const css = getComputedStyle(root);
  const get = (name) => css.getPropertyValue(name).trim();
  return { ink: get('--ink'), surface: get('--surface'), text: get('--text'), soft: get('--soft'), ok: get('--ok'), warn: get('--warn'), bad: get('--bad'), link: get('--link') };
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// a mixed with b: weight 0 is a, 1 is b. Hex in, hex out.
export function mix(a, b, weight) {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round(v * (1 - weight) + y[i] * weight).toString(16).padStart(2, '0')).join('')}`;
}

// Categories (clients, VAT rates) get eight distinguishable colours that are not the status colours alone: a green or
// rose slice must not read as "paid" or "late". Severity (ageing, status) uses ok, warn and bad on purpose.
export function palette(t) {
  return [t.link, t.ok, t.warn, mix(t.link, t.bad, 0.5), mix(t.ok, t.link, 0.5), mix(t.warn, t.bad, 0.5), mix(t.link, t.text, 0.6), t.soft];
}
const SERIES_COLOR = (t) => ({ invoiced: t.link, collected: t.ok, outstanding: t.warn, vat: mix(t.link, t.ok, 0.5), count: t.link });
const SEVERITY = (t) => ({ '0-30': t.ok, '31-60': t.warn, '61+': t.bad, paid: t.ok, open: t.warn, overdue: t.bad });

// ---------- the figures of a widget ----------

const show = (v, unit, fmt) => (unit === 'eur' ? fmt(v) : String(v));

// [{ label, text }]: one per series, from the engine's totals.
export const figures = (data, fmt) => data.series.map((s) => ({ label: s.label, text: show(data.total[s.key], s.unit, fmt) }));

// ---------- AG Charts options ----------

const compact = (v) => {
  const n = Number(v);
  if (!n) return '0';
  return Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(Math.abs(n) % 1000 === 0 ? 0 : 1).replace(/\.0$/, '')}k` : String(n);
};

// tokens: readTokens(). fmt: the currency formatter (eur). Returns the options without the container.
export function chartOptions(data, t, fmt) {
  const colors = palette(t);
  const theme = {
    baseTheme: 'ag-default-dark',
    palette: { fills: colors, strokes: colors },
    params: {
      fontFamily: 'Inter, system-ui, "Segoe UI", sans-serif', fontSize: 11,
      foregroundColor: t.text, textColor: t.text, subtleTextColor: t.soft, accentColor: t.link,
      backgroundColor: 'transparent', chartBackgroundColor: 'transparent', chartPadding: 6,
      gridLineColor: 'rgba(255, 255, 255, .07)',
    },
  };
  // The Community charts do not animate (animation is an Enterprise feature): asking for it only logs a warning, so it is switched off.
  const base = { theme, animation: { enabled: false }, legend: { enabled: false } };
  const primary = data.series[0];
  const tip = (unit) => ({ renderer: ({ datum, yKey, yName }) => ({ title: String(datum.label), data: [{ label: yName, value: show(datum[yKey], unit, fmt) }] }) });
  const rows = data.rows.map((r) => ({ ...r }));

  if (data.type === 'donut') {
    const slices = rows.filter((r) => r[primary.key] > 0).map((r) => ({ label: r.label, value: r[primary.key] }));
    return {
      ...base, data: slices,
      series: [{
        type: 'donut', angleKey: 'value', calloutLabelKey: 'label', legendItemKey: 'label', innerRadiusRatio: 0.64,
        calloutLabel: { enabled: false }, sectorLabel: { enabled: false }, strokeWidth: 2, strokes: [t.surface], fills: colors,
        innerLabels: [{ text: show(data.value, primary.unit, fmt), fontSize: 17, fontWeight: 600, color: t.text }, { text: primary.label.toLowerCase(), fontSize: 11, color: t.soft, spacing: 4 }],
        tooltip: { renderer: ({ datum }) => ({ title: String(datum.label), data: [{ label: primary.label, value: show(datum.value, primary.unit, fmt) }] }) },
      }],
    };
  }

  const axes = { x: { type: 'category', line: { enabled: false } }, y: { type: 'number', line: { enabled: false }, label: { formatter: ({ value }) => (primary.unit === 'eur' ? compact(value) : String(Math.round(value))) } } };
  const own = SERIES_COLOR(t);
  const severity = SEVERITY(t);
  const bySeverity = data.spec.groupBy === 'aging' || data.spec.groupBy === 'status';
  if (data.type === 'line') {
    return {
      ...base, data: rows, axes,
      legend: { enabled: data.series.length > 1, position: 'bottom' },
      series: data.series.map((s) => ({ type: 'line', xKey: 'label', yKey: s.key, yName: s.label, stroke: own[s.key], strokeWidth: 2, marker: { fill: own[s.key], stroke: own[s.key], size: 6 }, tooltip: tip(s.unit) })),
    };
  }
  return {
    ...base, data: rows, axes,
    legend: { enabled: data.series.length > 1, position: 'bottom' },
    series: data.series.map((s) => ({
      type: 'bar', xKey: 'label', yKey: s.key, yName: s.label, grouped: true, cornerRadius: 3, fill: own[s.key], tooltip: tip(s.unit),
      ...(bySeverity && data.series.length === 1 ? { itemStyler: ({ datum }) => ({ fill: severity[datum.key] || own[s.key] }) } : {}),
    })),
  };
}

// What a screen reader gets for a chart: its title and every figure in it (the canvas itself says nothing).
export function chartLabel(data, fmt) {
  const kind = { bar: 'Bar chart', donut: 'Donut chart', line: 'Line chart' }[data.type] || 'Chart';
  const rows = data.rows.map((r) => `${r.label}: ${data.series.map((s) => `${data.series.length > 1 ? `${s.label} ` : ''}${show(r[s.key], s.unit, fmt)}`).join(', ')}`);
  return `${kind}: ${data.title}. ${rows.join('; ')}.`;
}

// The legend of a donut, drawn by the card so it can show the amounts: [{ label, text, share, color }].
export function legendRows(data, t, fmt) {
  const colors = palette(t);
  const primary = data.series[0];
  const slices = data.rows.filter((r) => r[primary.key] > 0);
  const sum = slices.reduce((s, r) => s + r[primary.key], 0) || 1;
  return slices.map((r, i) => ({ label: r.label, text: show(r[primary.key], primary.unit, fmt), share: Math.round((r[primary.key] / sum) * 100), color: colors[i % colors.length] }));
}

export const legendHtml = (rows) => `<ul class="insight-legend">${rows.map((r) => `<li><span class="legend-dot" style="background:${esc(r.color)}"></span><span class="legend-name">${esc(r.label)}</span><span class="legend-val num">${esc(r.text)}</span><span class="legend-share">${r.share}%</span></li>`).join('')}</ul>`;

// ---------- the body of a widget, shared by the Insight card and the board ----------

// chartKey: where the chart goes (a placeholder the hub fills). A card with nothing to show says so.
export function widgetBodyHtml(data, { chartKey, tokens, fmt }) {
  const figs = figures(data, fmt);
  const head = `<div class="insight-figures">${figs.map((f) => `<div class="insight-figure"><span class="insight-fig-label">${esc(f.label)}</span><span class="insight-fig-value num">${esc(f.text)}</span></div>`).join('')}</div><div class="insight-sub">${esc(subtitle(data))}</div>`;
  if (data.empty) return `${head}<p class="insight-empty">Nothing to show for this period yet.</p>`;
  if (data.type === 'number') return head;
  if (data.type === 'table') return `${head}<div class="insight-tablewrap">${widgetTableHtml(data)}</div>`;
  const legend = data.type === 'donut' ? legendHtml(legendRows(data, tokens, fmt)) : '';
  return `${head}<div class="insight-chart" data-chart="${esc(chartKey)}">${widgetTableHtml(data)}</div>${legend}`;
}

// ---------- the hub: one live chart per card ----------

// ag: window.agCharts. A chart is kept while its data is unchanged, so a re-render of the chat or the board does not
// redraw it; it is destroyed when its card goes away. Any failure leaves the table that is already in the card.
export function createChartHub(ag, { tokens, fmt }) {
  const live = new Map(); // key -> { sig, host, chart }
  const drop = (key) => {
    const entry = live.get(key);
    if (!entry) return;
    try { entry.chart.destroy(); } catch { /* already gone */ }
    entry.host.remove();
    live.delete(key);
  };
  return {
    get size() { return live.size; },
    // placeholder: the .insight-chart element (it holds the fallback table until the chart is there).
    mount(placeholder, key, data) {
      const sig = JSON.stringify([data.type, data.rows, data.series.map((s) => s.key)]);
      let entry = live.get(key);
      if (entry && entry.sig !== sig) { drop(key); entry = null; }
      if (entry) { placeholder.replaceChildren(entry.host); placeholder.classList?.add('has-chart'); return true; }
      const host = document.createElement('div');
      host.className = 'chart-host';
      host.setAttribute?.('role', 'img');
      host.setAttribute?.('aria-label', chartLabel(data, fmt));
      const fallback = [...placeholder.childNodes];
      placeholder.replaceChildren(host);
      try {
        const chart = ag.AgCharts.create({ ...chartOptions(data, tokens, fmt), container: host });
        live.set(key, { sig, host, chart });
        placeholder.classList?.add('has-chart');
        return true;
      } catch {
        placeholder.replaceChildren(...fallback);
        return false;
      }
    },
    // Destroys the charts whose key starts with `prefix` and is not in `keep`.
    prune(prefix, keep) { for (const key of [...live.keys()]) if (key.startsWith(prefix) && !keep.has(key)) drop(key); },
    destroyAll() { for (const key of [...live.keys()]) drop(key); },
  };
}

// ---------- cards ----------

// The Insight proposal in the chat. state: { pinned, boardFull, busy, done, ok, skipped, id }.
export function insightCardHtml(data, { id, busy = false, pinned = false, boardFull = false, done = '', ok = true, skipped = false, tokens, fmt }) {
  const body = widgetBodyHtml(data, { chartKey: `chat:${id}`, tokens, fmt });
  const note = '<p class="insight-note">Computed in your browser from the ledger, not by the AI.</p>';
  let foot;
  if (done) {
    foot = `<div class="proposal-result${ok === false ? ' is-fail' : skipped ? ' is-skipped' : ''}"><span>${esc(done)}</span>${pinned ? '<button type="button" class="btn-ghost !min-h-8" data-board="show">Show board</button>' : ''}</div>`;
  } else {
    foot = `<div class="proposal-actions"><button class="btn-primary" data-act="pin" data-id="${esc(id)}"${busy || boardFull ? ' disabled' : ''}>${busy ? 'Working…' : 'Pin to board'}</button><button class="btn-ghost" data-act="discard" data-id="${esc(id)}"${busy ? ' disabled' : ''}>Dismiss</button></div>${boardFull ? '<p class="insight-note insight-warn">The board holds 6 insights. Remove one to pin this.</p>' : ''}`;
  }
  return `<article class="insight${done ? ' is-done' : ''}" aria-label="Insight proposal: ${esc(data.title)}">
    <header class="insight-head"><span class="insight-kind">Insight</span><h3 class="insight-title">${esc(data.title)}</h3></header>
    ${body}${note}${foot}
  </article>`;
}

// A pinned widget on the board.
export function boardCardHtml(w, data, { isNew = false, tokens, fmt }) {
  const body = widgetBodyHtml(data, { chartKey: `board:${w.id}`, tokens, fmt });
  return `<article class="board-card${isNew ? ' is-new' : ''}" data-w="${esc(w.id)}" aria-label="${esc(data.title)}">
    <header class="board-card-head">
      <h3 class="board-title">${esc(data.title)}</h3>
      <div class="board-tools">
        <button type="button" class="mini-btn" data-w-csv="${esc(w.id)}" aria-label="Export CSV: ${esc(data.title)}" title="Export CSV">CSV</button>
        <button type="button" class="mini-btn" data-w-remove="${esc(w.id)}" aria-label="Remove from the board: ${esc(data.title)}" title="Remove from the board">✕</button>
      </div>
    </header>
    ${body}
  </article>`;
}
