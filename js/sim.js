'use strict';
// Simulation: trucks spawn packages at IN docks, packages ride conveyors,
// machines add value (and jam), OUT docks sell. Each tile holds one package.

let nextItemId = 1;

function tileAt(prop, def, x, y) {
  if (x < 0 || y < 0 || x >= def.cols || y >= def.rows) return null;
  return prop.tiles[y][x];
}

// Sorter exits are absolute directions: `dir` for everything else, `out` for
// the filtered cargo. (Older saves stored `side`, relative to `dir`.)
function sorterSideDir(o) { return o.out != null ? o.out : (o.dir + o.side) % 4; }

// Where the sorted cargo goes: { dir: weight }. Older sorters have one exit.
function sorterSplit(o) { return o.split || { [sorterSideDir(o)]: 1 }; }
const sorterMatchDirs = (o) => Object.entries(sorterSplit(o)).filter(([, w]) => w > 0).map(([d]) => +d);

// Weighted round-robin over the sorted cargo's exits, preferring ones with room.
function chooseSortDir(prop, def, r, it, o, openOnly) {
  const dirs = sorterMatchDirs(o);
  if (dirs.length === 1) return dirs[0];
  const open = dirs.filter((d) => canEnter(prop, def, r, it.x + DIRS[d].x, it.y + DIRS[d].y, opposite(d), it));
  const pool = open.length ? open : openOnly ? [] : dirs;
  if (!pool.length) return null;
  const split = sorterSplit(o);
  const cur = o.wrr || (o.wrr = {});
  let total = 0, best = null;
  for (const d of pool) {
    cur[d] = (cur[d] || 0) + split[d];
    total += split[d];
    if (best == null || cur[d] > cur[best]) best = d;
  }
  cur[best] -= total;
  return best;
}

// Is tile (x,y) built to take packages in through its `side` face?
function acceptsFrom(prop, def, x, y, side) {
  const t = tileAt(prop, def, x, y);
  if (!t) return false;
  if (t.base === 'out') return !t.locked;
  if (t.base !== 'floor' || !t.obj) return false;
  const o = t.obj;
  if (o.k === 'rack') return true; // conveyors can feed racks directly
  if (FACILITIES[o.k]) return false; // solid buildings
  if (o.k === 'splitter') return true;
  if (o.k === 'sorter') return side !== o.dir && !sorterMatchDirs(o).includes(side);
  return o.dir !== side; // can't push into a tile's output face
}

// Assemblers swallow ingredients for their recipe into an internal buffer.
function assemblerWants(o, it) {
  const rec = o.recipe && RECIPES[o.recipe];
  if (!rec || !it || !rec.in[it.product] || assemblerIdle(o)) return false; // idle ones let ingredients pass by
  return ((o.buf && o.buf[it.product]) || 0) < rec.in[it.product] * ASSEMBLER.bufferRecipes;
}

// ...and can it take this package right now?
function canEnter(prop, def, r, x, y, side, it) {
  if (!acceptsFrom(prop, def, x, y, side)) return false;
  const t = prop.tiles[y][x];
  if (t.base === 'out') return !it || canShip(def.id, prop, it.product);
  if (t.obj.jammed) return false;
  if (t.obj.k === 'assembler') return assemblerWants(t.obj, it);
  if (t.obj.k === 'rack') return !it || (rackAllows(t.obj, it.product) && storageRoomFor(def.id, it.product) > 0); // racks absorb into storage
  return !r.occ[y][x];
}

const sorterMatches = (o, it) => o.filter === it.product || o.filter === it.type;

function makeItem(product, x, y, p, fromDir, outDir) {
  const P = PRODUCTS[product];
  return {
    id: nextItemId++, x, y, p, fromDir, outDir, product, type: P.cls,
    value: P.value, base: P.value, fresh: 1,
    tags: [], proc: 0, processed: false, wait: 0, hue: Math.floor(Math.random() * 3),
  };
}

function chooseSplitterDir(prop, def, r, it, obj) {
  for (let i = 0; i < 4; i++) {
    const d = (obj.rr + i) % 4;
    if (d === it.fromDir) continue;
    if (canEnter(prop, def, r, it.x + DIRS[d].x, it.y + DIRS[d].y, opposite(d), it)) {
      obj.rr = (d + 1) % 4;
      return d;
    }
  }
  return null;
}

function baseLife(o) {
  if (o.k === 'belt') return BELT_TIERS[o.tier].life;
  if (o.k === 'splitter') return SPLITTER.life;
  if (o.k === 'sorter') return SORTER.life;
  if (o.k === 'assembler') return ASSEMBLER.life;
  return MACHINES[o.k].life;
}

function equipLife(o) {
  return Math.round(baseLife(o) * (1 + rfx('life')) * (0.75 + Math.random() * 0.5));
}

const EQUIP_NAMES = { belt: 'Conveyor', splitter: 'Splitter', sorter: 'Sorter', assembler: 'Assembler' };
const equipName = (o) => EQUIP_NAMES[o.k] || MACHINES[o.k].name;

