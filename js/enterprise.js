'use strict';
// Enterprise layer: the map of your sites, logistics (distribution plans per
// product + the truck fleet), the launch site, and the assembler recipe panel.

const SITE_IDS = [...PROPERTIES.map((p) => p.id), 'launch'];

function siteOwned(id) {
  return id === 'launch' ? state.launch.owned : state.props[id].owned;
}

// Products that leave this site's SHIP doors and so need a distribution plan.
function relevantProducts(id) {
  const def = PROP_BY_ID[id], prop = state.props[id];
  const set = new Set();
  for (const d of def.inDocks) {
    if (d.cargo && !prop.tiles[d.y][d.x].locked) for (const k of Object.keys(d.cargo)) set.add(k);
  }
  for (const row of prop.tiles) for (const t of row) if (t.obj && t.obj.k === 'assembler' && t.obj.recipe) set.add(t.obj.recipe);
  for (const p of Object.keys(prop.inbox)) set.add(p);
  for (const p of Object.keys(prop.plans)) set.add(p);
  return PRODUCT_IDS.filter((p) => set.has(p));
}

// Sites this product could be trucked to from `from`.
function routeTargets(from, product) {
  const out = PROPERTIES.filter((d) => d.id !== from && state.props[d.id].owned && hasReceiveDock(d)).map((d) => d.id);
  if (state.launch.owned && (marsOn() ? marsAccepts(product) : LAUNCH.needs[product])) out.push('launch');
  return out;
}

function truckCost() {
  return Math.round(TRUCK_BASE_COST * Math.pow(TRUCK_COST_GROWTH, state.garage.trucks));
}

const destLabel = (to) => (to === 'sell' ? '💰 Sell' : to === 'store' ? '🗄️ Store here' : `🚚 ${siteEmoji(to)} ${siteName(to)}`);

function planSummary(id, p) {
  const plan = planOf(state.props[id], p);
  const live = plan.dests.filter((d) => d.w > 0);
  const total = live.reduce((n, d) => n + d.w, 0) || 1;
  return live.map((d) => `${Math.round((d.w / total) * 100)}% ${d.to === 'sell' ? 'sell' : d.to === 'store' ? 'store' : siteName(d.to)}${d.cap ? ` (≤${d.cap})` : ''}`).join(' · ')
    + (plan.overflow === 'hold' ? ' · hold when full' : '');
}

function routeStats(key) {
  const [from, to] = key.split('>');
  const f = state.fleet[key];
  const trip = travelTime(from, to);
  const wait = routeWait(f);
  const perMin = Math.round((f.trucks * truckCap() * 60) / (trip * 2 + (wait == null ? 15 : wait)));
  const waiting = Object.values(state.props[from].outbox[to] || {}).reduce((a, b) => a + b, 0);
  const moving = f.units.filter((u) => u.phase === 'go' || u.phase === 'back').length;
  const unloading = f.units.filter((u) => u.phase === 'unload').length;
  return { from, to, f, trip, perMin, waiting, moving, unloading };
}

const countList = (obj) => Object.entries(obj || {}).filter(([, n]) => n > 0)
  .map(([p, n]) => `${PRODUCTS[p].icon} ${n}`).join(' · ');

// 🏆 The road to victory, shown on the map.
function victoryTrackerHTML() {
  const pop = state.mars ? state.mars.colonists : 0;
  const stage = state.mars && state.mars.terra ? state.mars.terra.stage : 0;
  const steps = [
    ['🚀', 'First rocket', state.launch.count >= 1],
    ['🏠', 'Colony founded', pop > 0 || stage > 0],
    ['👩‍🚀', '25 colonists', pop >= 25 || stage >= 1],
    ...TERRAFORM.map((st, i) => [st.icon, st.name, stage > i]),
  ];
  const next = steps.findIndex(([, , ok]) => !ok);
  return `<div class="victory-track"><div class="vt-head"><span>🏆 Road to victory${state.legacy ? ` · 🔁 Game ${state.legacy + 1}` : ''}</span>
    ${state.won ? '<button class="link-btn" data-act="showvictory">You won! See stats</button>' : `<span class="muted small">${next < 0 ? '' : `Next: ${steps[next][1]}`}</span>`}</div>
    <div class="vt-steps">${steps.map(([ic, name, ok], i) => `<span class="vt-step ${ok ? 'done' : i === next ? 'next' : ''}" title="${name}">${ic}</span>`).join('<i></i>')}</div></div>`;
}

