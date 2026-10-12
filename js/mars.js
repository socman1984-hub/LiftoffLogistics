'use strict';
// Mars colony: after the first rocket, every launch carries a base module,
// supplies or colonists. Colonists eat through supplies each launch window
// and pay back reputation, gems and Rare Metals. Shortages mean rationing and
// people heading home, never a wipe. Windows run on the game clock, so the
// colony simply pauses while you're away.

const marsOn = () => state.launch.count >= 1;
const M = () => state.mars || (state.mars = marsFresh());

function marsFresh() {
  return {
    colonists: 0, modules: {}, stock: { food: 0, water: 0, spares: 0 }, rations: 0,
    windowAt: state.clock + MARS.firstWindow, nextCycle: state.clock + MARS.firstWindow, cycle: 0,
    flights: [], manifest: { module: 'habitat', food: 4, water: 4, spares: 2, colonists: 4 },
    milestones: {}, event: null, request: null, last: null, metalsWaiting: 0, metalsTotal: 0, autoWindow: -1,
  };
}

// ---------- Windows ----------
const padBusy = () => Math.max(0, (M().padFreeAt || 0) - state.clock);
function marsWindowOpen() { const m = M(); return state.clock >= m.windowAt && state.clock < m.windowAt + MARS.windowOpen; }
function marsWindowIn() { const m = M(); return Math.max(0, m.windowAt - state.clock); }
function marsWindowLeft() { const m = M(); return Math.max(0, m.windowAt + MARS.windowOpen - state.clock); }

// ---------- Colony numbers ----------
const modCount = (k) => M().modules[k] || 0;
const marsCap = () => MARS.perHabitat * modCount('habitat');
const totalModules = () => Object.values(M().modules).reduce((a, b) => a + b, 0);
const inTransitColonists = () => M().flights.reduce((a, f) => a + (f.colonists || 0), 0);

// Share of the powered modules that actually get power (dust storms halve solar).
function marsPower() {
  const supply = MARS.solarPower * modCount('solar') * (M().event && M().event.kind === 'dust' ? 0.5 : 1);
  const demand = ['greenhouse', 'icemine', 'station', 'pad'].reduce((a, k) => a + modCount(k), 0);
  return { supply, demand, frac: demand ? Math.min(1, supply / demand) : 1 };
}

// What the colony needs from Earth each window.
function marsNeeds() {
  const m = M(), pw = marsPower().frac;
  const food = m.colonists * MARS.foodPerColonist * Math.max(0, 1 - 0.25 * Math.min(3, modCount('greenhouse')) * pw);
  const water = m.colonists * MARS.waterPerColonist * Math.max(0, 1 - 0.25 * Math.min(3, modCount('icemine')) * pw);
  const spares = MARS.sparesPerModule * totalModules();
  return { food: Math.ceil(food), water: Math.ceil(water), spares: Math.ceil(spares) };
}

// Things the Launch Site wants trucked in for the next flight.
function marsPadWants() {
  const m = M();
  const out = {};
  const cut = 1 - rfx('launchParts');
  for (const [p, n] of Object.entries(VEHICLE)) out[p] = Math.max(1, Math.round(n * cut));
  if (m.manifest.module && MARS_MODULES[m.manifest.module]) {
    for (const [p, n] of Object.entries(MARS_MODULES[m.manifest.module].payload)) out[p] = (out[p] || 0) + n;
  }
  for (const [kind, prod] of Object.entries(SUPPLY_PRODUCT)) if (m.manifest[kind]) out[prod] = (out[prod] || 0) + m.manifest[kind];
  return out;
}
const marsAccepts = (p) => !!VEHICLE[p] || Object.values(MARS_MODULES).some((mm) => mm.payload[p]) || Object.values(SUPPLY_PRODUCT).includes(p);

const vehicleReady = () => {
  const cut = 1 - rfx('launchParts');
  return Object.entries(VEHICLE).every(([p, n]) => (state.launch.parts[p] || 0) >= Math.max(1, Math.round(n * cut)));
};

// ---------- Cargo ----------
function moduleAllowed(k) {
  const mm = MARS_MODULES[k];
  if (!mm) return false;
  if (k !== 'habitat' && !modCount('habitat') && !M().flights.some((f) => f.module === 'habitat')) return false; // live somewhere first
  if (mm.max && modCount(k) + M().flights.filter((f) => f.module === k).length >= mm.max) return false;
  return true;
}
const payloadReady = (k) => Object.entries(MARS_MODULES[k].payload).every(([p, n]) => (state.launch.parts[p] || 0) >= n);

