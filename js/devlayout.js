'use strict';
// 🧪 Dev stage jumps build every owned site the way a player (the test bot) would have by then:
// conveyor trunk, assembler blocks with recipes, sorters, racks, facilities, staff, value
// machines, distribution plans and trucks. Same planner as the playtest bot.

const DEV_SITES = {
  mill: { mx: 4, use: ['2,0', '5,0', '8,0', '0,6'], unlock: ['8,0', '0,6'], blocks: [{ recipe: 'wiring' }, { recipe: 'circuit' }, { recipe: 'spares', mars: true }, { recipe: 'foodcrate', mars: true }] },
  foundry: { mx: 5, use: ['2,0', '5,0', '8,0'], unlock: ['8,0'], blocks: [{ recipe: 'alloy' }, { recipe: 'valve' }, { recipe: 'turbopump' }] },
  depot: { mx: 4, use: ['2,0', '5,0', '0,4', '10,3'], unlock: ['0,4'], marsUnlock: ['10,3'], blocks: [{ recipe: 'tank' }, { recipe: 'fuselage' }, { recipe: 'engine' }, { recipe: 'heatshield' }] },
  refinery: { mx: 4, use: ['2,0', '5,0'], blocks: [{ recipe: 'fuel' }, { recipe: 'solar' }, { recipe: 'lifesupport' }] },
  lab: { mx: 4, use: ['2,0', '5,0'], blocks: [{ recipe: 'sensor' }, { recipe: 'computer' }, { recipe: 'avionics' }, { recipe: 'canister', mars: true }] },
  hub: { mx: 5, use: ['5,0'], blocks: [{ recipe: 'fusioncore' }, { recipe: 'superconductor' }] },
};
// Who supplies whom: product -> [[consumer site, cap]].
const DEV_FLOWS = {
  panel: [['depot', 30], ['foundry', 20], ['mill', 15]],
  wiring: [['mill', 25], ['lab', 25], ['refinery', 15], ['hub', 20]],
  circuit: [['lab', 40]],
  silicon: [['refinery', 20]],
  alloy: [['depot', 15], ['refinery', 15], ['lab', 15], ['hub', 15]],
  valve: [['depot', 15], ['mill', 12]],
  provisions: [['mill', 40]],
  turbopump: [['depot', 10]],
  lox: [['refinery', 25], ['lab', 10], ['mill', 20]],
  computer: [['refinery', 10], ['hub', 10]],
};
const DEV_PRODUCER = { panel: ['shed'], wiring: ['shed', 'mill'], circuit: ['mill'], silicon: ['mill'], alloy: ['foundry'], valve: ['foundry'], turbopump: ['foundry'], lox: ['depot'], provisions: ['depot'], computer: ['lab'] };