// One package's worth of wear; equipment past its life breaks down.
function wearOut(id, prop, def, o) {
  o.wear = (o.wear || 0) + 1;
  if (!o.life) o.life = equipLife(o);
  if (o.wear < o.life || o.jammed) return;
  o.jammed = true;
  prop.jams++;
  if (!staffCount(id, prop, 'tech')) toast(`⚠️ ${equipName(o)} broke down at the ${def.name}`);
}

function addFloater(id, r, x, y, text, color) {
  if (id === state.current) r.floaters.push({ x, y, text, color, age: 0 });
}

// ---- Distribution plans ----
// Each product leaving a site follows its plan: a weighted list of
// destinations (sell, or another site), each with an optional stock cap.
const DEFAULT_PLAN = { dests: [{ to: 'sell', w: 1, cap: 0 }], overflow: 'sell' };
const planOf = (prop, p) => prop.plans[p] || DEFAULT_PLAN;

function destValid(from, to, p) {
  if (to === 'sell' || to === 'store') return true;
  if (to === 'launch') return state.launch.owned && !!LAUNCH.needs[p];
  const def = PROP_BY_ID[to];
  return !!def && to !== from && state.props[to].owned && hasReceiveDock(def);
}

function inTransit(from, to, p) {
  const f = state.fleet[routeKey(from, to)];
  if (!f) return 0;
  let n = 0;
  for (const u of f.units) if (u.phase === 'go' || u.phase === 'unload') n += u.load[p] || 0;
  return n;
}

// Stock of `p` at a destination, counting what's queued and on the road.
function stockAt(from, to, p) {
  const queued = ((state.props[from].outbox[to] || {})[p] || 0) + inTransit(from, to, p);
  if (to === 'launch') return (state.launch.parts[p] || 0) + queued;
  return (state.props[to].inbox[p] || 0) + queued;
}

// ---- Storage racks ----
function storageCap(id) {
  return STORAGE_BASE + layoutOf(id).rackSlots;
}

function storageUsed(id) {
  const prop = state.props[id];
  let n = 0;
  for (const box of Object.values(prop.outbox)) for (const v of Object.values(box)) n += v;
  for (const v of Object.values(prop.held)) n += v;
  for (const v of Object.values(prop.inbox)) n += v;
  return n;
}

// ---- Rack handling: a bank of moves refilled at the crew's rate ----
const movesReady = (id) => (rt(id).moves || 0) >= 1;

function takeMove(id) {
  const r = rt(id);
  if ((r.moves || 0) < 1) return false;
  r.moves -= 1;
  (r.moveLog || (r.moveLog = [])).push(r.time);
  return true;
}

// Moves actually used per minute (last 30s), for the busy meter.
function movesUsed(id) {
  const r = runtime[id];
  if (!r || !r.moveLog) return 0;
  const cutoff = r.time - 30;
  let n = 0;
  for (const t of r.moveLog) if (t >= cutoff) n++;
  return n * 2;
}

const storageRoom = (id) => storageCap(id) - storageUsed(id);

// A rack with an `allow` list only holds those products.
const rackAllows = (o, p) => !o.allow || o.allow.includes(p);

// Room for one more `p`: the dock staging takes anything, but racks only
// count when they allow `p`.
function storageRoomFor(id, p) {
  const room = storageRoom(id);
  const L = layoutOf(id);
  if (room <= 0 || !L.filtered || !p) return room;
  let onRacks = 0, freeForP = 0;
  for (const o of L.rackObjs) {
    const load = rackLoad(o);
    onRacks += load;
    if (rackAllows(o, p)) freeForP += Math.max(0, rackCapOf(o) - load);
  }
  const stagingFree = Math.max(0, STORAGE_BASE - (storageUsed(id) - onRacks));
  return Math.min(room, stagingFree + freeForP);
}

// Everything on the racks as an ordered list: stored stock first, then
// goods waiting for an outgoing truck, then goods trucked in.
function storageUnits(id) {
  const prop = state.props[id];
  const units = [];
  const add = (obj, kind) => { for (const p of PRODUCT_IDS) if (obj[p] > 0) units.push({ p, n: obj[p], kind }); };
  add(prop.held, 'stored');
  const out = {};
  for (const box of Object.values(prop.outbox)) for (const [p, n] of Object.entries(box)) out[p] = (out[p] || 0) + n;
  add(out, 'outgoing');
  add(prop.inbox, 'incoming');
  return units;
}

// Racks in reading order: 'x,y' -> { k, cap, obj }.
function rackIndex(id) {
  const idx = new Map();
  state.props[id].tiles.forEach((row, y) => row.forEach((t, x) => {
    if (!t.obj || t.obj.k !== 'rack') return;
    idx.set(x + ',' + y, { k: idx.size, cap: rackCapOf(t.obj), obj: t.obj });
  }));
  return idx;
}

// Each rack remembers what sits on it (o.stock: 'kind:product' -> n), so goods
// stay put: upgrading a rack only adds room, it never pulls stock off others.
// The site totals (held/outbox/inbox) stay the source of truth; this keeps the
// racks in step with them each tick.
const rackLoad = (o) => Object.values(o.stock || {}).reduce((a, b) => a + b, 0);