// What the next rocket would carry right now, from the pad's stock.
function planCargo(slots, allowModule) {
  const m = M(), pad = state.launch.parts, c = { module: null, colonists: 0, food: 0, water: 0, spares: 0 };
  let left = slots;
  if (allowModule && m.manifest.module && moduleAllowed(m.manifest.module) && payloadReady(m.manifest.module) && left >= MARS.slotModule) {
    c.module = m.manifest.module;
    left -= MARS.slotModule;
  }
  if (allowModule) {
    const capAfter = marsCap() + (c.module === 'habitat' ? MARS.perHabitat : 0) + MARS.perHabitat * m.flights.filter((f) => f.module === 'habitat').length;
    const room = Math.max(0, capAfter - m.colonists - inTransitColonists());
    c.colonists = Math.min(m.manifest.colonists, room, Math.floor(left / MARS.slotColonist));
    left -= c.colonists * MARS.slotColonist;
  }
  // Supplies load one crate at a time, most urgent first, up to the manifest's numbers.
  const need = marsNeeds();
  const order = ['food', 'water', 'spares'].sort((a, b2) => (m.stock[a] + c[a]) / (need[a] || 0.5) - (m.stock[b2] + c[b2]) / (need[b2] || 0.5));
  let moved = true;
  while (left > 0 && moved) {
    moved = false;
    for (const kind of order) {
      if (left > 0 && c[kind] < (m.manifest[kind] || 0) && c[kind] < (pad[SUPPLY_PRODUCT[kind]] || 0)) { c[kind]++; left--; moved = true; }
    }
  }
  c.used = slots - left;
  return c;
}

// Emergency drops grab whatever's on the pad, most urgent supply first.
function emergencyCargo() {
  const m = M(), pad = state.launch.parts, need = marsNeeds();
  const c = { module: null, colonists: 0, food: 0, water: 0, spares: 0 };
  let left = MARS.emergencySlots;
  const order = ['food', 'water', 'spares'].sort((a, b) => (m.stock[a] / (need[a] || 1)) - (m.stock[b] / (need[b] || 1)));
  while (left > 0) {
    let moved = false;
    for (const kind of order) {
      if (left > 0 && (pad[SUPPLY_PRODUCT[kind]] || 0) > c[kind]) { c[kind]++; left--; moved = true; }
    }
    if (!moved) break;
  }
  c.used = MARS.emergencySlots - left;
  return c;
}

function takeFromPad(c) {
  const pad = state.launch.parts;
  if (c.module) for (const [p, n] of Object.entries(MARS_MODULES[c.module].payload)) pad[p] -= n;
  for (const kind of ['food', 'water', 'spares']) if (c[kind]) pad[SUPPLY_PRODUCT[kind]] -= c[kind];
  for (const p of Object.keys(pad)) if (pad[p] <= 0) delete pad[p];
}

// A cargo rocket to Mars (regular), or a gem-paid emergency supply drop.
function marsLaunch(opts = {}) {
  const m = M();
  if (opts.emergency) {
    if (state.gems < MARS.emergencyGems) { toast(`🆘 Needs ${MARS.emergencyGems} 💎`); return false; }
    const c = emergencyCargo();
    if (!c.used) { toast('🆘 No supply crates on the pad to send'); return false; }
    state.gems -= MARS.emergencyGems;
    takeFromPad(c);
    m.flights.push({ ...c, arriveAt: state.clock + MARS.transit, emergency: true });
    toast(`🆘 Emergency drop on its way: ${cargoText(c)} · arrives in ${fmtSecs(MARS.transit)}`);
    save();
    return true;
  }
  if (!marsWindowOpen()) { toast('🪐 Wait for the launch window'); return false; }
  if (padBusy()) { toast(`🚧 The pad is being reset: ready in ${fmtSecs(padBusy())}`); return false; }
  if (!vehicleReady()) { toast('🚀 The rocket still needs parts'); return false; }
  const cut = 1 - rfx('launchParts');
  for (const [p, n] of Object.entries(VEHICLE)) state.launch.parts[p] -= Math.max(1, Math.round(n * cut));
  const c = planCargo(MARS.slots, true);
  takeFromPad(c);
  m.flights.push({ ...c, arriveAt: state.clock + MARS.transit });
  state.launch.count++;
  m.autoWindow = m.windowAt;
  m.padFreeAt = state.clock + MARS.padTurnaround;
  toast(`🚀 Rocket #${state.launch.count} is off to Mars: ${cargoText(c) || 'empty hold'} · arrives in ${fmtSecs(MARS.transit)}`);
  save();
  return true;
}

