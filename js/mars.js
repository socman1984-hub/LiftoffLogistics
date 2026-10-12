'use strict';
// Mars colony: after the first rocket, every launch carries a base module,
// supplies or colonists. Colonists eat through supplies each launch window
// and pay back reputation, gems and Rare Metals. Shortages mean rationing and
// people heading home, never a wipe. Windows run on the game clock, so the
// colony simply pauses while you're away.

const marsOn = () => state.launch.count >= 1;
const M = () => {
  const m = state.mars || (state.mars = marsFresh());
  // Saves from before a field existed.
  for (const k of SUPPLY_KINDS) { if (m.stock[k] == null) m.stock[k] = 0; if (m.manifest[k] == null) m.manifest[k] = 0; }
  if (!m.events) { m.events = { dust: m.event && m.event.kind === 'dust' ? m.event.left : 0, meteor: null, sick: false }; delete m.event; }
  if (!m.damaged) m.damaged = {};
  if (m.metalsTo == null) m.metalsTo = 'sell';
  if (m.padLevel == null) m.padLevel = 0;
  if (!m.terra) m.terra = { stage: 0, delivered: {} };
  if (typeof m.manifest.terra !== 'number') m.manifest.terra = m.manifest.terra ? 10 : 0; // slots for Terraform parts
  return m;
};

// ---------- Project Terraform ----------
const terraStage = () => TERRAFORM[M().terra.stage] || null;
function terraUnlocked() {
  const st = terraStage();
  return !!st && M().colonists >= st.pop && (!st.research || hasResearch(st.research));
}
// Parts still needed for the current stage, after what's delivered and in flight.
function terraRemaining() {
  const st = terraStage(), m = M();
  if (!st) return {};
  const out = {};
  for (const [p, n] of Object.entries(st.needs)) {
    const flying = m.flights.reduce((a, f) => a + ((f.terra || {})[p] || 0), 0);
    out[p] = Math.max(0, n - (m.terra.delivered[p] || 0) - flying);
  }
  return out;
}
const terraParts = () => [...new Set(TERRAFORM.flatMap((st) => Object.keys(st.needs)))];

function marsFresh() {
  return {
    colonists: 0, modules: {}, damaged: {}, stock: { food: 0, water: 0, spares: 0, med: 0, power: 0 }, rations: 0,
    windowAt: state.clock + MARS.firstWindow, nextCycle: state.clock + MARS.firstWindow, cycle: 0,
    flights: [], manifest: { module: 'habitat', food: 4, water: 4, spares: 2, med: 0, power: 0, colonists: 4 },
    milestones: {}, events: { dust: 0, meteor: null, sick: false }, request: null, last: null,
    metalsWaiting: 0, metalsTotal: 0, metalsTo: 'sell', autoWindow: -1, padLevel: 0, cargoBoost: 0,
  };
}

// ---------- Windows, pad and rockets ----------
const cargoCenter = () => state.props.hub && state.props.hub.owned && facCount('hub', 'cargocenter') > 0;
const padTurnaround = () => Math.max(20, MARS.padTurnaround - rfx('marsTurn') - PAD_LEVELS.slice(0, M().padLevel).reduce((a, l) => a + l.cut, 0) - (cargoCenter() ? 30 : 0));
const rocketSlots = () => MARS.slots + rfx('marsSlots') + (cargoCenter() ? 10 : 0) + (M().cargoBoost || 0);
const transitTime = () => Math.round(MARS.transit * (1 - rfx('marsTransit')));
const padBusy = () => Math.max(0, (M().padFreeAt || 0) - state.clock);
function marsWindowOpen() { const m = M(); return state.clock >= m.windowAt && state.clock < m.windowAt + MARS.windowOpen; }
function marsWindowIn() { const m = M(); return Math.max(0, m.windowAt - state.clock); }
function marsWindowLeft() { const m = M(); return Math.max(0, m.windowAt + MARS.windowOpen - state.clock); }

// ---------- Colony numbers ----------
const modCount = (k) => M().modules[k] || 0;
const effMod = (k) => Math.max(0, modCount(k) - (M().damaged[k] || 0)); // damaged modules do nothing
const marsCap = () => (MARS.perHabitat + rfx('marsCap')) * effMod('habitat');
const totalModules = () => Object.values(M().modules).reduce((a, b) => a + b, 0);
const inTransitColonists = () => M().flights.reduce((a, f) => a + (f.colonists || 0), 0);

// Power: solar (halved by dust; Power Cells help), fusion (immune). Share of powered modules running.
function marsPower() {
  const m = M();
  const dust = m.events.dust > 0;
  const solar = MARS.solarPower * effMod('solar') * (dust ? 0.5 : 1);
  const fusion = MARS.fusionPower * effMod('fusion');
  const demand = ['greenhouse', 'icemine', 'station', 'pad'].reduce((a, k) => a + effMod(k), 0);
  const short = Math.max(0, demand - solar - fusion);
  const cells = dust ? Math.min(m.stock.power, Math.ceil(short / MARS.powerCellBoost)) : 0;
  const supply = solar + fusion + cells * MARS.powerCellBoost;
  return { supply, demand, cells, frac: demand ? Math.min(1, supply / demand) : 1 };
}

