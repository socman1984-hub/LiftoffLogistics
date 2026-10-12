'use strict';
// Suppliers: who delivers raw materials to each IN door, and at what price.
// Pick a supplier (budget / standard / express), then negotiate a deal
// yourself, or hire a Purchasing Agent who renews deals for you (but settles
// for less than a sharp negotiator would).

const supplyKey = (d) => d.x + ',' + d.y;
const fmtUnit = (v) => (v < 100 ? '$' + v.toFixed(2) : fmt(v)); // per-package prices need cents

function supplyOf(prop, d) {
  const all = prop.supply || (prop.supply = {});
  return all[supplyKey(d)] || (all[supplyKey(d)] = { tier: 'standard' });
}

const dockMain = (d) => Object.keys(d.cargo).sort((a, b) => d.cargo[b] - d.cargo[a])[0];
const supplierName = (d, tier) => (SUPPLIER_NAMES[dockMain(d)] || SUPPLIER_NAMES.default)[SUPPLIER_TIER_IDS.indexOf(tier)];
const activeDeal = (s) => (s.deal && s.deal.until > state.clock ? s.deal : null);

// Price multiplier and delivery speed for one dock.
function dockPriceMult(prop, d) {
  const s = supplyOf(prop, d);
  const deal = activeDeal(s);
  return SUPPLIER_TIERS[s.tier].price * (deal ? deal.mult : 1);
}
function dockCost(id, d, product) { return supplierCost(product) * dockPriceMult(state.props[id], d); }
function dockInterval(id, prop, d) { return truckInterval(id, prop) / SUPPLIER_TIERS[supplyOf(prop, d).tier].speed; }

function signDeal(site, d, mult, minutes, by) {
  const s = supplyOf(state.props[site], d);
  s.deal = { mult: Math.round(mult * 100) / 100, until: state.clock + minutes * 60, by, minutes };
  s.cool = 0;
}

// Once a second: expire deals; a Purchasing Agent renews them.
function stepSuppliers() {
  for (const def of PROPERTIES) {
    const prop = state.props[def.id];
    if (!prop.owned) continue;
    const agent = (prop.staff.buyer || 0) > 0;
    for (const d of def.inDocks) {
      if (d.receive || prop.tiles[d.y][d.x].locked) continue;
      const s = supplyOf(prop, d);
      if (s.deal && s.deal.until <= state.clock) {
        s.deal = null;
        if (!agent) toast(`🤝 Your ${PRODUCTS[dockMain(d)].name} deal at the ${def.name} ended: back to list price`);
      }
      if (agent && !activeDeal(s) && !(s.cool > state.clock) && !(ui.neg && ui.neg.site === def.id && ui.neg.key === supplyKey(d))) {
        const t = SUPPLIER_TIERS[s.tier];
        const floor = t.floor[0] + Math.random() * (t.floor[1] - t.floor[0]) - repBonus();
        const mult = floor + (1 - floor) * AGENT_SHARE;
        signDeal(def.id, d, mult, AGENT_TERM, 'agent');
        toast(`🧾 Agent signed ${supplierName(d, s.tier)}: ${PRODUCTS[dockMain(d)].icon} at ${Math.round(mult * 100)}% for ${AGENT_TERM} min`);
      }
    }
  }
}
const repBonus = () => (state.rep >= 100 ? 0.04 : state.rep >= 30 ? 0.02 : 0); // a known name gets better prices

// ---------- Negotiation ----------
function startNegotiation(site, d) {
  const prop = state.props[site];
  const s = supplyOf(prop, d);
  const t = SUPPLIER_TIERS[s.tier];
  ui.neg = {
    site, key: supplyKey(d), tier: s.tier,
    base: t.floor[0] + Math.random() * (t.floor[1] - t.floor[0]) - repBonus(), // hidden walk-away price before term
    ask: 1, patience: t.patience + (state.rep >= 50 ? 1 : 0), term: 1, offer: null,
    maxP: t.patience + (state.rep >= 50 ? 1 : 0),
    mood: '🙂', line: 'What are you offering?', done: null,
  };
  openPanel('negotiate');
}

const negFloor = (n) => Math.max(0.5, n.base - DEAL_TERMS[n.term].bonus);

