'use strict';
// 💵 Finances: tap the money to see where it comes from and where it goes.

const FIN_WINDOWS = [['min', 'Last minute', 60], ['ten', 'Last 10 min', 600], ['all', 'This session', null]];

function financeHTML() {
  if (!ui.finWin) ui.finWin = 'min';
  const win = FIN_WINDOWS.find((w) => w[0] === ui.finWin);
  const totals = ledgerTotals(win[2]);
  const rows = Object.entries(totals).filter(([, v]) => Math.abs(v) >= 0.5);
  const income = rows.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const costs = rows.filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]);
  const sum = (list) => list.reduce((n, [, v]) => n + v, 0);
  const inSum = sum(income), outSum = sum(costs);
  const line = ([k, v]) => `<div class="stat-row"><span>${LEDGER_CATS[k].icon} ${LEDGER_CATS[k].label}</span><b class="${v > 0 ? 'pos' : 'neg'}">${v > 0 ? '+' : '−'}${fmt(Math.abs(v)).replace('$', '$')}</b></div>`;

  let html = `<div class="tabs">${FIN_WINDOWS.map(([id, name]) =>
    `<button class="tab ${ui.finWin === id ? 'on' : ''}" data-act="finwin" data-id="${id}">${name}</button>`).join('')}</div>`;
  html += `<div class="fin-net ${inSum + outSum < 0 ? 'neg' : 'pos'}">${inSum + outSum < 0 ? '−' : '+'}${fmt(Math.abs(inSum + outSum))}
    <span class="muted">net ${win[1].toLowerCase()}</span></div>`;
  html += `<div class="stats"><h3>Money in · +${fmt(inSum)}</h3>${income.length ? income.map(line).join('') : '<div class="stat-row"><span class="muted">Nothing yet</span></div>'}`;
  html += `<h3>Money out · −${fmt(Math.abs(outSum))}</h3>${costs.length ? costs.map(line).join('') : '<div class="stat-row"><span class="muted">Nothing yet</span></div>'}`;

  // Per-site running rates.
  const sites = PROPERTIES.filter((d) => state.props[d.id].owned);
  if (sites.length) {
    html += '<h3>By site (per minute, right now)</h3>';
    for (const d of sites) {
      const rev = propRate(d.id), raw = propCost(d.id), wages = runtime[d.id] && runtime[d.id].unpaid ? 0 : wagesPerMin(d.id);
      const net = rev - raw - wages;
      html += `<div class="fin-site"><div class="fin-site-name">${d.emoji} ${d.name}<b class="${net < 0 ? 'neg' : 'pos'}">${net < 0 ? '−' : '+'}${fmt(Math.abs(net))}/min</b></div>
        <div class="muted">💰 ${fmt(rev)} sales · 🔩 −${fmt(raw)} raw · 👷 −${fmt(wages)} wages</div></div>`;
    }
  }

  // One-off charges and credits.
  html += '<h3>Recent one-off transactions</h3>';
  if (!ledger.recent.length) html += '<div class="stat-row"><span class="muted">None yet. Building, repairs, refunds and contracts show up here.</span></div>';
  // Merge back-to-back identical entries (e.g. a 12-tile conveyor line).
  const grouped = [];
  for (const e of ledger.recent) {
    const g = grouped[grouped.length - 1];
    if (g && g.cat === e.cat && g.note === e.note && g.site === e.site && Math.abs(g.t - e.t) < 15) { g.amt += e.amt; g.n++; }
    else grouped.push({ ...e, n: 1 });
  }
  for (const e of grouped.slice(0, 12)) {
    const ago = Math.max(0, Math.round(state.clock - e.t));
    const when = ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`;
    const site = e.site && e.site !== state.current ? ` · ${siteName(e.site)}` : '';
    html += `<div class="stat-row"><span>${LEDGER_CATS[e.cat].icon} ${e.note || LEDGER_CATS[e.cat].label}${e.n > 1 ? ` ×${e.n}` : ''}<span class="muted"> · ${when}${site}</span></span>
      <b class="${e.amt > 0 ? 'pos' : 'neg'}">${e.amt > 0 ? '+' : '−'}${fmt(Math.abs(e.amt))}</b></div>`;
  }
  html += '</div><p class="intro small">Wages and raw materials are charged continuously; supplier trucks charge for each package they drop off.</p>';
  return html;
}