// What the colony needs from Earth each window.
function marsNeeds() {
  const m = M(), pw = marsPower().frac;
  const food = m.colonists * MARS.foodPerColonist * (1 - rfx('marsFood')) * Math.max(0, 1 - 0.25 * Math.min(3, effMod('greenhouse')) * pw);
  const water = m.colonists * MARS.waterPerColonist * (1 - rfx('marsWater')) * (m.terra && m.terra.stage >= 1 ? 0.5 : 1) * Math.max(0, 1 - 0.25 * Math.min(3, effMod('icemine')) * pw);
  const spares = MARS.sparesPerModule * totalModules() * (1 - rfx('marsSpares'));
  return { food: Math.ceil(food), water: Math.ceil(water), spares: Math.ceil(spares), med: m.events.sick ? 2 : 0, power: 0 };
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
  if (m.manifest.terra && terraUnlocked()) {
    for (const [p, n] of Object.entries(terraRemaining())) if (n > 0) out[p] = (out[p] || 0) + Math.min(n, m.manifest.terra);
  }
  return out;
}
const marsAccepts = (p) => !!VEHICLE[p] || Object.values(MARS_MODULES).some((mm) => mm.payload[p]) || Object.values(SUPPLY_PRODUCT).includes(p) || terraParts().includes(p);

const vehicleReady = () => {
  const cut = 1 - rfx('launchParts');
  return Object.entries(VEHICLE).every(([p, n]) => (state.launch.parts[p] || 0) >= Math.max(1, Math.round(n * cut)));
};

// ---------- Cargo ----------
function moduleAllowed(k) {
  const mm = MARS_MODULES[k];
  if (!mm) return false;
  if (mm.research && !hasResearch(mm.research)) return false;
  if (k !== 'habitat' && !modCount('habitat') && !M().flights.some((f) => f.module === 'habitat')) return false; // live somewhere first
  if (mm.max && modCount(k) + M().flights.filter((f) => f.module === k).length >= mm.max) return false;
  return true;
}
const payloadReady = (k) => Object.entries(MARS_MODULES[k].payload).every(([p, n]) => (state.launch.parts[p] || 0) >= n);
const emptyCargo = () => ({ module: null, colonists: 0, food: 0, water: 0, spares: 0, med: 0, power: 0 });

// Slots the cargo plan asks for (module + colonists who have room + supply crates).
function colonistRoom() {
  const m = M(), per = MARS.perHabitat + rfx('marsCap');
  return Math.max(0, marsCap() + per * (m.manifest.module === 'habitat' ? 1 : 0) + per * m.flights.filter((f) => f.module === 'habitat').length - m.colonists - inTransitColonists());
}
function plannedSlots() {
  const m = M();
  const mod = m.manifest.module && moduleAllowed(m.manifest.module) ? MARS.slotModule : 0;
  const col = Math.min(m.manifest.colonists || 0, colonistRoom()) * MARS.slotColonist;
  const sup = SUPPLY_KINDS.reduce((a, k) => a + (m.manifest[k] || 0), 0);
  const terra = terraStage() ? m.manifest.terra || 0 : 0;
  return { mod, col, sup, terra, total: mod + col + sup + terra };
}

// What the next rocket would carry right now, from the pad's stock.
function planCargo(slots, allowModule) {
  const m = M(), pad = state.launch.parts, c = emptyCargo();
  let left = slots;
  if (allowModule && m.manifest.module && moduleAllowed(m.manifest.module) && payloadReady(m.manifest.module) && left >= MARS.slotModule) {
    c.module = m.manifest.module;
    left -= MARS.slotModule;
  }
  if (allowModule) {
    const per = MARS.perHabitat + rfx('marsCap');
    const capAfter = marsCap() + (c.module === 'habitat' ? per : 0) + per * m.flights.filter((f) => f.module === 'habitat').length;
    const room = Math.max(0, capAfter - m.colonists - inTransitColonists());
    c.colonists = Math.min(m.manifest.colonists, room, Math.floor(left / MARS.slotColonist));
    left -= c.colonists * MARS.slotColonist;
  }
  // Supplies load one crate at a time, most urgent first, up to the manifest's numbers.
  const need = marsNeeds();
  const order = [...SUPPLY_KINDS].sort((a, b) => (m.stock[a] + c[a]) / (need[a] || 0.5) - (m.stock[b] + c[b]) / (need[b] || 0.5));
  let moved = true;
  while (left > 0 && moved) {
    moved = false;
    for (const kind of order) {
      if (left > 0 && c[kind] < (m.manifest[kind] || 0) && c[kind] < (pad[SUPPLY_PRODUCT[kind]] || 0)) { c[kind]++; left--; moved = true; }
    }
  }
  // Project Terraform parts: up to the slots set aside for them, round-robin.
  if (allowModule && m.manifest.terra && terraUnlocked()) {
    let budget = Math.min(left, m.manifest.terra);
    const cap0 = left;
    const rem = terraRemaining(), padLeft = {};
    c.terra = {};
    for (const p of Object.keys(rem)) padLeft[p] = Math.max(0, (pad[p] || 0) - (c.module ? MARS_MODULES[c.module].payload[p] || 0 : 0) - (Object.entries(SUPPLY_PRODUCT).find(([, q]) => q === p) ? c[Object.entries(SUPPLY_PRODUCT).find(([, q]) => q === p)[0]] : 0));
    let more = true;
    while (budget > 0 && more) {
      more = false;
      for (const p of Object.keys(rem)) {
        if (budget > 0 && (c.terra[p] || 0) < rem[p] && (c.terra[p] || 0) < padLeft[p]) { c.terra[p] = (c.terra[p] || 0) + 1; budget--; left--; more = true; }
      }
    }
    void cap0;
  }
  c.used = slots - left;
  return c;
}