const cargoText = (c) => [c.module && `${MARS_MODULES[c.module].icon} ${MARS_MODULES[c.module].name}`, c.colonists && `👩‍🚀 ${c.colonists}`,
  c.food && `🍞 ${c.food}`, c.water && `💧 ${c.water}`, c.spares && `🔧 ${c.spares}`].filter(Boolean).join(' · ');

// ---------- Simulation (once a second) ----------
function stepMars() {
  if (!marsOn()) return;
  const m = M();
  // Windows roll forward.
  while (state.clock >= m.windowAt + MARS.windowOpen) m.windowAt += MARS.windowEvery;
  if (marsWindowOpen() && ui.marsWindowToast !== m.windowAt) {
    ui.marsWindowToast = m.windowAt;
    if (!state.launch.auto) toast(`🪐 Mars launch window open for ${fmtSecs(MARS.windowOpen)}${vehicleReady() ? ': your rocket is ready' : ''}`);
  }
  // Arrivals.
  for (const f of m.flights.filter((q) => q.arriveAt <= state.clock)) marsArrive(f);
  m.flights = m.flights.filter((q) => q.arriveAt > state.clock);
  // The colony's cycle runs as each window opens.
  while (state.clock >= m.nextCycle) { marsCycle(); m.nextCycle += MARS.windowEvery; }
}

function marsArrive(f) {
  const m = M();
  const bits = [];
  if (f.module) {
    m.modules[f.module] = (m.modules[f.module] || 0) + 1;
    bits.push(`${MARS_MODULES[f.module].icon} ${MARS_MODULES[f.module].name} built`);
    if (f.module === 'habitat') { // each dome lands stocked for one window, so new arrivals don't start hungry
      m.stock.food += MARS.perHabitat; m.stock.water += MARS.perHabitat; m.stock.spares += 1;
    }
    if (f.module === 'pad' && m.metalsWaiting) { sellMetals(m.metalsWaiting); m.metalsWaiting = 0; }
  }
  if (f.colonists) {
    const n = Math.min(f.colonists, Math.max(0, marsCap() - m.colonists));
    m.colonists += n;
    if (n) bits.push(`👩‍🚀 ${n} colonist${n > 1 ? 's' : ''} landed`);
  }
  for (const kind of ['food', 'water', 'spares']) if (f[kind]) m.stock[kind] += f[kind];
  if (f.food || f.water || f.spares) bits.push(`supplies: ${cargoText({ food: f.food, water: f.water, spares: f.spares })}`);
  // Colonist request filled?
  const rq = m.request;
  if (rq && !rq.done && (f[rq.kind] || 0) >= rq.n) {
    rq.done = true;
    state.rep += rq.stars;
    state.gems += rq.gems;
    bits.push(`request filled: +${rq.stars} ⭐ +${rq.gems} 💎`);
  }
  toast(`🔴 Mars: ${bits.join(' · ') || 'empty rocket landed'}`);
  checkMilestones();
}

function sellMetals(n) {
  if (n <= 0) return;
  const value = n * MARS.metalValue;
  earn(value, 'mars', `${n} Rare Metals`);
  M().metalsTotal += n;
}

