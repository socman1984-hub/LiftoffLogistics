'use strict';
// Test mode: cheats for playtesting. Only active when the page is opened
// with ?dev=1 (e.g. http://localhost:5173/?dev=1). Players never see it.

const DEV = new URLSearchParams(location.search).has('dev');
let devSpeed = 1; // read by the game loop in main.js

const DEV_ACTIONS = {
  // Money & currencies
  money10k: () => { earn(1e4, 'dev', 'Cheat'); },
  money100k: () => { earn(1e5, 'dev', 'Cheat'); },
  money1m: () => { earn(1e6, 'dev', 'Cheat'); },
  money10m: () => { earn(1e7, 'dev', 'Cheat'); },
  rep10: () => { state.rep += 10; },
  gems100: () => { state.gems += 100; },
  // Unlocks
  research: () => { for (const r of RESEARCH) state.research[r.id] = true; },
  sites: () => {
    for (const def of PROPERTIES) state.props[def.id].owned = true;
    state.launch.owned = true;
  },
  docks: () => { for (const t of curTiles()) if (t.base === 'in' || t.base === 'out') t.locked = false; },
  floors: () => { for (const t of curTiles()) if (t.base === 'broken') t.base = 'floor'; },
  maxUpgrades: () => { const p = curProp(); for (const u of UPGRADES) p.upgrades[u.id] = u.max; },
  trucks5: () => { state.garage.trucks += 5; },
  // Fixes & progress
  fixAll: () => {
    for (const def of PROPERTIES) for (const row of state.props[def.id].tiles) for (const t of row) if (t.obj) unjam(t.obj);
  },
  noBreakdowns: () => { ui.devNoWear = !ui.devNoWear; },
  contracts: () => {
    const c = state.contracts;
    for (const a of c.active) { earn(a.reward, 'contracts', a.client); state.rep += a.stars; c.done++; }
    c.active = [];
    c.offers = [];
    c.nextOfferAt = 0;
  },
  goal: () => { if (state.objective < OBJECTIVES.length) state.objective++; },
  stage1: () => fillLaunch(1),
  rocket: () => fillLaunch(3),
  market: () => { state.market.demand = {}; state.market.event = null; },
  boom: () => { state.market.nextEventAt = state.clock; },
};


// ---- Jump to a stage: realistic snapshots of a game, from bot playthroughs ----
// Research in roughly the order a player gets it (prerequisites are added automatically).
const DEV_RESEARCH_ORDER = ['sorter', 'marketing', 'motors1', 'fastassembly', 'maint', 'forklift', 'routing', 'fleet', 'wrapper',
  'efficiency', 'hygiene', 'logistics', 'slots1', 'bulk', 'aerospace', 'express', 'chiller', 'diagnostics', 'efficiency2', 'wellness',
  'propulsion', 'guidance', 'logistics2', 'pallet', 'negotiation', 'bulk2', 'premium', 'padding', 'assembly2', 'insulated', 'thermal',
  'habitat', 'photovoltaics', 'maint2', 'powergrid', 'lean', 'suppliers', 'wms', 'gps', 'slots2', 'nightshift', 'brand', 'motors2',
  'qc', 'cryo', 'predictive', 'safety', 'lean2', 'bulkraw', 'cameras', 'doubletrail', 'prestige', 'nightshift2', 'export',
  'flighttest', 'automation', 'cobots', 'hub', 'enterprise', 'reusable'];

