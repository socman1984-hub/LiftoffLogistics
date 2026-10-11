'use strict';
// Workers: every staff member walks the warehouse floor. They path-find over
// repaired floor (stepping over conveyors), never over broken tiles, and stand
// beside whatever they work on. Assembler Operators crew assemblers, techs walk
// to repairs, forklifts shuttle to the racks, and everyone takes breaks at the
// restrooms and break rooms. Stuck workers raise alerts.

const WORKER_SPEED = 2.2; // tiles per second
const BREAK_LENGTH = 6; // seconds at a restroom / break room
const ROLE_LOOK = {
  operator: { icon: '👷', color: '#e67e22' },
  janitor: { icon: '🧹', color: '#16a085' },
  tech: { icon: '🔧', color: '#2d9cdb' },
  forklift: { icon: '🚜', color: '#d4ac0d' },
  ops: { icon: '📋', color: '#8e44ad' },
  sales: { icon: '💼', color: '#27ae60' },
  security: { icon: '🛡️', color: '#34495e' },
  safety: { icon: '⛑️', color: '#c0392b' },
  hr: { icon: '🗂️', color: '#7f8c8d' },
};
const ROLE_HOME = { ops: 'opscenter', security: 'securitybooth', safety: 'firstaid' };
const WORKER_NAMES = ['Ava', 'Ben', 'Carlos', 'Dana', 'Eli', 'Fatima', 'Gus', 'Hana', 'Ivan', 'Jade', 'Kofi', 'Lena',
  'Marco', 'Nia', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tara', 'Uri', 'Vera', 'Wes', 'Ximena', 'Yusuf', 'Zoe'];
let nextWorkerId = 1;

// ---- Grid helpers ----
// `wade`: janitors may step onto filthy floor to clean it.
function walkable(prop, def, x, y, wade) {
  if (x < 0 || y < 0 || x >= def.cols || y >= def.rows) return false;
  const t = prop.tiles[y][x];
  if (t.base === 'in' || t.base === 'out') return !t.locked; // doors
  if (t.base !== 'floor') return false; // broken floor, walls, pillars
  if (!wade && (t.dirt || 0) >= DIRT.filthy) return false; // a mess nobody can get through
  const o = t.obj;
  return !o || o.k === 'belt' || o.k === 'splitter' || o.k === 'sorter'; // step over conveyors
}

function entranceOf(prop, def) {
  const d = def.outDocks.find((k) => !prop.tiles[k.y][k.x].locked) || def.inDocks.find((k) => !prop.tiles[k.y][k.x].locked);
  return { x: d.x, y: d.y };
}

// Breadth-first search to the nearest walkable tile that satisfies goal().
function findPath(prop, def, sx, sy, goal, wade) {
  if (goal(sx, sy)) return [];
  const W = def.cols;
  const prev = new Int32Array(W * def.rows).fill(-1);
  const start = sy * W + sx;
  prev[start] = start;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const cx = cur % W, cy = (cur / W) | 0;
    for (const d of DIRS) {
      const nx = cx + d.x, ny = cy + d.y;
      if (!walkable(prop, def, nx, ny, wade)) continue;
      const ni = ny * W + nx;
      if (prev[ni] !== -1) continue;
      prev[ni] = cur;
      if (goal(nx, ny)) {
        const path = [];
        for (let i = ni; i !== start; i = prev[i]) path.push({ x: i % W, y: (i / W) | 0 });
        return path.reverse();
      }
      queue.push(ni);
    }
  }
  return null;
}

const nextTo = (tx, ty) => (x, y) => Math.abs(x - tx) + Math.abs(y - ty) === 1;
const tileDist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// Where a worker spends their shift (their assembler, their facility, or where they are).
function anchorOf(prop, w) {
  if (w.role === 'operator' && w.assign) { const [x, y] = w.assign.split(',').map(Number); return { x, y }; }
  if (w.role === 'tech' && w.task) return { x: w.task.x, y: w.task.y };
  return { x: w.x, y: w.y };
}