function marsCycle() {
  const m = M();
  m.cycle++;
  if (m.event) { m.event.left--; if (m.event.left <= 0) { toast('🌤️ The Martian dust storm has cleared'); m.event = null; } }
  if (m.request && !m.request.done && m.cycle > m.request.due) m.request = null;
  if (m.request && m.request.done) m.request = null;
  if (!m.colonists) { m.last = null; return; }
  const need = marsNeeds();
  let short = false;
  for (const kind of ['food', 'water', 'spares']) {
    if (m.stock[kind] < need[kind]) short = true;
    m.stock[kind] = Math.max(0, m.stock[kind] - need[kind]);
  }
  m.rations = short ? m.rations + 1 : 0;
  const mult = m.rations ? 0.5 : 1;
  const pw = marsPower().frac;
  const stars = Math.round(m.colonists * (1 + 0.5 * Math.min(1, modCount('station')) * pw) * mult * MARS.starsPerColonist);
  const metals = Math.round(m.colonists * MARS.metalsPerColonist * mult);
  const gems = Math.floor(m.colonists / 10);
  state.rep += stars;
  state.gems += gems;
  if (modCount('pad')) sellMetals(metals + m.metalsWaiting), (m.metalsWaiting = 0);
  else m.metalsWaiting += metals;
  let left = 0;
  if (m.rations >= MARS.rationsBeforeLeaving && m.colonists > MARS.minColonists) { m.colonists--; left = 1; }
  m.last = { need, short, stars, metals, gems, left };
  // Something happens now and then.
  if (!m.event && Math.random() < MARS.dustChance && modCount('solar')) {
    m.event = { kind: 'dust', left: 2 };
    toast('🌪️ A dust storm is rolling over the colony: solar power halved for 2 windows');
  }
  if (!m.request && Math.random() < MARS.requestChance) {
    const kind = ['food', 'water', 'spares'][Math.floor(Math.random() * 3)];
    const n = Math.max(3, Math.round(m.colonists * 1.5));
    const who = WORKER_NAMES[Math.floor(Math.random() * WORKER_NAMES.length)];
    m.request = { kind, n, due: m.cycle + 2, stars: 5 + Math.round(n / 2), gems: 2, who };
  }
  toast(`🔴 Mars window: colony used ${cargoText(need) || 'nothing'}${short ? ' · ⚠️ rationing' : ''} · made +${stars} ⭐${left ? ' · 1 colonist went home' : ''}`);
}

function checkMilestones() {
  const m = M();
  for (const [pop, gems] of MARS.milestones) {
    if (m.colonists >= pop && !m.milestones[pop]) {
      m.milestones[pop] = true;
      state.gems += gems;
      toast(`🎉 Mars colony reached ${pop} colonists! +${gems} 💎`);
    }
  }
}

// ---------- Panels ----------
function marsControlHTML() {
  const tab = ui.marsTab || 'launch';
  let html = `<div class="tabs"><button class="tab ${tab === 'launch' ? 'on' : ''}" data-act="marstab" data-id="launch">🚀 Next launch</button>
    <button class="tab ${tab === 'base' ? 'on' : ''}" data-act="marstab" data-id="base">🔴 Mars base</button></div>`;
  return html + (tab === 'base' ? marsBaseHTML() : marsLaunchHTML());
}