function syncRacks(id) {
  const racks = [...rackIndex(id).values()].map((i) => i.obj);
  const want = {};
  for (const u of storageUnits(id)) want[u.kind + ':' + u.p] = u.n;
  const have = {};
  for (const o of racks) {
    const st = o.stock || (o.stock = {});
    // A rack that shrank (shouldn't happen) drops what no longer fits.
    let over = rackLoad(o) - rackCapOf(o);
    for (const k of Object.keys(st)) { if (over <= 0) break; const n = Math.min(st[k], over); st[k] -= n; over -= n; }
    for (const [k, n] of Object.entries(st)) if (n > 0) have[k] = (have[k] || 0) + n; else delete st[k];
  }
  // Same product changing role (stored -> waiting for a truck): relabel in place.
  for (const k of Object.keys(have)) {
    let extra = have[k] - (want[k] || 0);
    if (extra <= 0) continue;
    const p = k.slice(k.indexOf(':') + 1);
    for (const k2 of Object.keys(want)) {
      if (extra <= 0) break;
      if (k2 === k || !k2.endsWith(':' + p)) continue;
      let short = want[k2] - (have[k2] || 0);
      for (const o of racks) {
        if (extra <= 0 || short <= 0) break;
        const n = Math.min(o.stock[k] || 0, extra, short);
        if (!n) continue;
        o.stock[k] -= n; if (!o.stock[k]) delete o.stock[k];
        o.stock[k2] = (o.stock[k2] || 0) + n;
        have[k] -= n; have[k2] = (have[k2] || 0) + n; extra -= n; short -= n;
      }
    }
  }
  // Gone (sold, loaded, unloaded onto the floor): take from the last racks first.
  for (const k of Object.keys(have)) {
    let extra = have[k] - (want[k] || 0);
    for (let i = racks.length - 1; i >= 0 && extra > 0; i--) {
      const st = racks[i].stock;
      const n = Math.min(st[k] || 0, extra);
      if (!n) continue;
      st[k] -= n; if (!st[k]) delete st[k];
      extra -= n;
    }
  }
  // New arrivals (or goods waiting at the dock staging) go to the first rack with room.
  for (const [k, n] of Object.entries(want)) {
    let short = n - Math.max(0, Math.min(have[k] || 0, n));
    const prod = k.slice(k.indexOf(':') + 1);
    for (const o of racks) {
      if (short <= 0) break;
      if (!rackAllows(o, prod)) continue;
      const room = rackCapOf(o) - rackLoad(o);
      const m = Math.min(room, short);
      if (m <= 0) continue;
      o.stock[k] = (o.stock[k] || 0) + m;
      short -= m;
    }
  }
}

// Products this site stores or ships (shown brighter in the rack filter).
function storageUnitsHave(id, p) {
  const prop = state.props[id];
  if (prop.held[p] || prop.inbox[p] || prop.shipped[p] || prop.made[p]) return true;
  return Object.values(prop.outbox).some((b) => b[p]);
}

function rackContents(id, info) {
  const order = { stored: 0, outgoing: 1, incoming: 2 };
  return Object.entries(info.obj.stock || {}).filter(([, n]) => n > 0).map(([k, n]) => {
    const i = k.indexOf(':');
    return { kind: k.slice(0, i), p: k.slice(i + 1), n };
  }).sort((a, b) => order[a.kind] - order[b.kind]);
}

// Can `d` take another package? Trucked destinations need a free rack slot
// to wait on — unless the package is already in storage (`fromStorage`).
function destOpen(from, d, p, fromStorage) {
  if (!d.w || !destValid(from, d.to, p)) return false;
  if (d.to === 'sell') return true;
  // "Store here": park it on this site's racks (needs a free slot and a move).
  if (d.to === 'store') return !fromStorage && storageRoomFor(from, p) > 0 && movesReady(from);
  if (!fromStorage && (storageRoomFor(from, p) <= 0 || !movesReady(from))) return false;
  const stock = stockAt(from, d.to, p);
  if (d.to === 'launch' && stock >= (launchNeeds()[p] || 0)) return false; // rocket has enough
  return !d.cap || stock < d.cap;
}

// False only when the plan says "store", every destination is full and the
// racks are full too — then the SHIP doors refuse and the line backs up.
function canShip(id, prop, p) {
  const plan = planOf(prop, p);
  return plan.overflow !== 'hold' || (storageRoomFor(id, p) > 0 && movesReady(id)) || plan.dests.some((d) => destOpen(id, d, p));
}

// Smooth weighted round-robin: exact shares, evenly interleaved.
// Returns 'sell', a site id, 'store' (park it on the racks), or null.
function chooseDest(id, prop, r, p, fromStorage) {
  const plan = planOf(prop, p);
  const open = plan.dests.filter((d) => destOpen(id, d, p, fromStorage));
  if (!open.length) {
    if (fromStorage) return null;
    if (plan.overflow !== 'hold') return 'sell';
    return storageRoomFor(id, p) > 0 && movesReady(id) ? 'store' : null;
  }
  if (open.length === 1) return open[0].to;
  const cur = (r.wrr || (r.wrr = {}))[p] || (r.wrr[p] = {});
  let total = 0, best = null;
  for (const d of open) {
    cur[d.to] = (cur[d.to] || 0) + d.w;
    total += d.w;
    if (!best || cur[d.to] > cur[best.to]) best = d;
  }
  cur[best.to] -= total;
  return best.to;
}