// Assign each worker to the nearest restroom / break room in range with room
// to spare. Coverage (0..1) drives morale; per-facility use shows in details.
function computeCoverage(prop, r) {
  const total = r.workers.length;
  if (!total && r.coverage) return; // nobody on the floor (e.g. unpaid): keep the last reading
  const cov = { restroom: 1, breakroom: 1 };
  r.facUse = {};
  for (const kind of ['restroom', 'breakroom']) {
    const facs = [];
    prop.tiles.forEach((row, y) => row.forEach((t, x) => {
      if (t.obj && t.obj.k === kind && (t.obj.dirt || 0) < DIRT.filthy) facs.push({ x, y, key: x + ',' + y, lv: facLevel(t.obj), used: 0 });
    }));
    let covered = 0;
    for (const w of r.workers) {
      const a = anchorOf(prop, w);
      const f = facs.filter((q) => q.used < q.lv.cap && tileDist(q, a) <= q.lv.range)
        .sort((p, q) => tileDist(p, a) - tileDist(q, a))[0];
      w[kind] = f ? f.key : null;
      if (f) { f.used++; covered++; }
    }
    for (const f of facs) r.facUse[f.key] = f.used;
    cov[kind] = total ? covered / total : 1;
  }
  r.coverage = cov;
}
const nextToAny = (spots) => (x, y) => spots.some((p) => Math.abs(x - p.x) + Math.abs(y - p.y) === 1);

// Tiles holding `kind`; usableOnly skips filthy (out-of-order) buildings.
function tilesOf(prop, kind, usableOnly) {
  const out = [];
  prop.tiles.forEach((row, y) => row.forEach((t, x) => {
    if (t.obj && t.obj.k === kind && !(usableOnly && (t.obj.dirt || 0) >= DIRT.filthy)) out.push({ x, y });
  }));
  return out;
}

// ---- Alerts ----
// `hold` keeps an alert up that long even if nothing refreshes it.
function setAlert(r, key, text, x, y, hold = 0) {
  if (text) r.alerts[key] = { text, x, y, t: r.time + hold };
}

function siteAlerts(id) {
  const r = runtime[id];
  return r && r.alerts ? Object.values(r.alerts) : [];
}

// ---- Worker roster ----
function syncWorkers(id, prop, def, r) {
  const want = {};
  for (const s of STAFF) want[s.id] = r.unpaid ? 0 : prop.staff[s.id] || 0;
  const have = {};
  r.workers = r.workers.filter((w) => {
    have[w.role] = (have[w.role] || 0) + 1;
    return have[w.role] <= want[w.role];
  });
  const door = entranceOf(prop, def);
  for (const s of STAFF) {
    for (let n = have[s.id] || 0; n < want[s.id]; n++) {
      r.workers.push({
        id: nextWorkerId++, role: s.id, x: door.x, y: door.y, fx: door.x, fy: door.y,
        path: [], mode: 'idle', breakIn: 40 + Math.random() * 80, wait: 0,
        name: WORKER_NAMES[Math.floor(Math.random() * WORKER_NAMES.length)],
      });
    }
  }
}

// Walk toward goal(); returns true once standing on a goal tile.
function walkTo(prop, def, r, w, goal, dt, label, ax, ay) {
  if (!w.path.length || !goal(w.path[w.path.length - 1].x, w.path[w.path.length - 1].y)
      || !walkable(prop, def, w.path[0].x, w.path[0].y, w.role === 'janitor')) {
    if (goal(w.x, w.y)) { w.path = []; w.stuck = null; return true; }
    w.repath = (w.repath || 0) - dt;
    if (w.repath > 0 && w.stuck) { setAlert(r, 'stuck' + w.id, w.stuck, ax, ay); return false; }
    w.repath = 1;
    const path = findPath(prop, def, w.x, w.y, goal, w.role === 'janitor');
    if (!path) {
      w.path = [];
      w.stuck = label;
      setAlert(r, 'stuck' + w.id, label, ax, ay);
      return false;
    }
    w.path = path;
    w.stuck = null;
  }
  // Move along the path.
  let step = WORKER_SPEED * (0.6 + 0.4 * (r.morale == null ? 1 : r.morale)) * dt; // unhappy staff dawdle
  while (step > 0 && w.path.length) {
    const n = w.path[0];
    const dx = n.x - w.fx, dy = n.y - w.fy;
    const dist = Math.hypot(dx, dy);
    if (dist <= step) {
      w.fx = n.x; w.fy = n.y; w.x = n.x; w.y = n.y;
      const ft = prop.tiles[n.y][n.x];
      if (w.role !== 'janitor' && ft.base === 'floor' && !ft.obj) ft.dirt = Math.min(DIRT.filthy, (ft.dirt || 0) + DIRT.perStep);
      w.path.shift();
      step -= dist;
    } else {
      w.fx += (dx / dist) * step;
      w.fy += (dy / dist) * step;
      step = 0;
    }
  }
  return !w.path.length && goal(w.x, w.y);
}