function negOffer(o) {
  const n = ui.neg;
  if (!n || n.done) return;
  const floor = negFloor(n);
  const d = negDock(n);
  if (o >= floor || o >= n.ask) {
    n.done = 'deal';
    n.mood = '🤝';
    n.line = 'Deal. Pleasure doing business.';
    signDeal(n.site, d, Math.min(o, n.ask), DEAL_TERMS[n.term].min, 'you');
    return;
  }
  const gap = floor - o;
  n.patience -= gap > 0.12 ? 2 : 1;
  if (n.patience <= 0) {
    n.done = 'walk';
    n.mood = '🚪';
    n.line = 'I\'ve got other customers. Call me back in a few minutes.';
    supplyOf(state.props[n.site], d).cool = state.clock + NEG_COOLDOWN;
    return;
  }
  n.ask = Math.max(floor + 0.01, Math.round((n.ask - (n.ask - floor) * 0.45) * 100) / 100);
  [n.mood, n.line] = gap > 0.12 ? ['😠', 'Are you trying to insult me?']
    : gap > 0.06 ? ['😒', 'That won\'t even cover my fuel.']
      : gap > 0.025 ? ['🤔', 'Hmm. You\'ll have to do better than that.']
        : ['😬', 'You\'re close. Very close.'];
  n.line += ` I could do ${Math.round(n.ask * 100)}%.`;
}

function negDock(n) {
  return PROP_BY_ID[n.site].inDocks.find((q) => supplyKey(q) === n.key);
}

function negotiateHTML() {
  const n = ui.neg;
  if (!n) return '<p class="intro">No negotiation in progress.</p>';
  const d = negDock(n);
  const p = dockMain(d);
  const list = supplierCost(p) * SUPPLIER_TIERS[n.tier].price;
  const price = (m) => fmtUnit(list * m);
  const name = supplierName(d, n.tier);
  let html = `<div class="neg-head"><div class="neg-face">${n.mood}</div><div><b>${name}</b><div class="muted small">${SUPPLIER_TIERS[n.tier].label} supplier · ${PRODUCTS[p].icon} ${PRODUCTS[p].name} list ${price(1)}/pkg</div></div></div>
    <div class="neg-line">“${n.line}”</div>`;
  if (n.done === 'deal') {
    const deal = activeDeal(supplyOf(state.props[n.site], d));
    return html + `<div class="power-box"><div class="power-note">🤝 Signed: <b>${Math.round(deal.mult * 100)}%</b> (${price(deal.mult)}/pkg) for ${deal.minutes} minutes.</div></div>
      <button class="btn" style="width:100%" data-act="negclose">Done</button>`;
  }
  if (n.done === 'walk') {
    return html + `<p class="intro small">No deal. You're still on list price, and you can try again in ${Math.round(NEG_COOLDOWN / 60)} minutes.</p>
      <button class="btn" style="width:100%" data-act="negclose">OK</button>`;
  }
  html += `<div class="neg-row"><span>Their price</span><b>${Math.round(n.ask * 100)}% · ${price(n.ask)}</b></div>
    <div class="neg-row"><span>Patience</span><b>${'●'.repeat(Math.max(0, n.patience))}${'○'.repeat(Math.max(0, n.maxP - n.patience))}</b></div>
    <h3 class="sec">Contract length</h3><div class="choice">${DEAL_TERMS.map((t, i) =>
    `<button class="chip ${n.term === i ? 'on' : ''}" data-act="negterm" data-id="${i}">${t.min} min${t.bonus ? ` <span class="muted">(they'll go lower)</span>` : ''}</button>`).join('')}</div>
    <h3 class="sec">Your offer</h3><div class="choice neg-offers">${OFFER_STEPS.filter((o) => o < n.ask).map((o) =>
    `<button class="chip ${n.offer === o ? 'on' : ''}" data-act="negpick" data-id="${o}">${Math.round(o * 100)}% · ${price(o)}</button>`).join('')}</div>
    <div class="neg-btns"><button class="btn secondary" data-act="negclose">Walk away</button>
    <button class="btn secondary" data-act="negaccept">Take ${Math.round(n.ask * 100)}%</button>
    <button class="btn" data-act="negoffer" ${n.offer == null ? 'disabled' : ''}>Offer${n.offer != null ? ` ${Math.round(n.offer * 100)}%` : ''}</button></div>
    <p class="intro small">Read their mood: lowball too hard and they lose patience twice as fast. Longer contracts get better prices.</p>`;
  return html;
}