function marsLaunchHTML() {
  const m = M(), pad = state.launch.parts;
  const open = marsWindowOpen();
  let html = `<div class="mars-window ${open ? 'open' : ''}"><b>${open ? '🟢 Launch window open' : '🪐 Next launch window'}</b>
    <span class="num">${open ? `${fmtSecs(marsWindowLeft())} left` : `in ${fmtSecs(marsWindowIn())}`}</span></div>
    <p class="intro small">Earth and Mars line up every ${Math.round(MARS.windowEvery / 60)} minutes of play; rockets can leave while the window is open and reach Mars ${Math.round(MARS.transit / 60)} minutes later. Truck parts and supplies here with 🚚 Logistics → add 🚀 Launch Site as a destination.</p>`;
  // Vehicle
  const cut = 1 - rfx('launchParts');
  html += '<h3 class="sec">Rocket</h3><div class="mars-parts">' + Object.entries(VEHICLE).map(([p, n]) => {
    const need = Math.max(1, Math.round(n * cut)), have = Math.min(need, pad[p] || 0);
    return `<span class="${have >= need ? 'ok' : ''}">${PRODUCTS[p].icon} ${have}/${need}</span>`;
  }).join('') + '</div>';
  // Manifest
  const c = planCargo(MARS.slots, true);
  html += `<h3 class="sec">Cargo <span class="muted">${c.used}/${MARS.slots} slots ready</span></h3>`;
  html += '<div class="choice mars-mods">' + `<button class="chip ${!m.manifest.module ? 'on' : ''}" data-act="marsmod" data-id="">No module</button>`
    + Object.entries(MARS_MODULES).map(([k, mm]) => {
      const ok = moduleAllowed(k);
      return `<button class="chip ${m.manifest.module === k ? 'on' : ''} ${ok ? '' : 'faint'}" data-act="marsmod" data-id="${k}" title="${mm.desc}">${mm.icon} ${mm.name}${modCount(k) ? ` (${modCount(k)})` : ''}</button>`;
    }).join('') + '</div>';
  if (m.manifest.module) {
    const mm = MARS_MODULES[m.manifest.module];
    const why = !moduleAllowed(m.manifest.module) ? (mm.max && modCount(m.manifest.module) >= mm.max ? ' · already at max' : ' · build a Habitat first') : '';
    html += `<p class="intro small">${mm.icon} <b>${mm.name}</b>: ${mm.desc}${why}<br>Payload (${MARS.slotModule} slots): ${Object.entries(mm.payload).map(([p, n]) => `<span class="${(pad[p] || 0) >= n ? 'pos' : ''}">${PRODUCTS[p].icon} ${Math.min(n, pad[p] || 0)}/${n}</span>`).join(' · ')}</p>`;
  }
  const step = (kind, label, onPad) => `<div class="mars-step"><span>${label}</span><span class="muted small">${onPad}</span>
    <span class="dest-ctl"><button class="step" data-act="marsqty" data-id="${kind}|-1" ${m.manifest[kind] ? '' : 'disabled'}>−</button><b class="num">${m.manifest[kind]}</b>
    <button class="step" data-act="marsqty" data-id="${kind}|1">+</button></span></div>`;
  const room = Math.max(0, marsCap() + MARS.perHabitat * (m.manifest.module === 'habitat' ? 1 : 0) - m.colonists - inTransitColonists());
  html += step('colonists', `👩‍🚀 Colonists <span class="muted small">(${MARS.slotColonist} slots each)</span>`, `room for ${room}`);
  html += step('food', '🍞 Food Crates', `${pad.foodcrate || 0} on pad`);
  html += step('water', '💧 Water/O₂ Canisters', `${pad.canister || 0} on pad`);
  html += step('spares', '🔧 Spares Kits', `${pad.spares || 0} on pad`);
  html += `<p class="intro small">This launch would carry: <b>${cargoText(c) || 'nothing yet'}</b>.</p>`;
  const busy = padBusy();
  html += `<button class="btn launch" data-act="marslaunch" ${open && vehicleReady() && !busy ? '' : 'disabled'}>${!vehicleReady() ? '🚀 Rocket needs parts' : !open ? `🪐 Window opens in ${fmtSecs(marsWindowIn())}` : busy ? `🚧 Pad resetting · ${fmtSecs(busy)}` : '🚀 Launch to Mars'}</button>`;
  html += `<div class="choice"><span class="ctl-lbl">Launch</span>
    <button class="chip ${state.launch.auto ? 'on' : ''}" data-act="autolaunch" data-id="on">🔁 Automatically each window</button>
    <button class="chip ${!state.launch.auto ? 'on' : ''}" data-act="autolaunch" data-id="off">👆 When I press Launch</button></div>`;
  html += `<button class="btn secondary" style="width:100%;margin-top:6px" data-act="marsemergency" ${state.gems >= MARS.emergencyGems ? '' : 'disabled'}>🆘 Emergency supply drop now · up to ${MARS.emergencySlots} crates · ${MARS.emergencyGems} 💎</button>`;
  return html;
}

