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
  if (state.launch.owned && LAUNCH.needs[product]) out.push('launch');
  return out;
}

function truckCost() {
  return Math.round(TRUCK_BASE_COST * Math.pow(1.45, state.garage.trucks));
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

// ---------------- Map panel ----------------
function mapHTML() {
  if (!ui.mapSel) ui.mapSel = state.current || 'shed';
  let html = '';
  if (!state.current) {
    html += `<h2 class="game-title">🚀 Liftoff Logistics</h2>`;
    html += `<p class="intro">You've got <b>${fmt(state.money)}</b> and a dream: <b>build a rocket 🚀</b>.
      Start with a cheap warehouse, turn raw materials into parts, and grow a supply chain across the region.</p>`;
  }
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
    <b>Weights</b> split the flow (3 + 1 = 75% / 25%). A <b>cap</b> stops sending once that much is stocked or on the way there.</p>`;
  const products = relevantProducts(id);
  if (!products.length) html += '<p class="intro">Nothing ships from here yet. Open a supplier dock or set an assembler recipe.</p>';
  for (const p of products) {
    const plan = planOf(prop, p);
    const total = plan.dests.reduce((n, d) => n + d.w, 0) || 1;
    html += `<div class="plan"><div class="plan-head">${PRODUCTS[p].icon} <b>${PRODUCTS[p].name}</b><span class="muted"> · sells ${fmt(marketPrice(p))}</span></div>`;
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
    ${countList(prop.held) ? `<div class="dest-ctl"><button class="btn small secondary" data-act="sellstored" data-id="${id}">💰 Sell stored stock</button></div>` : ''}
    <div class="power-note">${layoutOf(id).racks} rack${layoutOf(id).racks === 1 ? '' : 's'} (${layoutOf(id).rackSlots} slots) + ${STORAGE_BASE} dock staging. Build more with the 🗄️ Rack tool, or tap a rack to upgrade it.</div>
    <div class="power-head" style="margin-top:10px"><span>🚜 Handling</span><b>${rate} moves/min</b></div>
    <div class="bar"><div style="width:${busy}%;background:${busy > 90 ? '#eb5757' : busy > 70 ? '#f2c94c' : '#6fcf97'}"></div></div>
    <div class="power-note">Crew is ${busy}% busy. Every put-away, truck load, unload and pick is one move.${busy > 90 ? ' <b class="neg">Bottleneck: hire forklift operators.</b>' : ''}</div>
    <div class="dest-ctl"><span class="ctl-lbl">Forklift operators ${ops}/${opDef.max}</span>
      <button class="btn small" data-act="hire" data-id="forklift" ${ops >= opDef.max || state.money < fee || id !== state.current ? 'disabled' : ''}>${id !== state.current ? 'Hire there' : `+ Hire ${fmt(fee)}`}</button></div>
  </div>`;
}

function fleetHTML() {
  const idle = idleTrucks();
  const cost = truckCost();
  let html = `<div class="garage"><div><b>🚚 ${state.garage.trucks}</b> trucks owned · <b class="${idle ? 'gold' : ''}">${idle}</b> idle
    <div class="muted">${truckCap()} packages per truck${hasResearch('fleet') ? ' (Semi Trailers)' : ''}</div></div>
    <button class="btn small" data-act="buytruck" ${state.money < cost ? 'disabled' : ''}>Buy ${fmt(cost)}</button></div>`;
  const keys = Object.keys(state.fleet);
  if (!keys.length) {
    html += '<p class="intro">No routes yet. In 📦 Distribution, send a product to another site and its route appears here.</p>';
    return html;
  }
  html += '<p class="intro small">Assign trucks to each route. A truck loads at the source, drives over, unloads and comes back. The departure rule sets how long a part-loaded truck waits for more cargo.</p>';
  for (const key of keys) {
    const st = routeStats(key);
    const busy = st.waiting > st.perMin * 1.5;
    html += `<div class="plan route-card ${!st.f.trucks && st.waiting ? 'alert' : ''}">
      <div class="plan-head">${siteEmoji(st.from)} ${siteName(st.from)} → ${siteEmoji(st.to)} <b>${siteName(st.to)}</b></div>
      <div class="muted">${Math.round(st.trip)}s each way · ${st.moving}/${st.f.trucks} on the road · up to ~${st.perMin}/min</div>
      <div class="muted ${busy ? 'neg' : ''}">${st.waiting ? `${st.waiting} waiting to load${busy ? ': add trucks or forklift operators!' : ''}` : 'Nothing waiting'}</div>
      ${st.unloading ? `<div class="muted neg">${st.unloading} truck${st.unloading > 1 ? 's' : ''} waiting to unload at ${siteName(st.to)} (racks full or handlers busy)</div>` : ''}
      <div class="dest-ctl">
        <span class="ctl-lbl">Trucks</span>
        <button class="step" data-act="tassign" data-id="${key}|-1" ${st.f.trucks ? '' : 'disabled'}>−</button><b>${st.f.trucks}</b>
        <button class="step" data-act="tassign" data-id="${key}|1" ${idle > 0 ? '' : 'disabled'}>+</button>
        ${!st.f.trucks && !st.waiting && !st.f.units.length ? `<button class="step x" data-act="rdel" data-id="${key}">✕</button>` : ''}
      </div>
      <div class="choice"><span class="ctl-lbl">Leave</span>${TRUCK_WAITS.map((w) =>
    `<button class="chip small ${st.f.wait === w.id ? 'on' : ''}" data-act="twait" data-id="${key}|${w.id}">${w.label}</button>`).join('')}</div>
    </div>`;
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
  html += `<h3 class="sec">${state.launch.count ? `Rocket #${state.launch.count + 1}` : 'Your rocket'}: 3 stages</h3>`;
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
    html += launchReady()
      ? '<button class="btn launch" data-act="launch">🚀 LAUNCH!</button>'
      : '<p class="intro">Truck parts here: in 🚚 Logistics → Distribution, add 🚀 Launch Site as a destination, then assign trucks to the route.</p>';
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
      svg += `<text x="${x}" y="${y + 1.5}" class="truck${flip}${u.phase === 'back' ? ' empty' : ''}">🚚</text>`;
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
  const mult = Math.pow(LAUNCH.growth, state.launch.count);
  const left = { ...state.launch.parts };
  return LAUNCH.stages.map((st) => {
    const needs = {}, have = {};
    let done = true;
    for (const [p, n] of Object.entries(st.needs)) {
      needs[p] = n * mult;
      have[p] = Math.min(needs[p], left[p] || 0);
      left[p] = (left[p] || 0) - have[p];
      if (have[p] < needs[p]) done = false;
    }
    return { ...st, needs, have, done };
  });
}

function doLaunch() {
  if (!launchReady()) return;
  state.launch.count++;
  state.launch.parts = {};
  state.gems += GEMS.perLaunch;
  save();
  const mins = Math.round(state.clock / 60);
  const n = state.launch.count;
  showMessage(n === 1 ? '🚀 LIFTOFF! You win!' : `🚀 Rocket #${n} launched!`, `
    <div class="victory">🚀</div>
    <p class="intro">${n === 1
    ? `From a rusty shed to a rocket in <b>${Math.floor(mins / 60)}h ${mins % 60}m</b> of play. Your supply chain did it!`
    : 'Another flawless launch.'}</p>
    <p class="intro">+${GEMS.perLaunch} 💎 · Keep going: the next rocket needs ${LAUNCH.growth}× the parts.</p>`);
}

// Panel button handlers for this module. Returns true if handled.
function handleEnterpriseAct(act, id) {
  if (act === 'mapsel') { ui.mapSel = id; return true; }
  if (act === 'openlog') { ui.logSite = id; ui.logTab = 'dist'; openPanel('logistics'); return 'stop'; }
  if (act === 'logtab') { ui.logTab = id; return true; }
  if (act === 'logsite') { ui.logSite = id; return true; }
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
    if (spend(truckCost())) { state.garage.trucks++; toast('🚚 New truck in the garage. Assign it to a route'); save(); }
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
  if (act === 'twait') {
    const [key, w] = id.split('|');
    state.fleet[key].wait = w;
    save();
    return true;
  }
  if (act === 'rdel') { delete state.fleet[id]; save(); return true; }
  if (act === 'sellstored') { toast(`💰 Sold stored stock for ${fmt(sellStored(id))}`); save(); return true; }
  if (act === 'buylaunch') {
    if (!state.launch.owned && spend(LAUNCH.price)) {
      state.launch.owned = true;
      toast('🚀 Launch Site bought! Truck rocket parts here.');
      save();
    }
    return true;
  }
  if (act === 'launch') { doLaunch(); return 'stop'; }
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