// Emergency drops grab whatever's on the pad, most urgent supply first.
function emergencyCargo() {
  const m = M(), pad = state.launch.parts, need = marsNeeds();
  const c = emptyCargo();
  let left = MARS.emergencySlots;
  const order = [...SUPPLY_KINDS].sort((a, b) => (m.stock[a] / (need[a] || 1)) - (m.stock[b] / (need[b] || 1)));
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
  for (const kind of SUPPLY_KINDS) if (c[kind]) pad[SUPPLY_PRODUCT[kind]] -= c[kind];
  for (const [p, n] of Object.entries(c.terra || {})) pad[p] -= n;
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
    m.flights.push({ ...c, arriveAt: state.clock + transitTime(), emergency: true });
    toast(`🆘 Emergency drop on its way: ${cargoText(c)} · arrives in ${fmtSecs(transitTime())}`);
    save();
    return true;
  }
  if (!marsWindowOpen()) { toast('🪐 Wait for the launch window'); return false; }
  if (padBusy()) { toast(`🚧 The pad is being reset: ready in ${fmtSecs(padBusy())}`); return false; }
  if (!vehicleReady()) { toast('🚀 The rocket still needs parts'); return false; }
  const cut = 1 - rfx('launchParts');
  for (const [p, n] of Object.entries(VEHICLE)) state.launch.parts[p] -= Math.max(1, Math.round(n * cut));
  const c = planCargo(rocketSlots(), true);
  takeFromPad(c);
  m.flights.push({ ...c, arriveAt: state.clock + transitTime() });
  m.cargoBoost = 0;
  state.launch.count++;
  m.autoWindow = m.windowAt;
  m.padFreeAt = state.clock + padTurnaround();
  toast(`🚀 Rocket #${state.launch.count} is off to Mars: ${cargoText(c) || 'empty hold'} · arrives in ${fmtSecs(transitTime())}`);
  save();
  return true;
}

const SUPPLY_ICON = { food: '🍞', water: '💧', spares: '🔧', med: '💊', power: '🔋' };
const cargoText = (c) => [c.module && `${MARS_MODULES[c.module].icon} ${MARS_MODULES[c.module].name}`, c.colonists && `👩‍🚀 ${c.colonists}`,
  ...SUPPLY_KINDS.map((k) => c[k] && `${SUPPLY_ICON[k]} ${c[k]}`),
  c.terra && Object.values(c.terra).some((n) => n) && `🌍 ${Object.entries(c.terra).filter(([, n]) => n).map(([p, n]) => `${PRODUCTS[p].icon}${n}`).join(' ')}`].filter(Boolean).join(' · ');

// ---------- Simulation (once a second) ----------
function stepMars() {
  if (!marsOn()) return;
  const m = M();
  while (state.clock >= m.windowAt + MARS.windowOpen) m.windowAt += MARS.windowEvery;
  if (marsWindowOpen() && ui.marsWindowToast !== m.windowAt) {
    ui.marsWindowToast = m.windowAt;
    if (!state.launch.auto) toast(`🪐 Mars launch window open for ${fmtSecs(MARS.windowOpen)}${vehicleReady() ? ': your rocket is ready' : ''}`);
  }
  for (const f of m.flights.filter((q) => q.arriveAt <= state.clock)) marsArrive(f);
  m.flights = m.flights.filter((q) => q.arriveAt > state.clock);
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
    if (f.module === 'pad' && m.metalsWaiting) { shipMetals(m.metalsWaiting); m.metalsWaiting = 0; }
  }
  if (f.colonists) {
    const n = Math.min(f.colonists, Math.max(0, marsCap() - m.colonists));
    m.colonists += n;
    if (n) bits.push(`👩‍🚀 ${n} colonist${n > 1 ? 's' : ''} landed`);
  }
  for (const kind of SUPPLY_KINDS) if (f[kind]) m.stock[kind] += f[kind];
  if (f.terra && terraStage()) {
    for (const [p, n] of Object.entries(f.terra)) m.terra.delivered[p] = (m.terra.delivered[p] || 0) + n;
    bits.push(`🌍 Terraform parts: ${Object.entries(f.terra).filter(([, n]) => n).map(([p, n]) => `${PRODUCTS[p].icon} ${n}`).join(' ')}`);
    const st = terraStage();
    if (Object.entries(st.needs).every(([p, n]) => (m.terra.delivered[p] || 0) >= n)) {
      m.terra.stage++;
      m.terra.delivered = {};
      if (m.terra.stage >= TERRAFORM.length) { setTimeout(winGame, 600); }
      else toast(`🌍 ${st.icon} ${st.name} complete! ${st.effect}. Next: ${TERRAFORM[m.terra.stage].icon} ${TERRAFORM[m.terra.stage].name}`);
      if (st.id === 'shield') { m.events.dust = 0; if (m.events.meteor) { m.damaged[m.events.meteor] = Math.max(0, (m.damaged[m.events.meteor] || 0) - 1); m.events.meteor = null; } }
    }
  }
  const sup = {};
  for (const k of SUPPLY_KINDS) sup[k] = f[k];
  if (SUPPLY_KINDS.some((k) => f[k])) bits.push(`supplies: ${cargoText(sup)}`);
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