const DEV_STAGES = [
  { id: 'new', name: 'Brand new game', time: 0, desc: 'Fresh start, tutorial on.', fresh: true },
  { id: 'shed', goal: 'buy the Old Textile Mill', name: 'Shed humming', time: 0.5, sites: ['shed'], money: 15e3, rep: 12, gems: 20, research: 2, trucks: 0, done: 4,
    docks: { shed: ['5,0'] }, upgrades: { shed: { trucks: 2, roof: 1, power: 1 } }, desc: 'Both shed lines worth of cash, first research done. Next: the Mill.' },
  { id: 'mill', goal: 'add the Mill as a destination', name: 'Mill online', time: 1, sites: ['shed', 'mill'], money: 45e3, rep: 25, gems: 30, research: 6, trucks: 2, done: 10,
    docks: { shed: ['5,0'], mill: ['0,6'] }, upgrades: { shed: { trucks: 3, roof: 3, power: 2 }, mill: { roof: 1 } }, desc: 'Electronics site bought; circuit boards next.' },
  { id: 'foundry', goal: 'Build <b>🚰 Valves', name: 'Foundry', time: 1.6, sites: ['shed', 'mill', 'foundry'], money: 120e3, rep: 45, gems: 40, research: 11, trucks: 4, done: 18,
    docks: { shed: ['5,0'], mill: ['0,6'], foundry: ['8,0'] }, upgrades: { shed: { trucks: 4, roof: 4, power: 2 }, mill: { roof: 3 }, foundry: { roof: 1 } }, desc: 'Alloys and valves; trucks between three sites.' },
  { id: 'depot', goal: 'Buy the Coastal Refinery', name: 'Regional Depot', time: 2.6, sites: ['shed', 'mill', 'foundry', 'depot'], money: 300e3, rep: 60, gems: 55, research: 20, trucks: 6, done: 28,
    docks: { shed: ['5,0'], mill: ['0,6'], foundry: ['8,0'], depot: ['0,4'] }, upgrades: { shed: { trucks: 5, roof: 5, power: 3 }, mill: { roof: 4 }, foundry: { roof: 3 }, depot: { roof: 1 } }, desc: 'Fuel tanks and fuselages; the Aerospace branch opens.' },
  { id: 'refinery', goal: 'Buy the Coastal Refinery', name: 'Coastal Refinery', time: 4.1, sites: ['shed', 'mill', 'foundry', 'depot', 'refinery'], money: 800e3, rep: 80, gems: 75, research: 31, trucks: 9, done: 40,
    docks: { shed: ['5,0'], mill: ['0,6'], foundry: ['8,0'], depot: ['0,4'] }, upgrades: { shed: { trucks: 6, roof: 6, power: 3 }, mill: { roof: 5 }, foundry: { roof: 4 }, depot: { roof: 3 }, refinery: { roof: 1 } }, desc: 'Propellant, solar arrays, life support.' },
  { id: 'lab', goal: 'Buy the 🚀 Launch Site', name: 'Clean Room Lab', time: 6.2, sites: ['shed', 'mill', 'foundry', 'depot', 'refinery', 'lab'], money: 1.8e6, rep: 100, gems: 95, research: 38, trucks: 11, done: 55,
    docks: { shed: ['5,0'], mill: ['0,6'], foundry: ['8,0'], depot: ['0,4'] }, upgrades: { shed: { trucks: 7, roof: 6, power: 4 }, mill: { roof: 6 }, foundry: { roof: 5 }, depot: { roof: 4 }, refinery: { roof: 3 }, lab: { roof: 1 } }, desc: 'Sensors, computers, avionics: every rocket part is now makeable.' },
  { id: 'launchsite', goal: 'Finish all three stages', name: 'Rocket ready to launch', time: 10.4, sites: ['shed', 'mill', 'foundry', 'depot', 'refinery', 'lab'], money: 600e3, rep: 40, gems: 120, research: 43, trucks: 14, done: 85,
    launch: { owned: true, full: true }, docks: { shed: ['5,0'], mill: ['0,6'], foundry: ['8,0'], depot: ['0,4'] }, upgrades: { shed: { trucks: 8, roof: 6, power: 4 }, mill: { roof: 6 }, foundry: { roof: 6 }, depot: { roof: 6 }, refinery: { roof: 5 }, lab: { roof: 4 } },
    desc: 'Launch Site bought and every part delivered: open it and press LAUNCH to see the cinematic.' },
  { id: 'mars', goal: '*', name: 'Mars begins', time: 11, sites: ['shed', 'mill', 'foundry', 'depot', 'refinery', 'lab'], money: 2e6, rep: 60, gems: 170, research: 45, trucks: 14, done: 90,
    launch: { owned: true, count: 1 }, mars: { colonists: 0 }, docks: { shed: ['5,0'], mill: ['0,6'], foundry: ['8,0'], depot: ['0,4', '10,3'] }, upgrades: { shed: { trucks: 8, roof: 6, power: 4 }, mill: { roof: 6 }, foundry: { roof: 6 }, depot: { roof: 6 }, refinery: { roof: 6 }, lab: { roof: 5 } },
    desc: 'First rocket flown. Plan the first Mars flight in Launch Site → Mission Control; a window opens in a minute.' },
  { id: 'colony', goal: '*', name: 'Growing colony', time: 16, sites: ['shed', 'mill', 'foundry', 'depot', 'refinery', 'lab'], money: 8e6, rep: 140, gems: 260, research: 50, trucks: 16, done: 120,
    launch: { owned: true, count: 15 }, colony: ['hydroponics', 'robotics'],
    mars: { colonists: 12, modules: { habitat: 3, solar: 2, greenhouse: 1, icemine: 1, pad: 1 }, stock: { food: 10, water: 10, spares: 5 }, metals: 220, milestones: [10] },
    docks: { shed: ['5,0'], mill: ['0,6'], foundry: ['8,0'], depot: ['0,4', '10,3'] }, upgrades: { shed: { trucks: 9, roof: 6, power: 5 }, mill: { roof: 6 }, foundry: { roof: 6 }, depot: { roof: 6 }, refinery: { roof: 6 }, lab: { roof: 6 } },
    desc: '12 colonists, Landing Pad up, first Colony research done.' },
  { id: 'late', goal: '*', name: 'Late colony', time: 24, sites: ['shed', 'mill', 'foundry', 'depot', 'refinery', 'lab', 'hub'], money: 25e6, rep: 260, gems: 420, research: 56, trucks: 20, done: 170,
    launch: { owned: true, count: 40, padLevel: 1 }, colony: ['hydroponics', 'robotics', 'recyclers', 'domes2', 'heavylift', 'transit'],
    mars: { colonists: 40, modules: { habitat: 10, solar: 4, greenhouse: 3, icemine: 3, pad: 1, station: 1 }, stock: { food: 25, water: 25, spares: 12, med: 2, power: 2 }, metals: 2400, milestones: [10, 25] },
    docks: { shed: ['5,0'], mill: ['0,6'], foundry: ['8,0'], depot: ['0,4', '10,3'] }, upgrades: { shed: { trucks: 10, roof: 6, power: 6 }, mill: { roof: 6 }, foundry: { roof: 6 }, depot: { roof: 6 }, refinery: { roof: 6 }, lab: { roof: 6 }, hub: { roof: 2 } },
    desc: '40 colonists, Mega Hub bought, half the Colony branch researched. Ready for Fusion and the Cargo Center.' },
];

