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
  if (!m.kits) m.kits = {};
  if (!m.map) { // saves from before the base map: lay out what's already built
    m.map = marsMapFresh();
    for (const [k, n] of Object.entries(m.modules)) for (let i = 0; i < n; i++) {
      const at = autoSpot(m.map, k);
      if (at) m.map.b.push({ k, x: at[0], y: at[1], prog: 1, done: true }); else m.kits[k] = (m.kits[k] || 0) + 1;
    }
    syncMods(m);
  }
  if (!m.map.veined) addVeins(m.map);
  if (m.ore == null) { m.ore = m.metalsWaiting || 0; m.metalsWaiting = 0; }
  if (!m.kitHead) m.kitHead = {};
  if (!m.finds) m.finds = { regolith: 0, salvage: 0, ice: 0, crystal: 0 };
  if (m.rover == null) m.rover = 0;
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
const padTurnaround = () => Math.max(20, MARS.padTurnaround - rfx('marsTurn') - PAD_LEVELS.slice(0, M().padLevel).reduce((a, l) => a + l.cut, 0) - (cargoCenter() ? 30 : 0) - (mega('spaceport') ? 30 : 0));
const rocketSlots = () => MARS.slots + rfx('marsSlots') + (cargoCenter() ? 10 : 0) + (mega('orbital') ? 20 : 0) + (M().cargoBoost || 0);
const padRockets = () => MARS.padRockets + (mega('spaceport') ? 1 : 0);
const transitTime = () => Math.round(MARS.transit * (1 - rfx('marsTransit')));
const padBusy = () => Math.max(0, (M().padFreeAt || 0) - state.clock);
function marsWindowOpen() { const m = M(); return state.clock >= m.windowAt && state.clock < m.windowAt + MARS.windowOpen; }
function marsWindowIn() { const m = M(); return Math.max(0, m.windowAt - state.clock); }
function marsWindowLeft() { const m = M(); return Math.max(0, m.windowAt + MARS.windowOpen - state.clock); }