// ---------------- Map panel ----------------
function mapHTML() {
  if (!ui.mapSel) ui.mapSel = state.current || 'shed';
  let html = '';
  if (!state.current) {
    html += `<h2 class="game-title">🚀 Liftoff Logistics</h2>`;
    html += `<p class="intro">You've got <b>${fmt(state.money)}</b> and a dream: <b>build a rocket 🚀</b>, found a colony on Mars, and bring it to life 🌍.
      Start with a cheap warehouse, turn raw materials into parts, and grow a supply chain across the region.</p>
      ${state.legacy ? `<p class="intro small">🔁 New Game+ (game ${state.legacy + 1}): every package is worth +${Math.round(state.legacy * LEGACY_BONUS * 100)}%.</p>` : ''}`;
  }
  if (state.current) html += victoryTrackerHTML();
  if (state.current) {
    const idle = idleTrucks();
    html += `<button class="btn log-btn" data-act="openlog" data-id="${ui.mapSel === 'launch' ? state.current : ui.mapSel}">🚚 Logistics: distribution &amp; trucks${idle > 0 ? ` · ${idle} idle truck${idle > 1 ? 's' : ''}` : ''}</button>`;
  }
  html += `<svg class="map" viewBox="0 0 100 70" xmlns="http://www.w3.org/2000/svg">`;
  html += `<rect x="0" y="0" width="100" height="70" rx="3" class="map-bg"/>`;
  // Faint roads between every pair of sites.
  for (let i = 0; i < SITE_IDS.length; i++) {
    for (let j = i + 1; j < SITE_IDS.length; j++) {
      const a = MAP_POS[SITE_IDS[i]], b = MAP_POS[SITE_IDS[j]];
      html += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="road"/>`;
    }
  }
  // Active truck routes.
  for (const key of Object.keys(state.fleet)) {
    const [from, to] = key.split('>');
    const a = MAP_POS[from], b = MAP_POS[to];
    html += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="route"/>`;
    html += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="route-hit" data-act="maproute" data-id="${key}"><title>${siteName(from)} → ${siteName(to)}: tap for trucks</title></line>`;
  }
  html += '<g id="mapTrucks"></g>';
  for (const id of SITE_IDS) {
    const p = MAP_POS[id];
    const owned = siteOwned(id);
    const sel = ui.mapSel === id;
    const price = id === 'launch' ? LAUNCH.price : PROP_BY_ID[id].price;
    html += `<g class="node ${owned ? 'owned' : ''} ${sel ? 'sel' : ''}" data-act="mapsel" data-id="${id}">
      <circle cx="${p.x}" cy="${p.y}" r="6.5"/>
      <text x="${p.x}" y="${p.y + 2.2}" class="node-emoji">${siteEmoji(id)}</text>
      <text x="${p.x > 80 ? p.x + 7 : p.x}" y="${p.y + 10.5}" class="node-label" ${p.x > 80 ? 'style="text-anchor:end"' : ''}>${siteName(id)}</text>
      ${owned ? '' : `<text x="${p.x}" y="${p.y - 8}" class="node-price">${fmt(price)}</text>`}
    </g>`;
  }
  html += '</svg>';
  html += ui.mapSel === 'launch' ? launchDetailHTML() : siteDetailHTML(ui.mapSel);
  return html;
}

function siteDetailHTML(id) {
  const def = PROP_BY_ID[id], prop = state.props[id];
  const raws = rawProductsOf(def).map((p) => PRODUCTS[p].icon).join(' ');
  let html = `<div class="site-head"><div class="emoji">${def.emoji}</div><div class="info">
    <div class="title">${def.name}</div><div class="desc">${def.role} · Raw materials: ${raws}${hasReceiveDock(def) ? ' · 📥 receives trucks' : ''}</div></div>`;
  if (!prop.owned) {
    html += `<button class="btn" data-act="buyprop" data-id="${id}" ${state.money < def.price ? 'disabled' : ''}>Buy ${fmt(def.price)}</button></div>`;
    html += `<p class="intro">${def.desc}</p>`;
    const unl = UNLOCK_LIST(id);
    if (unl.length) html += `<p class="intro small">🆕 Unlocks: ${unl.map((u) => `${u.icon} <b>${u.name}</b>`).join(', ')}</p>`;
    return html;
  }
  html += state.current === id
    ? '<button class="btn secondary" data-act="close">Here</button></div>'
    : `<button class="btn secondary" data-act="goto" data-id="${id}">Go ›</button></div>`;
  html += `<p class="intro">Net <b>${fmt(propNet(id))}/min</b> · Lifetime ${fmt(prop.earned)} · ${prop.sent} trucked out</p>`;
  if (countList(prop.inbox)) html += `<p class="intro">📥 Waiting to unload: ${countList(prop.inbox)}</p>`;
  html += `<p class="intro">🗄️ Racks ${storageUsed(id)} / ${storageCap(id)} · 🚜 ${Math.round(handlingRate(id))} moves/min</p>`;

  html += `<div class="sec-row"><h3 class="sec">Distribution</h3><button class="btn small" data-act="openlog" data-id="${id}">🚚 Logistics ›</button></div>`;
  const products = relevantProducts(id);
  if (!products.length) html += '<p class="intro">Nothing ships from here yet.</p>';
  for (const p of products) {
    html += `<div class="stat-row"><span>${PRODUCTS[p].icon} ${PRODUCTS[p].name}</span><b class="plan-sum">${planSummary(id, p)}</b></div>`;
  }
  const routes = Object.keys(state.fleet).filter((k) => k.startsWith(id + '>'));
  for (const key of routes) {
    const st = routeStats(key);
    if (!st.f.trucks && st.waiting) html += `<p class="warn">⚠️ ${st.waiting} waiting for ${siteName(st.to)} but no trucks are assigned to that route.</p>`;
  }
  return html;
}

// ---------------- Logistics panel ----------------
function logisticsHTML() {
  if (!ui.logTab) ui.logTab = 'dist';
  const owned = PROPERTIES.filter((d) => state.props[d.id].owned);
  if (!owned.length) return '<p class="intro">Buy a warehouse first.</p>';
  if (!ui.logSite || !state.props[ui.logSite].owned) ui.logSite = state.current || owned[0].id;
  const idle = idleTrucks();
  let html = `<div class="tabs">
    <button class="tab ${ui.logTab === 'dist' ? 'on' : ''}" data-act="logtab" data-id="dist">📦 Distribution</button>
    <button class="tab ${ui.logTab === 'fleet' ? 'on' : ''}" data-act="logtab" data-id="fleet">🚚 Fleet${idle > 0 ? ` (${idle} idle)` : ''}</button></div>`;
  return html + (ui.logTab === 'dist' ? distributionHTML(owned) : fleetHTML());
}

function distributionHTML(owned) {
  const id = ui.logSite;
  const prop = state.props[id];
  let html = '<div class="choice site-pick">';
  for (const d of owned) html += `<button class="chip ${d.id === id ? 'on' : ''}" data-act="logsite" data-id="${d.id}">${d.emoji} ${d.name}</button>`;
  html += '</div>';
  html += storageBoxHTML(id);
  html += `<p class="intro small">For each product leaving ${PROP_BY_ID[id].name}'s SHIP doors, choose where it goes.
    <b>Weights</b> split the flow (3 + 1 = 75% / 25%). A <b>cap</b> stops sending once that much is stocked or on the way there. Tap a product to open its plan.</p>`;
  const products = relevantProducts(id);
  if (!products.length) html += '<p class="intro">Nothing ships from here yet. Open a supplier dock or set an assembler recipe.</p>';
  for (const p of products) {
    const plan = planOf(prop, p);
    const total = plan.dests.reduce((n, d) => n + d.w, 0) || 1;
    // Cards start collapsed to a one-line summary; tap the header to expand.
    const key = `${id}|${p}`;
    const open = (ui.planOpen || (ui.planOpen = new Set())).has(key);
    html += `<div class="plan ${open ? 'open' : 'closed'}"><button class="plan-head plan-toggle" data-act="ptoggle" data-id="${key}">
      <span>${PRODUCTS[p].icon} <b>${PRODUCTS[p].name}</b><span class="muted"> · sells ${fmt(marketPrice(p))}</span></span>
      <span class="plan-caret">${open ? '▾' : '▸'}</span></button>`;
    if (!open) {
      html += `<div class="plan-sum-line">${planSummary(id, p)}${prop.held[p] ? ` · 🗄️ ${prop.held[p]} stored` : ''}</div></div>`;
      continue;
    }
    plan.dests.forEach((d, i) => {
      const k = `${id}|${p}|${i}`;
      const valid = destValid(id, d.to, p);
      const stock = d.to === 'sell' ? '' : d.to === 'store' ? ` · ${prop.held[p] || 0} on racks` : ` · ${stockAt(id, d.to, p)} there/en route`;
      const route = d.to !== 'sell' && d.to !== 'store' ? state.fleet[routeKey(id, d.to)] : null;
      const noTrucks = route && !route.trucks;
      html += `<div class="dest ${valid ? '' : 'invalid'}">
        <div class="dest-name">${destLabel(d.to)}<span class="muted">${d.w ? ` · ${Math.round((d.w / total) * 100)}%` : ' · off'}${stock}</span>
          ${noTrucks ? '<span class="neg"> · no trucks!</span>' : ''}${valid ? '' : '<span class="neg"> · unavailable</span>'}</div>
        <div class="dest-ctl">
          <span class="ctl-lbl">Weight</span>
          <button class="step" data-act="pw" data-id="${k}|-1">−</button><b>${d.w}</b><button class="step" data-act="pw" data-id="${k}|1">+</button>
          ${d.to === 'sell' || d.to === 'store' ? '' : `<span class="ctl-lbl">Cap</span>
          <button class="step" data-act="pcap" data-id="${k}|-1">−</button><b>${d.cap || '∞'}</b><button class="step" data-act="pcap" data-id="${k}|1">+</button>`}
          ${plan.dests.length > 1 ? `<button class="step x" data-act="pdel" data-id="${k}">✕</button>` : ''}
        </div></div>`;
    });
    const options = ['sell', 'store', ...routeTargets(id, p)].filter((to) => !plan.dests.some((d) => d.to === to));
    if (options.length) {
      html += `<div class="choice add">${options.map((to) => `<button class="chip small" data-act="padd" data-id="${id}|${p}|${to}">+ ${destLabel(to)}</button>`).join('')}</div>`;
    }
    const sells = plan.dests.some((d) => d.to === 'sell' && d.w > 0);
    html += `<div class="overflow"><span class="ctl-lbl">If every destination above is full (capped or out of rack space):</span>
      <button class="chip small ${plan.overflow !== 'hold' ? 'on' : ''}" data-act="pover" data-id="${id}|${p}|sell">💰 Sell it</button>
      <button class="chip small ${plan.overflow === 'hold' ? 'on' : ''}" data-act="pover" data-id="${id}|${p}|hold">✋ Back up the line</button>
      ${sells ? '<div class="muted">💡 Sell never fills up, so this only matters if you remove 💰 Sell. To keep products, add 🗄️ Store here.</div>' : ''}</div>`;
    if (prop.held[p]) html += `<div class="muted">🗄️ ${prop.held[p]} on the racks. They leave on a truck when a destination above has room.</div>`;
    html += '</div>';
  }
  return html;
}

function storageBoxHTML(id) {
  const def = PROP_BY_ID[id], prop = state.props[id];
  const cap = storageCap(id), used = storageUsed(id);
  const pct = Math.min(100, (used / cap) * 100);
  const outgoing = {};
  for (const box of Object.values(prop.outbox)) for (const [p, n] of Object.entries(box)) outgoing[p] = (outgoing[p] || 0) + n;
  const rate = Math.round(handlingRate(id));
  const used30 = movesUsed(id);
  const busy = Math.min(100, Math.round((used30 / Math.max(1, rate)) * 100));
  const ops = prop.staff.forklift;
  const opDef = STAFF_BY_ID.forklift;
  const fee = Math.round(staffWage(opDef, def, prop) * HIRE_FEE_MINUTES);
  return `<div class="power-box ${used >= cap ? 'over' : ''}">
    <div class="power-head"><span>🗄️ Racks</span><b>${used} / ${cap}</b></div>
    <div class="bar"><div style="width:${pct}%;background:${used >= cap ? '#eb5757' : pct > 75 ? '#f2c94c' : '#6fcf97'}"></div></div>
    <div class="power-note">📥 Incoming: ${countList(prop.inbox) || 'none'}<br>🚚 Outgoing: ${countList(outgoing) || 'none'}<br>🗄️ Stored: ${countList(prop.held) || 'none'}</div>
    ${storedSellHTML(id)}
    <div class="power-note">${layoutOf(id).racks} rack${layoutOf(id).racks === 1 ? '' : 's'} (${layoutOf(id).rackSlots} slots) + ${STORAGE_BASE} dock staging. Build more with the 🗄️ Rack tool, or tap a rack to upgrade it.</div>
    <div class="power-head" style="margin-top:10px"><span>🚜 Handling</span><b>${rate} moves/min</b></div>
    <div class="bar"><div style="width:${busy}%;background:${busy > 90 ? '#eb5757' : busy > 70 ? '#f2c94c' : '#6fcf97'}"></div></div>
    <div class="power-note">Crew is ${busy}% busy. Every put-away, truck load, unload and pick is one move.${busy > 90 ? ' <b class="neg">Bottleneck: hire forklift operators.</b>' : ''}</div>
    <div class="dest-ctl"><span class="ctl-lbl">Forklift operators ${ops}/${opDef.max}</span>
      <button class="btn small" data-act="hire" data-id="forklift" ${ops >= opDef.max || state.money < fee || id !== state.current ? 'disabled' : ''}>${id !== state.current ? 'Hire there' : `+ Hire ${fmt(fee)}`}</button></div>
  </div>`;
}

// Sell stored stock: per product, or all at once (with estimated value).
function storedSellHTML(id) {
  const held = Object.entries(state.props[id].held).filter(([, n]) => n > 0);
  if (!held.length) return '';
  let all = 0;
  let html = '<div class="sell-list"><div class="ctl-lbl">Sell stored stock</div>';
  for (const [p, n] of held) {
    const v = storedSaleValue(id, p, n);
    all += v;
    html += `<div class="sell-row"><span>${PRODUCTS[p].icon} ${n} ${PRODUCTS[p].name}<span class="muted"> · ≈${fmt(v)}</span></span>
      <button class="btn small secondary" data-act="sellpick" data-id="${id}|${p}">💰 Sell…</button></div>`;
  }
  if (held.length > 1) html += `<button class="btn small" style="width:100%;margin-top:6px" data-act="sellstored" data-id="${id}">💰 Sell all (≈${fmt(all)})</button>`;
  return html + '</div>';
}

// Popup for selling some or all of one stored product.
function openSellPop(site, p) {
  closeSellPop();
  const n = state.props[site].held[p] || 0;
  if (!n) return;
  const pop = document.createElement('div');
  pop.id = 'sellPop';
  pop.innerHTML = `<div class="sell-card">
    <h3>${PRODUCTS[p].icon} Sell ${PRODUCTS[p].name}</h3>
    <div class="muted">${n} on the racks</div>
    ${n > 1 ? `<input type="range" id="sellRange" min="1" max="${n}" value="${n}">
    <div class="choice sell-quick">${[0.25, 0.5, 1].map((f) => `<button class="chip" data-f="${f}">${f === 1 ? 'All' : f * 100 + '%'}</button>`).join('')}</div>` : ''}
    <div class="sell-sum" id="sellSum"></div>
    <div class="sell-btns"><button class="btn secondary" id="sellNo">Cancel</button><button class="btn" id="sellYes"></button></div></div>`;
  document.body.appendChild(pop);
  const range = pop.querySelector('#sellRange');
  const qty = () => (range ? Number(range.value) : 1);
  const update = () => {
    const q = qty();
    pop.querySelector('#sellSum').innerHTML = `<b>${q}</b> × ${PRODUCTS[p].name} ≈ <b class="pos">${fmt(storedSaleValue(site, p, q))}</b>`;
    pop.querySelector('#sellYes').textContent = q === n ? '💰 Sell all' : `💰 Sell ${q}`;
    pop.querySelectorAll('[data-f]').forEach((c) => c.classList.toggle('on', Math.max(1, Math.round(n * c.dataset.f)) === q));
  };
  if (range) range.addEventListener('input', update);
  pop.querySelectorAll('[data-f]').forEach((c) => c.addEventListener('click', () => { range.value = Math.max(1, Math.round(n * c.dataset.f)); update(); }));
  pop.querySelector('#sellNo').addEventListener('click', closeSellPop);
  pop.addEventListener('click', (e) => { if (e.target === pop) closeSellPop(); });
  pop.querySelector('#sellYes').addEventListener('click', () => {
    const q = Math.min(qty(), state.props[site].held[p] || 0);
    closeSellPop();
    if (!q) return;
    toast(`💰 Sold ${q} ${PRODUCTS[p].name} for ${fmt(sellStored(site, p, q))}`);
    save();
    renderPanel();
  });
  update();
}

function closeSellPop() {
  const el = document.getElementById('sellPop');
  if (el) el.remove();
}

function fleetHTML() {
  const idle = idleTrucks();
  const cost = truckCost();
  const keys = Object.keys(state.fleet);
  const starving = keys.some((k) => routeStats(k).waiting > 0);
  let html = `<div class="garage"><div><b>🚚 ${state.garage.trucks}</b> trucks owned · <b class="${idle ? 'gold' : ''}">${idle}</b> in the garage
    <div class="muted">Each carries ${truckCap()} · next truck ${fmt(cost)}</div></div>
    <div class="garage-btns">${idle && starving ? '<button class="btn small secondary" data-act="tauto">⚖️ Assign idle</button>' : ''}
    <button class="btn small" data-act="buytruck" ${state.money < cost ? 'disabled' : ''}>Buy ${fmt(cost)}</button></div></div>`;
  if (!keys.length) {
    html += '<p class="intro">No routes yet. In 📦 Distribution, send a product to another site and its route appears here.</p>';
    return html;
  }
  html += '<p class="intro small">Each truck loads at the source, drives over, unloads and comes back. Tap a route to open it.</p>';
  for (const key of keys) html += routeCardHTML(key, idle);
  return html;
}

const fmtSecs = (s) => { s = Math.max(0, Math.ceil(s)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };
const WAIT_TEXT = {
  asap: 'Leaves 3 seconds after the first package goes on.',
  '10s': 'Waits up to 10 seconds for more cargo after the first package.',
  '30s': 'Waits up to 30 seconds for more cargo after the first package.',
  full: 'Only leaves with a full load (slow routes can sit a long time).',
};

// One truck's status: what it's doing, a progress fraction and a tone.
function truckStatus(key, u) {
  const st = routeStats(key);
  const cap = truckCap(), wait = routeWait(st.f), to = siteName(st.to), from = siteName(st.from);
  const cargo = countList(u.load);
  if (u.phase === 'load') {
    if (!u.n) {
      const idleFor = u.idle || 0;
      return { icon: '⏳', text: `At ${from}, waiting for cargo${idleFor > 20 ? ` · idle ${fmtSecs(idleFor)}` : ''}`, k: 0, tone: idleFor > 90 ? 'warn' : '' };
    }
    const left = wait == null ? null : wait - u.t;
    return { icon: '📦', text: `Loading ${u.n}/${cap} · ${left == null ? 'leaves when full' : `leaves in ${fmtSecs(left)}`}`, k: u.n / cap, cargo, tone: 'load' };
  }
  if (u.phase === 'go') return { icon: '🚚', text: `Driving to ${to} · arrives in ${fmtSecs(st.trip - u.t)}`, k: u.t / st.trip, cargo, tone: 'go' };
  if (u.phase === 'unload') {
    return u.t > 4
      ? { icon: '⚠️', text: `Stuck unloading at ${to} for ${fmtSecs(u.t)} · ${u.n} left (racks full or forklifts busy there)`, k: 1, cargo, tone: 'warn' }
      : { icon: '📥', text: `Unloading at ${to} · ${u.n} left`, k: 1, cargo, tone: 'go' };
  }
  return { icon: '↩️', text: `Heading back to ${from} · ${fmtSecs(st.trip - u.t)}`, k: u.t / st.trip, tone: 'back' };
}

function truckListHTML(key) {
  const f = state.fleet[key];
  if (!f.units.length) return f.trucks ? '<div class="muted small">Trucks on their way to the dock…</div>' : '<div class="muted small">No trucks on this route.</div>';
  return f.units.map((u, i) => {
    const s = truckStatus(key, u);
    return `<div class="truck-row ${s.tone}"><span class="tr-n">#${i + 1}</span><span class="tr-ic">${s.icon}</span>
      <div class="tr-body"><div class="tr-text">${s.text}</div>
      <div class="bar tr-bar"><div style="width:${Math.min(100, s.k * 100)}%"></div></div>
      ${s.cargo ? `<div class="tr-cargo">${s.cargo}</div>` : ''}</div></div>`;
  }).join('');
}

// Route status line and advice (no buttons, so it can refresh live).
function routeLiveHTML(key) {
  const st = routeStats(key);
  const f = st.f;
  const stuck = f.units.some((u) => u.phase === 'unload' && u.t > 4);
  const idleLong = f.units.filter((u) => u.phase === 'load' && !u.n && (u.idle || 0) > 90).length;
  let advice, tone = '';
  if (!f.trucks && st.waiting) { advice = `${st.waiting} packages waiting and no trucks. Assign one!`; tone = 'neg'; }
  else if (stuck) { advice = `Trucks can't unload at ${siteName(st.to)}: add racks or forklift operators there.`; tone = 'neg'; }
  else if (st.waiting > truckCap() * Math.max(1, f.trucks)) { advice = `Cargo is piling up (${st.waiting} waiting). Add a truck.`; tone = 'neg'; }
  else if (idleLong && f.trucks > 1) { advice = `${idleLong} truck${idleLong > 1 ? 's have' : ' has'} been idle a while. You could move one to a busier route.`; tone = 'gold'; }
  else if (!st.waiting && !f.units.some((u) => u.n)) advice = 'Nothing to carry right now.';
  else advice = 'Keeping up.';
  return `<div class="route-stats"><span>⏱️ ${fmtSecs(st.trip)} each way</span><span>📈 up to ~${st.perMin}/min</span><span>📦 ${st.waiting} waiting at ${siteName(st.from)}</span></div>
    ${st.waiting ? `<div class="muted small">Waiting: ${countList(state.props[st.from].outbox[st.to])}</div>` : ''}
    <div class="route-advice ${tone}">${advice}</div>`;
}

// Compact status chips for a collapsed route.
function routeChipsHTML(key) {
  const st = routeStats(key);
  const icons = st.f.units.map((u) => truckStatus(key, u).icon).join('');
  return `<span class="rc-chip">🚚 ${st.f.trucks}</span>${st.waiting ? `<span class="rc-chip ${!st.f.trucks ? 'neg' : ''}">📦 ${st.waiting}</span>` : ''}<span class="rc-icons">${icons}</span>`;
}

// One route's card: live trucks, what's waiting, and the controls.
function routeCardHTML(key, idle) {
  const st = routeStats(key);
  const f = st.f;
  const keys = Object.keys(state.fleet);
  const open = ui.routeOpen && key in ui.routeOpen ? ui.routeOpen[key] : keys.length <= 3 || (!f.trucks && st.waiting > 0);
  const alert = (!f.trucks && st.waiting) || f.units.some((u) => u.phase === 'unload' && u.t > 4);
  let html = `<div class="plan route-card ${alert ? 'alert' : ''}">
    <button class="route-head" data-act="rtoggle" data-id="${key}">
      <span class="rh-name">${siteEmoji(st.from)} ${siteName(st.from)} → ${siteEmoji(st.to)} <b>${siteName(st.to)}</b></span>
      <span class="rh-chips" data-route-chips="${key}">${routeChipsHTML(key)}</span><span class="rh-caret">${open ? '▾' : '▸'}</span></button>`;
  if (!open) return html + '</div>';
  const canSend = f.units.some((u) => u.phase === 'load' && u.n > 0);
  html += `<div data-route-live="${key}">${routeLiveHTML(key)}</div>
    <div class="truck-list" data-truck-list="${key}">${truckListHTML(key)}</div>
    <div class="dest-ctl route-ctl">
      <span class="ctl-lbl">Trucks</span>
      <button class="step" data-act="tassign" data-id="${key}|-1" ${f.trucks ? '' : 'disabled'}>−</button><b>${f.trucks}</b>
      <button class="step" data-act="tassign" data-id="${key}|1" ${idle > 0 ? '' : 'disabled'}>+</button>
      <span class="muted small">${idle ? `${idle} in garage` : 'garage empty'}</span>
      <button class="btn small secondary send-now" data-act="tsend" data-id="${key}" ${canSend ? '' : 'disabled'}>🚀 Send now</button>
    </div>
    <div class="choice"><span class="ctl-lbl">Leave</span>${TRUCK_WAITS.map((w) =>
    `<button class="chip small ${f.wait === w.id ? 'on' : ''}" data-act="twait" data-id="${key}|${w.id}">${w.label}</button>`).join('')}</div>
    <div class="muted small">${WAIT_TEXT[f.wait] || WAIT_TEXT['10s']}</div>
    <div class="route-links"><button class="link-btn" data-act="openlog" data-id="${st.from}">📦 Edit what ${siteName(st.from)} sends</button>
      ${!f.trucks && !st.waiting && !f.units.length ? `<button class="link-btn neg" data-act="rdel" data-id="${key}">✕ Remove route</button>` : ''}</div>
  </div>`;
  return html;
}

// Truck rows and route status refresh every tick without rebuilding any buttons.
function updateFleetDynamic() {
  document.querySelectorAll('[data-truck-list]').forEach((el) => { const k = el.dataset.truckList; if (state.fleet[k]) el.innerHTML = truckListHTML(k); });
  document.querySelectorAll('[data-route-live]').forEach((el) => { const k = el.dataset.routeLive; if (state.fleet[k]) el.innerHTML = routeLiveHTML(k); });
  document.querySelectorAll('[data-route-chips]').forEach((el) => { const k = el.dataset.routeChips; if (state.fleet[k]) el.innerHTML = routeChipsHTML(k); });
}

// Tapping a RECV door: what's arriving here, and the truck routes that bring it.
function recvDockHTML() {
  const id = state.current;
  const prop = state.props[id];
  const idle = idleTrucks();
  const waiting = Object.values(prop.inbox).reduce((a, b) => a + b, 0);
  let html = `<p class="intro">Trucks from your other sites unload here. Products arrive when another site's distribution plan sends them to <b>${siteName(id)}</b> and its route has trucks.</p>`;
  html += `<div class="power-box"><div class="power-head"><span>📥 Unloaded, waiting to go on the line</span><b>${waiting}</b></div>
    <div class="power-note">${countList(prop.inbox) || 'Nothing yet'}</div></div>`;
  // What the assemblers here use, so the player knows what to send.
  const needs = new Set();
  for (const row of prop.tiles) for (const t of row) {
    if (t.obj && t.obj.k === 'assembler' && t.obj.recipe) for (const p of Object.keys(RECIPES[t.obj.recipe].in || {})) needs.add(p);
  }
  if (needs.size) html += `<p class="intro small">Assemblers here use: ${[...needs].map((p) => `${PRODUCTS[p].icon} ${PRODUCTS[p].name}`).join(', ')}</p>`;

  html += `<div class="garage"><div><b>🚚 ${state.garage.trucks}</b> trucks · <b class="${idle ? 'gold' : ''}">${idle}</b> idle</div>
    <button class="btn small" data-act="buytruck" ${state.money < truckCost() ? 'disabled' : ''}>Buy ${fmt(truckCost())}</button></div>`;
  const inbound = Object.keys(state.fleet).filter((k) => k.split('>')[1] === id);
  html += '<h3 class="sec">Routes into this site</h3>';
  if (inbound.length) for (const key of inbound) html += routeCardHTML(key, idle);
  else html += '<p class="intro small">No trucks come here yet.</p>';
  // Other sites: jump to their plan to send products here.
  const others = PROPERTIES.filter((d) => d.id !== id && state.props[d.id].owned);
  html += '<h3 class="sec">Send products here</h3>';
  if (!others.length) html += '<p class="intro small">Buy another site on the 🗺️ Map; its products can then be trucked here.</p>';
  else {
    html += '<p class="intro small">Open a site&#39;s plan and add this site as a destination for a product. Its route then shows up above, ready for trucks.</p>';
    for (const d of others) {
      html += `<div class="sell-row"><span>${siteEmoji(d.id)} ${d.name}</span>
        <button class="btn small secondary" data-act="openlog" data-id="${d.id}">📦 Its plan ›</button></div>`;
    }
  }
  return html;
}

function launchDetailHTML() {
  let html = `<div class="site-head"><div class="emoji">🚀</div><div class="info">
    <div class="title">${LAUNCH.name}${state.launch.count ? ` · ${state.launch.count} launched` : ''}</div>
    <div class="desc">${LAUNCH.desc}</div></div>`;
  if (!state.launch.owned) {
    html += `<button class="btn" data-act="buylaunch" ${state.money < LAUNCH.price ? 'disabled' : ''}>Buy ${fmt(LAUNCH.price)}</button></div>`;
  } else html += '</div>';
  if (state.launch.owned && marsOn()) return html + marsControlHTML();
  html += '<h3 class="sec">Your first rocket: 3 stages</h3>';
  for (const st of launchStageProgress()) {
    const rows = Object.entries(st.needs).map(([p, n]) => {
      const have = st.have[p];
      const lock = RECIPES[p].research && !hasResearch(RECIPES[p].research) ? ' 🔒' : '';
      return `<div class="stage-part"><span>${PRODUCTS[p].icon} ${PRODUCTS[p].name}${lock}</span>
        <span class="count">${have}/${n}</span><div class="bar"><div style="width:${Math.min(100, (have / n) * 100)}%"></div></div></div>`;
    }).join('');
    html += `<div class="card stage ${st.done ? 'done-stage' : ''}"><div class="emoji">${st.icon}</div><div class="info">
      <div class="title">${st.name}${st.done ? ' ✅' : ''}</div>${rows}</div></div>`;
  }
  if (state.launch.owned) {
    html += launchReady() && !(state.launch.count >= 1 && state.launch.auto)
      ? '<button class="btn launch" data-act="launch">🚀 LAUNCH!</button>'
      : '<p class="intro">Truck parts here: in 🚚 Logistics → Distribution, add 🚀 Launch Site as a destination, then assign trucks to the route.</p>';
    if (state.launch.count >= 1) {
      html += `<div class="choice"><span class="ctl-lbl">Launch</span>
        <button class="chip ${state.launch.auto ? 'on' : ''}" data-act="autolaunch" data-id="on">🔁 Automatically when ready</button>
        <button class="chip ${!state.launch.auto ? 'on' : ''}" data-act="autolaunch" data-id="off">👆 When I press Launch</button></div>`;
    }
  }
  return html;
}

// Moving trucks are drawn separately so re-rendering the panel doesn't
// rebuild buttons under the player's finger every frame.
function updateMapDynamic() {
  const g = document.getElementById('mapTrucks');
  if (!g) return;
  let svg = '';
  for (const [key, f] of Object.entries(state.fleet)) {
    const [from, to] = key.split('>');
    const a = MAP_POS[from], b = MAP_POS[to];
    const trip = travelTime(from, to);
    for (const u of f.units) {
      let k;
      if (u.phase === 'go') k = Math.min(1, u.t / trip);
      else if (u.phase === 'back') k = 1 - Math.min(1, u.t / trip);
      else if (u.phase === 'unload') k = 0.92; // parked at the gate, waiting to unload
      else continue; // loading trucks sit at the depot
      const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
      const flip = (u.phase === 'go') === (b.x < a.x) ? '' : ' flip';
      svg += `<text x="${x}" y="${y + 1.5}" class="truck${flip}${u.phase === 'back' ? ' empty' : ''}" data-act="maproute" data-id="${key}">🚚</text>`;
    }
  }
  g.innerHTML = svg;
}

// ---------------- Assembler recipe panel ----------------
function assemblerHTML() {
  const at = ui.assemblerAt;
  const t = at && curProp().tiles[at.y][at.x];
  if (!t || !t.obj || t.obj.k !== 'assembler') return '<p class="intro">That assembler is gone.</p>';
  const o = t.obj;
  let html = '<p class="intro">Feed ingredients in from any side except the output arrow. Wrong items will back up, so sort them first.</p>';
  if (o.recipe) {
    const rocket = !!LAUNCH.needs[o.recipe];
    const mode = o.mode || 'run';
    const chip = (m, label) => `<button class="chip ${mode === m ? 'on' : ''}" data-act="asmmode" data-id="${m}">${label}</button>`;
    let note = mode === 'pause' ? 'Paused: it takes no ingredients, so they flow on to whatever is next on the line.'
      : mode === 'auto' ? (!state.launch.owned ? 'Runs until you own the Launch Site, then stops whenever the rocket already has enough of this part.'
        : assemblerIdle(o) ? `✅ The rocket has enough (${launchStock(o.recipe)}/${launchNeeds()[o.recipe]}), so it's idle and ingredients flow past.`
          : `Working: the rocket has ${launchStock(o.recipe)}/${launchNeeds()[o.recipe]}.`)
        : 'Running. Pause it to let its ingredients reach assemblers further down the line.';
    html += `<h3 class="sec">Mode</h3><div class="choice">${chip('run', '▶ Run')}${chip('pause', '⏸ Pause')}${rocket ? chip('auto', '🚀 Until the rocket has enough') : ''}</div>
      <p class="intro small">${note}</p>`;
    const prop = curProp();
    const stored = Object.keys(RECIPES[o.recipe].in).filter((p) => prop.held[p] > 0).map((p) => `${PRODUCTS[p].icon} ${prop.held[p]}`).join(' · ');
    html += `<h3 class="sec">Restock from storage</h3><div class="choice">
      <button class="chip ${!o.noFeed ? 'on' : ''}" data-act="asmfeed" data-id="on">🚜 Forklifts restock it</button>
      <button class="chip ${o.noFeed ? 'on' : ''}" data-act="asmfeed" data-id="off">Belt only</button></div>
      <p class="intro small">${o.noFeed ? 'Only takes ingredients from the belts.' : `When it runs out of an ingredient that's stored on this site's racks, a 🚜 Forklift Operator brings up to ${FORKLIFT_CARRY} at a time.`} ${stored ? `In storage now: ${stored}.` : 'None of its ingredients are in storage right now.'}</p>`;
  }
  for (const p of RECIPE_IDS) {
    const r = RECIPES[p];
    const on = o.recipe === p;
    const buf = on ? Object.entries(r.in).map(([q, n]) => `${PRODUCTS[q].icon} ${(o.buf && o.buf[q]) || 0}/${n}`).join(' · ') : '';
    const locked = r.research && !hasResearch(r.research);
    const btn = on ? '<button class="btn secondary" disabled>Active</button>'
      : locked ? '<button class="btn secondary" disabled>🔒</button>'
        : `<button class="btn" data-act="recipe" data-id="${p}">Build</button>`;
    html += card(PRODUCTS[p].icon, PRODUCTS[p].name,
      `${recipeText(p)} → ${PRODUCTS[p].icon} in ${r.time}s · sells for ${fmt(marketPrice(p))}${LAUNCH.needs[p] ? ' · 🚀 rocket part' : ''}`,
      on ? `Loaded: ${buf}` : locked ? `🔬 Needs ${RESEARCH_BY_ID[r.research].name} research` : '', btn,
      (on ? 'current' : '') + (locked ? ' done' : ''));
  }
  return html;
}

// Delivered parts fill the stages in order (booster first).
function launchStageProgress() {
  const mult = Math.pow(LAUNCH.growth, state.launch.count) * (1 - rfx('launchParts'));
  const left = { ...state.launch.parts };
  return LAUNCH.stages.map((st) => {
    const needs = {}, have = {};
    let done = true;
    for (const [p, n] of Object.entries(st.needs)) {
      needs[p] = Math.max(1, Math.round(n * mult));
      have[p] = Math.min(needs[p], left[p] || 0);
      left[p] = (left[p] || 0) - have[p];
      if (have[p] < needs[p]) done = false;
    }
    return { ...st, needs, have, done };
  });
}

// The first launch plays the cinematic; `auto` launches (later rockets) just report.
function doLaunch(opts = {}) {
  if (marsOn()) { marsLaunch(); return; }
  if (!launchReady()) return;
  state.launch.count++;
  state.launch.parts = {};
  state.gems += GEMS.perLaunch;
  const stars = Math.round(LAUNCH_STARS * (1 + rfx('launchStars')));
  state.rep += stars;
  save();
  const n = state.launch.count;
  if (opts.auto) {
    toast(`🚀 Rocket #${n} launched automatically! +${GEMS.perLaunch} 💎 +${stars} ⭐`);
    return;
  }
  if (n === 1) {
    closePanel();
    playLaunchAnimation(() => launchMessage(n, stars));
  } else launchMessage(n, stars);
}

function launchMessage(n, stars) {
  const mins = Math.round(state.clock / 60);
  if (n === 1 && !state.firstLaunchAt) state.firstLaunchAt = state.clock;
  showMessage(n === 1 ? '🚀 LIFTOFF! Next stop: Mars' : `🚀 Rocket #${n} launched!`, `
    <div class="victory">🚀</div>
    <p class="intro">${n === 1
    ? `From a rusty shed to a rocket in <b>${Math.floor(mins / 60)}h ${mins % 60}m</b> of play. Your supply chain did it!`
    : 'Another flawless launch.'}</p>
    <p class="intro">+${GEMS.perLaunch} 💎 · +${stars} ⭐</p>
    ${n === 1 ? `<div class="power-box unlock-box"><div class="power-head"><span>🔴 Next stop: Mars</span></div>
      <div class="power-note">Every rocket from now on flies to Mars during a launch window (every ${Math.round(MARS.windowEvery / 60)} minutes of play). Send a 🏠 Habitat Dome and colonists first, then keep them supplied with 🍞 Food Crates, 💧 Water/O₂ Canisters and 🔧 Spares Kits. Colonists pay you back in ⭐, 💎 and Rare Metals.<br>Open 🚀 Launch Site → Mission Control to plan the first flight.</div></div>` : ''}`);
}

// Auto-launch (after the first rocket) and a heads-up when one is ready to go.
function checkLaunch() {
  if (!state.launch.owned || !launchReady()) { ui.launchReadyToasted = false; return; }
  if (marsOn()) {
    // Auto: one rocket per window, as soon as the vehicle is ready.
    if (state.launch.auto && (M().autoWindow !== M().windowAt || planCargo(rocketSlots(), true).used >= rocketSlots() / 2)) marsLaunch();
    return;
  }
  if (state.launch.count >= 1 && state.launch.auto) { doLaunch({ auto: true }); return; }
  if (!ui.launchReadyToasted) {
    ui.launchReadyToasted = true;
    toast(state.launch.count ? '🚀 A rocket is ready: open the 🚀 Launch Site to fire it' : '🚀 Your first rocket is ready! Open the 🚀 Launch Site on the Map and press LAUNCH');
  }
}

// Panel button handlers for this module. Returns true if handled.
function handleEnterpriseAct(act, id) {
  if (act === 'mapsel') { ui.mapSel = id; return true; }
  if (act === 'openlog') { ui.logSite = id; ui.logTab = 'dist'; openPanel('logistics'); return 'stop'; }
  if (act === 'logtab') { ui.logTab = id; return true; }
  if (act === 'logsite') { ui.logSite = id; return true; }
  if (act === 'ptoggle') {
    const open = ui.planOpen || (ui.planOpen = new Set());
    if (open.has(id)) open.delete(id); else open.add(id);
    return true;
  }
  if (['pw', 'pcap', 'pdel', 'padd', 'pover'].includes(act)) {
    const [site, p, a, b] = id.split('|');
    const prop = state.props[site];
    const plan = prop.plans[p] || (prop.plans[p] = JSON.parse(JSON.stringify(DEFAULT_PLAN)));
    if (act === 'padd') {
      plan.dests.push({ to: a, w: 1, cap: 0 });
      if (a !== 'sell' && a !== 'store') ensureRoute(site, a);
    } else if (act === 'pover') {
      plan.overflow = a;
    } else {
      const d = plan.dests[Number(a)];
      if (act === 'pw') d.w = Math.max(0, Math.min(10, d.w + Number(b)));
      else if (act === 'pcap') {
        const i = CAP_STEPS.indexOf(d.cap);
        d.cap = CAP_STEPS[Math.max(0, Math.min(CAP_STEPS.length - 1, (i < 0 ? 0 : i) + Number(b)))];
      } else plan.dests.splice(Number(a), 1);
    }
    if (rt(site).wrr) delete rt(site).wrr[p]; // restart the interleave
    save();
    return true;
  }
  if (act === 'buytruck') {
    if (spend(truckCost(), 'trucks', 'New truck')) { state.garage.trucks++; toast('🚚 New truck in the garage. Assign it to a route'); save(); }
    return true;
  }
  if (act === 'tassign') {
    const [key, delta] = id.split('|');
    const f = state.fleet[key];
    if (Number(delta) > 0 && idleTrucks() > 0) f.trucks++;
    if (Number(delta) < 0 && f.trucks > 0) f.trucks--;
    save();
    return true;
  }
  if (act === 'maproute') {
    // Straight to that route's trucks, opened and in view.
    const [from] = id.split('>');
    ui.logTab = 'fleet';
    ui.logSite = from;
    ui.routeOpen = { ...(ui.routeOpen || {}), [id]: true };
    openPanel('logistics');
    setTimeout(() => {
      const el = document.querySelector(`[data-route-chips="${id}"]`);
      if (el) { const card = el.closest('.route-card'); card.scrollIntoView({ block: 'start', behavior: 'smooth' }); card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1200); }
    }, 50);
    return 'stop';
  }
  if (act === 'rtoggle') {
    ui.routeOpen = ui.routeOpen || {};
    const st = routeStats(id);
    const wasOpen = id in ui.routeOpen ? ui.routeOpen[id] : Object.keys(state.fleet).length <= 3 || (!st.f.trucks && st.waiting > 0);
    ui.routeOpen[id] = !wasOpen;
    return true;
  }
  if (act === 'tsend') {
    let n = 0;
    for (const u of state.fleet[id].units) if (u.phase === 'load' && u.n > 0) { u.phase = 'go'; u.t = 0; u.idle = 0; n++; }
    toast(n ? `🚚 ${n} truck${n > 1 ? 's' : ''} sent` : 'No loaded trucks to send');
    save();
    return true;
  }
  if (act === 'tauto') {
    // Hand idle trucks to the routes with the most cargo per truck.
    let n = 0;
    while (idleTrucks() > 0) {
      const best = Object.keys(state.fleet).map((k) => ({ k, s: routeStats(k) })).filter((q) => q.s.waiting > 0)
        .sort((a, b) => b.s.waiting / (b.s.f.trucks + 1) - a.s.waiting / (a.s.f.trucks + 1))[0];
      if (!best) break;
      state.fleet[best.k].trucks++;
      n++;
    }
    toast(n ? `⚖️ Assigned ${n} truck${n > 1 ? 's' : ''}` : 'No routes need trucks right now');
    save();
    return true;
  }
  if (act === 'twait') {
    const [key, w] = id.split('|');
    state.fleet[key].wait = w;
    save();
    return true;
  }
  if (act === 'sellpick') { const [site, p] = id.split('|'); openSellPop(site, p); return true; }
  if (act === 'rdel') { delete state.fleet[id]; save(); return true; }
  if (act === 'sellstored') {
    const [site, p, q] = id.split('|');
    const n = Number(q) || 0;
    toast(`💰 Sold ${p ? `${n || 'all'} ${PRODUCTS[p].name}` : 'all stored stock'} for ${fmt(sellStored(site, p, n))}`);
    save();
    return true;
  }
  if (act === 'buylaunch') {
    if (!state.launch.owned && spend(LAUNCH.price, 'property', 'Launch Site')) {
      state.launch.owned = true;
      toast('🚀 Launch Site bought! Truck rocket parts here.');
      save();
    }
    return true;
  }
  if (act === 'launch') { doLaunch(); return 'stop'; }
  const mars = handleMarsAct(act, id);
  if (mars) return mars;
  if (act === 'autolaunch') { state.launch.auto = id === 'on'; save(); if (state.launch.auto) checkLaunch(); return true; }
  if (act === 'asmfeed') {
    const o = curProp().tiles[ui.assemblerAt.y][ui.assemblerAt.x].obj;
    if (o && o.k === 'assembler') { if (id === 'off') o.noFeed = true; else delete o.noFeed; save(); }
    return true;
  }
  if (act === 'asmmode') {
    const o = curProp().tiles[ui.assemblerAt.y][ui.assemblerAt.x].obj;
    if (o && o.k === 'assembler') { o.mode = id === 'run' ? undefined : id; save(); }
    return true;
  }
  if (act === 'recipe') {
    const o = curProp().tiles[ui.assemblerAt.y][ui.assemblerAt.x].obj;
    const rr = RECIPES[id].research;
    if (rr && !hasResearch(rr)) { toast(`🔬 Research ${RESEARCH_BY_ID[rr].name} first`); return true; }
    if (o && o.k === 'assembler') {
      o.recipe = id;
      o.buf = {}; // ingredients for the old recipe are scrapped
      o.craftT = 0;
      save();
    }
    return true;
  }
  return false;
}