const objName = (o) => (o.k === 'assembler' ? `${o.recipe ? PRODUCTS[o.recipe].name : 'unset'} assembler` : equipName(o));

// ---- Per-tick update ----
function stepWorkers(id, prop, def, r, dt) {
  syncWorkers(id, prop, def, r);
  r.crewed = new Map();
  r.covT = (r.covT || 0) - dt;
  if (r.covT <= 0) { computeCoverage(prop, r); computeMorale(id, prop, r); r.covT = 1; }
  const pace = workPace(id) * (facCount(id, 'maintshop') ? 2 : 1);

  // Workers standing on a tile that just got built over go back to the door.
  for (const w of r.workers) {
    if (!walkable(prop, def, w.x, w.y, w.role === 'janitor')) {
      const door = entranceOf(prop, def);
      Object.assign(w, { x: door.x, y: door.y, fx: door.x, fy: door.y, path: [] });
    }
  }

  // Assemblers: every one gets an operator first; extras join (up to MAX_CREW).
  const assemblers = [];
  prop.tiles.forEach((row, y) => row.forEach((t, x) => { if (t.obj && t.obj.k === 'assembler' && t.obj.recipe) assemblers.push({ x, y, key: x + ',' + y }); }));
  const crew = new Map(assemblers.map((a) => [a.key, 0]));
  const ops = r.workers.filter((w) => w.role === 'operator');
  for (const w of ops) {
    if (w.assign && crew.has(w.assign)) crew.set(w.assign, crew.get(w.assign) + 1);
    else w.assign = null;
  }
  // An assembler with nobody pulls a helper off one that has extras.
  for (const a of assemblers) {
    if (crew.get(a.key)) continue;
    const helper = ops.find((w) => w.assign && crew.get(w.assign) > 1) || ops.find((w) => !w.assign);
    if (!helper) break;
    if (helper.assign) crew.set(helper.assign, crew.get(helper.assign) - 1);
    helper.assign = a.key; helper.path = [];
    crew.set(a.key, 1);
  }
  for (const w of ops) {
    if (w.assign) continue;
    const a = assemblers.filter((q) => crew.get(q.key) < MAX_CREW).sort((p, q) => crew.get(p.key) - crew.get(q.key))[0];
    if (a) { w.assign = a.key; crew.set(a.key, crew.get(a.key) + 1); }
  }
  const lonely = assemblers.filter((a) => !crew.get(a.key));
  if (lonely.length) {
    setAlert(r, 'nocrew', `${lonely.length} assembler${lonely.length > 1 ? 's have' : ' has'} no operator. Hire 👷 Assembler Operators in Manage → Staff.`, lonely[0].x, lonely[0].y);
  }

  // Techs: claim jobs nobody else has.
  const busy = new Set(r.workers.filter((w) => w.role === 'tech' && w.task).map((w) => w.task.x + ',' + w.task.y));
  r.skip = r.skip || {};
  const racks = tilesOf(prop, 'rack');
  r.racksBlocked = false;

  for (const w of r.workers) {
    // Breaks come first (but never in the middle of a repair).
    w.breakIn -= dt;
    if (w.mode !== 'break' && w.breakIn <= 0 && !(w.task && w.task.t > 0)) {
      const kind = facCount(id, 'restroom') && (Math.random() < 0.55 || !facCount(id, 'breakroom')) ? 'restroom'
        : facCount(id, 'breakroom') ? 'breakroom' : null;
      if (kind) { w.mode = 'break'; w.breakKind = kind; w.breakT = 0; w.path = []; } else w.breakIn = 60 + Math.random() * 60;
    }
    if (w.mode === 'break') {
      // Head for the facility covering them; otherwise the nearest one at all.
      let spots = tilesOf(prop, w.breakKind, true);
      const f = FACILITIES[w.breakKind];
      if (!spots.length) { w.mode = 'idle'; continue; }
      if (w[w.breakKind]) spots = [w[w.breakKind]].map((k) => { const [x, y] = k.split(',').map(Number); return { x, y }; });
      if (walkTo(prop, def, r, w, nextToAny(spots), dt, null)) {
        delete r.alerts['fac' + w.breakKind]; // someone made it
        const fo = w[w.breakKind] && prop.tiles[spots[0].y][spots[0].x].obj;
        w.breakT += dt * (fo && FACILITIES[fo.k] && FACILITIES[fo.k].levels ? facLevel(fo).speed : 1);
        if (w.breakT >= BREAK_LENGTH) {
          w.mode = 'idle';
          w.breakIn = 90 + Math.random() * 90;
          const used = prop.tiles[spots[0].y][spots[0].x].obj;
          if (used) dirtyBuilding(id, used, DIRT.perBreak);
        }
      } else if (w.stuck === null && !w.path.length) {
        // No route: skip this break, and keep the problem visible until someone gets there.
        setAlert(r, 'fac' + w.breakKind, `${f.icon} Staff can't reach the ${f.name}. Repair the floor or clear a path to it.`, spots[0].x, spots[0].y, 60);
        w.mode = 'idle';
        w.breakIn = 30;
      }
      continue;
    }

    if (w.role === 'operator') {
      if (!w.assign) { wander(prop, def, r, w, dt); continue; }
      const [ax, ay] = w.assign.split(',').map(Number);
      const o = prop.tiles[ay][ax].obj;
      if (walkTo(prop, def, r, w, nextTo(ax, ay), dt, `👷 Operator can't reach the ${objName(o)}. Repair the broken floor or clear a path to it.`, ax, ay)) {
        w.mode = 'work';
        r.crewed.set(w.assign, (r.crewed.get(w.assign) || 0) + 1);
      } else w.mode = 'walk';
    } else if (w.role === 'tech') {
      stepTechWorker(id, prop, def, r, w, dt, busy, pace);
    } else if (w.role === 'janitor') {
      stepJanitor(id, prop, def, r, w, dt);
    } else if (w.role === 'forklift') {
      if (!racks.length) { wander(prop, def, r, w, dt); continue; }
      const door = entranceOf(prop, def);
      const goal = w.leg === 'rack' ? nextToAny(racks) : nextTo(door.x, door.y);
      if (walkTo(prop, def, r, w, goal, dt, '🚜 Forklift operators can\'t reach any racks. Repair the floor around them.', racks[0].x, racks[0].y)) {
        w.wait += dt;
        if (w.wait > 1.2) { w.wait = 0; w.leg = w.leg === 'rack' ? 'door' : 'rack'; }
      } else if (w.stuck && w.leg === 'rack') r.racksBlocked = true;
    } else {
      // Ops / security / safety stand at their facility; others wander.
      const home = ROLE_HOME[w.role];
      const spots = home ? tilesOf(prop, home, true) : [];
      if (spots.length) walkTo(prop, def, r, w, nextToAny(spots), dt, `${ROLE_LOOK[w.role].icon} Staff can't reach the ${FACILITIES[home].name}.`, spots[0].x, spots[0].y);
      else wander(prop, def, r, w, dt);
    }
  }

  stepDirt(id, prop, def, r, dt);

  // Drop alerts that weren't refreshed recently.
  for (const [k, a] of Object.entries(r.alerts)) if (r.time - a.t > 1.5) delete r.alerts[k];
}