// ---------- Colony numbers ----------
const oreCap = () => MARS_STORE.lander + MARS_STORE.silo * modCount('silo'); // the Lander keeps a little; Ore Silos the rest
// ---------- The base map ----------
// Terrain: g ground, i ice (Ice Mines go here), r rock (nothing can be built). The Lander sits in the middle.
function marsMapFresh() {
  const { cols, rows } = MARS_MAP;
  const rnd = (n) => Math.floor(Math.random() * n);
  const lx = Math.floor(cols / 2), ly = Math.floor(rows / 2);
  const t = Array.from({ length: rows }, () => Array(cols).fill('g'));
  for (const [sx, sy] of [[1 + rnd(2), 1 + rnd(3)], [cols - 2 - rnd(2), rows - 2 - rnd(3)]]) { // two ice fields, opposite corners
    let x = sx, y = sy, n = 0;
    while (n < MARS_MAP.iceSize) {
      if (t[y][x] !== 'i') { t[y][x] = 'i'; n++; }
      const d = DIRS[rnd(4)];
      x = Math.max(0, Math.min(cols - 1, x + d.x)); y = Math.max(0, Math.min(rows - 1, y + d.y));
    }
  }
  for (let n = 0; n < MARS_MAP.rocks;) {
    const x = rnd(cols), y = rnd(rows);
    if (t[y][x] === 'g' && Math.max(Math.abs(x - lx), Math.abs(y - ly)) > 1) { t[y][x] = 'r'; n++; }
  }
  const map = { t, lander: { x: lx, y: ly }, b: [] };
  addVeins(map);
  return map;
}
// Metal veins (v): short runs of ore on open ground, away from the Lander. Old maps get them too.
function addVeins(map) {
  const rows = map.t.length, cols = map.t[0].length, rnd = (n) => Math.floor(Math.random() * n);
  const open = (x, y) => map.t[y][x] === 'g' && !buildingAt(map, x, y) && Math.max(Math.abs(x - map.lander.x), Math.abs(y - map.lander.y)) > 2;
  for (let v = 0, tries = 0; v < MARS_MAP.veins && tries < 400; tries++) {
    let x = rnd(cols), y = rnd(rows);
    if (!open(x, y)) continue;
    for (let n = 0, steps = 0; n < MARS_MAP.veinSize && steps < 40; steps++) {
      if (open(x, y)) { map.t[y][x] = 'v'; n++; }
      const d = DIRS[rnd(4)];
      x = Math.max(0, Math.min(cols - 1, x + d.x)); y = Math.max(0, Math.min(rows - 1, y + d.y));
    }
    v++;
  }
  map.veined = true;
}
const buildingAt = (map, x, y) => map.b.find((q) => q.x === x && q.y === y);
const isLander = (map, x, y) => map.lander.x === x && map.lander.y === y;
// Why a kit can't go here (or null when it can).
function placeProblem(map, k, x, y) {
  if (y < 0 || x < 0 || y >= map.t.length || x >= map.t[0].length) return 'Off the map';
  if (isLander(map, x, y)) return 'That is the Lander';
  if (map.t[y][x] === 'r') return 'Solid rock: nothing can be built here';
  if (buildingAt(map, x, y)) return 'Something is already here';
  if (k === 'icemine' && map.t[y][x] !== 'i') return 'Ice Mines must go on 🧊 ice';
  if (k === 'mine' && map.t[y][x] !== 'v') return 'Metal Mines must go on a 🟫 metal vein';
  return null;
}
const coversAt = (map, x, y) => map.b.some((q) => q.done && MARS_MAP.powerRange[q.k] && Math.max(Math.abs(q.x - x), Math.abs(q.y - y)) <= MARS_MAP.powerRange[q.k]);
const needsPower = (k) => MARS_POWERED.includes(k);
// The best free spot for a kit (auto-place, and old saves).
function autoSpot(map, k) {
  const { lander } = map;
  let best = null, bestScore = -Infinity;
  for (let y = 0; y < map.t.length; y++) for (let x = 0; x < map.t[0].length; x++) {
    if (placeProblem(map, k, x, y)) continue;
    let score = -Math.max(Math.abs(x - lander.x), Math.abs(y - lander.y));
    if (k !== 'icemine' && map.t[y][x] === 'i') score -= 50; // keep ice for Ice Mines
    if (k !== 'mine' && map.t[y][x] === 'v') score -= 50; // and veins for Metal Mines
    if (needsPower(k) && coversAt(map, x, y)) score += 100;
    const r = MARS_MAP.powerRange[k];
    if (r) { // power: reach unpowered buildings and open ground
      for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) {
        if (yy < 0 || xx < 0 || yy >= map.t.length || xx >= map.t[0].length || coversAt(map, xx, yy)) continue;
        const q = buildingAt(map, xx, yy);
        score += q && needsPower(q.k) ? 6 : !q && map.t[yy][xx] !== 'r' ? 1 : 0;
      }
    }
    if (score > bestScore) { bestScore = score; best = [x, y]; }
  }
  return best;
}
// How many tiles a kit of this kind could still go on.
function freeSpots(k) {
  const map = M().map;
  let n = 0;
  for (let y = 0; y < map.t.length; y++) for (let x = 0; x < map.t[0].length; x++) if (!placeProblem(map, k, x, y)) n++;
  return n;
}
// m.modules mirrors the finished buildings (counts by kind).
function syncMods(m) {
  m.modules = {};
  for (const q of m.map.b) if (q.done) m.modules[q.k] = (m.modules[q.k] || 0) + 1;
}
function placeKit(k, x, y) {
  const m = M();
  if (!(m.kits[k] > 0) || placeProblem(m.map, k, x, y)) return false;
  m.kits[k]--;
  const head = m.kitHead[k] > 0; // a relocated building keeps most of its work
  if (head) m.kitHead[k]--;
  m.map.b.push({ k, x, y, prog: head ? MARS_MAP.relocateKeep : 0, done: false });
  return true;
}
function autoPlaceKits() {
  const m = M();
  let n = 0;
  for (const k of Object.keys(MARS_MODULES)) while (m.kits[k] > 0) { const at = autoSpot(m.map, k); if (!at || !placeKit(k, at[0], at[1])) break; n++; }
  return n;
}
const constructionSpeed = () => { const c = marsCrew(); return (MARS_MAP.buildBase + c.engineer * MARS_MAP.buildPerEngineer + c.laborer * MARS_MAP.buildPerLaborer) * (1 + rfx('marsBuild')); };
// Colonists build one site at a time, in the order they were placed.
function stepConstruction(dt) {
  const m = M();
  const q = m.map.b.find((b) => !b.done);
  if (!q) return;
  q.prog = Math.min(1, q.prog + (dt * constructionSpeed()) / MARS_BUILD[q.k]);
  if (q.prog < 1) return;
  q.done = true;
  syncMods(m);
  const mm = MARS_MODULES[q.k];
  toast(`🏗️ Mars: ${mm.icon} ${mm.name} finished${needsPower(q.k) && !coversAt(m.map, q.x, q.y) ? ' · ⚠️ no power reaches it: build a ⚡ Solar Farm nearby' : ''}`);
  checkMilestones();
}