// A package went out a SHIP door: sell it, or queue it for a truck.
function shipOut(id, prop, r, it, x, y) {
  if (Math.random() < theftChance(id, prop)) {
    prop.stolen++;
    addFloater(id, r, x + 0.5, y + 0.2, '🦹 stolen', '235,87,87');
    return;
  }
  const to = chooseDest(id, prop, r, it.product) || 'sell';
  if (to !== 'sell') takeMove(id); // put it away on the racks
  if (to === 'store') {
    prop.held[it.product] = (prop.held[it.product] || 0) + 1;
    addFloater(id, r, x + 0.5, y + 0.2, '🗄️ stored', '242,201,76');
    return;
  }
  if (to !== 'sell') {
    const box = prop.outbox[to] || (prop.outbox[to] = {});
    box[it.product] = (box[it.product] || 0) + 1;
    prop.sent++;
    ensureRoute(id, to);
    addFloater(id, r, x + 0.5, y + 0.2, '🚚 ' + siteEmoji(to), '86,204,242');
    return;
  }
  // Market demand moves the price; selling floods it a little.
  const p = it.product;
  const hubBonus = LAUNCH.needs[p] ? 1 + (PROP_BY_ID[id].rocketBonus || 0) : 1;
  const amount = it.value * demandOf(p) * eventMult(p) * valueMult(id, prop) * hubBonus * (boostActive('double') ? 2 : 1);
  state.market.demand[p] = Math.max(MARKET.floor, demandOf(p) - marketDrop(p));
  earn(amount, 'sales', PRODUCTS[p].name, id);
  prop.earned += amount;
  prop.shipped[it.product] = (prop.shipped[it.product] || 0) + 1;
  r.sales.push({ t: r.time, v: amount });
  shipLog.push({ t: state.clock, type: it.product });
  addFloater(id, r, x + 0.5, y + 0.2, '+' + fmt(amount), '111,207,151');
  onPackageShipped(it);
}

// Phase 1: move a package along its current tile (up to the exit edge).
function advanceItem(id, prop, def, r, it, dt) {
  const t = prop.tiles[it.y][it.x];
  const sm = speedMult(id, prop) * (it.type === 'bulky' ? BULKY_SPEED : 1);
  let speed, outDir;

  // Cold cargo spoils until chilled.
  if (it.type === 'cold' && !it.tags.includes('chiller') && it.fresh > COLD_FLOOR) {
    const k = 1 - COLD_DECAY * Math.max(0.05, 1 - rfx('coldDecay')) * dt;
    const nf = Math.max(COLD_FLOOR, it.fresh * k);
    it.value *= nf / it.fresh;
    it.fresh = nf;
  }

  if (t.base === 'in') {
    speed = DOCK_SPEED * sm;
    outDir = t.dir;
  } else {
    const o = t.obj;
    if (!o) { it.dead = true; return; } // conveyor removed under it
    if (o.jammed) return; // broken down — everything on it waits
    if (o.k === 'belt') {
      speed = BELT_TIERS[o.tier].speed * sm;
      outDir = o.dir;
    } else if (o.k === 'splitter') {
      speed = SPLITTER.speed * sm;
      if (it.p >= 0.5 && it.outDir == null) {
        it.outDir = chooseSplitterDir(prop, def, r, it, o);
        if (it.outDir == null) { it.p = 0.5; return; }
      }
      outDir = it.outDir;
    } else if (o.k === 'sorter') {
      speed = SORTER.speed * sm;
      if (sorterMatches(o, it)) {
        if (it.sortDir == null) it.sortDir = chooseSortDir(prop, def, r, it, o);
        outDir = it.sortDir;
      } else outDir = o.dir;
    } else if (o.k === 'assembler') {
      speed = MACHINE_SPEED * sm; // freshly built product leaving
      outDir = o.dir;
    } else {
      // Machine: pause at the centre while processing.
      const m = MACHINES[o.k];
      speed = MACHINE_SPEED * sm;
      outDir = o.dir;
      if (it.p >= 0.5 && !it.processed) {
        it.p = 0.5;
        const skip = it.tags.includes(o.k) || (m.only && it.type !== m.only);
        if (skip) {
          it.processed = true; // nothing to do — pass straight through
        } else {
          const time = m.time * (it.type === 'bulky' ? 2 : 1);
          it.proc += dt * speedMult(id, prop) * r.power;
          if (it.proc < time) return;
          if (m.add) it.value += it.base * m.add * it.fresh;
          if (m.mul) it.value *= m.mul;
          it.tags.push(o.k);
          it.processed = true;
          wearOut(id, prop, def, o);
        }
      }
    }
  }

  it.outDir = outDir;
  it.p = Math.min(1, it.p + speed * dt);
}