// Trunk down column mx, docks feeding it along row 1, and per-recipe blocks: a sorter on the
// trunk for each ingredient, the assembler beside it, and its output merging back below.
function devPlanSite(def, cfg) {
  const W = def.cols, H = def.rows;
  const blocked = new Set();
  const key = (x, y) => x + ',' + y;
  for (const [x, y] of def.pillars) blocked.add(key(x, y));
  const free = (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1 && !blocked.has(key(x, y));
  const cells = [];
  const used = new Map();
  const add = (c) => { cells.push(c); used.set(key(c.x, c.y), c); blocked.add(key(c.x, c.y)); };
  const mx = cfg.mx, bottom = H - 2;
  const out = def.outDocks[0];
  for (const d of def.inDocks.filter((d) => d.y === 0 && cfg.use.includes(d.x + ',' + d.y))) {
    if (d.x === mx) continue;
    const s = d.x < mx ? 1 : -1;
    for (let x = d.x; x !== mx; x += s) add({ x, y: 1, k: 'belt', dir: s > 0 ? 1 : 3 });
  }
  for (const d of def.inDocks.filter((d) => d.x === 0 && cfg.use.includes(d.x + ',' + d.y))) {
    for (let y = d.y; y > 1; y--) add({ x: 1, y, k: 'belt', dir: 0 });
    if (!used.has(key(1, 1))) for (let x = 1; x < mx; x++) if (!used.has(key(x, 1))) add({ x, y: 1, k: 'belt', dir: 1 });
  }
  for (const d of def.inDocks.filter((d) => d.x === W - 1 && cfg.use.includes(d.x + ',' + d.y))) {
    for (let y = d.y; y > 1; y--) if (!used.has(key(W - 2, y))) add({ x: W - 2, y, k: 'belt', dir: 0 });
    for (let x = W - 2; x > mx; x--) if (!used.has(key(x, 1))) add({ x, y: 1, k: 'belt', dir: 3 });
  }
  const trunk = new Map();
  for (let y = 1; y < bottom; y++) { add({ x: mx, y, k: 'belt', dir: 2 }); trunk.set(y, { yellow: null, merge: new Set() }); }
  const sb = out.x < mx ? -1 : 1;
  add({ x: mx, y: bottom, k: 'belt', dir: out.x === mx ? 2 : sb > 0 ? 1 : 3 });
  for (let x = mx + sb; out.x !== mx && x !== out.x + sb; x += sb) add({ x, y: bottom, k: 'belt', dir: x === out.x ? 2 : sb > 0 ? 1 : 3 });
  let minRow = 2;
  const placed = [];
  for (const b of cfg.blocks) {
    const ins = Object.keys(RECIPES[b.recipe].in), k = ins.length;
    let best = null;
    for (let r0 = minRow; r0 + k <= bottom - 1 && !best; r0++) {
      for (const s of [-1, 1]) {
        const y = r0 + k - 1, sd = s > 0 ? 1 : 3;
        const need = [[mx + s, y], [mx + s, y + 1]];
        if (k >= 2) need.push([mx + s, y - 1]);
        if (k >= 3) need.push([mx + s, y - 2], [mx + 2 * s, y - 2], [mx + 2 * s, y - 1], [mx + 2 * s, y]);
        if (!need.every(([x, yy]) => free(x, yy))) continue;
        let ok = true;
        for (let yy = r0; yy <= y; yy++) { const t = trunk.get(yy); if (!t || t.yellow != null || t.merge.has(sd)) ok = false; }
        const m = trunk.get(y + 1);
        if (!m || m.yellow === sd) ok = false;
        if (ok) { best = { s, sd, y, r0 }; break; }
      }
    }
    if (!best) continue;
    const { s, sd, y } = best, toward = (sd + 2) % 4, bid = `${b.recipe}@${y}`, start = cells.length;
    const sorterAt = (row, p) => { const c = used.get(key(mx, row)); c.k = 'sorter'; c.block = bid; c.filter = p; c.split = { [sd]: 9, 2: 1 }; trunk.get(row).yellow = sd; };
    sorterAt(y, ins[0]);
    add({ x: mx + s, y, k: 'assembler', dir: 2, recipe: b.recipe });
    add({ x: mx + s, y: y + 1, k: 'belt', dir: toward });
    trunk.get(y + 1).merge.add(sd);
    if (k >= 2) { sorterAt(y - 1, ins[1]); add({ x: mx + s, y: y - 1, k: 'belt', dir: 2 }); }
    if (k >= 3) {
      sorterAt(y - 2, ins[2]);
      add({ x: mx + s, y: y - 2, k: 'belt', dir: sd });
      add({ x: mx + 2 * s, y: y - 2, k: 'belt', dir: 2 });
      add({ x: mx + 2 * s, y: y - 1, k: 'belt', dir: 2 });
      add({ x: mx + 2 * s, y, k: 'belt', dir: toward });
    }
    for (const c of cells.slice(start)) c.block = bid;
    placed.push({ recipe: b.recipe, side: s, row: y, bid, mars: !!b.mars });
  }
  const spare = [];
  for (let y = 2; y < bottom; y++) for (let x = 1; x < W - 1; x++) if (free(x, y) && !def.inDocks.some((d) => d.x === x && d.y === y)) spare.push([x, y]);
  spare.sort((a, b) => Math.abs(a[1] - H / 2) - Math.abs(b[1] - H / 2));
  return { cells, placed, spare, mx };
}

function devShedCells() {
  const c = [];
  const line = (pts, dirs) => pts.forEach(([x, y], i) => c.push({ x, y, k: 'belt', dir: dirs[i] }));
  line([[2,1],[2,2],[2,3],[2,4],[2,5],[2,6],[2,7],[2,8],[2,9],[2,10],[3,10],[4,10]], [2,2,2,2,2,2,2,2,2,1,1,2]);
  Object.assign(c.find((q) => q.x === 2 && q.y === 4), { k: 'assembler', recipe: 'panel' });
  [[5,1],[5,2],[5,3],[5,4],[5,5],[5,6],[5,7],[5,8],[5,9],[5,10]].forEach(([x, y], i) => c.push({ x, y, k: 'belt', dir: i === 9 ? 3 : 2 }));
  Object.assign(c.find((q) => q.x === 5 && q.y === 4), { k: 'assembler', recipe: 'wiring' });
  return c;
}

// Put one planned cell on the floor, free (dev setup), with its settings.
function devPut(id, c, tier) {
  const P = state.props[id], D = PROP_BY_ID[id], t = P.tiles[c.y] && P.tiles[c.y][c.x];
  if (!t || (t.base !== 'floor' && t.base !== 'broken')) return false;
  t.base = 'floor';
  t.obj = makeObj(c.k, c.dir || 0, D);
  if (c.k === 'belt') t.obj.tier = tier;
  if (c.k === 'assembler') { t.obj.recipe = c.recipe; if (LAUNCH.needs[c.recipe]) t.obj.mode = 'auto'; }
  if (c.k === 'sorter') { t.obj.filter = c.filter; t.obj.split = c.split; t.obj.wrr = {}; }
  return true;
}

// Build a site's layout for the current stage (research, launches and stage time decide what's there).
function devBuildSite(id) {
  const P = state.props[id], D = PROP_BY_ID[id];
  const mars = state.launch.count >= 1;
  const tier = hasResearch('express') && mars ? 2 : state.clock >= 4 * 3600 ? 1 : 0;
  const works = []; // assembler spots, for facilities nearby
  let spare, near;
  if (id === 'shed') {
    for (const c of devShedCells()) devPut(id, c, tier);
    if (!mars) { devPut(id, { x: 2, y: 7, k: 'scanner', dir: 2 }, tier); devPut(id, { x: 2, y: 8, k: 'labeler', dir: 2 }, tier); }
    for (const [x, y, k] of [[3, 3, 'restroom'], [3, 5, 'breakroom'], [6, 2, 'rack'], [6, 3, 'rack'], [6, 6, 'rack'], [6, 7, 'rack']]) devPut(id, { x, y, k });
    works.push([2, 4], [5, 4]);
    P.tiles[0][5].locked = false;
  } else {
    const cfg = DEV_SITES[id];
    const L = devPlanSite(D, cfg);
    const ok = (p) => (!RECIPES[p.recipe].research || hasResearch(RECIPES[p.recipe].research)) && (!p.mars || mars) && (p.recipe !== 'superconductor' || hasResearch('refining')) && hasResearch('sorter');
    const live = new Set(L.placed.filter(ok).map((p) => p.bid));
    for (const c of L.cells) {
      if (!c.block) devPut(id, c, tier);
      else if (live.has(c.block)) devPut(id, c, tier);
      else if (c.k === 'sorter' || (c.x === L.mx)) devPut(id, { ...c, k: 'belt' }, tier); // trunk stays a plain belt
    }
    for (const p of L.placed) if (live.has(p.bid)) works.push([L.mx + p.side, p.row]);
    for (const xy of [...(cfg.unlock || []), ...(mars ? cfg.marsUnlock || [] : [])]) { const [x, y] = xy.split(',').map(Number); P.tiles[y][x].locked = false; }
    near = [...L.spare].sort((a, b) => works.reduce((n, w) => n + Math.abs(a[0] - w[0]) + Math.abs(a[1] - w[1]), 0) - works.reduce((n, w) => n + Math.abs(b[0] - w[0]) + Math.abs(b[1] - w[1]), 0));
    if (near[0]) devPut(id, { x: near[0][0], y: near[0][1], k: 'restroom' });
    if (near[1]) devPut(id, { x: near[1][0], y: near[1][1], k: 'breakroom' });
    const racks = L.spare.filter(([x, y]) => !near.slice(0, 4).some(([a, b]) => a === x && b === y)).slice(-4);
    for (const [x, y] of racks) devPut(id, { x, y, k: 'rack' });
    spare = L.spare.filter(([x, y]) => !P.tiles[y][x].obj);
    // Scanner + labeler just before the shipping door (not at the busy Mill and Lab).
    if (!['mill', 'lab'].includes(id)) {
      const tail = L.cells.filter((c) => c.y === D.rows - 2 && c.x !== D.outDocks[0].x && c.k === 'belt').slice(0, 2);
      if (tail[0]) devPut(id, { ...tail[0], k: 'scanner' }, tier);
      if (tail[1]) devPut(id, { ...tail[1], k: 'labeler' }, tier);
    }
  }
  // Late game: Precision Fab Cells by the assemblers and Research Benches, if they don't block a walkway.
  const tryPut = (x, y, k) => {
    const before = reachableTargets(P, D);
    if (!devPut(id, { x, y, k })) return false;
    const after = reachableTargets(P, D);
    if ([...before.keys()].some((q) => !after.has(q))) { P.tiles[y][x].obj = null; return false; }
    return true;
  };
  const floorFree = () => { const out = []; for (let y = 1; y < D.rows - 1; y++) for (let x = 1; x < D.cols - 1; x++) if (P.tiles[y][x].base === 'floor' && !P.tiles[y][x].obj) out.push([x, y]); return out; };
  if (!facLockReason(FACILITIES.fabcell)) for (const [ax, ay] of works) {
    floorFree().filter(([x, y]) => Math.abs(x - ax) + Math.abs(y - ay) <= FAB_RANGE).sort((a, b) => Math.abs(a[0] - ax) + Math.abs(a[1] - ay) - (Math.abs(b[0] - ax) + Math.abs(b[1] - ay))).find(([x, y]) => tryPut(x, y, 'fabcell'));
  }
  if (state.launch.owned && ['lab', 'refinery'].includes(id) && !facLockReason(FACILITIES.bench)) floorFree().slice(0, 6).filter(([x, y]) => tryPut(x, y, 'bench')).slice(0, 2);
  // Staff: an operator per assembler, plus the regulars.
  const asm = P.tiles.flat().filter((t) => t.obj && t.obj.k === 'assembler').length;
  Object.assign(P.staff, { operator: asm, janitor: 1, tech: 1, forklift: id === 'shed' ? 1 : 2, sales: hasResearch('marketing') ? 2 : 0 });
  markLayoutDirty(id);
}

// Distribution plans and trucks between the sites, like the bot runs them.
function devPlansAndTrucks() {
  const sites = PROPERTIES.map((d) => d.id).filter((id) => state.props[id].owned);
  const uses = (to, p) => state.props[to].tiles.some((row) => row.some((t) => t.obj && t.obj.k === 'assembler' && t.obj.recipe && RECIPES[t.obj.recipe].in[p]));
  for (const site of sites) {
    const P = state.props[site];
    for (const [p, cons] of Object.entries(DEV_FLOWS)) {
      if (!DEV_PRODUCER[p].includes(site)) continue;
      const dests = cons.filter(([to]) => to !== site && state.props[to].owned && uses(to, p)).map(([to, cap]) => ({ to, w: 9, cap }));
      if (state.launch.owned && marsOn() && marsAccepts(p)) dests.unshift({ to: 'launch', w: 9, cap: 0 });
      if (dests.length) P.plans[p] = { dests: [...dests, { to: 'sell', w: 1, cap: 0 }], overflow: 'sell' };
    }
    if (state.launch.owned) {
      const made = new Set(P.tiles.flat().filter((t) => t.obj && t.obj.k === 'assembler').map((t) => t.obj.recipe));
      for (const p of made) if (marsOn() ? marsAccepts(p) : LAUNCH.needs[p]) P.plans[p] = { dests: [{ to: 'launch', w: 9, cap: 0 }, { to: 'sell', w: 1, cap: 0 }], overflow: 'sell' };
    }
  }
  // One route per destination used; share the stage's trucks out.
  const routes = [];
  for (const site of sites) for (const plan of Object.values(state.props[site].plans)) for (const d of plan.dests) if (d.to !== 'sell' && d.to !== 'store') routes.push(ensureRoute(site, d.to));
  const uniq = [...new Set(routes)];
  uniq.forEach((f, i) => { f.trucks = Math.floor(state.garage.trucks / uniq.length) + (i < state.garage.trucks % uniq.length ? 1 : 0); });
}

function devBuildLayouts(st) {
  for (const id of st.sites || []) devBuildSite(id);
  devPlansAndTrucks();
}