// ---- Morale ----
// Recomputed once a second; also handles warnings and quitting.
function computeMorale(id, prop, r) {
  const staff = totalStaff(prop);
  const parts = [];
  if (staff) {
    const cov = r.coverage || { restroom: 1, breakroom: 1 };
    if (cov.restroom < 1) parts.push({ label: '🚻 Staff without a restroom in range', v: -MORALE.restroom * (1 - cov.restroom) });
    if (cov.breakroom < 1) parts.push({ label: '☕ Staff without a break room in range', v: -MORALE.breakroom * (1 - cov.breakroom) });
    if (r.unpaid) parts.push({ label: '💸 Wages not being paid', v: -MORALE.unpaid });
    if (r.lastAccident != null) {
      const fade = 1 - (r.time - r.lastAccident) / MORALE.accidentFade;
      if (fade > 0) parts.push({ label: '🚑 Recent accident', v: -MORALE.accident * fade });
    }
    let filthy = 0;
    for (const row of prop.tiles) for (const t of row) if ((t.dirt || 0) >= DIRT.filthy) filthy++;
    if (filthy) parts.push({ label: `🪣 ${filthy} filthy floor tile${filthy > 1 ? 's' : ''}`, v: -Math.min(MORALE.filthyMax, filthy * MORALE.perFilthy) });
    if (prop.staff.hr > 0) parts.push({ label: '🗂️ HR Manager looking after people', v: MORALE.hrBonus });
  }
  r.moraleParts = parts;
  r.morale = staff ? Math.max(MORALE.min, Math.min(1, 1 + parts.reduce((a, p) => a + p.v, 0))) : 1;

  // Unhappy staff quit.
  if (staff && r.morale < MORALE.quit) {
    r.quitT = (r.quitT || 0) + 1;
    setAlert(r, 'morale', `😠 Morale is ${Math.round(r.morale * 100)}%. Staff are about to quit! Fix it in Manage → Staff.`, ...doorXY(prop, PROP_BY_ID[id]));
    if (r.quitT >= MORALE.quitAfter) {
      r.quitT = 0;
      const roles = STAFF.filter((s) => prop.staff[s.id] > 0);
      const who = roles[Math.floor(Math.random() * roles.length)];
      prop.staff[who.id]--;
      toast(`😠 A ${who.name} quit the ${PROP_BY_ID[id].name} over poor conditions`);
      setAlert(r, 'quit', `😠 A ${who.name} quit over poor conditions.`, ...doorXY(prop, PROP_BY_ID[id]), 30);
    }
  } else {
    r.quitT = Math.max(0, (r.quitT || 0) - 2);
    if (staff && r.morale < MORALE.warn) {
      setAlert(r, 'morale', `😟 Morale is ${Math.round(r.morale * 100)}%. Staff are working slower. See Manage → Staff.`, ...doorXY(prop, PROP_BY_ID[id]));
    }
  }
}