// Rare Metals: sold on arrival, or delivered to one of your sites for Fusion Cores.
function shipMetals(n) {
  if (n <= 0) return;
  const m = M();
  m.metalsTotal += n;
  const to = m.metalsTo;
  if (to !== 'sell' && state.props[to] && state.props[to].owned && hasReceiveDock(PROP_BY_ID[to])) {
    // Only what the site has room to store; the rest is sold.
    const take = Math.max(0, Math.min(n, storageRoomFor(to, 'raremetal')));
    const inbox = state.props[to].inbox;
    inbox.raremetal = (inbox.raremetal || 0) + take;
    n -= take;
  }
  if (n > 0) earn(n * PRODUCTS.raremetal.value * demandOf('raremetal'), 'mars', `${n} Rare Metals`);
}

function marsCycle() {
  const m = M();
  m.cycle++;
  const ev = m.events;
  if (ev.dust > 0 && --ev.dust === 0) toast('🌤️ The Martian dust storm has cleared');
  if (m.request && (m.request.done || m.cycle > m.request.due)) m.request = null;
  if (!m.colonists) { m.last = null; return; }
  // Power Cells burn during a storm.
  const pw = marsPower();
  if (pw.cells) m.stock.power -= pw.cells;
  const need = marsNeeds();
  let short = false;
  for (const kind of ['food', 'water', 'spares']) {
    if (m.stock[kind] < need[kind]) short = true;
    m.stock[kind] = Math.max(0, m.stock[kind] - need[kind]);
  }
  // Event fixes: spares repair meteor damage, medical kits cure sickness.
  if (ev.meteor && m.stock.spares >= 4) {
    m.stock.spares -= 4;
    m.damaged[ev.meteor] = Math.max(0, (m.damaged[ev.meteor] || 0) - 1);
    toast(`🔧 Mars: the ${MARS_MODULES[ev.meteor].name} is repaired`);
    ev.meteor = null;
  }
  if (ev.sick && m.stock.med >= 2) { m.stock.med -= 2; ev.sick = false; toast('💊 Mars: the sickness is treated'); }
  m.rations = short ? m.rations + 1 : 0;
  let mult = m.rations ? 0.5 + rfx('marsRation') : 1;
  if (ev.sick) mult *= 1 - 0.3 * (1 - rfx('marsRation'));
  const stars = Math.round(m.colonists * (1 + 0.5 * Math.min(1, effMod('station')) * pw.frac) * mult * MARS.starsPerColonist * (1 + rfx('marsOutput')));
  const metals = Math.round(m.colonists * MARS.metalsPerColonist * mult * (1 + rfx('marsMetals') + rfx('marsOutput')));
  const gems = Math.floor(m.colonists / 10);
  state.rep += stars;
  state.gems += gems;
  if (effMod('pad')) { shipMetals(metals + m.metalsWaiting); m.metalsWaiting = 0; } else m.metalsWaiting += metals;
  let left = 0;
  if (m.rations >= MARS.rationsBeforeLeaving && m.colonists > MARS.minColonists) { m.colonists--; left = 1; }
  m.last = { need, short, stars, metals, gems, left };
  // Something happens now and then.
  const shielded = m.terra.stage >= 2;
  if (!shielded && !ev.dust && effMod('solar') && Math.random() < MARS_EVENTS.dust.chance) {
    ev.dust = MARS_EVENTS.dust.windows;
    toast('🌪️ A dust storm is rolling over the colony: solar power halved for 2 windows (🔋 Power Cells help)');
  }
  if (!shielded && !ev.meteor && totalModules() >= 3 && Math.random() < MARS_EVENTS.meteor.chance) {
    const hit = Object.keys(m.modules).filter((k) => k !== 'habitat' && effMod(k) > 0);
    if (hit.length) {
      ev.meteor = hit[Math.floor(Math.random() * hit.length)];
      m.damaged[ev.meteor] = (m.damaged[ev.meteor] || 0) + 1;
      toast(`☄️ Meteor strike! The ${MARS_MODULES[ev.meteor].name} is offline until the colony has 4 spare 🔧 Spares Kits`);
    }
  }
  if (!ev.sick && m.colonists >= 8 && Math.random() < MARS_EVENTS.sick.chance) {
    ev.sick = true;
    toast('🦠 Sickness in the colony: output down 30% until 2 💊 Medical Kits arrive');
  }
  if (!m.request && Math.random() < MARS.requestChance) {
    const kind = ['food', 'water', 'spares'][Math.floor(Math.random() * 3)];
    const n = Math.max(3, Math.round(m.colonists * 0.75));
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
  const html = `<div class="tabs"><button class="tab ${tab === 'launch' ? 'on' : ''}" data-act="marstab" data-id="launch">🚀 Next launch</button>
    <button class="tab ${tab === 'base' ? 'on' : ''}" data-act="marstab" data-id="base">🔴 Mars base</button></div>`;
  return html + (tab === 'base' ? marsBaseHTML() : marsLaunchHTML());
}

function marsLaunchHTML() {
  const m = M(), pad = state.launch.parts;
  const open = marsWindowOpen();
  let html = `<div class="mars-window ${open ? 'open' : ''}"><b>${open ? '🟢 Launch window open' : '🪐 Next launch window'}</b>
    <span class="num">${open ? `${fmtSecs(marsWindowLeft())} left` : `in ${fmtSecs(marsWindowIn())}`}</span></div>
    <p class="intro small">Earth and Mars line up every ${Math.round(MARS.windowEvery / 60)} minutes of play; rockets can leave while the window is open and reach Mars in ${fmtSecs(transitTime())}. Truck parts and supplies here with 🚚 Logistics → add 🚀 Launch Site as a destination.</p>`;
  const cut = 1 - rfx('launchParts');
  html += '<h3 class="sec">Rocket</h3><div class="mars-parts">' + Object.entries(VEHICLE).map(([p, n]) => {
    const need = Math.max(1, Math.round(n * cut)), have = Math.min(need, pad[p] || 0);
    return `<span class="${have >= need ? 'ok' : ''}">${PRODUCTS[p].icon} ${have}/${need}</span>`;
  }).join('') + '</div>';
  const slots = rocketSlots();
  const c = planCargo(slots, true);
  const plan = plannedSlots();
  const over = plan.total > slots;
  html += `<h3 class="sec">Cargo</h3><div class="cargo-cap ${over ? 'over' : ''}">
    <div class="cc-top"><span>📦 Cargo plan</span><b class="num">${plan.total} / ${slots} slots</b></div>
    <div class="bar"><div style="width:${Math.min(100, (plan.total / slots) * 100)}%"></div></div>
    <div class="cc-note">${plan.mod ? `🏠 module ${plan.mod}` : 'no module'} · 👩‍🚀 colonists ${plan.col} · 📦 supplies ${plan.sup}${plan.terra ? ` · 🌍 terraform ${plan.terra}` : ''}${over ? ` · <b class="neg">${plan.total - slots} over: lower something, or it won't fit</b>` : ` · ${slots - plan.total} free`}</div>
    <div class="cc-note">Ready on the pad now: <b>${c.used}/${slots}</b>. Each rocket holds ${slots} slots (module ${MARS.slotModule}, colonist ${MARS.slotColonist}, crate 1)${m.cargoBoost ? `, including 📦 +${m.cargoBoost} boost` : ''}. Heavy-Lift research, the Cargo Center and Cargo Boost add more.</div></div>`;
  html += '<div class="choice mars-mods">' + `<button class="chip ${!m.manifest.module ? 'on' : ''}" data-act="marsmod" data-id="">No module</button>`
    + Object.entries(MARS_MODULES).map(([k, mm]) => {
      if (mm.research && !hasResearch(mm.research)) return '';
      const ok = moduleAllowed(k);
      return `<button class="chip ${m.manifest.module === k ? 'on' : ''} ${ok ? '' : 'faint'}" data-act="marsmod" data-id="${k}" title="${mm.desc}">${mm.icon} ${mm.name}${modCount(k) ? ` (${modCount(k)})` : ''}</button>`;
    }).join('') + '</div>';
  if (m.manifest.module) {
    const mm = MARS_MODULES[m.manifest.module];
    const why = !moduleAllowed(m.manifest.module) ? (mm.max && modCount(m.manifest.module) >= mm.max ? ' · already at max' : ' · build a Habitat first') : '';
    html += `<p class="intro small">${mm.icon} <b>${mm.name}</b>: ${mm.desc}${why}<br>Payload (${MARS.slotModule} slots): ${Object.entries(mm.payload).map(([p, n]) => `<span class="${(pad[p] || 0) >= n ? 'pos' : ''}">${PRODUCTS[p].icon} ${Math.min(n, pad[p] || 0)}/${n}</span>`).join(' · ')}</p>`;
  }
  const free = slots - plan.total;
  const step = (kind, label, onPad) => {
    const cost = kind === 'colonists' ? MARS.slotColonist : 1;
    const canAdd = free >= cost && !(kind === 'colonists' && m.manifest.colonists >= colonistRoom());
    return `<div class="mars-step"><span>${label}</span><span class="muted small">${onPad}</span>
    <span class="dest-ctl"><button class="step" data-act="marsqty" data-id="${kind}|-1" ${m.manifest[kind] ? '' : 'disabled'}>−</button><b class="num">${m.manifest[kind]}</b>
    <button class="step" data-act="marsqty" data-id="${kind}|1" ${canAdd ? '' : 'disabled'}>+</button></span></div>`;
  };
  const room = colonistRoom();
  html += step('colonists', `👩‍🚀 Colonists <span class="muted small">(${MARS.slotColonist} slots each)</span>`, `room for ${room}`);
  html += step('food', '🍞 Food Crates', `${pad.foodcrate || 0} on pad`);
  html += step('water', '💧 Water/O₂ Canisters', `${pad.canister || 0} on pad`);
  html += step('spares', '🔧 Spares Kits', `${pad.spares || 0} on pad`);
  html += step('med', '💊 Medical Kits <span class="muted small">(sickness)</span>', `${pad.medkit || 0} on pad`);
  html += step('power', '🔋 Power Cells <span class="muted small">(dust storms)</span>', `${pad.powercell || 0} on pad`);
  if (terraStage()) {
    const st = terraStage();
    const onPad = Object.keys(st.needs).reduce((a, p) => a + Math.min(pad[p] || 0, terraRemaining()[p] || 0), 0);
    html += step('terra', `🌍 Terraform parts <span class="muted small">(${st.icon} ${st.name})</span>`, terraUnlocked() ? `${onPad} on pad` : '🔒 locked');
    if (!terraUnlocked()) html += `<p class="intro small">🌍 ${st.name} unlocks at ${st.pop} colonists${st.research ? ` and ${RESEARCH_BY_ID[st.research].name} research` : ''}.</p>`;
  }
  html += `<p class="intro small">This launch would carry: <b>${cargoText(c) || 'nothing yet'}</b>.</p>`;
  const busy = padBusy();
  html += `<button class="btn launch" data-act="marslaunch" ${open && vehicleReady() && !busy ? '' : 'disabled'}>${!vehicleReady() ? '🚀 Rocket needs parts' : !open ? `🪐 Window opens in ${fmtSecs(marsWindowIn())}` : busy ? `🚧 Pad resetting · ${fmtSecs(busy)}` : '🚀 Launch to Mars'}</button>`;
  html += `<div class="choice"><span class="ctl-lbl">Launch</span>
    <button class="chip ${state.launch.auto ? 'on' : ''}" data-act="autolaunch" data-id="on">🔁 Automatically each window</button>
    <button class="chip ${!state.launch.auto ? 'on' : ''}" data-act="autolaunch" data-id="off">👆 When I press Launch</button></div>`;
  html += `<button class="btn secondary" style="width:100%;margin-top:6px" data-act="marsemergency" ${state.gems >= MARS.emergencyGems ? '' : 'disabled'}>🆘 Emergency supply drop now · up to ${MARS.emergencySlots} crates · ${MARS.emergencyGems} 💎</button>`;
  // Pad upgrades: a place for late-game cash.
  const next = PAD_LEVELS[m.padLevel];
  html += `<h3 class="sec">Launch pad</h3>` + card('🚧', `Pad level ${m.padLevel + 1}/${PAD_LEVELS.length + 1}`,
    `Resets in ${fmtSecs(padTurnaround())} between launches${cargoCenter() ? ' (📦 Cargo Center −30 s)' : ''}`,
    next ? `Next level: −${next.cut} s` : 'Fully upgraded',
    next ? `<button class="btn" data-act="marspad" ${state.money < next.cost ? 'disabled' : ''}>${fmt(next.cost)}</button>` : '<button class="btn secondary" disabled>Max</button>');
  return html;
}

function marsBaseHTML() {
  const m = M(), ev = m.events;
  const need = marsNeeds(), pw = marsPower();
  const plots = Object.entries(MARS_MODULES).map(([k, mm]) => {
    if (mm.research && !hasResearch(mm.research) && !modCount(k)) return '';
    const n = modCount(k), dmg = m.damaged[k] || 0, coming = m.flights.filter((f) => f.module === k).length;
    return `<div class="mars-plot ${n ? 'built' : ''} ${dmg ? 'damaged' : ''}"><div class="mp-ic">${n ? mm.icon : '·'}</div><div class="mp-nm">${mm.name}</div>
      <div class="mp-lv">${dmg ? '💥 damaged' : n ? (mm.max ? `L${n}/${mm.max}` : `×${n}`) : coming ? '🚀 inbound' : 'not built'}</div></div>`;
  }).join('');
  const badges = [m.rations ? `<span class="neg">rationing (${m.rations})</span>` : '', ev.dust ? `🌪️ dust storm (${ev.dust})` : '', ev.meteor ? '☄️ meteor damage' : '', ev.sick ? '🦠 sickness' : ''].filter(Boolean).join(' · ');
  let html = `<div class="mars-scene"><div class="mars-sky"><span class="mars-earth">🌍</span></div>
    <div class="mars-plots">${plots}</div>
    <div class="mars-pop">👩‍🚀 <b>${m.colonists}</b> / ${marsCap()} colonists${badges ? ` · ${badges}` : ''}</div></div>`;
  html += terraHTML();
  // Active events and what fixes them
  for (const [k, on] of [['dust', ev.dust], ['meteor', ev.meteor], ['sick', ev.sick]]) {
    if (!on) continue;
    const e = MARS_EVENTS[k];
    html += `<div class="power-box over"><div class="power-head"><span>${e.icon} ${e.name}${k === 'meteor' ? `: ${MARS_MODULES[ev.meteor].name}` : ''}</span></div><div class="power-note">${e.desc}</div></div>`;
  }
  const meter = (kind, label) => {
    const per = need[kind];
    const w = per ? m.stock[kind] / per : Infinity;
    const pct = per ? Math.min(100, (w / 4) * 100) : 100;
    const col = !per ? '#6fcf97' : w >= 2 ? '#6fcf97' : w >= 1 ? '#f2c94c' : '#eb5757';
    return `<div class="mars-meter"><div class="mm-top"><span>${label}</span><span class="num">${m.stock[kind]} · ${per ? `${w.toFixed(1)} windows` : 'not needed'}</span></div>
      <div class="bar"><div style="width:${pct}%;background:${col}"></div></div><div class="muted small">uses ${per} per window</div></div>`;
  };
  html += '<h3 class="sec">Supplies</h3>' + meter('food', '🍞 Food') + meter('water', '💧 Water / O₂') + meter('spares', '🔧 Spares');
  html += `<p class="intro small">In reserve: 💊 ${m.stock.med} Medical Kits · 🔋 ${m.stock.power} Power Cells</p>`;
  html += `<div class="stats risk">
    <div class="stat-row"><span>⚡ Power</span><b class="${pw.frac < 1 ? 'neg' : ''}">${pw.supply} / ${pw.demand}${pw.cells ? ` (🔋 ${pw.cells} cells)` : ''}${pw.frac < 1 ? ` · ${Math.round(pw.frac * 100)}% running` : ''}</b></div>
    <div class="stat-row"><span>Next window</span><b>${marsWindowOpen() ? 'open now' : `in ${fmtSecs(marsWindowIn())}`}</b></div>
    ${m.last ? `<div class="stat-row"><span>Last window made</span><b>+${m.last.stars} ⭐ · ${m.last.metals} 🪨${m.last.gems ? ` · +${m.last.gems} 💎` : ''}</b></div>` : ''}
    <div class="stat-row"><span>🪨 Rare Metals shipped home</span><b>${m.metalsTotal}${m.metalsWaiting ? ` (+${m.metalsWaiting} waiting for a Landing Pad)` : ''}</b></div></div>`;
  // Where Rare Metals go
  const sites = PROPERTIES.filter((d) => state.props[d.id].owned && hasReceiveDock(d));
  html += `<h3 class="sec">Rare Metals go to</h3><div class="choice">
    <button class="chip ${m.metalsTo === 'sell' ? 'on' : ''}" data-act="marsmetals" data-id="sell">💰 Sell on arrival</button>
    ${sites.map((d) => `<button class="chip ${m.metalsTo === d.id ? 'on' : ''}" data-act="marsmetals" data-id="${d.id}">🚚 ${d.emoji} ${d.name}</button>`).join('')}</div>
    <p class="intro small">${m.metalsTo === 'sell' ? `Sold at ${fmt(marketPrice('raremetal'))} each.` : `Unloaded at the ${PROP_BY_ID[m.metalsTo].name}'s receiving dock${hasResearch('fusion') ? ', ready for ⚛️ Fusion Cores (2 🪨 + 💻 + 2 🟦)' : '. Research ⚛️ Fusion Power (Colony) to turn them into Fusion Cores'}.`}</p>`;
  if (m.request) {
    const rq = m.request, nm = { food: '🍞 Food Crates', water: '💧 Water/O₂ Canisters', spares: '🔧 Spares Kits' }[rq.kind];
    html += `<div class="power-box"><div class="power-head"><span>📨 ${rq.who} asks</span><b>${rq.done ? '✅ done' : `${Math.max(0, rq.due - m.cycle + 1)} window${rq.due - m.cycle ? 's' : ''} left`}</b></div>
      <div class="power-note">“Can you send <b>${rq.n} ${nm}</b> in one rocket?” Reward +${rq.stars} ⭐ +${rq.gems} 💎</div></div>`;
  }
  if (m.flights.length) {
    html += '<h3 class="sec">On the way</h3>' + m.flights.map((f) => `<div class="truck-row go"><span class="tr-ic">${f.emergency ? '🆘' : '🚀'}</span><div class="tr-body">
      <div class="tr-text">Lands in ${fmtSecs(f.arriveAt - state.clock)} · ${cargoText(f) || 'empty'}</div>
      <div class="bar tr-bar"><div style="width:${Math.min(100, (1 - (f.arriveAt - state.clock) / transitTime()) * 100)}%"></div></div></div></div>`).join('');
  }
  html += `<p class="intro small">Colonists use supplies each window and make ⭐, 💎 and Rare Metals. Run short and they ration at half output; after ${MARS.rationsBeforeLeaving} short windows one goes home each window. The 🔴 Colony research branch improves all of this. The colony pauses while you're away.</p>`;
  return html;
}

function terraHTML() {
  const m = M(), st = terraStage();
  if (!st) return `<div class="power-box unlock-box"><div class="power-head"><span>🌍 Project Terraform</span><b>✅ Complete</b></div><div class="power-note">Mars is alive. You won! Keep growing, or start 🔁 New Game+ from the Map.</div></div>`;
  const reqs = [`👩‍🚀 ${Math.min(m.colonists, st.pop)}/${st.pop} colonists`, st.research ? `🔬 ${RESEARCH_BY_ID[st.research].name}${hasResearch(st.research) ? ' ✓' : ''}` : ''].filter(Boolean).join(' · ');
  const bars = Object.entries(st.needs).map(([p, n]) => {
    const have = Math.min(n, m.terra.delivered[p] || 0);
    return `<div class="terra-part"><span>${PRODUCTS[p].icon} ${PRODUCTS[p].name}</span><span class="num">${have}/${n}</span><div class="bar"><div style="width:${(have / n) * 100}%"></div></div></div>`;
  }).join('');
  return `<div class="power-box terra-box ${terraUnlocked() ? 'open' : ''}"><div class="power-head"><span>🌍 Project Terraform · stage ${m.terra.stage + 1}/3</span><b>${st.icon} ${st.name}</b></div>
    <div class="power-note">${terraUnlocked() ? 'Unlocked: set aside 🌍 Terraform slots in the cargo plan (Next launch tab) and truck these parts to the Launch Site.' : `Unlocks at ${reqs}.`}<br>When done: <b>${st.effect}</b>.</div>${bars}</div>`;
}

// ---------- Winning ----------
function winGame() {
  if (state.won) return;
  const m = M();
  state.won = { at: state.clock, rockets: state.launch.count, colonists: m.colonists, earned: state.lifetime || 0, research: Object.keys(state.research).length, firstLaunch: state.firstLaunchAt || null };
  state.gems += 100;
  save();
  closePanel();
  playEndingAnimation(() => showVictory());
}

function showVictory() {
  const w = state.won;
  const hm = (s) => `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
  const legacy = state.legacy || 0;
  showMessage('🌍 Mars is alive. You win!', `<div class="victory">🏆</div>
    <p class="intro">From a rusty shed to a living world in <b>${hm(w.at)}</b> of play.</p>
    <div class="stats risk">
      <div class="stat-row"><span>🚀 Rockets launched</span><b>${w.rockets}</b></div>
      ${w.firstLaunch ? `<div class="stat-row"><span>First liftoff</span><b>${hm(w.firstLaunch)}</b></div>` : ''}
      <div class="stat-row"><span>👩‍🚀 Colonists on Mars</span><b>${w.colonists}</b></div>
      <div class="stat-row"><span>💰 Money earned</span><b>${fmt(w.earned)}</b></div>
      <div class="stat-row"><span>🔬 Research completed</span><b>${w.research}/${RESEARCH.length}</b></div>
      ${legacy ? `<div class="stat-row"><span>🔁 Legacy</span><b>Game ${legacy + 1}</b></div>` : ''}
    </div>
    <p class="intro small">+100 💎. Keep playing this world, or start <b>New Game+</b>: a fresh start with a permanent +${Math.round(LEGACY_BONUS * 100)}% package value per win (up to +${Math.round(LEGACY_BONUS * 500)}%), double starting cash, Sorting Systems researched, and your gems kept.</p>
    <button class="btn" style="width:100%;margin-bottom:8px" data-act="keepplaying">Keep playing</button>
    <button class="btn secondary" style="width:100%" data-act="newgameplus">🔁 Start New Game+</button>`, { noClose: true });
}

function newGamePlus() {
  const legacy = Math.min(5, (state.legacy || 0) + 1);
  const gems = state.gems;
  for (const k of Object.keys(runtime)) delete runtime[k];
  shipLog.length = 0;
  ledger.buckets.clear(); ledger.recent = []; ledger.session = {};
  state = newState();
  state.legacy = legacy;
  state.gems = gems;
  state.money = START_MONEY * 2;
  state.research = { sorter: true };
  state.tutorial = { active: false, step: 0, done: true };
  save();
  closePanel();
  refreshTopbar();
  openPanel('map');
  toast(`🔁 New Game+ (game ${legacy + 1}): packages worth +${Math.round(legacy * LEGACY_BONUS * 100)}%`);
}

function handleMarsAct(act, id) {
  const m = M();
  if (act === 'keepplaying') { closePanel(); return 'stop'; }
  if (act === 'newgameplus') { if (confirm('Start New Game+? This world is replaced by a fresh one with your legacy bonus.')) newGamePlus(); return 'stop'; }
  if (act === 'showvictory') { showVictory(); return 'stop'; }
  if (act === 'marstab') { ui.marsTab = id; return true; }
  if (act === 'marsmod') { m.manifest.module = id || null; save(); return true; }
  if (act === 'marsqty') {
    const [kind, d] = id.split('|');
    const cost = kind === 'colonists' ? MARS.slotColonist : 1;
    if (Number(d) > 0 && plannedSlots().total + cost > rocketSlots()) { toast(`📦 The rocket is full (${rocketSlots()} slots). Lower something else first`); return true; }
    m.manifest[kind] = Math.max(0, (m.manifest[kind] || 0) + Number(d));
    save();
    return true;
  }
  if (act === 'marslaunch') { marsLaunch(); return true; }
  if (act === 'marsemergency') { marsLaunch({ emergency: true }); return true; }
  if (act === 'marsmetals') { m.metalsTo = id; save(); return true; }
  if (act === 'marspad') {
    const next = PAD_LEVELS[m.padLevel];
    if (next && spend(next.cost, 'upgrades', 'Launch pad')) { m.padLevel++; toast(`🚧 Launch pad level ${m.padLevel + 1}: resets in ${fmtSecs(padTurnaround())}`); save(); }
    return true;
  }
  return false;
}
