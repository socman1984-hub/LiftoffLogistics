'use strict';
// Game state: creation, layout generation, persistence, cost/effect helpers.

const SAVE_KEY = 'conveyor-tycoon-v1';
const START_MONEY = 3000; // enough to follow the tutorial without waiting

let state = null;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Tile: { base: 'wall'|'broken'|'floor'|'pillar'|'in'|'out', dir?, locked?, price?, obj? }
// obj:  { k: 'belt'|'splitter'|'sorter'|<machine id>, dir, tier?, rr?, filter?, side?, wear?, life?, jammed? }
function generateTiles(def) {
  const rnd = mulberry32(hashStr(def.id));
  const tiles = [];
  for (let y = 0; y < def.rows; y++) {
    const row = [];
    for (let x = 0; x < def.cols; x++) {
      const edge = x === 0 || y === 0 || x === def.cols - 1 || y === def.rows - 1;
      if (edge) row.push({ base: 'wall' });
      else row.push({ base: rnd() < def.brokenPct ? 'broken' : 'floor' });
    }
    tiles.push(row);
  }
  for (const [x, y] of def.pillars) tiles[y][x] = { base: 'pillar' };
  for (const d of def.inDocks) {
    tiles[d.y][d.x] = { base: 'in', dir: d.dir, locked: d.price > 0, price: d.price };
  }
  for (const d of def.outDocks) {
    tiles[d.y][d.x] = { base: 'out', locked: d.price > 0, price: d.price };
  }
  return tiles;
}

function newPropState(def) {
  return {
    owned: false,
    tiles: generateTiles(def),
    upgrades: { trucks: 0, roof: 0, power: 0 },
    staff: Object.fromEntries(STAFF.map((s) => [s.id, 0])), // headcount per role
    payRate: 0, // index into PAY_RATES
    earned: 0,
    shipped: {}, // cargo type -> count
    broken: 0, // fragile packages smashed
    jams: 0, // equipment breakdowns
    stolen: 0,
    accidents: 0,
    routes: {}, // (v4, migrated into plans)
    plans: {}, // product -> { dests: [{ to: 'sell'|site, w: weight, cap: 0|max stock }], overflow: 'sell'|'hold' }
    outbox: {}, // site id -> { product: count } waiting for a truck
    inbox: {}, // product -> count delivered here, waiting at the receiving dock
    held: {}, // product -> count in storage, waiting for a destination with room
    made: {}, // product -> count assembled here
    sent: 0, // packages trucked to other sites
  };
}

function newState() {
  const props = {};
  for (const def of PROPERTIES) props[def.id] = newPropState(def);
  return {
    money: START_MONEY,
    rep: 0, // ⭐ reputation, earned from contracts, spent on research
    research: {},
    lab: null, // research in progress: { id, left } (seconds)
    contracts: { offers: [], active: [], done: 0, nextId: 1, nextOfferAt: 0 },
    fleet: {}, // 'from>to' -> { trucks (assigned), wait, units: [{ phase, t, load, n }] }
    garage: { trucks: 0 }, // trucks you own (assigned + idle)
    launch: { owned: false, parts: {}, count: 0 }, // count = rockets launched
    market: { demand: {}, event: null, nextEventAt: 150 }, // demand: product -> 0.35..1
    gems: GEMS.start, // 💎 premium currency
    boosts: {}, // boost id -> game clock time it runs until
    awayBoost: 0, // seconds of full-speed offline earnings banked (Night Crew)
    lastDaily: null, // date string of the last daily gem bonus
    clock: 0, // game-time seconds (only advances while playing)
    props,
    current: null,
    objective: 0,
    v4: true,
    v6: true,
    tutorial: { active: true, step: 0 }, // guided intro for new players
    lastRate: 0,
    savedAt: Date.now(),
  };
}