function doorXY(prop, def) {
  const d = entranceOf(prop, def);
  return [d.x, d.y];
}

const moraleFace = (m) => (m >= 0.9 ? '😊' : m >= MORALE.warn ? '😐' : m >= MORALE.quit ? '😟' : '😠');

// ---- Dirt & janitors ----
function dirtyBuilding(id, o, amount) {
  const was = (o.dirt || 0) >= DIRT.filthy;
  o.dirt = Math.min(DIRT.filthy, (o.dirt || 0) + amount);
  if (!was && o.dirt >= DIRT.filthy) markLayoutDirty(id); // just went out of order
}

function cleanBy(id, o, amount) {
  const was = (o.dirt || 0) >= DIRT.filthy;
  o.dirt = Math.max(0, (o.dirt || 0) - amount);
  if (was && o.dirt < DIRT.filthy) markLayoutDirty(id); // back in service
}

// Buildings slowly get dirty; filthy things raise alerts.
function stepDirt(id, prop, def, r, dt) {
  const janitors = prop.staff.janitor > 0;
  let filthyFloor = 0, fx = 0, fy = 0;
  prop.tiles.forEach((row, y) => row.forEach((t, x) => {
    const o = t.obj;
    if (o && FACILITIES[o.k]) {
      if (!FACILITIES[o.k].levels) dirtyBuilding(id, o, DIRT.perSecond * dt);
      if ((o.dirt || 0) >= DIRT.filthy) {
        setAlert(r, 'filthy' + x + ',' + y, `${FACILITIES[o.k].icon} ${FACILITIES[o.k].name} is filthy and out of order. ${janitors ? 'A janitor is on it.' : 'Hire a 🧹 Janitor, or tap it to clean.'}`, x, y);
      }
    } else if ((t.dirt || 0) >= DIRT.filthy) { filthyFloor++; fx = x; fy = y; }
  }));
  if (filthyFloor) {
    setAlert(r, 'filthyfloor', `🧽 ${filthyFloor} floor tile${filthyFloor > 1 ? 's are' : ' is'} filthy and blocking the way. ${janitors ? 'Janitors are cleaning.' : 'Hire a 🧹 Janitor, or use 🔨 Repair to clean.'}`, fx, fy);
  }
}