function breaksOn(it, t) {
  return it.type === 'fragile' && t.obj && t.obj.k === 'belt' && t.obj.tier === 2
    && !it.tags.includes('wrapper') && !hasResearch('padding');
}

// Phase 2: a package at the exit edge tries to hop to the next tile.
function tryMove(id, prop, def, r, it) {
  const t = prop.tiles[it.y][it.x];
  let outDir = it.outDir;
  let nx = it.x + DIRS[outDir].x;
  let ny = it.y + DIRS[outDir].y;
  if (!canEnter(prop, def, r, nx, ny, opposite(outDir), it)) {
    // A splitter (or a sorter splitting its cargo) whose exit got blocked may try another.
    const sorterSplitting = t.obj && t.obj.k === 'sorter' && sorterMatches(t.obj, it) && sorterMatchDirs(t.obj).length > 1;
    if (!(t.obj && t.obj.k === 'splitter') && !sorterSplitting) return false;
    const d = sorterSplitting ? chooseSortDir(prop, def, r, it, t.obj, true) : chooseSplitterDir(prop, def, r, it, t.obj);
    if (sorterSplitting && d != null) it.sortDir = d;
    if (d == null) return false;
    it.outDir = outDir = d;
    nx = it.x + DIRS[d].x;
    ny = it.y + DIRS[d].y;
  }

  r.occ[it.y][it.x] = null;
  const nt = prop.tiles[ny][nx];
  if (nt.base === 'out') {
    shipOut(id, prop, r, it, nx, ny);
    it.dead = true;
    return true;
  }
  if (nt.obj && nt.obj.k === 'rack') {
    // Conveyed straight onto the racks: stored stock (no forklift move needed).
    // It lands on this rack when there's room; otherwise the next free one.
    prop.held[it.product] = (prop.held[it.product] || 0) + 1;
    const st = nt.obj.stock || (nt.obj.stock = {});
    if (rackLoad(nt.obj) < rackCapOf(nt.obj) && rackAllows(nt.obj, it.product)) st['stored:' + it.product] = (st['stored:' + it.product] || 0) + 1;
    addFloater(id, r, nx + 0.5, ny + 0.3, '🗄️', '242,201,76');
    it.dead = true;
    return true;
  }
  if (nt.obj && nt.obj.k === 'assembler') {
    const buf = nt.obj.buf || (nt.obj.buf = {});
    buf[it.product] = (buf[it.product] || 0) + 1;
    it.dead = true;
    return true;
  }
  if (breaksOn(it, nt)) {
    prop.broken++;
    addFloater(id, r, nx + 0.5, ny + 0.5, '💥', '235,87,87');
    it.dead = true;
    return true;
  }
  it.x = nx;
  it.y = ny;
  it.p = 0;
  it.fromDir = opposite(outDir);
  it.outDir = null;
  it.sortDir = null;
  it.proc = 0;
  it.processed = false;
  it.wait = 0;
  r.occ[ny][nx] = it;
  if (nt.obj && !MACHINES[nt.obj.k]) wearOut(id, prop, def, nt.obj);
  return true;
}

function pickCargo(cargo) {
  let total = 0;
  for (const k in cargo) total += cargo[k];
  let roll = Math.random() * total;
  for (const k in cargo) {
    roll -= cargo[k];
    if (roll <= 0) return k;
  }
  return Object.keys(cargo)[0];
}