function devResearch(n, extra = []) {
  const want = new Set([...DEV_RESEARCH_ORDER.slice(0, n), ...extra].filter((id) => RESEARCH_BY_ID[id]));
  let grew = true;
  while (grew) { // pull in prerequisites
    grew = false;
    for (const id of [...want]) for (const q of RESEARCH_BY_ID[id].req) if (!want.has(q)) { want.add(q); grew = true; }
  }
  return Object.fromEntries([...want].map((id) => [id, true]));
}

function applyStage(st) {
  for (const k of Object.keys(runtime)) delete runtime[k];
  shipLog.length = 0;
  ledger.buckets.clear(); ledger.recent = []; ledger.session = {};
  state = newState();
  if (st.fresh) { state.tutorial = { active: true, step: 0 }; return; }
  state.tutorial = { active: false, step: 0, done: true };
  state.clock = st.time * 3600;
  state.money = st.money; state.rep = st.rep; state.gems = st.gems;
  state.research = devResearch(st.research, st.colony || []);
  state.garage.trucks = st.trucks;
  state.contracts.done = st.done;
  for (const id of st.sites) {
    const p = state.props[id], def = PROP_BY_ID[id];
    p.owned = true;
    for (const row of p.tiles) for (const t of row) if (t.base === 'broken') t.base = 'floor';
    for (const xy of (st.docks || {})[id] || []) { const [x, y] = xy.split(',').map(Number); if (p.tiles[y][x].base === 'in' || p.tiles[y][x].base === 'out') p.tiles[y][x].locked = false; }
    Object.assign(p.upgrades, (st.upgrades || {})[id] || {});
  }
  if (st.launch) {
    state.launch.owned = !!st.launch.owned;
    state.launch.count = st.launch.count || 0;
    state.launch.auto = state.launch.count > 1;
    if (st.launch.full) state.launch.parts = { ...launchNeeds() };
  }
  if (st.mars) {
    const m = M();
    m.colonists = st.mars.colonists || 0;
    m.modules = { ...(st.mars.modules || {}) };
    m.map = null; m.kits = {}; M(); // lay the stage's modules out on a fresh base map
    Object.assign(m.stock, st.mars.stock || {});
    m.metalsTotal = st.mars.metals || 0;
    for (const n of st.mars.milestones || []) m.milestones[n] = true;
    m.windowAt = m.nextCycle = state.clock + 60;
    m.padLevel = st.launch.padLevel || 0;
    m.manifest = { module: m.modules.habitat ? 'greenhouse' : 'habitat', food: 6, water: 6, spares: 3, med: 0, power: 0, colonists: 4 };
  }
  devBuildLayouts(st); // conveyors, assemblers, staff and trucks, as if you'd played to here
  // Lessons for features you'd already be past count as seen (replay them from Help).
  state.lessons = { done: {}, cur: null, off: false };
  for (const L of LESSONS) { try { if (L.when()) state.lessons.done[L.id] = 'skipped'; } catch (e) { /* not reachable yet */ } }
  state.current = st.sites[st.sites.length - 1];
  // Start the goal list where this stage is; Mars stages are past every goal.
  const gi = st.goal === '*' ? OBJECTIVES.length : OBJECTIVES.findIndex((o) => o.text().includes(st.goal));
  state.objective = gi < 0 ? 0 : gi;
}