function marsBaseHTML() {
  const m = M();
  const need = marsNeeds(), pw = marsPower();
  // The base: one plot per module type, filled when built.
  const plots = Object.entries(MARS_MODULES).map(([k, mm]) => {
    const n = modCount(k), coming = m.flights.filter((f) => f.module === k).length;
    return `<div class="mars-plot ${n ? 'built' : ''}"><div class="mp-ic">${n ? mm.icon : '·'}</div><div class="mp-nm">${mm.name}</div>
      <div class="mp-lv">${n ? (mm.max ? `L${n}/${mm.max}` : `×${n}`) : coming ? '🚀 inbound' : 'not built'}</div></div>`;
  }).join('');
  let html = `<div class="mars-scene"><div class="mars-sky"><span class="mars-earth">🌍</span></div>
    <div class="mars-plots">${plots}</div>
    <div class="mars-pop">👩‍🚀 <b>${m.colonists}</b> / ${marsCap()} colonists${m.rations ? ` · <span class="neg">rationing (${m.rations})</span>` : ''}${m.event ? ` · 🌪️ dust storm (${m.event.left})` : ''}</div></div>`;
  // Supplies in windows-left
  const meter = (kind, label) => {
    const per = need[kind];
    const w = per ? m.stock[kind] / per : Infinity;
    const pct = per ? Math.min(100, (w / 4) * 100) : 100;
    const col = !per ? 'var(--good,#6fcf97)' : w >= 2 ? '#6fcf97' : w >= 1 ? '#f2c94c' : '#eb5757';
    return `<div class="mars-meter"><div class="mm-top"><span>${label}</span><span class="num">${m.stock[kind]} · ${per ? `${w.toFixed(1)} windows` : 'not needed'}</span></div>
      <div class="bar"><div style="width:${pct}%;background:${col}"></div></div><div class="muted small">uses ${per} per window</div></div>`;
  };
  html += '<h3 class="sec">Supplies</h3>' + meter('food', '🍞 Food') + meter('water', '💧 Water / O₂') + meter('spares', '🔧 Spares');
  html += `<div class="stats risk">
    <div class="stat-row"><span>⚡ Power</span><b class="${pw.frac < 1 ? 'neg' : ''}">${pw.supply} / ${pw.demand}${pw.frac < 1 ? ` · ${Math.round(pw.frac * 100)}% of modules running` : ''}</b></div>
    <div class="stat-row"><span>Next window</span><b>${marsWindowOpen() ? 'open now' : `in ${fmtSecs(marsWindowIn())}`}</b></div>
    ${m.last ? `<div class="stat-row"><span>Last window made</span><b>+${m.last.stars} ⭐ · ${m.last.metals} 🪨${m.last.gems ? ` · +${m.last.gems} 💎` : ''}</b></div>` : ''}
    <div class="stat-row"><span>🪨 Rare Metals shipped home</span><b>${m.metalsTotal}${m.metalsWaiting ? ` (+${m.metalsWaiting} waiting for a Landing Pad)` : ''}</b></div></div>`;
  if (m.request) {
    const rq = m.request, nm = { food: '🍞 Food Crates', water: '💧 Water/O₂ Canisters', spares: '🔧 Spares Kits' }[rq.kind];
    html += `<div class="power-box"><div class="power-head"><span>📨 ${rq.who} asks</span><b>${rq.done ? '✅ done' : `${Math.max(0, rq.due - m.cycle + 1)} window${rq.due - m.cycle ? 's' : ''} left`}</b></div>
      <div class="power-note">“Can you send <b>${rq.n} ${nm}</b> in one rocket?” Reward +${rq.stars} ⭐ +${rq.gems} 💎</div></div>`;
  }
  if (m.flights.length) {
    html += '<h3 class="sec">On the way</h3>' + m.flights.map((f) => `<div class="truck-row go"><span class="tr-ic">${f.emergency ? '🆘' : '🚀'}</span><div class="tr-body">
      <div class="tr-text">Lands in ${fmtSecs(f.arriveAt - state.clock)} · ${cargoText(f) || 'empty'}</div>
      <div class="bar tr-bar"><div style="width:${Math.min(100, (1 - (f.arriveAt - state.clock) / MARS.transit) * 100)}%"></div></div></div></div>`).join('');
  }
  html += `<p class="intro small">Colonists use supplies each window and make ⭐, 💎 and Rare Metals (sold when a 🛬 Landing Pad can fly them home). Run short and they ration at half output; after ${MARS.rationsBeforeLeaving} short windows one goes home each window. The colony pauses while you're away.</p>`;
  return html;
}

function handleMarsAct(act, id) {
  const m = M();
  if (act === 'marstab') { ui.marsTab = id; return true; }
  if (act === 'marsmod') { m.manifest.module = id || null; save(); return true; }
  if (act === 'marsqty') {
    const [kind, d] = id.split('|');
    m.manifest[kind] = Math.max(0, Math.min(MARS.slots, (m.manifest[kind] || 0) + Number(d)));
    save();
    return true;
  }
  if (act === 'marslaunch') { marsLaunch(); return true; }
  if (act === 'marsemergency') { marsLaunch({ emergency: true }); return true; }
  return false;
}