function stepProperty(id, dt) {
  const def = PROP_BY_ID[id];
  const prop = state.props[id];
  const r = rt(id);
  r.time += dt;

  // Wages. Unpaid staff stop working until you can cover them.
  const wage = (wagesPerMin(id) / 60) * dt;
  if (wage > 0) {
    if (state.money >= wage) { state.money -= wage; book('wages', -wage, null, id); r.unpaid = false; }
    else r.unpaid = true;
  } else r.unpaid = false;

  // Workplace accidents halt everything for a while.
  if (r.shutdown > 0) {
    r.shutdown = Math.max(0, r.shutdown - dt);
    return;
  }
  if (Math.random() < (accidentsPerMin(id, prop) / 60) * dt) {
    r.shutdown = facCount(id, 'firstaid') ? ACCIDENT_SHUTDOWN / 2 : ACCIDENT_SHUTDOWN;
    r.lastAccident = r.time; // shakes morale for a while
    prop.accidents++;
    toast(`🚑 Workplace accident at the ${def.name}! Work stopped for ${r.shutdown}s`);
    return;
  }

  // Power is re-checked twice a second (it only changes when you build).
  r.powerT = (r.powerT || 0) - dt;
  if (r.powerT <= 0 || r.power == null) {
    r.power = powerFactor(id);
    r.powerT = 0.5;
    releaseStored(id, prop, r);
    syncRacks(id);
  }

  stepWorkers(id, prop, def, r, dt);
  r.moves = Math.min(HANDLING_BURST, (r.moves == null ? HANDLING_BURST : r.moves) + (handlingRate(id) / 60) * dt);

  // Supplier trucks drop raw material at open IN docks; receiving docks
  // unload whatever your other sites have trucked in.
  const interval = truckInterval(id, prop);
  for (const d of def.inDocks) {
    const t = prop.tiles[d.y][d.x];
    if (t.locked) continue;
    const key = d.x + ',' + d.y;
    r.timers[key] = (r.timers[key] || 0) + dt;
    if (r.timers[key] < interval) continue;
    const product = d.receive ? (movesReady(id) ? nextInboxProduct(prop, r) : null) : pickCargo(d.cargo);
    const cost = d.receive ? 0 : supplierCost(product);
    if (!product || r.occ[d.y][d.x] || state.money < cost) {
      r.timers[key] = interval; // backed up, nothing to unload, or can't pay the supplier — wait
      continue;
    }
    r.timers[key] -= interval;
    if (d.receive) { prop.inbox[product]--; takeMove(id); }
    else if (cost) { state.money -= cost; book('raw', -cost, PRODUCTS[product].name, id); r.costs.push({ t: r.time, v: cost }); }
    const it = makeItem(product, d.x, d.y, 0.3, opposite(t.dir), t.dir);
    r.items.push(it);
    r.occ[d.y][d.x] = it;
  }

  stepAssemblers(id, prop, def, r, dt);

  for (const it of r.items) advanceItem(id, prop, def, r, it, dt);
  if (id === state.current && ui.heat === 'traffic') accumulateTraffic(def, r, dt);

  // Resolve hops. Repeat passes so a whole queue can shuffle forward in one
  // step; longest-waiting packages go first so merges take turns fairly.
  let waiting = r.items.filter((i) => !i.dead && i.p >= 1);
  waiting.sort((a, b) => b.wait - a.wait);
  let moved = true;
  while (moved && waiting.length) {
    moved = false;
    const claimed = new Set(); // targets a longer-waiting package is queued for
    waiting = waiting.filter((it) => {
      const tx = it.x + DIRS[it.outDir].x, ty = it.y + DIRS[it.outDir].y;
      const key = tx + ',' + ty;
      if (!claimed.has(key) && tryMove(id, prop, def, r, it)) { moved = true; return false; }
      // Assemblers absorb by ingredient, so one blocked ingredient mustn't
      // hold the tile for another that the assembler still needs.
      const target = tileAt(prop, def, tx, ty);
      if (!(target && target.obj && target.obj.k === 'assembler')) claimed.add(key);
      return true;
    });
  }
  for (const it of waiting) it.wait += dt;

  if (r.items.some((i) => i.dead)) {
    for (const it of r.items) {
      if (it.dead && r.occ[it.y][it.x] === it) r.occ[it.y][it.x] = null;
    }
    r.items = r.items.filter((i) => !i.dead);
  }

  // Trim sales log & floaters.
  const cutoff = r.time - 31;
  while (r.sales.length && r.sales[0].t < cutoff) r.sales.shift();
  while (r.costs.length && r.costs[0].t < cutoff) r.costs.shift();
  if (r.moveLog) while (r.moveLog.length && r.moveLog[0] < cutoff) r.moveLog.shift();
  for (const f of r.floaters) f.age += dt;
  r.floaters = r.floaters.filter((f) => f.age < 1.2);
}

function unjam(o) {
  o.jammed = false;
  o.wear = 0;
  o.life = equipLife(o);
}

// Maintenance techs (see workers.js) pick jobs here: repairs first, then
// the most worn equipment (preventive maintenance).
function findTechJob(prop, busy, repairsOnly) {
  let best = null, bestWear = PM_THRESHOLD;
  for (let y = 0; y < prop.tiles.length; y++) {
    const row = prop.tiles[y];
    for (let x = 0; x < row.length; x++) {
      const o = row[x].obj;
      if (!o || busy.has(x + ',' + y)) continue;
      if (o.jammed) return { kind: 'repair', x, y, obj: o, t: 0, dur: TECH_REPAIR_TIME / (1 + rfx('repair')) };
      if (repairsOnly || !o.life) continue;
      const w = (o.wear || 0) / o.life;
      if (w >= bestWear) { bestWear = w; best = { kind: 'pm', x, y, obj: o, t: 0, dur: TECH_PM_TIME }; }
    }
  }
  return best;
}

// Stored packages move to a truck queue (or get sold) once their plan has room.
// Stored stock leaves only on a truck, to a destination in its plan with
// room (selling it is a manual choice: "Sell stored stock").
function releaseStored(id, prop, r) {
  for (const p of Object.keys(prop.held)) {
    const sites = planOf(prop, p).dests.filter((d) => d.to !== 'sell' && d.to !== 'store');
    while (prop.held[p] > 0) {
      const d = sites.find((x) => destOpen(id, x, p, true));
      if (!d) break;
      prop.held[p]--;
      const box = prop.outbox[d.to] || (prop.outbox[d.to] = {});
      box[p] = (box[p] || 0) + 1;
      prop.sent++;
      ensureRoute(id, d.to);
    }
    if (!prop.held[p]) delete prop.held[p];
  }
}

// What selling `n` of `p` would bring right now (each sale nudges the price down).
function storedSaleValue(id, p, n) {
  const prop = state.props[id];
  let d = demandOf(p), total = 0;
  for (let i = 0; i < n; i++) {
    total += PRODUCTS[p].value * d * eventMult(p) * valueMult(id, prop);
    d = Math.max(MARKET.floor, d - marketDrop(p));
  }
  return total;
}

