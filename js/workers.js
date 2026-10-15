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
  buyer: { icon: '🧾', color: '#a569bd' },
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
  return !o || o.k === 'belt' || o.k === 'splitter' || o.k === 'sorter' || o.k === 'bridge'; // step over conveyors
}

// Doors staff can come in by: unlocked, with walkable floor just inside (a machine parked
// right in front of a door blocks it, but staff simply use another one).
function entrances(prop, def) {
  const doors = [...def.outDocks, ...def.inDocks].filter((k) => !prop.tiles[k.y][k.x].locked);
  const open = doors.filter((k) => DIRS.some((d) => {
    const nx = k.x + d.x, ny = k.y + d.y;
    return nx > 0 && ny > 0 && nx < def.cols - 1 && ny < def.rows - 1 && walkable(prop, def, nx, ny);
  }));
  return open.length ? open : doors.slice(0, 1);
}
function entranceOf(prop, def) {
  const d = entrances(prop, def)[0];
  return { x: d.x, y: d.y };
}
// Every tile staff can get to from an open door (wade: count filthy floor, which janitors cross).
function reachFromDoors(prop, def, wade) {
  const seen = new Uint8Array(def.cols * def.rows);
  const q = entrances(prop, def).map((d) => d.y * def.cols + d.x);
  for (const i of q) seen[i] = 1;
  for (let i = 0; i < q.length; i++) {
    const cx = q[i] % def.cols, cy = (q[i] / def.cols) | 0;
    for (const d of DIRS) {
      const nx = cx + d.x, ny = cy + d.y;
      if (!walkable(prop, def, nx, ny, wade) || seen[ny * def.cols + nx]) continue;
      seen[ny * def.cols + nx] = 1;
      q.push(ny * def.cols + nx);
    }
  }
  return seen;
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
    const keep = have[w.role] <= want[w.role];
    if (!keep) returnCarry(prop, w);
    return keep;
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

// When buildings split the floor in two, staff on the wrong side walk out one door and
// come back in by another (outside isn't drawn, so they step out and reappear).
function aroundOutside(prop, def, w, goal) {
  const wade = w.role === 'janitor';
  const doors = entrances(prop, def);
  const isDoor = (x, y) => doors.some((d) => d.x === x && d.y === y);
  const way = doors.find((d) => findPath(prop, def, d.x, d.y, goal, wade));
  if (!way) return null;
  if (isDoor(w.x, w.y)) {
    Object.assign(w, { x: way.x, y: way.y, fx: way.x, fy: way.y });
    return findPath(prop, def, w.x, w.y, goal, wade);
  }
  return findPath(prop, def, w.x, w.y, isDoor, wade);
}

// Walk toward goal(); returns true once standing on a goal tile.
function walkTo(prop, def, r, w, goal, dt, label, ax, ay) {
  if (!w.path.length || !goal(w.path[w.path.length - 1].x, w.path[w.path.length - 1].y)
      || !walkable(prop, def, w.path[0].x, w.path[0].y, w.role === 'janitor')) {
    if (goal(w.x, w.y)) { w.path = []; w.stuck = null; return true; }
    w.repath = (w.repath || 0) - dt;
    if (w.repath > 0 && w.stuck) { setAlert(r, 'stuck' + w.id, w.stuck, ax, ay); return false; }
    w.repath = 1;
    const direct = findPath(prop, def, w.x, w.y, goal, w.role === 'janitor');
    const path = direct || aroundOutside(prop, def, w, goal);
    w.detour = !direct && !!path;
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
      if (w.role !== 'janitor' && ft.base === 'floor' && !ft.obj) ft.dirt = Math.min(DIRT.filthy, (ft.dirt || 0) + DIRT.perStep * (1 - rfx('dirt')));
      w.path.shift();
      step -= dist;
    } else {
      w.fx += (dx / dist) * step;
      w.fy += (dy / dist) * step;
      step = 0;
    }
  }
  if (w.detour && !w.path.length && !goal(w.x, w.y)) { // reached the door: back in by the other one
    w.detour = false;
    w.path = aroundOutside(prop, def, w, goal) || [];
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

  // Workers standing on a tile that just got built over, or cut off from the rest of the
  // site (boxed in, or at a door that got blocked), walk back in through an open door.
  const reach = r.covT === 1 ? reachFromDoors(prop, def, true) : null; // checked once a second
  for (const w of r.workers) {
    if (!walkable(prop, def, w.x, w.y, w.role === 'janitor') || (reach && !reach[w.y * def.cols + w.x])) {
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
  // Cobot Stations crew every assembler in range.
  const cobots = tilesOf(prop, 'cobot', true);
  const botCrewed = new Set(assemblers.filter((a) => cobots.some((c) => Math.abs(c.x - a.x) + Math.abs(c.y - a.y) <= COBOT_RANGE)).map((a) => a.key));
  const lonely = assemblers.filter((a) => !crew.get(a.key) && !botCrewed.has(a.key));
  if (lonely.length) {
    setAlert(r, 'nocrew', `${lonely.length} assembler${lonely.length > 1 ? 's have' : ' has'} no operator and run${lonely.length > 1 ? '' : 's'} at 25% speed. Hire 👷 Assembler Operators in Manage → Staff.`, lonely[0].x, lonely[0].y);
  }

  // Techs: claim jobs nobody else has.
  const busy = new Set(r.workers.filter((w) => w.role === 'tech' && w.task).map((w) => w.task.x + ',' + w.task.y));
  r.skip = r.skip || {};
  const racks = tilesOf(prop, 'rack');
  r.racksBlocked = false;
  // Restocking jobs, each taken by one forklift at a time.
  const jobs = supplyJobs(id, prop);
  const claimed = new Set(r.workers.filter((w) => w.job).map((w) => w.job.key));
  if (jobs.length && !r.workers.some((w) => w.role === 'forklift')) {
    const j = jobs[0];
    setAlert(r, 'nofeed', `${PRODUCTS[j.p].icon} ${PRODUCTS[j.p].name} is in storage but an assembler is out of it. Hire a 🚜 Forklift Operator to bring it over.`, j.ax, j.ay);
  }

  for (const w of r.workers) {
    // Breaks come first (but never in the middle of a repair).
    w.breakIn -= dt;
    if (w.mode !== 'break' && w.breakIn <= 0 && !(w.task && w.task.t > 0) && !w.job) { // finish a delivery first
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
          if (used) dirtyBuilding(id, used, DIRT.perBreak * (1 - rfx('dirt')));
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
      if (!w.job && jobs.length) {
        // Feeding a starved assembler comes first; take the nearest open job.
        const open = jobs.filter((q) => !claimed.has(q.key));
        const j = open.sort((p, q) => (Math.abs(p.rx - w.x) + Math.abs(p.ry - w.y)) - (Math.abs(q.rx - w.x) + Math.abs(q.ry - w.y)))[0];
        if (j) { w.job = j; claimed.add(j.key); w.path = []; w.wait = 0; }
      }
      if (w.job) { stepSupplyRun(id, prop, def, r, w, dt); continue; }
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

  for (const k of botCrewed) r.crewed.set(k, (r.crewed.get(k) || 0) + 1);

  stepDirt(id, prop, def, r, dt);

  // Drop alerts that weren't refreshed recently.
  for (const [k, a] of Object.entries(r.alerts)) if (r.time - a.t > 1.5) delete r.alerts[k];
}

// ---- Forklift restocking ----
// An assembler about to run out of an ingredient (not enough for the craft after
// this one, and no conveyor bringing it) gets a forklift load from the nearest
// rack holding it: up to FORKLIFT_CARRY per trip, one (priority) handling move.
function supplyJobs(id, prop) {
  const jobs = [];
  if (!Object.values(prop.held).some((n) => n > 0)) return jobs;
  const racks = tilesOf(prop, 'rack');
  prop.tiles.forEach((row, ay) => row.forEach((t, ax) => {
    const o = t.obj;
    if (!o || o.k !== 'assembler' || !o.recipe || o.jammed || o.noFeed || assemblerIdle(o)) return;
    const rec = RECIPES[o.recipe];
    for (const [p, n] of Object.entries(rec.in)) {
      const have = (o.buf && o.buf[p]) || 0;
      if (have >= n * 2 || !(prop.held[p] > 0)) continue;
      const belted = o.beltT && o.beltT[p] != null && rt(id).time - o.beltT[p] < 10;
      if (have >= n && belted) continue; // the conveyor is keeping up
      const rack = racks.filter((q) => ((prop.tiles[q.y][q.x].obj.stock || {})['stored:' + p] || 0) > 0)
        .sort((a, b) => (Math.abs(a.x - ax) + Math.abs(a.y - ay)) - (Math.abs(b.x - ax) + Math.abs(b.y - ay)))[0];
      if (rack) jobs.push({ ax, ay, key: ax + ',' + ay + ':' + p, p, rx: rack.x, ry: rack.y });
    }
  }));
  return jobs;
}

// Put a carried load back into storage (job cancelled, assembler gone, etc.).
function returnCarry(prop, w) {
  if (!w.carry) return;
  prop.held[w.carry.p] = (prop.held[w.carry.p] || 0) + w.carry.n;
  w.carry = null;
}

function stepSupplyRun(id, prop, def, r, w, dt) {
  const j = w.job;
  const a = prop.tiles[j.ay][j.ax].obj;
  const valid = a && a.k === 'assembler' && a.recipe && RECIPES[a.recipe].in[j.p] && !a.noFeed;
  if (!valid) { returnCarry(prop, w); w.job = null; return; }
  if (!w.carry) {
    // Pick up at the rack.
    const ro = prop.tiles[j.ry][j.rx].obj;
    const there = ro && ro.k === 'rack' ? (ro.stock || {})['stored:' + j.p] || 0 : 0;
    if (!there || !(prop.held[j.p] > 0)) { w.job = null; return; }
    if (!walkTo(prop, def, r, w, nextTo(j.rx, j.ry), dt, '🚜 Forklift can\'t reach the rack with the stock. Repair the floor around it.', j.rx, j.ry)) { w.mode = 'walk'; return; }
    w.mode = 'work';
    w.wait += dt;
    if (w.wait < 1 || !takeMove(id, true)) return; // loading the forks
    w.wait = 0;
    const cap = Math.max(RECIPES[a.recipe].in[j.p] * ASSEMBLER.bufferRecipes, FORKLIFT_CARRY);
    const n = Math.max(1, Math.min(FORKLIFT_CARRY, there, prop.held[j.p], cap - ((a.buf && a.buf[j.p]) || 0)));
    ro.stock['stored:' + j.p] -= n;
    if (!ro.stock['stored:' + j.p]) delete ro.stock['stored:' + j.p];
    prop.held[j.p] -= n;
    if (!prop.held[j.p]) delete prop.held[j.p];
    w.carry = { p: j.p, n };
    w.path = [];
    return;
  }
  // Drop it at the assembler.
  if (!walkTo(prop, def, r, w, nextTo(j.ax, j.ay), dt, `🚜 Forklift can't reach the ${objName(a)}. Repair the floor or clear a path to it.`, j.ax, j.ay)) { w.mode = 'walk'; return; }
  w.mode = 'work';
  w.wait += dt;
  if (w.wait < 0.6) return;
  w.wait = 0;
  const buf = a.buf || (a.buf = {});
  buf[w.carry.p] = (buf[w.carry.p] || 0) + w.carry.n;
  addFloater(id, r, j.ax + 0.5, j.ay + 0.2, `🚜 +${w.carry.n} ${PRODUCTS[w.carry.p].icon}`, '242,201,76');
  w.carry = null;
  w.job = null;
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
    if (neglectOf(prop, 'hr') > 0.02) parts.push({ label: '🗂️ Grievances piling up (no HR Manager)', v: -NEGLECT.moraleHit * neglectOf(prop, 'hr') });
    if (rfx('morale')) parts.push({ label: '🔬 Research perks', v: rfx('morale') });
    if (prop.payRate) parts.push({ label: `💵 Paying ${PAY_RATES[prop.payRate].label} wages`, v: PAY_RATES[prop.payRate].morale });
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
    if (o && t.dirt) t.dirt = 0; // floor dirt only lives on bare floor (old saves could hide a filthy tile under a conveyor)
    if (o && FACILITIES[o.k]) {
      if (!FACILITIES[o.k].levels) dirtyBuilding(id, o, DIRT.perSecond * (1 - rfx('dirt')) * dt);
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
    case 'forklift': {
      if (w.job) {
        const a = at(w.job.ax + ',' + w.job.ay);
        const what = a ? objName(a) : 'assembler';
        const P = PRODUCTS[w.job.p];
        return w.carry ? `Bringing ${w.carry.n} ${P.icon} ${P.name} to the ${what}` : `Fetching ${P.icon} ${P.name} from the racks for the ${what}`;
      }
      return w.leg === 'rack' ? 'Taking products to the racks' : 'Fetching products from the doors';
    }
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
  html += row('Next break', w.mode === 'break' ? (w.path.length ? 'heading there now' : 'on break') : w.breakIn < 20 ? `needs one soon (~${Math.max(0, Math.round(w.breakIn))}s)` : `in ~${Math.round(w.breakIn)}s`);
  html += row('Wage', `${fmt(staffWage(role, def, prop))}/min`);
  html += '</div>';
  html += payRateHTML(prop);
  html += `<button class="btn danger" style="width:100%;margin-top:8px" data-act="firew">🚪 Let ${w.name || 'them'} go</button>`;
  html += '<p class="intro small">Manage everyone in 🏗️ Manage → Staff.</p>';
  return html;
}

// Site-wide pay rate control (used on the worker card and the Staff tab).
function payRateHTML(prop) {
  const lvl = prop.payRate || 0;
  const p = PAY_RATES[lvl];
  return `<div class="power-box"><div class="power-head"><span>💵 Pay rate (everyone here)</span><b>${p.label}</b></div>
    <div class="power-note">${lvl ? `Wages ×${p.mult} · morale +${Math.round(p.morale * 100)}%` : 'Standard wages. Pay more to lift morale.'}</div>
    <div class="dest-ctl"><button class="step" data-act="pay" data-id="-1" ${lvl ? '' : 'disabled'}>−</button>
      <span class="pay-pips">${PAY_RATES.map((_, i) => `<span class="pip ${i <= lvl ? 'on' : ''}"></span>`).join('')}</span>
      <button class="step" data-act="pay" data-id="1" ${lvl < PAY_RATES.length - 1 ? '' : 'disabled'}>+</button></div></div>`;
}

// How a worker is doing, as a small badge on their icon.
function workerBadge(r, w) {
  if (w.stuck) return null; // the ❗ bubble covers it
  if (w.carry) return '📦';
  if (w.mode === 'break' && w.path.length) return FACILITIES[w.breakKind].icon; // heading to a break
  const m = r.morale == null ? 1 : r.morale;
  if (m < MORALE.quit) return '😠';
  if (m < MORALE.warn) return '😟';
  if (w.mode !== 'break' && w.breakIn < 20) return '⏳';
  return null;
}

// ---- Path check when building ----
// Which assemblers / facilities / racks staff can stand next to right now.
function reachableTargets(prop, def) {
  const seen = new Uint8Array(def.cols * def.rows);
  const q = entrances(prop, def).map((d) => d.y * def.cols + d.x); // staff come in by any open door
  for (const i of q) seen[i] = 1;
  for (let i = 0; i < q.length; i++) {
    const cx = q[i] % def.cols, cy = (q[i] / def.cols) | 0;
    for (const d of DIRS) {
      const nx = cx + d.x, ny = cy + d.y;
      if (!walkable(prop, def, nx, ny) || seen[ny * def.cols + nx]) continue;
      seen[ny * def.cols + nx] = 1;
      q.push(ny * def.cols + nx);
    }
  }
  const out = new Map();
  prop.tiles.forEach((row, y) => row.forEach((t, x) => {
    const o = t.obj;
    if (!o || !(o.k === 'assembler' || o.k === 'rack' || (FACILITIES[o.k] && t.base === 'floor'))) return;
    if (DIRS.some((d) => seen[(y + d.y) * def.cols + (x + d.x)])) out.set(x + ',' + y, o);
  }));
  return out;
}

const targetName = (o) => (o.k === 'assembler' ? `${o.recipe ? PRODUCTS[o.recipe].name + ' ' : ''}assembler` : o.k === 'rack' ? 'racks' : FACILITIES[o.k].name);

// Call with the reachable set from before a build; warns if something got cut off.
function warnIfCutOff(prop, def, before) {
  const after = reachableTargets(prop, def);
  for (const [k, o] of before) {
    if (!after.has(k) && prop.tiles[+k.split(',')[1]][+k.split(',')[0]].obj === o) {
      toast(`⚠️ That blocks the only path to your ${targetName(o)}. Repair floor next to it for a walkway`);
      return;
    }
  }
}