function curTiles() {
  const p = curProp();
  return p ? p.tiles.flat() : [];
}

// Deliver parts for the first n stages of the current rocket.
function fillLaunch(n) {
  state.launch.owned = true;
  if (marsOn()) { state.launch.parts = { ...launchNeeds() }; return; } // next Mars flight
  const parts = {};
  LAUNCH.stages.slice(0, n).forEach((st) => {
    for (const [p, k] of Object.entries(st.needs)) parts[p] = (parts[p] || 0) + k;
  });
  state.launch.parts = parts;
}

function devHTML() {
  const b = (id, label, cls = '') => `<button class="chip ${cls}" data-dev="${id}">${label}</button>`;
  const speed = [1, 2, 5, 10, 25].map((s) => b('speed' + s, `×${s}`, devSpeed === s ? 'on' : '')).join('');
  const slotNote = SAVE_SLOT
    ? `<p class="intro small">🧪 Using the <b>${SAVE_SLOT}</b> save slot, so your main game is safe.</p>`
    : `<p class="warn">You're on your <b>main save</b>. Jumping to a stage replaces it. <a href="?slot=test&dev=1">Open the test slot</a> to experiment safely.</p>`;
  const stages = DEV_STAGES.map((st) => `<div class="card stage-card"><div class="info"><div class="title">${st.name} <span class="count">${st.fresh ? 'start' : `~${st.time}h in`}</span></div>
    <div class="desc">${st.desc}</div>
    ${st.fresh ? '' : `<div class="meta">${fmt(st.money)} · ⭐ ${st.rep} · 💎 ${st.gems} · ${st.sites.length} site${st.sites.length > 1 ? 's' : ''} · ${st.research} research${st.mars ? ` · 🔴 ${st.mars.colonists} colonists` : ''}</div>`}</div>
    <button class="btn small" data-dev="stage:${st.id}">Jump</button></div>`).join('');
  return `<p class="warn">🧪 Test mode. Changes are saved like normal play; use Help → Reset game to start clean.</p>
    <h3 class="sec">Game speed</h3><div class="choice">${speed}</div>
    <h3 class="sec">🎬 Jump to a stage</h3>${slotNote}
    <p class="intro small">Each stage sets the money, ⭐, gems, research, sites, upgrades and trucks a player typically has at that point (from bot playthroughs). Every site is built the way the test bot plays it by then: conveyor trunk, assemblers with recipes, sorters, racks, facilities, value machines, staff, distribution plans and trucks (Fab Cells and benches late on).</p>
    ${stages}
    <h3 class="sec">Money &amp; currency</h3><div class="choice">
      ${b('money10k', '+$10K')}${b('money100k', '+$100K')}${b('money1m', '+$1M')}${b('money10m', '+$10M')}
      ${b('rep10', '+10 ⭐')}${b('gems100', '+100 💎')}</div>
    <h3 class="sec">Unlock</h3><div class="choice">
      ${b('research', '🔬 All research')}${b('sites', '🗺️ All sites + launch')}${b('trucks5', '🚚 +5 trucks')}</div>
    <h3 class="sec">This warehouse</h3><div class="choice">
      ${b('docks', '🔓 Open all docks')}${b('floors', '🔨 Repair floors')}${b('maxUpgrades', '⏫ Max upgrades')}</div>
    <h3 class="sec">Fixes &amp; progress</h3><div class="choice">
      ${b('fixAll', '🔧 Fix everything')}${b('noBreakdowns', ui.devNoWear ? '✅ Breakdowns off' : '⚠️ Breakdowns on', ui.devNoWear ? 'on' : '')}
      ${b('contracts', '📋 Finish contracts')}${b('goal', '🎯 Skip goal')}${b('market', '💹 Reset market')}${b('boom', '📈 Market event now')}</div>
    <h3 class="sec">Rocket</h3><div class="choice">
      ${b('stage1', '🔥 Fill booster stage')}${b('rocket', '🚀 Fill whole rocket')}</div>`;
}