// Sell stored stock: `qty` of one product (all of it by default), or
// everything when `only` is omitted.
function sellStored(id, only, qty) {
  const prop = state.props[id];
  let total = 0, sold = 0;
  for (const [p, have] of Object.entries(prop.held)) {
    if (only && p !== only) continue;
    const n = only && qty ? Math.min(qty, have) : have;
    for (let i = 0; i < n; i++) {
      total += marketPrice(p) * valueMult(id, prop);
      state.market.demand[p] = Math.max(MARKET.floor, demandOf(p) - marketDrop(p));
    }
    sold += n;
    prop.held[p] = have - n;
    if (!prop.held[p]) delete prop.held[p];
  }
  earn(total, 'stored', only ? `Sold ${sold} stored ${PRODUCTS[only].name}` : 'Sold all stored stock', id);
  prop.earned += total;
  return total;
}

// Receiving docks take turns between the products waiting in the inbox.
function nextInboxProduct(prop, r) {
  const ids = PRODUCT_IDS.filter((p) => prop.inbox[p] > 0);
  if (!ids.length) return null;
  r.recvRR = ((r.recvRR || 0) + 1) % ids.length;
  return ids[r.recvRR];
}

function stepAssemblers(id, prop, def, r, dt) {
  const speed = speedMult(id, prop) * (1 + rfx('assembly')) * r.power * (def.asmSpeed || 1);
  for (let y = 0; y < def.rows; y++) {
    for (let x = 0; x < def.cols; x++) {
      const o = prop.tiles[y][x].obj;
      if (!o || o.k !== 'assembler' || o.jammed || !o.recipe || assemblerIdle(o)) continue;
      const crew = r.crewed.get(x + ',' + y) || 0;
      // No operator: it still crawls along (25%) so a line can never deadlock.
      const crewMult = crew ? 1 + CREW_BONUS * (Math.min(crew, MAX_CREW) - 1) : Math.max(NO_CREW_SPEED, rfx('uncrewed'));
      const rec = RECIPES[o.recipe];
      const buf = o.buf || (o.buf = {});
      if (!Object.entries(rec.in).every(([p, n]) => (buf[p] || 0) >= n)) { o.craftT = 0; continue; }
      o.craftT = (o.craftT || 0) + dt * speed * (crew ? workPace(id) : 1) * crewMult;
      if (o.craftT < rec.time) continue;
      if (r.occ[y][x]) { o.craftT = rec.time; continue; } // output backed up
      for (const [p, n] of Object.entries(rec.in)) buf[p] -= n;
      o.craftT = 0;
      const it = makeItem(o.recipe, x, y, 0.5, opposite(o.dir), o.dir);
      it.processed = true;
      r.items.push(it);
      r.occ[y][x] = it;
      prop.made[o.recipe] = (prop.made[o.recipe] || 0) + 1;
      wearOut(id, prop, def, o);
    }
  }
}

// ---- Trucking between your sites ----
const routeKey = (a, b) => a + '>' + b;

function travelTime(a, b) {
  const p = MAP_POS[a], q = MAP_POS[b];
  return Math.hypot(p.x - q.x, p.y - q.y) * TRAVEL_PER_UNIT * (1 - Math.min(0.7, rfx('travel'))) / (boostActive('freight') ? 3 : 1);
}

function truckCap() { return Math.round(TRUCK_CAP * (1 + rfx('fleetCap'))); }

function ensureRoute(a, b) {
  const key = routeKey(a, b);
  if (!state.fleet[key]) state.fleet[key] = { trucks: 0, wait: '10s', units: [] };
  return state.fleet[key];
}

const assignedTrucks = () => Object.values(state.fleet).reduce((n, f) => n + f.trucks, 0);
const idleTrucks = () => state.garage.trucks - assignedTrucks();
const routeWait = (f) => (TRUCK_WAITS.find((w) => w.id === f.wait) || TRUCK_WAITS[1]).wait;

// Rocket parts at the pad plus everything queued or on the road to it.
function launchStock(p) {
  let n = state.launch.parts[p] || 0;
  for (const def of PROPERTIES) {
    const prop = state.props[def.id];
    if (!prop.owned) continue;
    n += ((prop.outbox.launch || {})[p] || 0) + inTransit(def.id, 'launch', p);
  }
  return n;
}

// 'pause' stops an assembler; 'auto' stops it while the rocket has enough of its part.
function assemblerIdle(o) {
  if (o.mode === 'pause') return true;
  if (o.mode !== 'auto' || !state.launch.owned || !LAUNCH.needs[o.recipe]) return false;
  return launchStock(o.recipe) >= (launchNeeds()[o.recipe] || 0);
}

function launchNeeds() {
  const mult = Math.pow(LAUNCH.growth, state.launch.count) * (1 - rfx('launchParts'));
  const out = {};
  for (const [p, n] of Object.entries(LAUNCH.needs)) out[p] = Math.max(1, Math.round(n * mult));
  return out;
}