// Bring older saves up to the current shape.
function migrate(s) {
  const wasV4 = !!s.v4; // read before defaults are filled in below
  const wasV6 = !!s.v6;
  if (!s.tutorial) s.tutorial = { active: false, step: 0 }; // existing players: off (restart from Help)
  const fresh = newState();
  for (const k of Object.keys(fresh)) if (s[k] === undefined) s[k] = fresh[k];
  for (const def of PROPERTIES) {
    if (!s.props[def.id]) { s.props[def.id] = newPropState(def); continue; }
    const p = s.props[def.id];
    const np = newPropState(def);
    for (const k of Object.keys(np)) if (p[k] === undefined) p[k] = np[k];
    // v2 staff were on/off flags; convert to headcounts.
    const old = p.staff;
    if (typeof old.mechanic === 'boolean' || typeof old.supervisor === 'boolean') {
      p.staff = np.staff;
      p.staff.tech = old.mechanic ? 1 : 0;
      p.staff.ops = old.supervisor ? 1 : 0;
      p.staff.sales = old.sales ? 1 : 0;
    }
    for (const st of STAFF) if (typeof p.staff[st.id] !== 'number') p.staff[st.id] = 0;
    for (const u of UPGRADES) if (typeof p.upgrades[u.id] !== 'number') p.upgrades[u.id] = 0;
    // v4: receiving docks are free and open.
    for (const d of def.inDocks) if (d.price === 0 && p.tiles[d.y][d.x].base === 'in') p.tiles[d.y][d.x].locked = false;
  }
  // v6: single-destination routes become distribution plans; trucks become
  // an owned fleet assigned to routes.
  if (!wasV6) {
    let owned = 0;
    for (const f of Object.values(s.fleet)) { owned += f.trucks || 0; if (!f.wait) f.wait = '10s'; }
    s.garage = { trucks: Math.max(s.garage ? s.garage.trucks : 0, owned) };
    for (const def of PROPERTIES) {
      const p = s.props[def.id];
      for (const [prod, to] of Object.entries(p.routes || {})) {
        if (to && to !== 'sell' && !p.plans[prod]) p.plans[prod] = { dests: [{ to, w: 1, cap: 0 }], overflow: 'sell' };
      }
    }
    s.objective = 0;
  }
  // v7: the site-wide "Taller Racks" upgrade became per-rack levels.
  for (const def of PROPERTIES) {
    const p = s.props[def.id];
    const lv = p.upgrades && p.upgrades.racking;
    if (!lv) continue;
    const per = 15 + 5 * lv; // what each rack held before
    const lvl = RACK.levels.findIndex((c) => c >= per) + 1 || RACK.levels.length;
    for (const row of p.tiles) for (const t of row) if (t.obj && t.obj.k === 'rack') t.obj.lvl = Math.max(t.obj.lvl || 1, lvl);
    delete p.upgrades.racking;
  }
  // v4: the goal list changed; re-walk it (finished goals skip themselves).
  if (!wasV4) s.objective = 0;
  // v4: contracts are per product now; drop older cargo-type contracts.
  s.contracts.offers = s.contracts.offers.filter((c) => c.product);
  s.contracts.active = s.contracts.active.filter((c) => c.product);
  return s;
}

// ---- Runtime (not persisted): items in flight, timers, sales log ----
const runtime = {}; // propId -> { items, occ, timers, sales, floaters, time, unpaid, techs, shutdown }
const shipLog = []; // { t: state.clock, type } for estimating contract sizes

function initRuntime(id) {
  const def = PROP_BY_ID[id];
  const occ = [];
  for (let y = 0; y < def.rows; y++) occ.push(new Array(def.cols).fill(null));
  runtime[id] = {
    items: [], occ, timers: {}, sales: [], costs: [], floaters: [], time: 0, unpaid: false,
    workers: [], // staff walking the floor (see workers.js)
    alerts: {}, // problems to show the player: key -> { text, x, y, t }
    crewed: new Map(), // assembler 'x,y' -> operators working at it
    shutdown: 0, // seconds left on an accident stoppage
  };
  return runtime[id];
}

function rt(id) {
  return runtime[id] || initRuntime(id);
}

// ---- Persistence ----
function save() {
  if (!state) return;
  state.savedAt = Date.now();
  state.lastRate = netRate();
  state.lastRates = {};
  for (const def of PROPERTIES) if (state.props[def.id].owned) state.lastRates[def.id] = propNet(def.id);
  state.snap = snapshotRuntime();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (e) { /* storage unavailable — play continues unsaved */ }
}