// Janitors go for the dirtiest floor tile or building nobody else is on.
function stepJanitor(id, prop, def, r, w, dt) {
  const claimed = new Set(r.workers.filter((q) => q !== w && q.role === 'janitor' && q.clean).map((q) => q.clean));
  const dirtAt = (k) => { const [x, y] = k.split(',').map(Number); const t = prop.tiles[y][x]; return t.obj && FACILITIES[t.obj.k] ? t.obj.dirt || 0 : t.dirt || 0; };
  if (!w.clean || dirtAt(w.clean) <= 0) {
    w.clean = null;
    let best = DIRT.worthCleaning;
    prop.tiles.forEach((row, y) => row.forEach((t, x) => {
      const k = x + ',' + y;
      if (claimed.has(k) || (r.skipClean && r.skipClean[k] > r.time)) return;
      const d = t.obj && FACILITIES[t.obj.k] ? t.obj.dirt || 0 : t.base === 'floor' && !t.obj ? t.dirt || 0 : 0;
      if (d >= best) { best = d; w.clean = k; }
    }));
    w.path = [];
    if (!w.clean) { wander(prop, def, r, w, dt); return; }
  }
  const [cx, cy] = w.clean.split(',').map(Number);
  const t = prop.tiles[cy][cx];
  const isBuildingTile = t.obj && FACILITIES[t.obj.k];
  const goal = isBuildingTile ? nextTo(cx, cy) : (x, y) => x === cx && y === cy;
  if (walkTo(prop, def, r, w, goal, dt, null)) {
    w.mode = 'work';
    if (t.obj && FACILITIES[t.obj.k]) cleanBy(id, t.obj, DIRT.cleanRate * dt);
    else t.dirt = Math.max(0, (t.dirt || 0) - DIRT.cleanRate * dt);
    if (dirtAt(w.clean) <= 0) w.clean = null;
  } else if (!w.path.length) {
    (r.skipClean || (r.skipClean = {}))[w.clean] = r.time + 10; // unreachable for now
    w.clean = null;
  }
}

function wander(prop, def, r, w, dt) {
  w.wait -= dt;
  if (w.path.length) { walkTo(prop, def, r, w, (x, y) => x === w.dest.x && y === w.dest.y, dt, null); return; }
  if (w.wait > 0) return;
  w.wait = 3 + Math.random() * 5;
  for (let tries = 0; tries < 6; tries++) {
    const x = 1 + Math.floor(Math.random() * (def.cols - 2)), y = 1 + Math.floor(Math.random() * (def.rows - 2));
    if (!walkable(prop, def, x, y)) continue;
    const path = findPath(prop, def, w.x, w.y, (px, py) => px === x && py === y);
    if (path) { w.path = path; w.dest = { x, y }; return; }
  }
}

// Techs walk to the job before the repair or service clock starts.
function stepTechWorker(id, prop, def, r, w, dt, busy, pace) {
  if (w.task) {
    const t = w.task;
    const o = prop.tiles[t.y][t.x].obj;
    if (!o || o !== t.obj) { w.task = null; return; }
    if (walkTo(prop, def, r, w, nextTo(t.x, t.y), dt, `🔧 Tech can't reach the ${t.kind === 'repair' ? 'broken' : 'worn'} ${objName(o)}. Repair the floor or clear a path.`, t.x, t.y)) {
      w.mode = 'work';
      t.t += dt * pace;
      if (t.t >= t.dur) {
        if (t.kind === 'repair') unjam(o);
        else o.wear = 0;
        w.task = null;
        w.rest = t.kind === 'pm' ? TECH_PM_REST / pace : 0;
      }
    } else if (w.stuck) {
      r.skip[t.x + ',' + t.y] = r.time + 8; // try other jobs for a bit
      busy.delete(t.x + ',' + t.y);
      w.task = null;
    }
    return;
  }
  w.rest = Math.max(0, (w.rest || 0) - dt);
  const skip = new Set(busy);
  for (const [k, until] of Object.entries(r.skip)) if (until > r.time) skip.add(k);
  const job = findTechJob(prop, skip, w.rest > 0);
  if (job) { w.task = job; busy.add(job.x + ',' + job.y); w.path = []; } else wander(prop, def, r, w, dt);
}