function launchReady() {
  const need = launchNeeds();
  return state.launch.owned && Object.entries(need).every(([p, n]) => (state.launch.parts[p] || 0) >= n);
}

function deliver(to, load) {
  if (to === 'launch') {
    const need = launchNeeds();
    for (const [p, n] of Object.entries(load)) {
      const room = Math.max(0, (need[p] || 0) - (state.launch.parts[p] || 0));
      const take = Math.min(room, n);
      state.launch.parts[p] = (state.launch.parts[p] || 0) + take;
      if (n > take) earn((n - take) * PRODUCTS[p].value, 'launch', PRODUCTS[p].name, 'launch'); // surplus sold at list price
    }
    return;
  }
  const inbox = state.props[to].inbox;
  for (const [p, n] of Object.entries(load)) inbox[p] = (inbox[p] || 0) + n;
}

// Unload what the destination's racks and crew can take right now.
function unloadTruck(to, u) {
  if (to === 'launch') { deliver(to, u.load); u.n = 0; return; }
  if (!state.props[to].owned) return;
  const inbox = state.props[to].inbox;
  for (const p of Object.keys(u.load)) {
    while (u.load[p] > 0 && storageRoomFor(to, p) > 0 && takeMove(to)) {
      u.load[p]--;
      u.n--;
      inbox[p] = (inbox[p] || 0) + 1;
    }
  }
}

function stepFleet(dt) {
  const cap = truckCap();
  for (const [key, f] of Object.entries(state.fleet)) {
    const [from, to] = key.split('>');
    const src = state.props[from];
    if (!src || !src.owned) continue;
    while (f.units.length < f.trucks) f.units.push({ phase: 'load', t: 0, load: {}, n: 0 });
    // Unassigned trucks leave once they're back at the loading dock.
    while (f.units.length > f.trucks) {
      const i = f.units.findIndex((u) => u.phase === 'load');
      if (i < 0) break;
      const box = src.outbox[to] || (src.outbox[to] = {});
      for (const [p, n] of Object.entries(f.units[i].load)) box[p] = (box[p] || 0) + n;
      f.units.splice(i, 1);
    }
    const trip = travelTime(from, to);
    const wait = routeWait(f);
    for (const u of f.units) {
      u.t += dt;
      if (u.phase === 'load') {
        // Forklifts pick from the racks onto the truck, one move per package.
        const box = src.outbox[to] || {};
        for (const p of Object.keys(box)) {
          while (box[p] > 0 && u.n < cap && takeMove(from)) {
            box[p]--;
            u.load[p] = (u.load[p] || 0) + 1;
            u.n++;
          }
        }
        if (u.n === 0) { u.t = 0; u.idle = (u.idle || 0) + dt; } else u.idle = 0;
        if (u.n >= cap || (u.n > 0 && wait != null && u.t >= wait)) { u.phase = 'go'; u.t = 0; u.idle = 0; }
      } else if (u.phase === 'go' && u.t >= trip) {
        u.phase = 'unload';
        u.t = 0;
      } else if (u.phase === 'unload') {
        unloadTruck(to, u);
        if (u.n === 0) { u.phase = 'back'; u.t = 0; u.load = {}; }
      } else if (u.phase === 'back' && u.t >= trip) {
        u.phase = 'load'; u.t = 0;
      }
    }
  }
}

// Demand drifts back toward normal; now and then a product booms or busts.
function stepMarket(dt) {
  const m = state.market;
  const k = Math.min(1, MARKET.recover * dt);
  for (const p of Object.keys(m.demand)) {
    m.demand[p] += (1 - m.demand[p]) * k;
    if (m.demand[p] > 0.999) delete m.demand[p];
  }
  if (!state.current || state.clock < m.nextEventAt) return;
  const [lo, hi] = MARKET.eventEvery;
  m.nextEventAt = state.clock + lo + Math.random() * (hi - lo);
  const products = availableProducts();
  if (!products.length) return;
  const p = products[Math.floor(Math.random() * products.length)];
  const boom = Math.random() < 0.7;
  m.event = { product: p, mult: boom ? 1.6 : 0.6, until: state.clock + MARKET.eventLength };
  toast(boom ? `📈 Boom! ${PRODUCTS[p].icon} ${PRODUCTS[p].name} sells for 160% right now`
    : `📉 Glut: ${PRODUCTS[p].icon} ${PRODUCTS[p].name} prices crashed to 60%`);
}

function stepWorld(dt) {
  state.clock += dt;
  stepLab(dt);
  for (const def of PROPERTIES) {
    if (state.props[def.id].owned) stepProperty(def.id, dt);
  }
  stepFleet(dt);
  stepMarket(dt);
  while (shipLog.length && shipLog[0].t < state.clock - 60) shipLog.shift();
  tickContracts();
}

// Remove any package sitting on a tile (used when the tile's contents change).
function clearItemAt(id, x, y) {
  const r = rt(id);
  const it = r.occ[y][x];
  if (it) {
    it.dead = true;
    r.occ[y][x] = null;
    r.items = r.items.filter((i) => i !== it);
  }
}