// ---- Live-floor snapshot ----
// Workers, packages on the belts and the last 30s of sales/costs normally
// live only in memory. Saving a small snapshot lets a reload pick up where
// you left off instead of starting from an empty floor (and a negative $/min).
const r1 = (v) => Math.round(v * 10) / 10;
function snapshotRuntime() {
  const sites = {};
  for (const def of PROPERTIES) {
    const r = runtime[def.id];
    if (!r || !state.props[def.id].owned) continue;
    sites[def.id] = {
      sales: r.sales.filter((s) => s.t >= r.time - 30).map((s) => [r1(r.time - s.t), r1(s.v)]),
      costs: r.costs.filter((c) => c.t >= r.time - 30).map((c) => [r1(r.time - c.t), r1(c.v)]),
      workers: r.workers.map((w) => [w.role, w.name, Math.round(w.x), Math.round(w.y), Math.round(w.breakIn || 60)]),
      carried: r.workers.filter((w) => w.carry).map((w) => [w.carry.p, w.carry.n]),
      items: r.items.filter((it) => !it.dead).map((it) => [it.product, it.x, it.y, r1(it.p), it.fromDir, it.outDir, r1(it.value), r1(it.fresh), it.tags.join(','), it.processed ? 1 : 0]),
    };
  }
  const buckets = [];
  for (const [sec, b] of ledger.buckets) buckets.push([sec, b]);
  return { sites, ledger: { buckets, recent: ledger.recent } };
}