function initDev() {
  if (!DEV) return;
  PANELS.dev = { title: '🧪 Test Mode', html: () => devHTML() };
  const btn = document.createElement('button');
  btn.id = 'devBtn';
  btn.className = 'rep-chip dev-chip';
  btn.textContent = '🧪';
  btn.addEventListener('click', () => openPanel('dev'));
  document.querySelector('#topbar .chips').appendChild(btn);

  $('modalBody').addEventListener('click', (e) => {
    const el = e.target.closest('[data-dev]');
    if (!el) return;
    const id = el.dataset.dev;
    if (id.startsWith('stage:')) {
      const st = DEV_STAGES.find((q) => q.id === id.slice(6));
      if (!confirm(`Replace ${SAVE_SLOT ? `the "${SAVE_SLOT}" save` : 'your main save'} with "${st.name}"?`)) return;
      applyStage(st);
      layoutView();
      closePanel();
      refreshTopbar();
      refreshToolbar();
      refreshObjective();
      save();
      toast(`🎬 Jumped to: ${st.name}`);
      return;
    }
    if (id.startsWith('speed')) devSpeed = Number(id.slice(5));
    else DEV_ACTIONS[id]();
    btn.textContent = devSpeed > 1 ? `🧪×${devSpeed}` : '🧪';
    if (id === 'sites' || id === 'docks' || id === 'floors') layoutView();
    renderPanel();
    refreshTopbar();
    refreshToolbar();
    toast('🧪 Done');
  });

  // "Breakdowns off": keep wear at zero.
  const origWearOut = wearOut;
  wearOut = function (id, prop, def, o) {
    if (ui.devNoWear) { o.wear = 0; return; }
    return origWearOut(id, prop, def, o);
  };
}