// ---- Worker info (tap a person) ----
function workerAt(px, py) {
  const r = state.current && runtime[state.current];
  if (!r) return null;
  const s = view.ts;
  let best = null, bestD = s * 0.45;
  for (const w of r.workers) {
    if (w.role === 'operator' && w.mode === 'work' && !w.path.length) continue; // shown as the assembler badge
    const cx = view.ox + (w.fx + 0.5) * s, cy = view.oy + (w.fy + 0.5) * s;
    const d = Math.hypot(px - cx, py - cy);
    if (d < bestD) { bestD = d; best = w; }
  }
  return best;
}

function workerActivity(prop, w) {
  if (w.stuck) return `❗ Stuck: ${w.stuck}`;
  if (w.mode === 'break') {
    const f = FACILITIES[w.breakKind];
    return w.path.length ? `Heading to the ${f.icon} ${f.name} for a break` : `On a break at the ${f.icon} ${f.name}`;
  }
  const at = (k) => { const [x, y] = k.split(',').map(Number); return prop.tiles[y][x].obj; };
  switch (w.role) {
    case 'operator': {
      if (!w.assign) return 'Waiting for an assembler to run';
      const o = at(w.assign);
      return o ? (w.mode === 'work' ? `Running the ${objName(o)}` : `Walking to the ${objName(o)}`) : 'Looking for work';
    }
    case 'tech': {
      if (!w.task) return 'Looking for worn or broken equipment';
      const o = prop.tiles[w.task.y][w.task.x].obj;
      const what = o ? objName(o) : 'equipment';
      return w.mode === 'work' ? `${w.task.kind === 'repair' ? 'Repairing' : 'Servicing'} the ${what}` : `Walking to the ${what}`;
    }
    case 'janitor': {
      if (!w.clean) return 'Looking for something to clean';
      const o = at(w.clean);
      const what = o && FACILITIES[o.k] ? `the ${FACILITIES[o.k].name}` : 'the floor';
      return w.mode === 'work' ? `Cleaning ${what}` : `Walking over to clean ${what}`;
    }
    case 'forklift':
      return w.leg === 'rack' ? 'Taking products to the racks' : 'Fetching products from the doors';
    default: {
      const home = ROLE_HOME[w.role];
      if (home && tilesOf(prop, home, true).length) return `Working at the ${FACILITIES[home].name}`;
      return 'Walking the floor';
    }
  }
}

function workerHTML() {
  const id = state.current;
  const r = runtime[id];
  const w = r && r.workers.find((q) => q.id === ui.workerSel);
  if (!w) return '<p class="intro">That person has left.</p>';
  const prop = state.props[id], def = PROP_BY_ID[id];
  const role = STAFF_BY_ID[w.role];
  document.getElementById('modalTitle').textContent = `${ROLE_LOOK[w.role].icon} ${w.name || 'Worker'}`;
  const row = (k, v, cls = '') => `<div class="stat-row ${cls}"><span>${k}</span><b>${v}</b></div>`;
  const m = moraleOf(id);
  let html = `<p class="intro">${role.name}: ${role.desc}</p><div class="stats risk">`;
  html += row('Doing', workerActivity(prop, w), w.stuck ? 'neg' : '');
  html += row('Mood', `${moraleFace(m)} ${Math.round(m * 100)}% site morale`, m < MORALE.warn ? 'neg' : '');
  html += row('Pace', `${Math.round(workPace(id) * 100)}%`);
  html += row('Next break', w.mode === 'break' ? 'now' : `in ~${Math.max(0, Math.round(w.breakIn))}s`);
  html += row('Wage', `${fmt(staffWage(role, def, prop))}/min`);
  html += '</div>';
  html += '<p class="intro small">Manage staff in 🏗️ Manage → Staff.</p>';
  return html;
}