// ---------- Colony numbers ----------
const modCount = (k) => M().modules[k] || 0; // finished
const pendingCount = (k) => (M().kits[k] || 0) + M().map.b.filter((q) => q.k === k && !q.done).length; // landed, not finished yet
// Working modules: finished, powered if they need it, minus meteor damage.
const onlineCount = (k) => M().map.b.filter((q) => q.k === k && q.done && (!needsPower(k) || coversAt(M().map, q.x, q.y))).length;
const effMod = (k) => Math.max(0, onlineCount(k) - (M().damaged[k] || 0)); // damaged modules do nothing
const marsCap = () => (MARS.perHabitat + rfx('marsCap')) * effMod('habitat'); // homes in finished domes
const marsRoom = () => (MARS.perHabitat + rfx('marsCap')) * (modCount('habitat') + pendingCount('habitat')); // incl. domes still to build
const shelteringColonists = () => Math.max(0, M().colonists - awayCount() - marsCap()); // explorers out on a trip aren't in the Lander
const totalModules = () => Object.values(M().modules).reduce((a, b) => a + b, 0);
const inTransitColonists = () => M().flights.reduce((a, f) => a + (f.colonists || 0), 0);

// Power: solar (halved by dust; Power Cells help), fusion (immune). Share of powered modules running.
function marsPower() {
  const m = M();
  const dust = m.events.dust > 0;
  const solar = MARS.solarPower * effMod('solar') * (dust ? 0.5 : 1);
  const fusion = MARS.fusionPower * effMod('fusion');
  const demand = MARS_POWERED.reduce((a, k) => a + effMod(k), 0);
  const short = Math.max(0, demand - solar - fusion);
  const cells = dust ? Math.min(m.stock.power, Math.ceil(short / MARS.powerCellBoost)) : 0;
  const supply = solar + fusion + cells * MARS.powerCellBoost;
  return { supply, demand, cells, frac: demand ? Math.min(1, supply / demand) : 1 };
}

// What the colony needs from Earth each window.
function marsNeeds() {
  const m = M(), pw = marsPower().frac;
  const food = m.colonists * MARS.foodPerColonist * (1 - rfx('marsFood')) * Math.max(0, 1 - 0.25 * Math.min(3, staffedEff('greenhouse')) * pw);
  const water = m.colonists * MARS.waterPerColonist * (1 - rfx('marsWater')) * (m.terra && m.terra.stage >= 1 ? 0.5 : 1) * Math.max(0, 1 - 0.25 * Math.min(3, staffedEff('icemine')) * pw);
  const spares = MARS.sparesPerModule * (totalModules() - modCount('habitat') / 2) * (1 - rfx('marsSpares')); // domes need half the upkeep
  return { food: Math.ceil(food), water: Math.ceil(water), spares: Math.ceil(spares), med: m.events.sick ? 2 : 0, power: 0 };
}