// ---------- Supplier panel (tap a supplier IN door) ----------
function supplierHTML() {
  const at = ui.supplyAt;
  if (!at) return '';
  const def = PROP_BY_ID[at.site], prop = state.props[at.site];
  const d = def.inDocks.find((q) => q.x === at.x && q.y === at.y);
  const s = supplyOf(prop, d);
  const p = dockMain(d);
  const deal = activeDeal(s);
  const iv = dockInterval(at.site, prop, d);
  let html = `<p class="intro">${Object.keys(d.cargo).map((q) => `${PRODUCTS[q].icon} ${PRODUCTS[q].name}`).join(' + ')} arrives here from <b>${supplierName(d, s.tier)}</b>: one package every ${iv.toFixed(1)}s at <b>${fmtUnit(dockCost(at.site, d, p))}</b> each.</p>`;
  html += `<div class="power-box ${deal ? '' : 'over'}"><div class="power-head"><span>🤝 ${deal ? `Deal: ${Math.round(deal.mult * 100)}% of list` : 'No deal: paying list price'}</span>
    <b>${deal ? `${Math.ceil((deal.until - state.clock) / 60)} min left` : ''}</b></div>
    <div class="power-note">${deal ? `${deal.by === 'agent' ? '🧾 Signed by your Purchasing Agent.' : '✍️ You negotiated this.'} It ends after ${deal.minutes} minutes of play.` : 'Negotiate a contract to pay less for every package.'}
    ${prop.staff.buyer ? '<br>🧾 Your Purchasing Agent renews deals here automatically.' : '<br>Or hire a 🧾 Purchasing Agent (Manage → Staff) to renew deals for you. You\'ll usually do better yourself.'}</div></div>`;
  html += `<div class="choice"><span class="ctl-lbl">Deliveries</span>
    <button class="chip ${!s.paused ? 'on' : ''}" data-act="suppause" data-id="off">▶ Running</button>
    <button class="chip ${s.paused ? 'on' : ''}" data-act="suppause" data-id="on">⏸ Paused</button></div>
    ${s.paused ? '<p class="intro small">⏸ Paused: no trucks come and you pay nothing. Handy when a line is flooded with more than it can use.</p>' : ''}`;
  const cooling = s.cool > state.clock;
  html += `<button class="btn" style="width:100%;margin:6px 0 10px" data-act="negstart" ${cooling ? 'disabled' : ''}>${cooling ? `📵 They won't talk for ${Math.ceil((s.cool - state.clock) / 60)} min` : deal ? '🤝 Renegotiate' : '🤝 Negotiate a deal'}</button>`;
  html += '<h3 class="sec">Supplier</h3>';
  for (const tid of SUPPLIER_TIER_IDS) {
    const t = SUPPLIER_TIERS[tid];
    const on = s.tier === tid;
    html += card(t.icon, supplierName(d, tid), `${t.label}: ${Math.round(t.price * 100)}% of list price · deliveries ${t.speed > 1 ? `${Math.round((t.speed - 1) * 100)}% faster` : t.speed < 1 ? `${Math.round((1 - t.speed) * 100)}% slower` : 'standard'} · ${t.note}`,
      on && deal ? 'Current deal stays with this supplier' : '', on ? '<button class="btn secondary" disabled>Current</button>' : `<button class="btn" data-act="suptier" data-id="${tid}">Switch</button>`, on ? 'current' : '');
  }
  return html;
}

function handleSupplierAct(act, id) {
  if (act === 'negstart') {
    const at = ui.supplyAt;
    const d = PROP_BY_ID[at.site].inDocks.find((q) => q.x === at.x && q.y === at.y);
    startNegotiation(at.site, d);
    return 'stop';
  }
  if (act === 'suptier') {
    const at = ui.supplyAt;
    const d = PROP_BY_ID[at.site].inDocks.find((q) => q.x === at.x && q.y === at.y);
    const s = supplyOf(state.props[at.site], d);
    if (activeDeal(s) && !confirm('Switching supplier ends your current deal. Switch anyway?')) return true;
    s.tier = id; s.deal = null; s.cool = 0;
    toast(`🚚 Now buying from ${supplierName(d, id)}`);
    save();
    return true;
  }
  if (act === 'suppause') {
    const at = ui.supplyAt;
    const d = PROP_BY_ID[at.site].inDocks.find((q) => q.x === at.x && q.y === at.y);
    const s = supplyOf(state.props[at.site], d);
    if (id === 'on') s.paused = true; else delete s.paused;
    toast(s.paused ? `⏸ ${supplierName(d, s.tier)} deliveries paused` : `▶ ${supplierName(d, s.tier)} deliveries resumed`);
    save();
    return true;
  }
  if (act === 'negterm') { if (ui.neg && !ui.neg.done) ui.neg.term = Number(id); return true; }
  if (act === 'negpick') { if (ui.neg) ui.neg.offer = Number(id); return true; }
  if (act === 'negoffer') { if (ui.neg && ui.neg.offer != null) { negOffer(ui.neg.offer); ui.neg.offer = null; save(); } return true; }
  if (act === 'negaccept') { if (ui.neg) { negOffer(ui.neg.ask); save(); } return true; }
  if (act === 'negclose') {
    const n = ui.neg;
    ui.neg = null;
    if (n) { ui.supplyAt = { site: n.site, x: negDock(n).x, y: negDock(n).y }; openPanel('supplier'); } else closePanel();
    return 'stop';
  }
  return false;
}