function restoreRuntime(snap) {
  if (!snap) return;
  for (const [id, s] of Object.entries(snap.sites || {})) {
    const def = PROP_BY_ID[id], prop = state.props[id];
    if (!def || !prop || !prop.owned) continue;
    const r = rt(id);
    r.sales = (s.sales || []).map(([age, v]) => ({ t: r.time - age, v }));
    r.costs = (s.costs || []).map(([age, v]) => ({ t: r.time - age, v }));
    for (const [p, n] of s.carried || []) if (PRODUCTS[p]) prop.held[p] = (prop.held[p] || 0) + n; // loads on forklifts go back on the racks
    for (const [role, name, x, y, breakIn] of s.workers || []) {
      if (!STAFF_BY_ID[role] || !prop.tiles[y] || !prop.tiles[y][x]) continue;
      r.workers.push({ id: nextWorkerId++, role, name, x, y, fx: x, fy: y, path: [], mode: 'idle', breakIn, wait: 0 });
    }
    for (const [product, x, y, p, fromDir, outDir, value, fresh, tags, processed] of s.items || []) {
      const t = prop.tiles[y] && prop.tiles[y][x];
      // Only put packages back where the layout still carries them.
      if (!PRODUCTS[product] || !t || r.occ[y][x] || !(t.obj || t.base === 'in')) continue;
      if (t.obj && (t.obj.k === 'assembler' || t.obj.k === 'rack' || FACILITIES[t.obj.k])) continue;
      const it = makeItem(product, x, y, p, fromDir, outDir);
      it.value = value; it.fresh = fresh; it.tags = tags ? tags.split(',') : []; it.processed = !!processed;
      r.items.push(it);
      r.occ[y][x] = it;
    }
  }
  if (snap.ledger) {
    for (const [sec, b] of snap.ledger.buckets || []) ledger.buckets.set(sec, b);
    ledger.recent = snap.ledger.recent || [];
  }
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return migrate(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

function resetGame() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  for (const k of Object.keys(runtime)) delete runtime[k];
  shipLog.length = 0;
  state = newState();
}

// ---- Cost / effect helpers ----
function curDef() { return state.current ? PROP_BY_ID[state.current] : null; }
function curProp() { return state.current ? state.props[state.current] : null; }
function hasResearch(id) { return !!state.research[id]; }

// Sum of a research effect over everything researched (cached until research changes).
let fxCache = null, fxFor = null, fxCount = -1;
function rfx(key) {
  const n = Object.keys(state.research).length;
  if (fxFor !== state.research || fxCount !== n) {
    fxCache = {};
    for (const r of RESEARCH) if (state.research[r.id]) for (const [k, v] of Object.entries(r.fx)) fxCache[k] = (fxCache[k] || 0) + v;
    fxFor = state.research;
    fxCount = n;
  }
  return fxCache[key] || 0;
}
const researchMet = (r) => r.req.every(hasResearch);

function costDiscount() { return 1 - rfx('discount'); }

function buildCost(kind, def, tier = 0) {
  const m = def.costMult * costDiscount();
  if (kind === 'belt') return Math.round(BELT_TIERS[tier].cost * m);
  if (kind === 'splitter') return Math.round(SPLITTER.cost * m);
  if (kind === 'sorter') return Math.round(SORTER.cost * m);
  if (kind === 'assembler') return Math.round(ASSEMBLER.cost * m);
  if (kind === 'rack') return Math.round(RACK.cost * m);
  if (FACILITIES[kind]) return Math.round(FACILITIES[kind].cost * m);
  return Math.round(MACHINES[kind].cost * m);
}

function upgradeCost(u, level, def) {
  return Math.round(u.base * def.costMult * Math.pow(u.growth, level) * costDiscount());
}

// Working headcount for a role (0 while wages are unpaid).
// Racks and facilities on a site's floor, cached until something is built/removed.
function layoutOf(id) {
  const r = rt(id);
  if (r.layout && !r.layoutDirty) return r.layout;
  const L = { racks: 0, rackSlots: 0, fac: {}, rackObjs: [], filtered: false };
  for (const row of state.props[id].tiles) {
    for (const t of row) {
      if (!t.obj) continue;
      if (t.obj.k === 'rack') {
        L.racks++; L.rackSlots += rackCapOf(t.obj); L.rackObjs.push(t.obj);
        if (t.obj.allow) L.filtered = true;
      }
      else if (FACILITIES[t.obj.k] && (t.obj.dirt || 0) < DIRT.filthy) L.fac[t.obj.k] = (L.fac[t.obj.k] || 0) + 1; // filthy = out of order
    }
  }
  r.layout = L;
  r.layoutDirty = false;
  return L;
}
const facCount = (id, type) => layoutOf(id).fac[type] || 0;
const markLayoutDirty = (id) => { rt(id).layoutDirty = true; };

// Staff morale: 1.0 with enough restrooms and break rooms, lower without.
function moraleOf(id) {
  const prop = state.props[id];
  const staff = totalStaff(prop);
  if (!staff) return 1;
  // Computed once a second by the workers (see computeMorale).
  if (runtime[id] && runtime[id].morale != null) return runtime[id].morale;
  let m = 1;
  const needR = Math.ceil(staff / STAFF_PER_RESTROOM);
  const needB = Math.ceil(staff / STAFF_PER_BREAKROOM);
  m -= 0.3 * Math.max(0, needR - facCount(id, 'restroom')) / needR;
  m -= 0.15 * Math.max(0, needB - facCount(id, 'breakroom')) / needB;
  return Math.max(0.55, m);
}

// Effective headcount for a role: 0 while unpaid, scaled by morale.
// How hard staff work: 40% pace at rock-bottom morale, 100% when happy.
const workPace = (id) => 0.4 + 0.6 * moraleOf(id);

function staffCount(id, prop, who) {
  if (runtime[id] && runtime[id].unpaid) return 0;
  return (prop.staff[who] || 0) * workPace(id);
}

function totalStaff(prop) {
  let n = 0;
  for (const s of STAFF) n += prop.staff[s.id] || 0;
  return n;
}

function truckInterval(id, prop) {
  return BASE_TRUCK_INTERVAL * Math.pow(0.85, prop.upgrades.trucks) * (1 - Math.min(0.6, rfx('truckRate')));
}

// Rack moves per minute this site's crew can handle.
function handlingRate(id) {
  const prop = state.props[id];
  const blocked = runtime[id] && runtime[id].racksBlocked; // forklifts can't reach the racks
  return (HANDLING_BASE + (blocked ? 0 : HANDLING_PER_OP * staffCount(id, prop, 'forklift')))
    * (1 + 0.15 * staffCount(id, prop, 'ops')) * (1 + 0.25 * facCount(id, 'opscenter')) * (1 + rfx('handling'));
}

function valueMult(id, prop) {
  return 1 + 0.25 * prop.upgrades.roof
    + 0.1 * staffCount(id, prop, 'sales')
    + rfx('value');
}

function speedMult(id, prop) {
  return 1 + 0.05 * prop.upgrades.power + 0.1 * staffCount(id, prop, 'ops') + 0.1 * facCount(id, 'opscenter') + rfx('speed');
}

// ---- Power ----
function powerCap(id) {
  return (PROP_BY_ID[id].power + POWER_PER_LEVEL * state.props[id].upgrades.power
    - FACILITIES.generator.power * facCount(id, 'generator')) * (1 + rfx('powerCap'));
}

function powerDraw(id) {
  let sum = 0;
  for (const row of state.props[id].tiles) {
    for (const t of row) {
      if (!t.obj) continue;
      const f = FACILITIES[t.obj.k];
      sum += f ? Math.max(0, f.power) : POWER_DRAW[t.obj.k] || 0;
    }
  }
  return sum * (1 - rfx('power'));
}

// Machines and assemblers slow down when a site draws more than it has.
function powerFactor(id) {
  const draw = powerDraw(id);
  return draw <= 0 ? 1 : Math.min(1, powerCap(id) / draw);
}

// ---- Market & boosts ----
const boostActive = (b) => (state.boosts[b] || 0) > state.clock;

function demandOf(p) {
  const d = state.market.demand[p];
  return d == null ? 1 : d;
}

function eventMult(p) {
  const e = state.market.event;
  return e && e.product === p && e.until > state.clock ? e.mult : 1;
}

// How much one sale lowers a product's price (Export Markets softens it).
function marketDrop(p) { return MARKET.drop[productTier(p)] * (1 - rfx('marketDrop')); }

function marketPrice(p) {
  return PRODUCTS[p].value * demandOf(p) * eventMult(p);
}

function supplierCost(p) {
  return PRODUCTS[p].cost * (1 - rfx('supplier'));
}

// Staff cost more at bigger sites, but less steeply than buildings do.
const wageMult = (def) => Math.pow(def.costMult, 0.8);

// Wage for one person in role `s` at a property.
function staffWage(s, def, prop) {
  const hr = prop && s.id !== 'hr' && prop.staff.hr > 0 ? 0.8 : 1;
  const pay = prop ? PAY_RATES[prop.payRate || 0].mult : 1;
  return s.wage * wageMult(def) * (1 - rfx('wage')) * hr * pay;
}

function wagesPerMin(id) {
  const def = PROP_BY_ID[id];
  const prop = state.props[id];
  let sum = 0;
  for (const s of STAFF) sum += (prop.staff[s.id] || 0) * staffWage(s, def, prop);
  return sum;
}

function theftChance(id, prop) {
  return PROP_BY_ID[id].theft * Math.pow(0.5, staffCount(id, prop, 'security') + facCount(id, 'securitybooth')) * (1 - rfx('theft'));
}

function accidentsPerMin(id, prop) {
  return ACCIDENT_RATE * totalStaff(prop) * Math.pow(0.25, staffCount(id, prop, 'safety'))
    * Math.pow(0.5, facCount(id, 'firstaid')) * (2 - moraleOf(id)) * (1 - rfx('accident'));
}

// Machines and conveyors that wear out (racks and facilities don't).
function equipmentCount(prop) {
  let n = 0;
  for (const row of prop.tiles) for (const t of row) if (t.obj && t.obj.k !== 'rack' && !FACILITIES[t.obj.k]) n++;
  return n;
}

function techsNeeded(prop) {
  const n = equipmentCount(prop);
  return n ? Math.ceil(n / EQUIP_PER_TECH) : 0;
}

// 0..1: how well maintenance staff cover this building's equipment.
function maintCoverage(prop) {
  const need = techsNeeded(prop);
  return need ? Math.min(1, prop.staff.tech / need) : 1;
}

function contractSlots() {
  return 1 + rfx('slots');
}

function offlineRate() { return OFFLINE_BASE_RATE + rfx('offline'); }
function offlineCapSec() { return (8 + rfx('offlineHours')) * 3600; }

// ---- Ledger: every money change is booked by category ----
const LEDGER_CATS = {
  sales: { label: 'Sales', icon: '💰' },
  contracts: { label: 'Contracts', icon: '📋' },
  stored: { label: 'Stored stock sold', icon: '🗄️' },
  launch: { label: 'Surplus rocket parts', icon: '🚀' },
  refunds: { label: 'Refunds', icon: '↩️' },
  offline: { label: 'Offline earnings', icon: '🌙' },
  boost: { label: 'Boosts', icon: '⏱️' },
  raw: { label: 'Raw materials', icon: '🔩' },
  wages: { label: 'Wages', icon: '👷' },
  build: { label: 'Construction', icon: '🏗️' },
  repair: { label: 'Repairs & cleaning', icon: '🔨' },
  upgrades: { label: 'Upgrades', icon: '⏫' },
  docks: { label: 'Docks', icon: '🚪' },
  hiring: { label: 'Hiring fees', icon: '🤝' },
  trucks: { label: 'Trucks', icon: '🚚' },
  property: { label: 'Properties', icon: '🏢' },
  research: { label: 'Research', icon: '🔬' },
  dev: { label: 'Test mode', icon: '🧪' },
  other: { label: 'Other', icon: '•' },
};
// Constant streams (aggregated, not listed one by one in "recent").
const LEDGER_STREAMS = new Set(['sales', 'raw', 'wages']);
const ledger = { buckets: new Map(), session: {}, recent: [] };

function book(cat, amt, note, site) {
  if (!amt || !state) return;
  const sec = Math.floor(state.clock);
  let b = ledger.buckets.get(sec);
  if (!b) {
    b = {};
    ledger.buckets.set(sec, b);
    for (const k of ledger.buckets.keys()) { if (k < sec - 600) ledger.buckets.delete(k); else break; }
  }
  b[cat] = (b[cat] || 0) + amt;
  ledger.session[cat] = (ledger.session[cat] || 0) + amt;
  if (!LEDGER_STREAMS.has(cat)) {
    ledger.recent.unshift({ t: state.clock, cat, amt, note: note || '', site: site || state.current });
    if (ledger.recent.length > 25) ledger.recent.length = 25;
  }
}

// Totals by category over the last `secs` seconds (null = whole session).
function ledgerTotals(secs) {
  if (secs == null) return { ...ledger.session };
  const out = {};
  const from = state.clock - secs;
  for (const [sec, b] of ledger.buckets) if (sec >= from) for (const [k, v] of Object.entries(b)) out[k] = (out[k] || 0) + v;
  return out;
}

function earn(amount, cat, note, site) {
  state.money += amount;
  book(cat, amount, note, site);
}

function spend(amount, cat = 'other', note) {
  if (state.money < amount) return false;
  state.money -= amount;
  book(cat, -amount, note);
  return true;
}

function propRate(id) {
  const r = runtime[id];
  if (!r) return 0;
  const cutoff = r.time - 30;
  let sum = 0;
  for (const s of r.sales) if (s.t >= cutoff) sum += s.v;
  return sum * 2; // per minute
}

// Supplier costs per minute (last 30s).
function propCost(id) {
  const r = runtime[id];
  if (!r) return 0;
  const cutoff = r.time - 30;
  let sum = 0;
  for (const c of r.costs) if (c.t >= cutoff) sum += c.v;
  return sum * 2;
}

function propNet(id) {
  const r = runtime[id];
  return propRate(id) - propCost(id) - (r && r.unpaid ? 0 : wagesPerMin(id));
}

function totalRate() {
  let sum = 0;
  for (const def of PROPERTIES) if (state.props[def.id].owned) sum += propRate(def.id);
  return sum;
}

function netRate() {
  let sum = 0;
  for (const def of PROPERTIES) if (state.props[def.id].owned) sum += propNet(def.id);
  return sum;
}
