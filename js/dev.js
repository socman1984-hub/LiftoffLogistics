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

function curTiles() {
  const p = curProp();
  return p ? p.tiles.flat() : [];
}

// Deliver parts for the first n stages of the current rocket.
function fillLaunch(n) {
  state.launch.owned = true;
  const mult = Math.pow(LAUNCH.growth, state.launch.count);
  const parts = {};
  LAUNCH.stages.slice(0, n).forEach((st) => {
    for (const [p, k] of Object.entries(st.needs)) parts[p] = (parts[p] || 0) + k * mult;
  });
  state.launch.parts = parts;
}

function devHTML() {
  const b = (id, label, cls = '') => `<button class="chip ${cls}" data-dev="${id}">${label}</button>`;
  const speed = [1, 2, 5, 10, 25].map((s) => b('speed' + s, `×${s}`, devSpeed === s ? 'on' : '')).join('');
  return `<p class="warn">🧪 Test mode. Changes are saved like normal play; use Help → Reset game to start clean.</p>
    <h3 class="sec">Game speed</h3><div class="choice">${speed}</div>
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