// Things the Launch Site wants trucked in for the next flight.
function marsPadWants() {
  const m = M();
  const out = {};
  const cut = 1 - rfx('launchParts');
  const k = padRockets(); // stock for more than one launch, so a window can see several
  for (const [p, n] of Object.entries(VEHICLE)) out[p] = Math.max(1, Math.round(n * cut)) * k;
  if (m.manifest.module && MARS_MODULES[m.manifest.module]) {
    for (const [p, n] of Object.entries(MARS_MODULES[m.manifest.module].payload)) out[p] = (out[p] || 0) + n;
  }
  for (const [kind, prod] of Object.entries(SUPPLY_PRODUCT)) if (m.manifest[kind]) out[prod] = (out[prod] || 0) + m.manifest[kind] * k;
  // Terraform parts only once the next rocket itself is stocked: they share ingredients
  // (Turbopumps go into Engines), and a grounded rocket would starve the colony.
  if (m.manifest.terra && terraUnlocked() && vehicleReady()) {
    for (const [p, n] of Object.entries(terraRemaining())) if (n > 0) out[p] = (out[p] || 0) + Math.min(n, m.manifest.terra * k);
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
  if (k !== 'habitat' && !modCount('habitat') && !pendingCount('habitat') && !M().flights.some((f) => f.module === 'habitat')) return false; // live somewhere first
  if (mm.max && modCount(k) + pendingCount(k) + M().flights.filter((f) => f.module === k).length >= mm.max) return false;
  if ((k === 'mine' || k === 'icemine') && freeSpots(k) - (M().kits[k] || 0) - M().flights.filter((f) => f.module === k).length <= 0) return false; // no ore / ice left
  return true;
}
const payloadReady = (k) => Object.entries(MARS_MODULES[k].payload).every(([p, n]) => (state.launch.parts[p] || 0) >= n);
const emptyCargo = () => ({ module: null, colonists: 0, food: 0, water: 0, spares: 0, med: 0, power: 0 });

// Slots the cargo plan asks for (module + colonists who have room + supply crates).
function colonistRoom() {
  const m = M(), per = MARS.perHabitat + rfx('marsCap');
  return Math.max(0, marsRoom() + per * (m.manifest.module === 'habitat' ? 1 : 0) + per * m.flights.filter((f) => f.module === 'habitat').length - m.colonists - inTransitColonists());
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
    const capAfter = marsRoom() + (c.module === 'habitat' ? per : 0) + per * m.flights.filter((f) => f.module === 'habitat').length;
    const room = Math.max(0, capAfter - m.colonists - inTransitColonists());
    c.colonists = Math.min(m.manifest.colonists, room, Math.floor(left / MARS.slotColonist));
    left -= c.colonists * MARS.slotColonist;
  }
  // Supplies load one crate at a time, most urgent first, up to the manifest's numbers.
  const need = marsNeeds();
  if (m.events.meteor) need.spares += MARS.repairSpares - (m.events.fixed || 0); // a repair is waiting
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
  if (m.events.meteor) need.spares += MARS.repairSpares - (m.events.fixed || 0);
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

// One emergency drop per launch window (windowAt moves on once a window has passed).
const emergencyUsed = () => M().emergencyWin === M().windowAt;

// Rocket parts the pad is short of because their ingredients are being sent up as terraform parts.
function terraConflicts() {
  const m = M(), pad = state.launch.parts, cut = 1 - rfx('launchParts');
  if (!m.manifest.terra || !terraStage() || !terraUnlocked()) return [];
  const rem = terraRemaining(), out = [];
  for (const [p, n] of Object.entries(VEHICLE)) {
    const need = Math.max(1, Math.round(n * cut)) * padRockets();
    if ((pad[p] || 0) >= need || !RECIPES[p]) continue;
    for (const q of Object.keys(RECIPES[p].in)) if (rem[q] > 0 && (pad[q] || 0) > 0) out.push({ part: p, have: pad[p] || 0, need, via: q });
  }
  return out;
}

// A cargo rocket to Mars (regular), or a gem-paid emergency supply drop.
function marsLaunch(opts = {}) {
  const m = M();
  if (opts.emergency) {
    if (emergencyUsed()) { toast('🆘 One emergency drop per launch window'); return false; }
    if (state.gems < MARS.emergencyGems) { toast(`🆘 Needs ${MARS.emergencyGems} 💎`); return false; }
    const c = emergencyCargo();
    if (!c.used) { toast('🆘 No supply crates on the pad to send'); return false; }
    state.gems -= MARS.emergencyGems;
    m.emergencyWin = m.windowAt;
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
  const dt = Math.min(5, Math.max(0, state.clock - (m.builtAt || state.clock))); // never catch up a long gap
  m.builtAt = state.clock;
  stepConstruction(dt);
  stepDomes(dt);
  stepExpeditions();
  for (const f of m.flights.filter((q) => q.arriveAt <= state.clock)) marsArrive(f);
  m.flights = m.flights.filter((q) => q.arriveAt > state.clock);
  while (state.clock >= m.nextCycle) { marsCycle(); m.nextCycle += MARS.windowEvery; }
}

function marsArrive(f) {
  const m = M();
  const bits = [];
  if (f.module) {
    m.kits[f.module] = (m.kits[f.module] || 0) + 1;
    if (m.autoBuild) autoPlaceKits();
    bits.push(`${MARS_MODULES[f.module].icon} ${MARS_MODULES[f.module].name} kit landed${m.autoBuild ? ' (placed for you)' : ': place it in 🔴 Mars base'}`);
    if (f.module === 'habitat') { // each dome lands stocked for one window, so new arrivals don't start hungry
      m.stock.food += MARS.perHabitat; m.stock.water += MARS.perHabitat; m.stock.spares += 1;
    }
  }
  if (f.colonists) {
    const n = Math.min(f.colonists, Math.max(0, marsRoom() - m.colonists));
    m.colonists += n;
    if (n) bits.push(`👩‍🚀 ${n} colonist${n > 1 ? 's' : ''} landed`);
  }
  for (const kind of SUPPLY_KINDS) if (f[kind]) m.stock[kind] += f[kind];
  // The rocket refuels and flies home with ore, if there's a working Landing Pad.
  if (!f.emergency && effMod('pad') && m.ore > 0) {
    const n = Math.min(m.ore, MARS_STORE.returnPerRocket);
    m.ore -= n;
    shipMetals(n);
    bits.push(`🪨 ${n} Rare Metals flying home`);
  }
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
  if (n > 0) earn(n * PRODUCTS.raremetal.value * demandOf('raremetal') * (mega('exchange') ? 1.5 : 1), 'mars', `${n} Rare Metals`);
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
  // Meteor damage is repaired first, before the colony's upkeep takes its share of the spares.
  // Spares go toward the repair as they arrive, so a trickle still gets there.
  if (ev.meteor && m.stock.spares > 0 && marsCrew().engineer > 0) { // engineers do the repair
    const use = Math.min(m.stock.spares, MARS.repairSpares - (ev.fixed || 0));
    m.stock.spares -= use;
    ev.fixed = (ev.fixed || 0) + use;
    if (ev.fixed >= MARS.repairSpares) {
      m.damaged[ev.meteor] = Math.max(0, (m.damaged[ev.meteor] || 0) - 1);
      toast(`🔧 Mars: the ${MARS_MODULES[ev.meteor].name} is repaired`);
      ev.meteor = null;
      ev.fixed = 0;
    }
  }
  const need = marsNeeds();
  let short = false;
  for (const kind of ['food', 'water', 'spares']) {
    if (m.stock[kind] < need[kind]) short = true;
    m.stock[kind] = Math.max(0, m.stock[kind] - need[kind]);
  }
  if (ev.sick && m.stock.med >= 2) { m.stock.med -= 2; ev.sick = false; toast('💊 Mars: the sickness is treated'); }
  m.rations = short ? m.rations + 1 : 0;
  let mult = m.rations ? 0.5 + rfx('marsRation') : 1;
  if (ev.sick) mult *= 1 - 0.3 * (1 - rfx('marsRation'));
  const home = m.colonists - awayCount(); // explorers out on a trip don't work at the base
  const workers = home - shelteringColonists() * (1 - MARS_MAP.shelterOutput); // waiting for a dome: half pace
  const morale = marsMorale().value, mm = 0.5 + 0.5 * morale;
  mult *= mm;
  const stars = Math.round(workers * (1 + 0.5 * Math.min(1, staffedEff('station')) * pw.frac) * mult * MARS.starsPerColonist * (1 + rfx('marsOutput')));
  // Laborers scavenge ore; miners dig the rest.
  const dig = MARS_CREW.metalsPerLaborer * marsCrew().laborer * (home ? workers / home : 0) + MARS_CREW.metalsPerMiner * MARS_JOBS.miner.per * staffedEff('mine') * pw.frac;
  let metals = Math.round(dig * mult * (1 + rfx('marsMetals') + rfx('marsOutput')));
  // Workshops turn some of it into Spares on the spot.
  const made = Math.min(Math.floor(MARS_CREW.sparesPerWorkshop * staffedEff('workshop') * pw.frac), Math.floor(metals / MARS_CREW.metalsPerSpare));
  if (made > 0) { m.stock.spares += made; metals -= made * MARS_CREW.metalsPerSpare; }
  const gems = Math.floor(m.colonists / 10);
  state.rep += stars;
  state.gems += gems;
  const stored = Math.min(metals, Math.max(0, oreCap() - m.ore));
  m.ore += stored;
  const lost = metals - stored; // nowhere to keep it
  let left = 0;
  if (m.rations >= MARS.rationsBeforeLeaving && home > MARS.minColonists) { m.colonists--; left = 1; }
  else if (morale < MARS_MORALE.leaveBelow && home > MARS.minColonists) { m.colonists--; left = 1; } // unhappy people go home too
  m.last = { need, short, stars, metals, gems, left, made, morale, lost };
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
      toast(`☄️ Meteor strike! The ${MARS_MODULES[ev.meteor].name} is offline until ${MARS.repairSpares} 🔧 Spares Kits reach the colony`);
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
  toast(`🔴 Mars window: colony used ${cargoText(need) || 'nothing'}${short ? ' · ⚠️ rationing' : ''} · made +${stars} ⭐ · 🪨 ${stored} ore stored${lost ? ` (${lost} lost: storage full, build an 🛢️ Ore Silo)` : ''}${made ? ` · 🔧 ${made} Spares made` : ''}${left ? ' · 1 colonist went home' : ''}`);
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
    <button class="tab ${tab === 'base' ? 'on' : ''}" data-act="marstab" data-id="base">🔴 Mars base</button>
    <button class="tab ${tab === 'explore' ? 'on' : ''}" data-act="marstab" data-id="explore">🧭 Explore</button></div>`;
  return html + (tab === 'base' ? marsBaseHTML() : tab === 'explore' ? exploreHTML() : marsLaunchHTML());
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
  const plural = (p) => PRODUCTS[p].name + (PRODUCTS[p].name.endsWith('s') ? '' : 's');
  if (m.events.meteor) {
    const mm = MARS_MODULES[m.events.meteor];
    html += `<div class="mars-warn">☄️ <b>${mm.icon} ${mm.name} offline</b> after a meteor strike. Repair: ${m.events.fixed || 0}/${MARS.repairSpares} 🔧 Spares Kits (they go to the repair first, as they land)${m.events.meteor === 'pad' && m.ore ? `; ${m.ore} 🪨 Rare Metals are waiting to come home` : ''}.</div>`;
  }
  if (m.manifest.module && m.manifest.terra && terraUnlocked()) {
    const mm = MARS_MODULES[m.manifest.module], rem = terraRemaining();
    const clash = Object.entries(mm.payload).filter(([p]) => rem[p] > 0);
    if (clash.length) html += `<div class="mars-warn">⚠️ <b>${mm.icon} ${mm.name}</b> uses ${clash.map(([p, n]) => `${n} ${PRODUCTS[p].icon} ${n > 1 ? plural(p) : PRODUCTS[p].name}`).join(' and ')} that Terraform also needs (${clash.map(([p]) => `${rem[p]} ${PRODUCTS[p].icon}`).join(', ')} still to go). Pick another module, or No module, to send them to Terraform first.</div>`;
  }
  for (const w of terraConflicts()) {
    const maker = PROPERTIES.find((d) => state.props[d.id].owned && state.props[d.id].tiles.some((row) => row.some((t) => t.obj && t.obj.k === 'assembler' && t.obj.recipe === w.part)));
    html += `<div class="mars-warn">⚠️ <b>Short on ${PRODUCTS[w.part].icon} ${plural(w.part)}</b> (${w.have}/${w.need} for the next ${padRockets()} rockets). They're built from ${PRODUCTS[w.via].icon} ${plural(w.via)}, which are also going up as terraform parts (${pad[w.via] || 0} on the pad). Send more ${plural(w.via)} to ${maker ? `the ${maker.name}` : `an assembler making ${plural(w.part)}`}, or carry fewer terraform parts.</div>`;
  }
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
    html += step('terra', `🌍 Terraform parts <span class="muted small">(${st.icon} ${st.name})</span>`, terraUnlocked() ? `${onPad} on pad${vehicleReady() ? '' : ' · rocket first'}` : '🔒 locked');
    if (!terraUnlocked()) html += `<p class="intro small">🌍 ${st.name} unlocks at ${st.pop} colonists${st.research ? ` and ${RESEARCH_BY_ID[st.research].name} research` : ''}.</p>`;
  }
  html += `<p class="intro small">This launch would carry: <b>${cargoText(c) || 'nothing yet'}</b>.</p>`;
  const busy = padBusy();
  html += `<button class="btn launch" data-act="marslaunch" ${open && vehicleReady() && !busy ? '' : 'disabled'}>${!vehicleReady() ? '🚀 Rocket needs parts' : !open ? `🪐 Window opens in ${fmtSecs(marsWindowIn())}` : busy ? `🚧 Pad resetting · ${fmtSecs(busy)}` : '🚀 Launch to Mars'}</button>`;
  html += `<div class="choice"><span class="ctl-lbl">Launch</span>
    <button class="chip ${state.launch.auto ? 'on' : ''}" data-act="autolaunch" data-id="on">🔁 Automatically each window</button>
    <button class="chip ${!state.launch.auto ? 'on' : ''}" data-act="autolaunch" data-id="off">👆 When I press Launch</button></div>`;
  html += `<button class="btn secondary" style="width:100%;margin-top:6px" data-act="marsemergency" ${state.gems >= MARS.emergencyGems && !emergencyUsed() ? '' : 'disabled'}>${emergencyUsed() ? `🆘 Emergency drop used · next after this window` : `🆘 Emergency supply drop now · up to ${MARS.emergencySlots} crates · ${MARS.emergencyGems} 💎`}</button>`;
  html += `<p class="intro small">Emergency drops skip the rocket and the window: one per launch window.</p>`;
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
  const badges = [m.rations ? `<span class="neg">rationing (${m.rations})</span>` : '', ev.dust ? `🌪️ dust storm (${ev.dust})` : '', ev.meteor ? '☄️ meteor damage' : '', ev.sick ? '🦠 sickness' : ''].filter(Boolean).join(' · ');
  const shelter = shelteringColonists();
  let html = `<div class="mars-pop-row">👩‍🚀 <b>${m.colonists}</b> colonists · 🏠 homes for ${marsCap()}${shelter ? ` · <span class="warn-text">${shelter} sheltering in the Lander (half pace)</span>` : ''}${badges ? ` · ${badges}` : ''}</div>`;
  html += marsMapHTML();
  html += marsCrewHTML();
  html += terraHTML();
  // Active events and what fixes them
  for (const [k, on] of [['dust', ev.dust], ['meteor', ev.meteor], ['sick', ev.sick]]) {
    if (!on) continue;
    const e = MARS_EVENTS[k];
    html += `<div class="power-box over"><div class="power-head"><span>${e.icon} ${e.name}${k === 'meteor' ? `: ${MARS_MODULES[ev.meteor].name} · repair ${ev.fixed || 0}/${MARS.repairSpares} 🔧` : ''}</span></div><div class="power-note">${e.desc}</div></div>`;
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
    <div class="stat-row"><span>🪨 Ore in storage</span><b>${m.ore} / ${oreCap()}${!effMod('pad') ? ` · ${modCount('pad') ? 'Landing Pad damaged' : 'needs a 🛬 Landing Pad to fly home'}` : ` · up to ${MARS_STORE.returnPerRocket} per rocket home`}</b></div>
    <div class="stat-row"><span>🪨 Rare Metals shipped home</span><b>${m.metalsTotal}</b></div></div>`;
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

// The way to the base, with what's waiting there.
function marsGoButton() {
  const m = M(), kits = Object.values(m.kits).reduce((x, y) => x + y, 0), q = m.map.b.find((b) => !b.done);
  return `<button class="btn mars-btn" data-act="gomars">🔴 Go to Mars base${kits ? ` · 📦 ${kits} kit${kits > 1 ? 's' : ''} to place` : q ? ` · 🏗️ building ${MARS_MODULES[q.k].name}` : ''}</button>`;
}

function marsMapHTML() {
  const m = M(), map = m.map;
  let html = marsGoButton();
  const kits = Object.keys(MARS_MODULES).filter((k) => m.kits[k] > 0);
  if (kits.length) html += `<p class="intro small">📦 Waiting on the ground: ${kits.map((k) => `${MARS_MODULES[k].icon} ${MARS_MODULES[k].name} ×${m.kits[k]}`).join(', ')}. Go to the base and use 🏗️ Build to place them.</p>`;
  html += `<div class="choice"><span class="ctl-lbl">New kits</span>
    <button class="chip ${!m.autoBuild ? 'on' : ''}" data-act="marsautobuild" data-id="off">👆 I place them</button>
    <button class="chip ${m.autoBuild ? 'on' : ''}" data-act="marsautobuild" data-id="on">✨ Place automatically</button></div>`;
  const queue = map.b.filter((q) => !q.done);
  if (queue.length) {
    const speed = constructionSpeed();
    let wait = 0;
    html += `<h3 class="sec">🏗️ Under construction</h3>` + queue.map((q, i) => {
      const mm = MARS_MODULES[q.k], left = ((1 - q.prog) * MARS_BUILD[q.k]) / speed;
      wait += left;
      return `<div class="truck-row ${i ? '' : 'go'}"><span class="tr-ic">${mm.icon}</span><div class="tr-body">
        <div class="tr-text">${mm.name} · ${i ? `queued, done in ${fmtSecs(wait)}` : `${Math.round(q.prog * 100)}% · ${fmtSecs(left)} left`}</div>
        <div class="bar tr-bar"><div style="width:${Math.round(q.prog * 100)}%"></div></div></div></div>`;
    }).join('') + `<p class="intro small">Builders work at ${speed.toFixed(1)}× (more colonists and 🤖 Repair Drones research build faster).</p>`;
  }
  const built = Object.keys(MARS_MODULES).filter((k) => modCount(k));
  if (built.length) html += `<p class="intro small">Built: ${built.map((k) => { const on = onlineCount(k), n = modCount(k); return `${MARS_MODULES[k].icon} ${n}${on < n ? ` <span class="warn-text">(${n - on} without power)</span>` : ''}`; }).join(' · ')}</p>`;
  return html;
}

function handleMarsTile(id) {
  const m = M(), [x, y] = id.split(',').map(Number), map = m.map;
  const q = buildingAt(map, x, y);
  if (isLander(map, x, y)) { toast(`🛸 The Lander: where rockets set down. Colonists without a finished dome shelter here (${shelteringColonists()} now)`); return true; }
  if (q) {
    const mm = MARS_MODULES[q.k];
    if (!q.done) { toast(`🏗️ ${mm.icon} ${mm.name}: ${Math.round(q.prog * 100)}% built${q.prog === 0 ? ' · 📦 Move can still shift it' : ''}`); return true; }
    const off = needsPower(q.k) && !coversAt(map, x, y);
    const job = Object.keys(MARS_JOBS).find((j) => MARS_JOBS[j].at === q.k);
    const staff = job && !off ? ` · ${MARS_JOBS[job].icon} ${Math.round(staffPct(q.k) * 100)}% staffed (${MARS_JOBS[job].per} ${MARS_JOBS[job].name.toLowerCase()} each)` : '';
    const dust = q.k === 'habitat' ? ` · ${(q.dirt || 0) >= 50 ? '🟤' : '✨'} ${Math.round(q.dirt || 0)}% dusty` : '';
    toast(`${mm.icon} ${mm.name}: ${mm.desc}${off ? ' · 🔌 offline: no ⚡ power reaches it' : ''}${staff}${dust}${MARS_MAP.powerRange[q.k] ? ` · powers everything within ${MARS_MAP.powerRange[q.k]} tiles` : ''}`);
    return true;
  }
  const ter = map.t[y][x];
  toast(ter === 'r' ? '🪨 Solid rock' : ter === 'i' ? '🧊 Ice: the only place an Ice Mine can go' : ter === 'v' ? '🟫 Metal vein: the only place a ⛏️ Metal Mine can go' : 'Open ground');
  return true;
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
  if (act === 'gomars') { goMars(); return 'stop'; }
  if (handleCrewAct(act, id)) return true;
  if (handleExploreAct(act, id)) return true;
  const info = handleMarsInfoAct(act, id);
  if (info) return info;
  if (act === 'marsautobuild') { m.autoBuild = id === 'on'; if (m.autoBuild) autoPlaceKits(); save(); return true; }
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
