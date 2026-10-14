'use strict';
// DOM UI (toolbar, panels, objectives) and touch/mouse input on the grid.

const ui = {
  tool: null, // null = inspect mode (tap things to see what they are)
  heat: null, // active heatmap overlay id
  lastDir: 2,
  toastTimer: 0,
  buildTab: 'upgrades',
  sorterAt: null, // {x, y} of the sorter being configured
};

const $ = (id) => document.getElementById(id);

// ---------------- Toast ----------------
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(ui.toastTimer);
  ui.toastTimer = setTimeout(() => el.classList.add('hidden'), 2000);
}

// ---------------- Toolbar ----------------
const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
const isPlaceable = (id) => ['belt', 'splitter', 'sorter', 'assembler', 'bridge', 'buffer'].includes(id) || !!MACHINES[id];
const isBuilding = (k) => k === 'rack' || k === 'silo' || !!FACILITIES[k]; // solid one-tile buildings

function toolLocked(id) {
  const t = TOOL_BY_ID[id];
  return !!((t.research && !hasResearch(t.research)) || (t.unlock && !unlockedBy(t.unlock)));
}
const lockReason = (t) => (t.unlock && !unlockedBy(t.unlock) ? `🔒 Buy the ${PROP_BY_ID[t.unlock].name} to unlock the ${t.name}` : `🔬 Research "${RESEARCH_BY_ID[t.research].name}" to unlock`);

function toolCost(id, def) {
  if (!def) return null;
  if (id === 'repair') return def.repairCost;
  if (id === 'rack') return buildCost('rack', def);
  if (id === 'silo') return buildCost('silo', def);
  if (id === 'facility') return ui.facilityType ? buildCost(ui.facilityType, def) : null;
  if (id === 'upgrade') return buildCost('belt', def, 1); // cheapest step, for the "can't afford" tint
  if (isPlaceable(id)) return buildCost(id, def);
  return null;
}

const groupOf = (toolId) => TOOL_GROUPS.find((g) => g.tools.includes(toolId));

// Toolbar: a tray with the open group's tools above one row of group buttons.
function buildToolbar() {
  const bar = $('toolbar');
  bar.innerHTML = '<div id="toolTray" class="hidden"></div><div id="toolGroups"></div>';
  const groups = $('toolGroups');
  const inspect = document.createElement('button');
  inspect.className = 'group';
  inspect.dataset.group = 'inspect';
  inspect.innerHTML = '<span class="ico">🔍</span><span class="lbl">Inspect</span>';
  inspect.addEventListener('click', () => {
    ui.tool = null;
    ui.toolGroup = null;
    refreshToolbar();
    toast('🔍 Inspect: tap things to see what they are');
  });
  groups.appendChild(inspect);
  for (const g of TOOL_GROUPS) {
    const b = document.createElement('button');
    b.className = 'group';
    b.dataset.group = g.id;
    b.innerHTML = `<span class="ico">${g.icon}</span><span class="lbl">${g.name}</span><span class="caret">▴</span>`;
    b.addEventListener('click', () => { ui.toolGroup = ui.toolGroup === g.id ? null : g.id; refreshToolbar(); });
    groups.appendChild(b);
  }
  const tray = $('toolTray');
  for (const t of TOOLS) {
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.tool = t.id;
    b.innerHTML = `<span class="ico">${t.icon}</span><span class="lbl">${t.name}</span><span class="cost"></span>`;
    if (t.id === 'facility') { b.classList.add('picker'); b.insertAdjacentHTML('beforeend', '<span class="pick-tag">▾ choose</span>'); }
    b.addEventListener('click', () => selectTool(t.id));
    tray.appendChild(b);
  }
  buildMarsBar();
  refreshToolbar();
}

function selectTool(id) {
  const t = TOOL_BY_ID[id];
  if (ui.pending) cancelPlan();
  if (toolLocked(id)) {
    toast(lockReason(t));
    return;
  }
  // Tapping the active tool again turns it off (inspect mode).
  if (ui.tool === id) {
    ui.tool = null;
    refreshToolbar();
    toast('🔍 No tool selected: tap things to inspect them');
    return;
  }
  if (id === 'facility') { openPanel('facilities'); return; }
  ui.tool = id;
  ui.toolGroup = null; // collapse the tray; the group button shows the chosen tool
  refreshToolbar();
  toast(t.tip);
}

function refreshToolbar() {
  const mars = !!ui.marsView;
  $('toolGroups').classList.toggle('hidden', mars);
  $('marsGroups').classList.toggle('hidden', !mars);
  if (mars) { $('toolTray').classList.add('hidden'); refreshMarsBar(); return; }
  $('marsTray').classList.add('hidden');
  const def = curDef();
  const open = TOOL_GROUPS.find((g) => g.id === ui.toolGroup);
  $('toolTray').classList.toggle('hidden', !open);
  for (const b of $('toolGroups').children) {
    const gid = b.dataset.group;
    if (gid === 'inspect') { b.classList.toggle('active', !ui.tool); continue; }
    const g = TOOL_GROUPS.find((x) => x.id === gid);
    const has = ui.tool && g.tools.includes(ui.tool);
    b.classList.toggle('active', !!has);
    b.classList.toggle('open', ui.toolGroup === gid);
    const t = has ? TOOL_BY_ID[ui.tool] : null;
    b.querySelector('.ico').textContent = t ? (t.id === 'facility' && FACILITIES[ui.facilityType] ? FACILITIES[ui.facilityType].icon : t.icon) : g.icon;
    b.querySelector('.lbl').textContent = t ? (t.id === 'facility' && FACILITIES[ui.facilityType] ? FACILITIES[ui.facilityType].name.split(' ')[0] : t.name) : g.name;
    b.querySelector('.caret').textContent = ui.toolGroup === gid ? '▾' : '▴';
  }
  for (const b of $('toolTray').children) {
    b.classList.toggle('hidden', !open || !open.tools.includes(b.dataset.tool));
    const id = b.dataset.tool;
    const locked = toolLocked(id);
    b.classList.toggle('active', id === ui.tool);
    b.classList.toggle('locked', locked);
    const c = toolCost(id, def);
    b.querySelector('.cost').textContent = locked ? '🔒' : id === 'upgrade' && def
      ? `${fmt(buildCost('belt', def, 1))}–${fmt(buildCost('belt', def, 2))}` // Basic→Fast, Fast→Express
      : c == null ? '' : fmt(c);
    if (id === 'facility') {
      const f = FACILITIES[ui.facilityType];
      b.querySelector('.ico').textContent = f ? f.icon : '🏢';
      b.querySelector('.lbl').textContent = f ? f.name.split(' ')[0] : 'Facilities';
    }
    b.classList.toggle('poor', !locked && c != null && state.money < c);
  }
}

// ---------------- Top bar, badges & objectives ----------------
function anyStaff(who) {
  return PROPERTIES.some((d) => state.props[d.id].owned && state.props[d.id].staff[who]);
}

const totalMade = (p) => PROPERTIES.reduce((n, d) => n + (state.props[d.id].made[p] || 0), 0);
const hasRecipe = (p) => PROPERTIES.some((d) => state.props[d.id].owned
  && state.props[d.id].tiles.some((row) => row.some((t) => t.obj && t.obj.k === 'assembler' && t.obj.recipe === p)));
const anyRoute = () => PROPERTIES.some((d) => Object.values(state.props[d.id].plans).some((pl) => pl.dests.some((x) => x.to !== 'sell' && x.w > 0)));
const anyAssigned = () => Object.values(state.fleet).some((f) => f.trucks > 0);

const OBJECTIVES = [
  { text: () => 'Open the <b>🗺️ Map</b> and buy the Rusty Shed', done: () => state.props.shed.owned },
  {
    text: () => 'Select <b>➡️ Conveyor</b> and drag from the 🚚 steel 🔩 door to the 📦 SHIP door to sell steel (damaged floor is repaired automatically)',
    done: () => state.props.shed.earned > 0,
  },
  { text: () => 'Place a <b>🏭 Assembler</b> on the line and set it to build <b>🔲 Hull Panels</b> (2 🔩 each)', done: () => hasRecipe('panel') },
  { text: () => 'Assemblers need a crew. Hire a <b>👷 Assembler Operator</b> in 🏗️ Manage → Staff (they walk over on repaired floor)', done: () => anyStaff('operator') },
  { text: () => 'Sell your first 🔲 Hull Panel', done: () => (state.props.shed.shipped.panel || 0) > 0 },
  { text: () => 'Add a <b>🔍 Scanner</b> after the assembler. Processed goods sell for more', done: () => hasObj('scanner') },
  {
    text: () => 'Machines draw ⚡ power. Buy <b>⚡ Electrical</b> in 🏗️ Manage before you overload the Shed',
    done: () => state.props.shed.upgrades.power > 0,
  },
  { text: () => 'Check the <b>💹 Market</b>. Selling too much of one product drives its price down', done: () => ui.marketSeen || state.contracts.done > 0 },
  { text: () => 'Open <b>📋 Contracts</b> and accept an order', done: () => state.contracts.active.length > 0 || state.contracts.done > 0 },
  { text: () => 'Complete the contract to earn <b>⭐ reputation</b>', done: () => state.contracts.done > 0 },
  { text: () => 'Spend ⭐ in <b>🔬 Research</b>. Try <b>Sorting Systems</b>', done: () => Object.keys(state.research).length > 0 || !!state.lab },
  { text: () => 'Tap the <b>🔒 door</b> to open the copper 🪙 dock, and build 🧵 Wiring', done: () => hasRecipe('wiring') },
  {
    text: () => 'Equipment wears out. Tap a breakdown ⚠️ to fix it, or hire a <b>🔧 Maintenance Tech</b> in 🏗️ Manage → Staff',
    done: () => (state.fixes || 0) > 0 || anyStaff('tech'),
  },
  { text: () => `Save up <b>${fmt(PROP_BY_ID.mill.price)}</b> and buy the Old Textile Mill on the 🗺️ Map`, done: () => state.props.mill.owned },
  { text: () => 'Open <b>🚚 Logistics → Distribution</b> and add the Mill as a destination for the Shed\'s <b>🧵 Wiring</b>', done: () => anyRoute() },
  { text: () => 'Your new site came with a free truck. Assign it to the Shed → Mill route in <b>🚚 Logistics → Fleet</b>', done: () => anyAssigned() },
  { text: () => 'Build <b>🗄️ Racks</b> on the floor (drag to place several). Products waiting on trucks need somewhere to sit', done: () => hasObj('rack') },
  { text: () => 'Racks need hands. Hire a <b>🚜 Forklift Operator</b> (Manage → Staff) to move products in and out faster', done: () => anyStaff('forklift') },
  { text: () => 'Staff need facilities. Build a <b>🚻 Restroom</b> with the 🏢 Facility tool', done: () => hasObj('restroom') },
  { text: () => 'Floors and buildings get dirty, and filthy ones can\'t be used. Hire a <b>🧹 Janitor</b>', done: () => anyStaff('janitor') },
  { text: () => 'At the Mill, build <b>📟 Circuit Boards</b> from 💿 silicon + 🧵 wiring (it arrives at the 📥 dock)', done: () => totalMade('circuit') > 0 },
  { text: () => `Buy the ⚒️ Old Foundry (${fmt(PROP_BY_ID.foundry.price)}) and make <b>🟦 Alloy Plates</b> from 🥈 titanium + 🔩 steel`, done: () => totalMade('alloy') > 0 },
  { text: () => 'Build <b>🚰 Valves</b> (🟦 + 🔲). Engines and turbopumps need them', done: () => totalMade('valve') > 0 },
  { text: () => `Buy the Regional Depot (${fmt(PROP_BY_ID.depot.price)}) for fuel tanks and fuselage`, done: () => state.props.depot.owned },
  { text: () => `Buy the Coastal Refinery (${fmt(PROP_BY_ID.refinery.price)}) and make <b>🧪 Propellant</b> (2 ⛽ + 🧊)`, done: () => totalMade('fuel') > 0 },
  { text: () => 'Research <b>🔥 Propulsion</b> and build a <b>🌀 Turbopump</b>', done: () => totalMade('turbopump') > 0 },
  { text: () => 'Assemble your first <b>🔥 Rocket Engine</b> (🌀 + 🚰 + 🧱)', done: () => totalMade('engine') > 0 },
  { text: () => `Buy the 🔬 Clean Room Lab (${fmt(PROP_BY_ID.lab.price)}) for 📡 sensors and 💻 flight computers`, done: () => state.props.lab.owned },
  { text: () => `Buy the 🚀 Launch Site (${fmt(LAUNCH.price)}) on the Map`, done: () => state.launch.owned },
  { text: () => 'Complete the <b>🔥 Booster Stage</b> at the Launch Site', done: () => state.launch.count > 0 || launchStageProgress()[0].done },
  { text: () => 'Finish all three stages and <b>LAUNCH</b> 🚀', done: () => state.launch.count > 0 },
];

function hasObj(kind) {
  for (const def of PROPERTIES) {
    const p = state.props[def.id];
    if (!p.owned) continue;
    for (const row of p.tiles) for (const t of row) if (t.obj && t.obj.k === kind) return true;
  }
  return false;
}

function refreshObjective() {
  if (typeof tutorialActive === 'function' && tutorialActive()) { $('objective').classList.add('hidden'); return; }
  while (state.objective < OBJECTIVES.length && OBJECTIVES[state.objective].done()) {
    state.objective++;
    state.gems += GEMS.perObjective;
    toast(`🎯 Goal complete! +${GEMS.perObjective} 💎`);
  }
  const el = $('objective');
  if (state.objective >= OBJECTIVES.length) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = '🎯 ' + OBJECTIVES[state.objective].text();
}

function refreshTopbar() {
  $('money').textContent = fmt(state.money);
  const net = netRate();
  const rateEl = $('rate');
  const boosts = activeBoostText();
  rateEl.textContent = (net < 0 ? '' : '+') + fmt(net) + '/min' + (boosts ? ' · ' + boosts : '');
  rateEl.classList.toggle('neg', net < 0);
  $('rep').textContent = '⭐ ' + state.rep;
  $('gems').textContent = '💎 ' + state.gems;
  const def = curDef();
  $('propName').textContent = ui.marsView ? '🔴 Mars Base' : def ? `${def.emoji} ${def.name}` : 'No warehouse';
  $('heatBtn').classList.toggle('hidden', !!ui.marsView);

  const c = state.contracts;
  const free = contractSlots() - c.active.length;
  setBadge('contracts', free > 0 && c.offers.length ? c.offers.length : '');
  setBadge('research', state.lab ? '⏳' : researchReady() ? '!' : '');
  const stalled = Object.entries(state.fleet).some(([k, f]) => !f.trucks
    && Object.values(state.props[k.split('>')[0]].outbox[k.split('>')[1]] || {}).some((n) => n > 0));
  const rocketWaiting = state.launch.owned && launchReady() && !(state.launch.count >= 1 && state.launch.auto);
  // (After the first launch, launchReady() means a Mars window is open and the rocket is built.)
  setBadge('map', rocketWaiting ? '🚀' : stalled ? '!' : idleTrucks() > 0 ? idleTrucks() : '');
}

function setBadge(panel, text) {
  const el = document.querySelector(`#actions [data-panel="${panel}"] .badge`);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('hidden', text === '');
}

// ---------------- Panels ----------------
let openPanelName = null;

function openPanel(name) {
  openPanelName = name;
  if (name === 'contracts') ui.marketSeen = true;
  $('modal').classList.remove('hidden');
  renderPanel();
}

function closePanel() {
  if (openPanelName === 'facdetail') ui.facSel = null;
  openPanelName = null;
  $('modal').classList.add('hidden');
}

const PANELS = {
  map: { title: '🗺️ Your Enterprise', html: () => mapHTML() },
  logistics: { title: '🚚 Logistics', html: () => logisticsHTML() },
  recvdock: { title: '📥 Receiving Dock', html: () => recvDockHTML() },
  supplier: { title: '🚚 Supplier', html: () => supplierHTML() },
  negotiate: { title: '🤝 Negotiate', html: () => negotiateHTML() },
  assembler: { title: '🏭 Assembler Recipe', html: () => assemblerHTML() },
  building: { title: '🏗️ Manage Site', html: () => buildingHTML() },
  contracts: { title: '💹 Market', html: () => marketHTML() },
  shop: { title: '💎 Gem Store', html: () => shopHTML() },
  research: { title: '🔬 Research', html: () => researchHTML() },
  help: { title: '❓ How to Play', html: () => helpHTML() },
  sorter: { title: '🚦 Sorter Settings', html: () => sorterHTML() },
  facilities: { title: '🏢 Facilities', html: () => facilitiesHTML() },
  alerts: { title: '⚠️ Problems', html: () => alertsHTML() },
  facdetail: { title: '🏢 Facility', html: () => facDetailHTML() },
  heat: { title: '🌡️ Overlays', html: () => heatMenuHTML() },
  rackdetail: { title: '🗄️ Rack', html: () => rackDetailHTML() },
  worker: { title: '👷 Worker', html: () => workerHTML() },
  confirmremove: { title: '🗑️ Remove?', html: () => confirmRemoveHTML() },
  confirmreplace: { title: '🔁 Replace?', html: () => confirmReplaceHTML() },
  finance: { title: '💵 Finances', html: () => financeHTML() },
};
const LIVE_PANELS = ['map', 'logistics', 'recvdock', 'supplier', 'building', 'contracts', 'research', 'assembler', 'shop', 'alerts', 'facdetail', 'rackdetail', 'worker', 'finance'];
const SLOW_PANELS = ['map', 'logistics', 'recvdock', 'supplier']; // lots of buttons; refresh less often

function renderPanel() {
  const panel = PANELS[openPanelName];
  if (!panel) return; // 'message' content is set by showMessage
  $('modalTitle').textContent = panel.title;
  let html;
  try { html = panel.html(); } catch (err) { // never leave the last panel's content under a new title
    console.error(err);
    html = `<p class="warn">Sorry, this panel couldn't load. Close it and try again; if it keeps happening, reload the game.</p><p class="muted small">${String(err && err.message || err).replace(/</g, '&lt;')}</p>`;
  }
  if ($('modalBody').dataset.html !== html) {
    $('modalBody').innerHTML = html;
    $('modalBody').dataset.html = html;
  }
  if (openPanelName === 'map') updateMapDynamic();
}

function showMessage(titleText, html, opts = {}) {
  openPanelName = 'message';
  $('modalTitle').textContent = titleText;
  delete $('modalBody').dataset.html;
  $('modalBody').innerHTML = html + (opts.noClose ? '' : '<button class="btn" style="width:100%;margin-top:8px" data-act="close">Nice!</button>');
  $('modal').classList.remove('hidden');
}

function card(emoji, title, desc, meta, btn, cls = '') {
  return `<div class="card ${cls}"><div class="emoji">${emoji}</div>
    <div class="info"><div class="title">${title}</div>${desc ? `<div class="desc">${desc}</div>` : ''}${meta ? `<div class="meta">${meta}</div>` : ''}</div>
    ${btn || ''}</div>`;
}

function tabsHTML() {
  const tabs = [['upgrades', 'Upgrades'], ['staff', 'Staff'], ['stats', 'Stats']];
  return `<div class="tabs">${tabs.map(([id, name]) =>
    `<button class="tab ${ui.buildTab === id ? 'on' : ''}" data-act="tab" data-id="${id}">${name}</button>`).join('')}</div>`;
}

function buildingHTML() {
  const def = curDef();
  if (!def) return '<p class="intro">Buy a warehouse first.</p>';
  let html = tabsHTML();
  if (ui.buildTab === 'upgrades') html += upgradesHTML(def, curProp());
  else if (ui.buildTab === 'staff') html += staffHTML(def, curProp());
  else html += statsHTML(def, curProp());
  return html;
}

function powerRowHTML(id) {
  const cap = powerCap(id), draw = powerDraw(id);
  const pf = powerFactor(id);
  const pct = cap ? Math.min(100, (draw / cap) * 100) : 0;
  return `<div class="power-box ${pf < 1 ? 'over' : ''}">
    <div class="power-head"><span>⚡ Power</span><b>${Math.round(draw * 10) / 10} / ${cap}</b></div>
    <div class="bar"><div style="width:${pct}%;background:${pf < 1 ? '#eb5757' : pct > 80 ? '#f2c94c' : '#6fcf97'}"></div></div>
    <div class="power-note">${pf < 1 ? `Overloaded! Machines and assemblers run at ${Math.round(pf * 100)}%. Upgrade Electrical or remove machines.`
    : 'Assembler 4 · Wrapper 5 · Labeler/Chiller 3 · Scanner 2 · Sorter 1. Belts are free.'}</div></div>`;
}

// What makes a site's packages worth more. New sites earn little until these are in.
function siteBoostHTML(id, full) {
  const def = PROP_BY_ID[id], prop = state.props[id];
  const roof = prop.upgrades.roof, roofMax = UPGRADES.find((u) => u.id === 'roof').max;
  const sales = prop.staff.sales || 0, salesMax = STAFF_BY_ID.sales.max;
  const has = (k) => prop.tiles.some((row) => row.some((t) => t.obj && t.obj.k === k));
  const items = [
    [roof >= 2, `🏚️ Roof & Walls ${roof}/${roofMax}`, '+25% value each (Manage → Upgrades)'],
    [sales >= 1, `💼 Sales Reps ${sales}/${salesMax}`, `+10% value each (Manage → Staff${hasResearch('marketing') ? '' : '; research 📣 Marketing first'})`],
    [has('scanner') || has('labeler'), '🔍🏷️ Scanner or Labeler on the line', 'before the SHIP door'],
    [has('wrapper'), '🎁 Wrapper', '×2 value (needs Shrink Wrapping research)'],
  ];
  const todo = items.filter(([ok]) => !ok).length;
  if (!full && todo <= 1) return '';
  return `<div class="power-box boost-box"><div class="power-head"><span>💡 Make ${def.name} pay</span><b>${items.length - todo}/${items.length}</b></div>
    <div class="power-note">${items.map(([ok, label, why]) => `${ok ? '✅' : '⬜'} ${label} <span class="muted">· ${why}</span>`).join('<br>')}</div></div>`;
}

function upgradesHTML(def, prop) {
  let html = powerRowHTML(state.current) + siteBoostHTML(state.current);
  let broken = 0;
  for (const row of prop.tiles) for (const t of row) if (t.base === 'broken') broken++;
  if (broken > 0) {
    const cost = broken * def.repairCost;
    html += card('🔨', 'Repair All Floors', `${broken} damaged tiles left`, '',
      `<button class="btn" data-act="repairall" ${state.money < cost ? 'disabled' : ''}>${fmt(cost)}</button>`);
  }
  for (const u of UPGRADES) {
    const lvl = prop.upgrades[u.id];
    const maxed = lvl >= u.max;
    const cost = upgradeCost(u, lvl, def);
    let pips = '';
    for (let i = 0; i < u.max; i++) pips += `<div class="pip ${i < lvl ? 'on' : ''}"></div>`;
    html += card(u.icon, u.name, u.desc, `<div class="pips">${pips}</div>`,
      `<button class="btn" data-act="upgrade" data-id="${u.id}" ${maxed || state.money < cost ? 'disabled' : ''}>${maxed ? 'MAX' : fmt(cost)}</button>`);
  }
  html += `<p class="intro" style="margin-top:6px">Truck every ${truckInterval(state.current, prop).toFixed(2)}s per dock ·
    Value ×${valueMult(state.current, prop).toFixed(2)} · Speed ×${speedMult(state.current, prop).toFixed(2)}</p>`;
  return html;
}

function alertsHTML() {
  let html = '';
  let any = false;
  for (const def of PROPERTIES) {
    if (!state.props[def.id].owned) continue;
    const list = siteAlerts(def.id);
    if (!list.length) continue;
    any = true;
    html += `<h3 class="sec">${def.emoji} ${def.name}</h3>`;
    for (const a of list) {
      html += `<button class="alert-row" data-act="showalert" data-id="${def.id}|${a.x}|${a.y}"><span>⚠️</span><span>${a.text}</span><span class="muted">Show ›</span></button>`;
    }
  }
  return any ? html : '<p class="intro">No problems right now. 👍</p>';
}

function refreshAlerts() {
  const pill = $('alertPill');
  if (!pill) return;
  const here = state.current ? siteAlerts(state.current).length : 0;
  let elsewhere = 0;
  for (const def of PROPERTIES) if (def.id !== state.current && state.props[def.id].owned) elsewhere += siteAlerts(def.id).length;
  pill.classList.toggle('hidden', !here && !elsewhere);
  pill.textContent = here ? `⚠️ ${here} problem${here > 1 ? 's' : ''}${elsewhere ? ` (+${elsewhere} elsewhere)` : ''}` : `⚠️ ${elsewhere} problem${elsewhere > 1 ? 's' : ''} at other sites`;
}

function facilitiesHTML() {
  const def = curDef();
  if (!def) return '<p class="intro">Buy a warehouse first.</p>';
  const id = state.current;
  let html = `<p class="intro small">Each facility takes one floor tile (🔌 Generators go outside on the outer wall). Pick one, then tap to build it.
    Tap the 🏢 button again any time to switch.
    ${moraleSummary(id)}</p>`;
  for (const k of FACILITY_IDS) {
    const f = FACILITIES[k];
    const why = facLockReason(f);
    if (why) {
      const btn = f.research && !hasResearch(f.research) && unlockedBy(f.unlock)
        ? `<button class="btn secondary small" data-act="openresearchnode" data-id="${f.research}">🔬 View</button>` : '<button class="btn secondary" disabled>🔒</button>';
      html += card(f.icon, `${f.name} <span class="count">🔒${facCount(id, k) ? ` · ${facCount(id, k)} here` : ''}</span>`, f.desc, why, btn, 'done');
      continue;
    }
    const n = facCount(id, k);
    const full = f.max && n >= f.max;
    const power = f.power < 0 ? `+${-f.power} ⚡` : f.power ? `uses ${f.power} ⚡` : 'no power';
    html += card(f.icon, `${f.name} <span class="count">${n} here</span>`, f.desc, `${fmt(buildCost(k, def))} · ${power}`,
      `<button class="btn ${ui.facilityType === k ? 'secondary' : ''}" data-act="pickfac" data-id="${k}" ${full ? 'disabled' : ''}>${full ? 'Built' : ui.facilityType === k ? 'Selected' : 'Build'}</button>`);
  }
  return html;
}

function moraleSummary(id) {
  const prop = state.props[id];
  const staff = totalStaff(prop);
  if (!staff) return 'No staff yet, so no restrooms or break rooms are needed.';
  const m = Math.round(moraleOf(id) * 100);
  const cov = rt(id).coverage || { restroom: 0, breakroom: 0 };
  return `Staff ${staff}: 🚻 ${Math.round(cov.restroom * staff)}/${staff} covered · ☕ ${Math.round(cov.breakroom * staff)}/${staff} covered (staff must work within a facility's range, and each serves a limited number). Morale <b class="${m < 100 ? 'neg' : 'pos'}">${m}%</b>.`;
}

function rackDetailHTML() {
  const at = ui.rackSel;
  const id = state.current;
  const o = at && curProp().tiles[at.y][at.x].obj;
  if (!o || o.k !== 'rack') return '<p class="intro">That rack is gone.</p>';
  const info = rackIndex(id).get(at.x + ',' + at.y);
  const slots = info.cap;
  const here = rackContents(id, info);
  const used = here.reduce((a, b) => a + b.n, 0);
  const lvl = o.lvl || 1;
  const kindLabel = { stored: '🗄️ stored', outgoing: '🚚 waiting for a truck', incoming: '📥 trucked in' };
  $('modalTitle').textContent = o.silo ? '🫙 Silo' : '🗄️ Rack';
  let html = `<div class="power-box"><div class="power-head"><span>${o.silo ? `Silo (rack #${info.k + 1})` : `Rack #${info.k + 1} · level ${lvl}/${RACK.levels.length}`}</span><b>${used} / ${slots}</b></div>
    <div class="bar"><div style="width:${(used / slots) * 100}%;background:${used >= slots ? '#eb5757' : '#6fcf97'}"></div></div>
    <div class="power-note">${here.length ? here.map((u) => `${PRODUCTS[u.p].icon} ${u.n} ${PRODUCTS[u.p].name} <span class="muted">(${kindLabel[u.kind]})</span>`).join('<br>') : 'Empty'}</div></div>`;
  if (o.silo) {
    html += '<p class="intro small">🫙 A silo holds 100 of one product. Pick it below (until you do, it takes anything).</p>';
  } else if (lvl < RACK.levels.length) {
    const cost = Math.round(buildCost('rack', curDef()) * RACK.upMult[lvl]);
    html += card('⏫', `Upgrade this rack to level ${lvl + 1}`, `Holds ${RACK.levels[lvl]} instead of ${slots}`, '',
      `<button class="btn" data-act="rackup" ${state.money < cost ? 'disabled' : ''}>${fmt(cost)}</button>`);
  } else html += '<p class="intro small">This rack is fully upgraded.</p>';
  // What this rack may hold: anything, or only the products picked here.
  const allow = o.allow || [];
  const known = new Set([...PRODUCT_IDS.filter((p) => storageUnitsHave(id, p)), ...allow]);
  html += `<h3 class="sec">What goes on this rack</h3>
    <div class="choice rack-allow"><button class="chip ${!o.allow ? 'on' : ''}" data-act="rackallow" data-id="*">📦 Anything</button>
    ${PRODUCT_IDS.filter((p) => ui.rackAllProducts || known.has(p)).map((p) => `<button class="chip ${allow.includes(p) ? 'on' : ''}" data-act="rackallow" data-id="${p}">${PRODUCTS[p].icon} ${PRODUCTS[p].name}</button>`).join('')}
    <button class="chip faint" data-act="rackallmore">${ui.rackAllProducts ? '− Fewer' : '+ Show all products'}</button></div>
    <p class="intro small">${o.allow ? `Only ${allow.map((p) => PRODUCTS[p].icon).join(' ')} can be put here. Anything else already on it stays until it ships.` : 'Pick products to reserve this rack for them. Racks set to Anything take whatever comes.'}
    <button class="link-btn" data-act="rackallowall">Copy to every rack here</button></p>`;
  html += `<p class="intro small">Goods stay on the rack they were put on; upgrading adds room here for new stock. Run a conveyor into any rack to store products directly (no forklift needed).
    Stored stock leaves on a truck when a destination in its plan has room, or sell it below.</p>`;
  html += storageBoxHTML(id);
  html += `<button class="btn danger" style="width:100%;margin-top:6px" data-act="rackremove">Remove this rack (refund ${fmt(refund(o, curDef()))})</button>`;
  return html;
}

function facDetailHTML() {
  const at = ui.facSel;
  const def = curDef(), prop = curProp();
  const o = at && prop && prop.tiles[at.y][at.x].obj;
  if (!o || !FACILITIES[o.k]) return '<p class="intro">That building is gone.</p>';
  const f = FACILITIES[o.k];
  $('modalTitle').textContent = `${f.icon} ${f.name}`;
  let html = `<p class="intro">${f.desc}</p>`;
  if (f.levels) {
    const lvl = o.lvl || 1;
    const L = facLevel(o);
    const used = (rt(state.current).facUse || {})[at.x + ',' + at.y] || 0;
    const row = (k, v, cls = '') => `<div class="stat-row ${cls}"><span>${k}</span><b>${v}</b></div>`;
    html += '<div class="stats risk">';
    html += row('Level', `${lvl} / ${f.levels.length}`);
    html += row('Range', `${L.range} tiles (shaded on the floor)`);
    html += row('Serves', `${used} / ${L.cap} staff`, used >= L.cap ? 'neg' : '');
    html += row('Break speed', L.speed > 1 ? `${Math.round((L.speed - 1) * 100)}% faster` : 'normal');
    html += '</div>';
    if (lvl < f.levels.length) {
      const N = f.levels[lvl];
      const cost = Math.round(buildCost(o.k, def) * FAC_UPGRADE_MULT[lvl]);
      html += card('⏫', `Upgrade to level ${lvl + 1}`, `Range ${N.range} tiles · serves ${N.cap} staff · breaks ${Math.round((N.speed - 1) * 100)}% faster`, '',
        `<button class="btn" data-act="facup" ${state.money < cost ? 'disabled' : ''}>${fmt(cost)}</button>`);
    } else html += '<p class="intro small">Fully upgraded.</p>';
  } else {
    html += '<p class="intro small">This building\'s bonus applies to the whole site while it stands.</p>';
  }
  const dirt = Math.round(o.dirt || 0);
  const cleanCost = Math.max(1, Math.round(buildCost(o.k, def) * 0.05));
  html += `<div class="power-box ${dirt >= DIRT.filthy ? 'over' : ''}"><div class="power-head"><span>🧽 Cleanliness</span><b>${dirt >= DIRT.filthy ? 'FILTHY: out of order' : `${100 - dirt}% clean`}</b></div>
    <div class="bar"><div style="width:${100 - dirt}%;background:${dirt >= DIRT.dirty ? '#eb5757' : '#6fcf97'}"></div></div>
    <div class="power-note">${FACILITIES[o.k].levels ? 'Gets dirtier with every break.' : 'Gets dirty over time.'} Filthy buildings can't be used. 🧹 Janitors clean automatically.</div>
    ${dirt > 0 ? `<div class="dest-ctl"><button class="btn small secondary" data-act="facclean" ${state.money < cleanCost ? 'disabled' : ''}>🧽 Clean now ${fmt(cleanCost)}</button></div>` : ''}</div>`;
  html += `<button class="btn danger" style="width:100%;margin-top:10px" data-act="facremove">Remove (refund ${fmt(refund(o, def))})</button>`;
  return html;
}

function staffHTML(def, prop) {
  const id = state.current;
  const r = rt(id);
  let html = '';
  const mv = moraleOf(id);
  const morale = Math.round(mv * 100);
  const parts = r.moraleParts || [];
  html += `<div class="power-box ${mv < MORALE.warn ? 'over' : ''}">
    <div class="power-head"><span>${moraleFace(mv)} Morale</span><b>${morale}%</b></div>
    <div class="bar"><div style="width:${morale}%;background:${mv >= 0.9 ? '#6fcf97' : mv >= MORALE.warn ? '#f2c94c' : '#eb5757'}"></div></div>
    <div class="power-note">${parts.length ? parts.map((p) => `${p.label}: <b class="${p.v < 0 ? 'neg' : 'pos'}">${p.v > 0 ? '+' : ''}${Math.round(p.v * 100)}%</b>`).join('<br>') : 'Everyone is happy.'}</div>
    <div class="power-note">Staff work at ${Math.round(workPace(id) * 100)}% pace. Below ${Math.round(MORALE.warn * 100)}% they slow down; below ${Math.round(MORALE.quit * 100)}% they start quitting.</div>
    <div class="power-note">${moraleSummary(id)}</div></div>`;
  if (r.unpaid) html += `<p class="warn">⚠️ You can't cover wages. Staff here have stopped working until you can.</p>`;

  // Building risk summary so hiring decisions are informed.
  const need = techsNeeded(prop);
  const cov = Math.round(maintCoverage(prop) * 100);
  const accHr = accidentsPerMin(id, prop) * 60;
  const row = (k, v, cls = '') => `<div class="stat-row ${cls}"><span>${k}</span><b>${v}</b></div>`;
  html += '<div class="stats risk">';
  html += row('🔧 Maintenance coverage', `${prop.staff.tech}/${need} techs · ${cov}%`, cov < 100 ? 'neg' : 'pos');
  html += row('🦹 Theft rate', `${(theftChance(id, prop) * 100).toFixed(1)}% of packages`, theftChance(id, prop) > 0.02 ? 'neg' : '');
  html += row('🚑 Accident risk', accHr < 0.05 ? 'very low' : `~${accHr.toFixed(1)} per hour`, accHr >= 1 ? 'neg' : '');
  html += row('💸 Wages', `${fmt(r.unpaid ? 0 : wagesPerMin(id))}/min`);
  html += '</div>';
  html += payRateHTML(prop);
  html += `<p class="intro">Hiring has a signing fee of ${HIRE_FEE_MINUTES} minutes' wages. Low maintenance coverage also cuts what this building earns while you're away.</p>`;

  for (const s of STAFF) {
    const wage = staffWage(s, def, prop);
    const fee = Math.round(wage * HIRE_FEE_MINUTES);
    const n = prop.staff[s.id];
    if (s.research && !hasResearch(s.research) && !n) {
      const rr = RESEARCH_BY_ID[s.research];
      html += card(s.icon, `${s.name} <span class="count">🔒</span>`, s.desc,
        `🔬 Research ${rr.icon} ${rr.name} (${branchOf(rr.b).name}) to unlock`, '<button class="btn secondary small" data-act="openresearchnode" data-id="' + rr.id + '">🔬 View</button>', 'done');
      continue;
    }
    const full = n >= s.max;
    const btns = `<div class="hire-btns">
      <button class="btn secondary small" data-act="fire" data-id="${s.id}" ${n ? '' : 'disabled'}>−</button>
      <button class="btn small" data-act="hire" data-id="${s.id}" ${full || state.money < fee ? 'disabled' : ''}>${full ? 'Max' : '+ ' + fmt(fee)}</button>
    </div>`;
    const pips = Array.from({ length: s.max }, (_, i) => `<div class="pip ${i < n ? 'on' : ''}"></div>`).join('');
    // Specialists this site is starting to need: say so, and how bad going without has got.
    const need = STAFF_NEEDS[s.id];
    const v = need ? neglectOf(prop, s.id) : 0;
    const needed = need && staffNeedOpen(prop, s.id) && !staffNeedMet(id, prop, s.id);
    const tag = needed ? ` <span class="need-tag ${v >= 0.5 ? 'bad' : ''}">⚠️ needed</span>` : '';
    const note = needed ? `<div class="need-note">${need.label}: ${need.effect(v)} and rising.</div>` : need && v > 0.02 ? `<div class="need-note ok">Calming down: ${need.effect(v)}.</div>` : '';
    html += card(s.icon, `${s.name} <span class="count">${n}/${s.max}</span>${tag}`, s.desc + note,
      `<div class="pips">${pips}</div>${fmt(wage)}/min each`, btns);
  }
  return html;
}

function statsHTML(def, prop) {
  const id = state.current;
  const r = rt(id);
  const rev = propRate(id);
  const wages = r.unpaid ? 0 : wagesPerMin(id);
  let jammed = 0, equipment = 0, worn = 0;
  for (const row of prop.tiles) for (const t of row) {
    if (!t.obj) continue;
    equipment++;
    if (t.obj.jammed) jammed++;
    else if (t.obj.life && t.obj.wear / t.obj.life > 0.75) worn++;
  }
  const row = (k, v, cls = '') => `<div class="stat-row ${cls}"><span>${k}</span><b>${v}</b></div>`;
  let html = '<div class="stats">';
  html += '<h3>Money</h3>';
  const supply = propCost(id);
  html += row('Revenue', fmt(rev) + '/min');
  html += row('Raw materials', '-' + fmt(supply) + '/min');
  html += row('Wages', '-' + fmt(wages) + '/min');
  html += row('Net', fmt(rev - supply - wages) + '/min', rev - supply - wages < 0 ? 'neg' : 'pos');
  html += row('⚡ Power', `${Math.round(powerDraw(id) * 10) / 10} / ${powerCap(id)}${r.power < 1 ? ` (machines at ${Math.round(r.power * 100)}%)` : ''}`, r.power < 1 ? 'neg' : '');
  html += row('Lifetime revenue', fmt(prop.earned));
  html += '<h3>Sold to vendors</h3>';
  const sold = PRODUCT_IDS.filter((p) => prop.shipped[p]);
  if (!sold.length) html += row('Nothing yet', '');
  for (const p of sold) html += row(`${PRODUCTS[p].icon} ${PRODUCTS[p].name}`, prop.shipped[p].toLocaleString('en-US'));
  const made = PRODUCT_IDS.filter((p) => prop.made[p]);
  if (made.length) {
    html += '<h3>Assembled here</h3>';
    for (const p of made) html += row(`${PRODUCTS[p].icon} ${PRODUCTS[p].name}`, prop.made[p].toLocaleString('en-US'));
  }
  html += row('🚚 Trucked to other sites', prop.sent.toLocaleString('en-US'));
  html += '<h3>Problems</h3>';
  html += row('💥 Fragile broken', prop.broken.toLocaleString('en-US'), prop.broken ? 'neg' : '');
  html += row('🦹 Packages stolen', prop.stolen.toLocaleString('en-US'), prop.stolen ? 'neg' : '');
  html += row('🚑 Accidents', prop.accidents.toLocaleString('en-US'), prop.accidents ? 'neg' : '');
  html += row('⚠️ Breakdowns (total)', prop.jams.toLocaleString('en-US'));
  html += row('Broken down now', `${jammed} / ${equipment}`, jammed ? 'neg' : '');
  html += row('Badly worn (75%+)', `${worn} / ${equipment}`, worn ? 'neg' : '');
  html += row('Packages on the floor', r.items.length);
  html += row('🗄️ Racks', `${storageUsed(id)} / ${storageCap(id)}`, storageUsed(id) >= storageCap(id) ? 'neg' : '');
  html += row('🚜 Rack handling', `${movesUsed(id)} / ${Math.round(handlingRate(id))} moves/min`, movesUsed(id) >= handlingRate(id) * 0.9 ? 'neg' : '');
  html += '<h3>Handling guide</h3>';
  for (const k of CARGO_IDS) {
    const items = PRODUCT_IDS.filter((p) => PRODUCTS[p].cls === k).map((p) => PRODUCTS[p].icon).join(' ');
    html += `<p class="cargo-note"><b>${CARGO[k].name}</b> ${items}: ${CARGO[k].desc}</p>`;
  }
  html += '</div>';
  return html;
}

// The confidence chip under an order (active orders say "on track" instead of "likely").
function outlookHTML(ol, active) {
  const label = active ? ol.label.replace('Very likely', 'On track').replace('🙂 Likely', '🙂 Should make it') : ol.label;
  return `<div class="outlook ${ol.cls}"><b>${label}</b><span>${ol.detail}</span></div>`;
}

function contractsHTML() {
  const c = state.contracts;
  if (!state.current) return '<p class="intro">Buy a warehouse first.</p>';
  const slots = contractSlots();
  let html = `<p class="intro">Clients pay cash <b>and ⭐ reputation</b> for orders. ${openPanelName === 'research' ? 'Spend ⭐ on the 🔬 Research tab.' : '<button class="link-btn" data-act="openresearchnode" data-id="sorter">Spend ⭐ in 🔬 Research ›</button>'}<br>
    Slots ${c.active.length}/${slots} · ⭐ ${state.rep} · ${c.done} completed</p>`;
  if (c.active.length) html += '<h3 class="sec">Active</h3>';
  for (const a of c.active) {
    const pct = Math.min(100, (a.progress / a.n) * 100);
    const left = a.deadline - state.clock;
    html += `<div class="card contract"><div class="info">
      <div class="title">${a.client}</div>
      <div class="desc">Ship ${contractLabel(a)}</div>
      <div class="bar"><div style="width:${pct}%"></div></div>
      <div class="meta">${a.progress}/${a.n} · ⏱ <span class="${left < 30 ? 'neg' : ''}">${fmtTime(left)}</span> · ${fmt(a.reward)} + ${a.stars}⭐</div>
      ${outlookHTML(contractOutlook(a, c.active.indexOf(a)), true)}
      </div><button class="btn secondary small" data-act="abandon" data-id="${a.id}">✕</button></div>`;
  }
  html += `<div class="sec-row"><h3 class="sec">Offers</h3><button class="btn small secondary" data-act="refreshoffers" ${state.gems >= CONTRACT_REFRESH_GEMS ? '' : 'disabled'}>🔄 New offers · ${CONTRACT_REFRESH_GEMS} 💎</button></div>`;
  if (!c.offers.length) html += '<p class="intro">New offers arrive every ~20 seconds.</p>';
  for (const o of c.offers) {
    const full = c.active.length >= slots;
    html += `<div class="card contract"><div class="info">
      <div class="title">${o.client}</div>
      <div class="desc">Ship ${contractLabel(o)} within ${o.minutes} min</div>
      <div class="meta">Reward <b class="gold">${fmt(o.reward)}</b> + <b>${o.stars}⭐</b> · offer ends in ${fmtTime(o.expires - state.clock)}</div>
      ${outlookHTML(contractOutlook(o))}
      </div><button class="btn" data-act="accept" data-id="${o.id}" ${full ? 'disabled' : ''}>${full ? 'Full' : 'Accept'}</button></div>`;
  }
  return html;
}

function sorterHTML() {
  const at = ui.sorterAt;
  const t = at && curProp().tiles[at.y][at.x];
  if (!t || !t.obj || t.obj.k !== 'sorter') return '<p class="intro">That sorter is gone.</p>';
  const o = t.obj;
  const def = curDef(), prop = curProp();
  const arrows = ['⬆️ Up', '➡️ Right', '⬇️ Down', '⬅️ Left'];
  // Flag exits with nothing there to receive packages.
  const leadsNowhere = (d) => !acceptsFrom(prop, def, at.x + DIRS[d].x, at.y + DIRS[d].y, opposite(d));
  const dirChips = (act, current) => [0, 1, 2, 3].map((d) =>
    `<button class="chip ${current === d ? 'on' : ''}" data-act="${act}" data-id="${d}">${arrows[d]}${leadsNowhere(d) ? ' ⚠️' : ''}</button>`).join('');

  let html = '<p class="intro">The chosen cargo leaves by the <b style="color:var(--accent)">yellow arrow(s)</b>; everything else leaves by the white arrow. Packages can come in from any other side.</p>';
  const chip = (k, label) => `<button class="chip ${o.filter === k ? 'on' : ''}" data-act="sorterfilter" data-id="${k}">${label}</button>`;
  html += '<h3 class="sec">Pull out a product</h3><div class="choice">';
  for (const p of PRODUCT_IDS) html += chip(p, `${PRODUCTS[p].icon} ${PRODUCTS[p].name}`);
  html += '</div><h3 class="sec">…or everything that is</h3><div class="choice">';
  for (const k of CARGO_IDS) if (k !== 'standard') html += chip(k, `${CARGO[k].icon} ${CARGO[k].name}`);
  const f = PRODUCTS[o.filter] || CARGO[o.filter];
  // Sorted cargo: a weight per direction (1 + 1 = half each way).
  const split = sorterSplit(o);
  const total = Object.values(split).reduce((n, w) => n + w, 0) || 1;
  html += `</div><h3 class="sec">Send ${f.icon} ${f.name.toLowerCase()} <span class="gold">(yellow)</span></h3>
    <p class="intro small">Give more than one direction a weight to split it, e.g. Down 1 + Right 1 = half each way.</p>`;
  for (const d of [0, 1, 2, 3]) {
    const w = split[d] || 0;
    html += `<div class="sort-row ${w ? 'on' : ''}"><span>${arrows[d]}${leadsNowhere(d) && w ? ' ⚠️' : ''}</span>
      <span class="sort-ctl"><button class="step" data-act="sortw" data-id="${d}|-1" ${w ? '' : 'disabled'}>−</button><b>${w}</b>
      <button class="step" data-act="sortw" data-id="${d}|1">+</button><span class="muted">${w ? Math.round((w / total) * 100) + '%' : 'off'}</span></span></div>`;
  }
  html += `<h3 class="sec">Send everything else (white)</h3><div class="choice">${dirChips('sorterdir', o.dir)}</div>`;
  if (sorterMatchDirs(o).some(leadsNowhere) || leadsNowhere(o.dir)) {
    html += '<p class="warn" style="margin-top:12px">⚠️ = no conveyor or dock there to take packages, so they\'ll back up.</p>';
  }
  html += '<button class="btn" style="width:100%;margin-top:14px" data-act="close">Done</button>';
  return html;
}

function helpHTML() {
  const sec = (icon, title, items, open) => `<details class="help-sec" ${open ? 'open' : ''}><summary>${icon} ${title}</summary><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul></details>`;
  // Later parts of the game stay folded away until you get there.
  const sites = PROPERTIES.filter((d) => state.props[d.id].owned).length;
  const gate = (ok, icon, title, when, html) => (ok ? html : `<div class="help-sec locked">🔒 ${icon} ${title} <span class="muted small">· unlocks when ${when}</span></div>`);
  const recipes = RECIPE_IDS.map((p) => `${PRODUCTS[p].icon} <b>${PRODUCTS[p].name}</b> = ${recipeText(p)}${LAUNCH.needs[p] ? ' 🚀' : ''}${RECIPES[p].research ? ` <span class="muted">(🔬 ${RESEARCH_BY_ID[RECIPES[p].research].name})</span>` : ''}`);
  return `<div class="help">
    <div class="help-version">🚀 Liftoff Logistics <b>v${GAME_VERSION}</b> · <a href="#" data-act="helpnotes">📝 What's new</a></div>
    ${tutorialHelpHTML()}
    <p><b>Goal:</b> grow from a rusty shed into a supply chain that builds a rocket 🚀, found a colony on Mars 🔴, and finish <b>🌍 Project Terraform</b> to win. The 🏆 Road to victory on the Map shows where you are.</p>
    <h3>Quick start</h3>
    <ol class="help-steps">
      <li>Suppliers drop raw materials at the green <b>🚚 IN doors</b>. Drag <b>➡️ Conveyors</b> from a door to a blue <b>📦 SHIP door</b> to sell.</li>
      <li>Put an <b>🏭 Assembler</b> on the line to turn raw materials into parts worth more. Hire an <b>👷 Operator</b> to run it.</li>
      <li>Fill <b>📋 Contracts</b> for cash and ⭐ reputation, and spend ⭐ on <b>🔬 Research</b>.</li>
      <li>Buy new sites on the <b>🗺️ Map</b>, truck parts between them, and build up to the 🚀 Launch Site.</li>
    </ol>
    ${sec('🧱', 'Building', [
      '<b>Drag</b> with the Conveyor tool to lay a line; you confirm the cost before it is placed. Tap a conveyor to turn it.',
      'Building over something asks first; <b>double-tap</b> anything to remove it. Full refund for 2 minutes, then it fades to 25%.',
      '<b>⏫ Upgrade</b> conveyors: Basic → Fast → Express (research). Each tile holds one package, so speed is throughput.',
      '<b>🔀 Splitters</b> deal packages out; <b>🚦 Sorters</b> pull one product out, and can split it by ratio across exits.',
      'New sites unlock new pieces everywhere: 🌉 <b>Bridge</b> (lines cross), 🧺 <b>Accumulator</b> (holds 20), 🫙 <b>Silo</b>, 🏗️ Loading Crane, 🧪 Research Bench, 🦾 Cobot Station.',
      '🌡️ <b>Heatmaps</b> (top right) show traffic, wear, dirt and more.',
      '🔍 <b>Zoom</b>: pinch with two fingers, or use ＋ / － under 🌡️ (mouse wheel on a computer); ⤢ fits it all back. While zoomed, move around with two fingers, or one finger with 🔍 Inspect selected.',
    ], true)}
    ${sec('🏭', 'Assemblers and machines', [
      'Tap an assembler to pick a recipe. Feed each ingredient from a different side so one cannot block another.',
      '<b>Modes</b>: ▶ Run, ⏸ Pause, or 🚀 Until the rocket has enough, so shared ingredients reach assemblers further down the line.',
      '<b>Restock from storage</b>: when an assembler runs out of something on this site’s racks, a 🚜 Forklift Operator brings up to 10 at a time.',
      '🔍 Scanner, 🏷️ Labeler, 🎁 Wrapper and ❄️ Chiller raise the <b>sale</b> price (flat bonuses before multipliers pay more). Each package stops inside for a moment, so a slow machine can cap a busy line: <b>⏫ Upgrade</b> it to Mk II (1.75× as fast) or Mk III (3×, after 🔬 Quality Control).',
      '⚙️ <b>Precision Fab Cells</b> (late game, 🔬 Full Automation) make every assembler within 2 tiles work 50% faster. One assembler starving the whole chain? Put a cell beside it, or build a second one.',
      'Everything wears out and <b>breaks down ⚠️</b>. Tap to fix, or hire 🔧 Maintenance Techs to fix and service it.',
    ])}
    ${sec('🗄️', 'Storage', [
      '<b>Racks</b> hold goods waiting for trucks, goods trucked in, and anything sent to “Store here”. Run a conveyor into a rack to store directly.',
      'Tap a rack to upgrade it (15 → 50), choose <b>what goes on it</b>, and sell stored stock (all of it or a chosen amount).',
      '<b>🚜 Handling</b>: every put-away, truck load and unload is a move. A site manages 10 a minute alone; each Forklift Operator adds 30.',
    ])}
    ${sec('👷', 'People', [
      'Workers walk the floor; they step over conveyors but not broken floor, machines or buildings. Stuck workers show ❗.',
      'Janitors, Techs, Operators and Forklift Operators are open from the start. <b>Specialists unlock through research</b>: Sales Rep, Security, Safety, Ops Manager, HR, Purchasing Agent.',
      '<b>Some specialists stop being optional as a site grows.</b> Once researched, a site with 4+ staff and no 🛡️ Security Guard (or Security Booth) slowly draws bolder thieves (up to 4× theft, then rack break-ins); 6+ staff and no ⛑️ Safety Officer means more accidents (up to 4×, then inspector fines); 10+ staff and no 🗂️ HR Manager lets grievances drag morale down (up to −20%). It builds over an hour or so and calms down once you hire. Ops Managers, Sales Reps and Purchasing Agents stay optional.',
      '😊 <b>Morale</b> comes from 🚻 restroom and ☕ break room coverage (within range), pay, accidents and filthy floors. Below 50% people quit.',
      'Tap a worker to see what they are doing, set the site’s pay rate, or let them go.',
      '🧽 Floors and buildings get dirty; filthy floors block walking. 🧹 Janitors clean.',
      'Other facilities (Generator, Maintenance Shop, First Aid, Security Booth, Ops Center) unlock through research.',
    ])}
    ${sec('🏢', 'Sites and suppliers', [
      'Each site has its own raw materials and role. A new site earns little until you boost it: follow its <b>💡 Make it pay</b> checklist (roof, sales reps, scanner or labeler, wrapper).',
      'Tap a raw-material door to pick its <b>supplier</b> (Budget, Standard, Express) or <b>🤝 negotiate</b> a cheaper contract. Read their mood; lowballing burns patience fast.',
      'A 🧾 <b>Purchasing Agent</b> renews deals for you, but settles for less. You can <b>⏸ pause</b> a door when a line is flooded.',
      'Purple <b>📥 receiving docks</b> unload trucks from your other sites; tap one to see what is coming.',
    ])}
    ${gate(sites >= 2, '🚚', 'Logistics', 'you own two sites', sec('🚚', 'Logistics', [
      '<b>Distribution</b> (or tap a SHIP door): for each product, list destinations with weights and optional caps. Surplus is sold or stored.',
      '<b>Fleet</b>: buy trucks and assign them to routes. Each truck shows live what it is doing: loading, driving, or stuck unloading and why. Tap a route on the map to jump to it.',
      'Each truck you own makes the next one 25% dearer.',
    ]))}
    ${sec('💰', 'Money', [
      '<b>💹 Market</b>: selling lots of one product drops its price until demand recovers. Booms and gluts come and go.',
      '<b>⚡ Power</b>: machines and assemblers draw power; overload a site and everything slows.',
      'Tap your money (top left) for the <b>finances</b>: where money comes from and where it goes.',
      `While you are away, sites earn ${Math.round(offlineRate() * 100)}% of their recent average for ${OFFLINE_FULL_HOURS} hours, then half that, up to ${Math.round(offlineCapSec() / 3600)} hours. A 🌙 Night Crew keeps them at ${Math.round(NIGHT_CREW_RATE * 100)}%.`,
    ])}
    ${sec('🔬', 'Research and contracts', [
      'Research is a tree in six branches. Each node needs its prerequisites, costs ⭐ and cash, and takes time in the lab (one at a time; 💎 can finish it early).',
      '<b>📋 Contracts</b> (also a tab in Research) pay cash, ⭐ and 💎. Each offer shows how likely you are to fill it, based on what you have actually been selling. 🔄 New offers costs a few 💎.',
      '<b>🏅 Mastery</b> (a Research tab after the first launch): repeatable upgrades for spare ⭐ and cash, plus 🌌 <b>Megaprojects</b> (cash and 💎) like the Orbital Cargo Depot for bigger rockets.',
    ])}
    ${gate(state.props.depot.owned || state.launch.owned, '🚀', 'The rocket', 'you buy the Regional Depot', sec('🚀', 'The rocket', [
      'Buy the 🚀 Launch Site and truck it the parts for three stages (Booster, Upper Stage, Crew Capsule), then press LAUNCH.',
      'After that, rockets can launch automatically.',
    ]))}
    ${gate(marsOn(), '🔴', 'Mars colony', 'your first rocket launches', sec('🔴', 'Mars colony', [
      'After the first launch, rockets fly to Mars during a <b>launch window</b> (every 25 minutes of play, open for 5). The colony pauses while you are away.',
      'Each rocket needs the same launch vehicle plus a <b>cargo manifest</b>: one base module, colonists, and supply crates. Plan it in 🚀 Launch Site → Mission Control.',
      'Modules: 🏠 Habitat (homes), ⚡ Solar Farm (power), 🌱 Greenhouse and 🧊 Ice Mine (cut needs), 🛬 Landing Pad (Rare Metals come home), 🔬 Research Station, ⚛️ Fusion Reactor.',
      '<b>🗺️ Build the base:</b> modules land as kits. Go to Mars (🗺️ Map → 🔴 Go to Mars base, like switching sites) and the bottom bar becomes your Mars build bar: 🏗️ Build a kit by tapping a tile, 🚚 Relocate a building (finished ones cost 2 🔧 Spares and keep 60% of their build), ✨ Auto-place, 📊 Colony stats. Colonists build one at a time (faster with more colonists). Ice Mines go on 🧊 ice, nothing goes on 🪨 rock, and Greenhouses, Ice Mines, the Research Station and the Landing Pad only work within reach of a ⚡ Solar Farm (2 tiles) or ⚛️ Fusion Reactor (3). Colonists whose dome isn’t finished shelter in the 🛸 Lander at half pace. Prefer not to? Switch new kits to ✨ Place automatically.',
      '<b>👥 Colonists have jobs:</b> farmers tend Greenhouses, ice crews run Ice Mines, caretakers keep domes clean, miners dig Rare Metals at ⛏️ Metal Mines (built on 🟫 metal veins), mechanics turn ore into Spares at the 🔧 Workshop, scientists boost ⭐ at the Research Station, and engineers build and repair. A building with nobody on it runs at 30%. Jobs fill automatically, or set them yourself in 📊 Colony.',
      '<b>🔎 Tap anything on Mars</b> (🔍 Inspect) for details: a building’s crew, power, output and dust, the Lander, or any colonist to see their name, job, what they’re doing and where they live.',
      '<b>🪨 Ore storage:</b> mined Rare Metals wait on Mars until a rocket flies them home from the 🛬 Landing Pad (up to 60 per rocket that lands). The Lander holds 30; each 🛢️ Ore Silo holds 150 more. Ore with nowhere to go is lost.',
      '<b>🙂 Morale</b> scales everything the colony makes: clean domes and a 🎳 Rec Dome nearby lift it; dusty domes, rationing, sickness and people sheltering in the Lander drag it down. Very low morale sends colonists home.',
      'Colonists use 🍞 Food, 💧 Water/O₂ and 🔧 Spares each window. Run short and they ration, then start going home (nobody dies).',
      `In a pinch, an 🆘 <b>emergency drop</b> (${MARS.emergencyGems} 💎, one per launch window) sends up to ${MARS.emergencySlots} supply crates without a rocket.`,
      'Terraform parts compete with the rocket: Turbopumps sent to Mars don’t become Engines. Mission Control warns you when that happens.',
      'Events: 🌪️ dust storms (🔋 Power Cells), ☄️ meteor strikes (repaired with Spares), 🦠 sickness (💊 Medical Kits).',
      'Colonists make ⭐, 💎 and 🪨 <b>Rare Metals</b>: sell them, or deliver them to a site for ⚛️ Fusion Cores.',
      'The 🔴 <b>Colony</b> research branch, 🚧 pad upgrades and the 📦 Spaceport Cargo Center (at the Mega Hub) grow the colony faster.',
    ]))}
    ${gate(marsOn(), '🌍', 'Winning: Project Terraform', 'your first rocket launches', sec('🌍', 'Winning: Project Terraform', [
      'Three stages, each unlocked by colony size and delivered in rocket cargo (set aside 🌍 Terraform slots in the cargo plan):',
      ...TERRAFORM.map((st) => `${st.icon} <b>${st.name}</b>: ${st.pop} colonists${st.research ? ` + ${RESEARCH_BY_ID[st.research].name}` : ''} · needs ${Object.entries(st.needs).map(([p, n]) => `${n} ${PRODUCTS[p].icon}`).join(' ')} · ${st.effect}.`),
      '🧲 Superconductors are 1 🪨 Rare Metal + 2 🧵 Wiring (after Rare Metal Refining); ⚛️ Fusion Cores need Fusion Power.',
      'Finish all three to win. Then keep playing, or start <b>🔁 New Game+</b>: +10% package value per win (up to +50%), double starting cash, Sorting Systems researched, gems kept.',
    ]))}
    ${sec('💎', 'Gems', [
      'Gems save time and never unlock anything you cannot earn: boosts, finishing research, refreshing contracts, emergency Mars drops, cargo boosts.',
      'Earn them from goals, contracts, daily play, launches and the Mars colony.',
    ])}
    ${sec('📜', 'All recipes', recipes)}
    ${sec('📦', 'Cargo types', [
      ...CARGO_IDS.filter((k) => k !== 'standard').map((k) => `<b>${CARGO[k].name}</b> (${PRODUCT_IDS.filter((p) => PRODUCTS[p].cls === k).map((p) => PRODUCTS[p].icon).join(' ')}): ${CARGO[k].desc}`),
      'Bigger sites suffer more theft, and every hire adds accident risk.',
    ])}
    <h3 id="releaseNotes">📝 Release notes</h3>
    ${releaseNotesHTML()}
    <button class="btn danger" style="width:100%;margin-top:10px" data-act="reset">Reset game</button>
  </div>`;
}

function onPanelClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const id = b.dataset.id;
  const def = curDef(), prop = curProp();
  if (act === 'close') { closePanel(); return; }
  if (act === 'appupdate') { applyUpdate(); return; }
  if (act === 'mtab') { ui.marketTab = id; renderPanel(); return; }
  if (act === 'openshop') { openPanel('shop'); return; }
  if (act === 'finwin') { ui.finWin = id; renderPanel(); return; }
  if (act === 'pay') {
    const p = curProp();
    p.payRate = Math.max(0, Math.min(PAY_RATES.length - 1, (p.payRate || 0) + Number(id)));
    rt(state.current).covT = 0; // refresh morale now
    toast(`💵 Pay rate: ${PAY_RATES[p.payRate].label}`);
    save();
    renderPanel();
    return;
  }
  if (act === 'firew') {
    const r = rt(state.current), p = curProp();
    const w = r.workers.find((q) => q.id === ui.workerSel);
    if (w && confirm(`Let ${w.name} (${STAFF_BY_ID[w.role].name}) go?`)) {
      p.staff[w.role] = Math.max(0, p.staff[w.role] - 1);
      r.workers = r.workers.filter((q) => q !== w); // this person leaves, not someone else
      toast(`🚪 ${w.name} has left`);
      save();
      closePanel();
    }
    return;
  }
  if (act === 'tutorial') { restartTutorial(); closePanel(); refreshTutorial(); return; }
  const tut = handleTutorialAct(act, id);
  if (tut === 'stop') { refreshTutorial(); return; }
  if (tut) { renderPanel(); refreshTutorial(); return; }
  if (act === 'helpnotes') { e.preventDefault(); const n = document.getElementById('releaseNotes'); if (n) n.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (act === 'showalert') {
    const [site, x, y] = id.split('|');
    if (site !== state.current) switchProperty(site);
    ui.flash = { x: Number(x), y: Number(y), until: performance.now() + 3000 };
    closePanel();
    return;
  }
  if (act === 'heat') {
    ui.heat = id === 'off' ? null : id;
    closePanel();
    refreshHeatUI();
    return;
  }
  if (act === 'facup') {
    const o = curProp().tiles[ui.facSel.y][ui.facSel.x].obj;
    const lvl = o.lvl || 1;
    const cost = Math.round(buildCost(o.k, curDef()) * FAC_UPGRADE_MULT[lvl]);
    if (lvl < FACILITIES[o.k].levels.length && spend(cost, 'upgrades', FACILITIES[o.k].name)) {
      o.lvl = lvl + 1;
      o.spent = (o.spent || 0) + cost;
      rt(state.current).covT = 0;
      toast(`${FACILITIES[o.k].icon} Upgraded to level ${o.lvl}`);
      save();
    }
    renderPanel();
    return;
  }
  if (act === 'rackup') {
    const o = curProp().tiles[ui.rackSel.y][ui.rackSel.x].obj;
    const lvl = o.lvl || 1;
    const cost = Math.round(buildCost('rack', curDef()) * RACK.upMult[lvl]);
    if (lvl < RACK.levels.length && spend(cost, 'upgrades', 'Rack')) {
      o.lvl = lvl + 1;
      o.spent = (o.spent || 0) + cost;
      markLayoutDirty(state.current);
      toast(`🗄️ Rack upgraded: holds ${rackCapOf(o)}`);
      save();
    }
    renderPanel();
    return;
  }
  if (act === 'doreplace') {
    closePanel();
    doReplace();
    refreshToolbar();
    return;
  }
  if (act === 'doremove') {
    if (ui.removeAt) removeTile(ui.removeAt.x, ui.removeAt.y);
    ui.removeAt = null;
    closePanel();
    refreshToolbar();
    return;
  }
  if (act === 'rackallmore') { ui.rackAllProducts = !ui.rackAllProducts; renderPanel(); return; }
  if (act === 'rackallow' || act === 'rackallowall') {
    const o = curProp().tiles[ui.rackSel.y][ui.rackSel.x].obj;
    if (o && o.k === 'rack') {
      if (act === 'rackallowall') {
        let n = 0;
        for (const row of curProp().tiles) for (const t of row) if (t.obj && t.obj.k === 'rack' && t.obj !== o) { t.obj.allow = o.allow ? [...o.allow] : undefined; n++; }
        toast(`🗄️ Copied to ${n} other rack${n === 1 ? '' : 's'}`);
      } else if (id === '*') delete o.allow;
      else if (o.silo) o.allow = [id]; // a silo holds one product
      else {
        const set = new Set(o.allow || []);
        if (set.has(id)) set.delete(id); else set.add(id);
        if (set.size) o.allow = PRODUCT_IDS.filter((p) => set.has(p)); else delete o.allow;
      }
      markLayoutDirty(state.current);
      save();
    }
    renderPanel();
    return;
  }
  if (act === 'rackremove') {
    removeTile(ui.rackSel.x, ui.rackSel.y);
    ui.rackSel = null;
    closePanel();
    return;
  }
  if (act === 'facclean') {
    const o = curProp().tiles[ui.facSel.y][ui.facSel.x].obj;
    const cost = Math.max(1, Math.round(buildCost(o.k, curDef()) * 0.05));
    if (spend(cost, 'repair', `Clean ${FACILITIES[o.k].name}`)) { cleanBy(state.current, o, DIRT.filthy); toast('🧽 Sparkling clean'); }
    renderPanel();
    return;
  }
  if (act === 'facremove') {
    removeTile(ui.facSel.x, ui.facSel.y);
    ui.facSel = null;
    closePanel();
    return;
  }
  if (act === 'pickfac') {
    const why = facLockReason(FACILITIES[id]);
    if (why) { toast(why); return; }
    ui.facilityType = id;
    ui.tool = 'facility';
    ui.toolGroup = null;
    closePanel();
    refreshToolbar();
    toast(`${FACILITIES[id].icon} Tap empty floor to build a ${FACILITIES[id].name}`);
    return;
  }
  if (act === 'boost') { buyBoost(id); renderPanel(); refreshTopbar(); return; }
  if (act === 'offline2x') {
    if (ui.lastOffline > 0 && state.gems >= OFFLINE_DOUBLE_COST) {
      state.gems -= OFFLINE_DOUBLE_COST;
      earn(ui.lastOffline, 'offline', 'Doubled with gems');
      toast(`💰 Doubled! +${fmt(ui.lastOffline)}`);
      ui.lastOffline = 0;
      save();
    }
    closePanel();
    return;
  }
  const res = handleResearchAct(act, id);
  if (res === 'stop') { refreshTopbar(); return; }
  if (res) { renderPanel(); refreshTopbar(); return; }
  if (act === 'keepplaying' || act === 'newgameplus' || act === 'showvictory') { handleMarsAct(act, id); return; }
  const sup = handleSupplierAct(act, id);
  if (sup === 'stop') { refreshTopbar(); return; }
  if (sup) { renderPanel(); refreshTopbar(); return; }
  const handled = handleEnterpriseAct(act, id);
  if (handled === 'stop') { refreshTopbar(); return; }
  if (handled) { renderPanel(); refreshTopbar(); refreshToolbar(); return; }
  if (act === 'buyprop') {
    const pd = PROP_BY_ID[id];
    if (spend(pd.price, 'property', pd.name)) {
      state.props[id].owned = true;
      if (PROPERTIES.some((d) => d.id !== id && state.props[d.id].owned)) {
        state.garage.trucks++; // every new site comes with a truck
        toast(`🚚 ${pd.name} came with a free truck. Assign it in Logistics`);
      }
      switchProperty(id);
      closePanel();
      toast(`Welcome to the ${pd.name}!`);
      if (id !== 'shed') {
        showMessage(`Welcome to the ${pd.name}! ${pd.emoji}`, `<p class="intro">${pd.desc}</p>
          <p class="intro">A new site earns little until you boost what its packages are worth. Bigger sites multiply every boost:</p>
          ${UNLOCK_LIST(id).length ? `<div class="power-box unlock-box"><div class="power-head"><span>🆕 New to build, at every site</span></div>
            <div class="power-note">${UNLOCK_LIST(id).map((u) => `<b>${u.icon} ${u.name}</b>: ${u.desc}`).join('<br>')}</div></div>` : ''}
          ${siteBoostHTML(id, true)}
          <p class="intro small">Staff here cost more than at your first site, so hire only who you need.</p>`);
      }
      save();
    }
  } else if (act === 'goto') {
    switchProperty(id);
    closePanel();
  } else if (act === 'tab') {
    ui.buildTab = id;
  } else if (act === 'upgrade') {
    const u = UPGRADES.find((x) => x.id === id);
    const lvl = prop.upgrades[id];
    if (lvl < u.max && spend(upgradeCost(u, lvl, def), 'upgrades', u.name)) { prop.upgrades[id]++; save(); }
  } else if (act === 'repairall') {
    let n = 0;
    for (const row of prop.tiles) for (const t of row) if (t.base === 'broken') n++;
    if (spend(n * def.repairCost, 'repair', `Repair ${n} floor tiles`)) {
      for (const row of prop.tiles) for (const t of row) if (t.base === 'broken') t.base = 'floor';
      save();
    }
  } else if (act === 'hire') {
    const s = STAFF_BY_ID[id];
    if (s.research && !hasResearch(s.research)) { toast(`🔬 Research ${RESEARCH_BY_ID[s.research].name} to hire a ${s.name}`); return; }
    if (prop.staff[id] < s.max && spend(Math.round(staffWage(s, def, prop) * HIRE_FEE_MINUTES), 'hiring', s.name)) {
      prop.staff[id]++;
      toast(`${s.icon} ${s.name} hired`);
      save();
    }
  } else if (act === 'fire') {
    if (prop.staff[id] > 0) prop.staff[id]--;
    save();
  } else if (act === 'refreshoffers') {
    refreshOffers();
  } else if (act === 'accept') {
    acceptContract(Number(id));
  } else if (act === 'abandon') {
    if (confirm('Abandon this contract?')) abandonContract(Number(id));
  } else if (act === 'sorterfilter' || act === 'sorterdir' || act === 'sortw') {
    const o = prop.tiles[ui.sorterAt.y][ui.sorterAt.x].obj;
    if (o && o.k === 'sorter') {
      if (act === 'sorterfilter') o.filter = id;
      else if (act === 'sorterdir') o.dir = Number(id); // the sorted cargo may share this exit
      else {
        const [d, delta] = id.split('|').map(Number);
        const split = { ...sorterSplit(o) };
        split[d] = Math.max(0, Math.min(9, (split[d] || 0) + delta));
        if (Object.values(split).some((w) => w > 0)) { o.split = split; o.wrr = {}; } // keep at least one exit
        else toast('The sorted cargo needs at least one exit');
      }
      delete o.side;
      clearStuckItem(ui.sorterAt.x, ui.sorterAt.y);
    }
  } else if (act === 'reset') {
    if (confirm('Erase all progress and start over?')) {
      resetGame();
      closePanel();
      layoutView();
      openPanel('map');
    }
    return;
  }
  renderPanel();
  refreshTopbar();
  refreshToolbar();
}

function switchProperty(id) {
  if (ui.marsView) leaveMars();
  if (state.current !== id) ui.pan = { x: 0, y: 0 };
  state.current = id;
  rt(id);
  layoutView();
  refreshTopbar();
  refreshToolbar();
}

// ---------------- Grid actions ----------------
// What something is worth: its build price plus any upgrades.
function totalCost(o, def) {
  let v = 0;
  if (o.k === 'belt') for (let i = 0; i <= o.tier; i++) v += buildCost('belt', def, i);
  else v = buildCost(o.silo ? 'silo' : o.k, def) + (o.spent || 0);
  return v;
}

// Full refund for the first 2 minutes, then sliding down to 25% over 10 more.
const REFUND = { fullFor: 120, fadeOver: 600, floor: 0.25 };
function refundFraction(o) {
  if (o.placedAt == null) return REFUND.floor;
  const age = state.clock - o.placedAt;
  if (age <= REFUND.fullFor) return 1;
  return Math.max(REFUND.floor, 1 - (1 - REFUND.floor) * ((age - REFUND.fullFor) / REFUND.fadeOver));
}

function refund(o, def) {
  return Math.floor(totalCost(o, def) * refundFraction(o));
}

// Pieces that sit in a conveyor line; placing one on another swaps it.
const isLinePiece = (k) => ['belt', 'splitter', 'sorter', 'assembler', 'bridge', 'buffer'].includes(k) || !!MACHINES[k];

function makeObj(kind, dir, def) {
  let o;
  if (kind === 'belt') o = { k: 'belt', dir, tier: 0 };
  else if (kind === 'splitter') o = { k: 'splitter', dir, rr: 0 };
  else if (kind === 'sorter') o = { k: 'sorter', dir, filter: defaultSorterFilter(def), out: (dir + 1) % 4 };
  else if (kind === 'assembler') o = { k: 'assembler', dir, recipe: null, buf: {}, craftT: 0 };
  else if (kind === 'silo') o = { k: 'rack', silo: true, dir: 0 };
  else if (kind === 'buffer') o = { k: 'buffer', dir, q: [] };
  else o = { k: kind, dir };
  if (!isBuilding(kind)) {
    o.wear = 0;
    o.life = equipLife(o);
  }
  o.placedAt = state.clock;
  return o;
}

// Swap a line piece for another, crediting the old one's refund.
function replaceObj(x, y, kind) {
  const def = curDef(), prop = curProp();
  const t = prop.tiles[y][x];
  const old = t.obj;
  const credit = refund(old, def);
  const net = buildCost(kind, def) - credit;
  if (net > 0 && !spend(net, 'build', `Swap to ${kind}`)) { toast(`Need ${fmt(net)} more`); return false; }
  if (net < 0) earn(-net, 'refunds', `Swap to ${kind}`);
  clearItemAt(state.current, x, y);
  const before = reachableTargets(prop, def);
  const name = (k) => (k === 'belt' ? 'Conveyor' : k === 'assembler' ? 'Assembler' : k === 'splitter' ? 'Splitter' : k === 'sorter' ? 'Sorter' : MACHINES[k].name);
  t.obj = makeObj(kind, old.dir == null ? ui.lastDir : old.dir, def);
  markLayoutDirty(state.current);
  toast(`🔁 ${name(old.k)} → ${name(kind)} (${net >= 0 ? fmt(net) : '+' + fmt(-net) + ' back'})`);
  warnIfCutOff(prop, def, before);
  return true;
}

// Make the tile buildable, repairing it if needed. Returns extra cost or -1 if impossible.
// Outer-wall tiles (not corners or docks) where outdoor buildings can go.
function isOutsideSpot(def, prop, x, y) {
  const t = prop.tiles[y][x];
  const corner = (x === 0 || x === def.cols - 1) && (y === 0 || y === def.rows - 1);
  return t.base === 'wall' && !corner && !t.obj;
}

function prepCost(t, def) {
  if (t.base === 'floor') return 0;
  if (t.base === 'broken') return def.repairCost;
  return -1;
}

function defaultSorterFilter(def) {
  return rawProductsOf(def)[0] || 'steel';
}

function placeObj(x, y, kind, dir) {
  const def = curDef(), prop = curProp();
  const t = prop.tiles[y][x];
  const prep = prepCost(t, def);
  if (prep < 0 || t.obj) return false;
  const cost = prep + buildCost(kind, def);
  if (!spend(cost, 'build', kind === 'belt' ? 'Conveyor' : MACHINES[kind] ? MACHINES[kind].name : FACILITIES[kind] ? FACILITIES[kind].name : kind[0].toUpperCase() + kind.slice(1))) { toast(`Need ${fmt(cost)}`); return false; }
  const blocks = kind !== 'belt' && kind !== 'splitter' && kind !== 'sorter'; // workers can't walk through it
  const before = blocks ? reachableTargets(prop, def) : null;
  t.base = 'floor';
  t.obj = makeObj(kind, dir, def);
  markLayoutDirty(state.current);
  if (before) warnIfCutOff(prop, def, before);
  return true;
}

function repairTile(x, y) {
  const def = curDef(), prop = curProp();
  const t = prop.tiles[y][x];
  if (t.base !== 'broken') return false;
  if (!spend(def.repairCost, 'repair', 'Floor repair')) { toast(`Need ${fmt(def.repairCost)}`); return false; }
  t.base = 'floor';
  return true;
}

function removeTile(x, y) {
  const def = curDef(), prop = curProp();
  const t = prop.tiles[y][x];
  if (!t.obj) return false;
  const back = refund(t.obj, def);
  const pct = Math.round(refundFraction(t.obj) * 100);
  earn(back, 'refunds', `Removed ${objLabel(t.obj)}`);
  toast(`🗑️ Removed: ${fmt(back)} back (${pct}%)`);
  clearItemAt(state.current, x, y);
  t.obj = null;
  markLayoutDirty(state.current);
  return true;
}

// Next upgrade for a belt or value machine: { name, cost, locked } or null when maxed.
function upgradeInfo(o, def) {
  if (!o) return null;
  if (o.k === 'belt') {
    const next = BELT_TIERS[o.tier + 1];
    return next ? { name: next.name, cost: buildCost('belt', def, o.tier + 1), locked: next.research && !hasResearch(next.research) ? next.research : null } : null;
  }
  if (MACHINES[o.k]) {
    const next = MACHINE_LEVELS[(o.mk || 0) + 1];
    return next ? { name: next.name, cost: Math.round(buildCost(o.k, def) * next.costMult), locked: next.research && !hasResearch(next.research) ? next.research : null } : null;
  }
  return null;
}

function upgradeTile(x, y) {
  const def = curDef(), prop = curProp();
  const t = prop.tiles[y][x];
  if (t.obj && MACHINES[t.obj.k]) {
    const m = MACHINES[t.obj.k], up = upgradeInfo(t.obj, def);
    if (!up) { toast(`${m.icon} ${m.name} is already ${MACHINE_LEVELS[MACHINE_LEVELS.length - 1].name}`); return false; }
    if (up.locked) { toast(`🔬 Research "${RESEARCH_BY_ID[up.locked].name}" first`); return false; }
    if (!spend(up.cost, 'upgrades', `${m.name} ${up.name}`)) { toast(`Need ${fmt(up.cost)}`); return false; }
    t.obj.mk = (t.obj.mk || 0) + 1;
    toast(`⏫ ${m.icon} ${m.name} ${up.name}: works ${MACHINE_LEVELS[t.obj.mk].speed}× as fast (−${fmt(up.cost)})`);
    return true;
  }
  if (!t.obj || t.obj.k !== 'belt') return false;
  const next = BELT_TIERS[t.obj.tier + 1];
  if (!next) { toast('Already Express'); return false; }
  if (next.research && !hasResearch(next.research)) { toast('🔬 Research "Express Belts" first'); return false; }
  const cost = buildCost('belt', def, t.obj.tier + 1);
  if (!spend(cost, 'upgrades', `${next.name} conveyor`)) { toast(`Need ${fmt(cost)}`); return false; }
  t.obj.tier++;
  t.obj.life = equipLife(t.obj);
  toast(`⏫ ${next.name} conveyor (−${fmt(cost)})`);
  return true;
}

// Price of the next upgrade step for a belt, or null if it's maxed out.
function beltUpgradeCost(o, def) {
  return o.tier < BELT_TIERS.length - 1 ? buildCost('belt', def, o.tier + 1) : null;
}

function fixCost(o, def) {
  const price = o.k === 'belt' ? buildCost('belt', def, o.tier) : buildCost(o.k, def);
  return Math.max(1, Math.round(price * (o.k === 'belt' ? FIX_FRACTION.belt : FIX_FRACTION.other)));
}

function fixMachine(x, y) {
  const def = curDef();
  const o = curProp().tiles[y][x].obj;
  const cost = fixCost(o, def);
  if (!spend(cost, 'repair', `Fix ${objLabel(o)}`)) { toast(`Need ${fmt(cost)} to fix`); return; }
  unjam(o);
  state.fixes = (state.fixes || 0) + 1;
  toast(`🔧 Fixed for ${fmt(cost)}`);
}

function rotateTile(x, y) {
  const t = curProp().tiles[y][x];
  if (!t.obj || t.obj.k === 'splitter' || isBuilding(t.obj.k)) return false;
  if (t.obj.k === 'sorter') {
    const split = sorterSplit(t.obj);
    t.obj.split = Object.fromEntries(Object.entries(split).map(([d, w]) => [(+d + 1) % 4, w]));
    t.obj.out = (sorterSideDir(t.obj) + 1) % 4;
    delete t.obj.side;
  }
  t.obj.dir = (t.obj.dir + 1) % 4;
  ui.lastDir = t.obj.dir;
  clearStuckItem(x, y);
  return true;
}

// A package mid-turn on a re-aimed tile would draw oddly; let it re-path.
function clearStuckItem(x, y) {
  const r = rt(state.current);
  for (const it of [r.occ[y][x], r.occV && r.occV[y][x]]) if (it) it.outDir = null;
}

function tryBuyDock(x, y) {
  const def = curDef(), prop = curProp();
  const t = prop.tiles[y][x];
  if (!t.locked) return false;
  const dock = def.inDocks.find((d) => d.x === x && d.y === y);
  const kind = t.base === 'out' ? 'shipping door' : dock && dock.receive ? 'receiving dock' : 'supplier dock';
  const what = t.base === 'out'
    ? 'OUTBOUND shipping door: another 📦 SHIP exit for your products'
    : dock && dock.receive
      ? 'INBOUND receiving dock: unloads trucks from your other sites'
      : `INBOUND supplier dock: brings ${Object.keys(dock.cargo).map((k) => PRODUCTS[k].icon + ' ' + PRODUCTS[k].name).join(' + ')}`;
  const label = kind;
  if (state.money < t.price) { toast(`Need ${fmt(t.price)} for this ${kind}`); return true; }
  if (confirm(`Open this ${what}

Cost: ${fmt(t.price)}`)) {
    spend(t.price, 'docks', kind);
    t.locked = false;
    toast(`New ${label} open!`);
    save();
  }
  return true;
}

// Inspect mode: say what's here without changing anything.
function inspectTile(x, y) {
  const def = curDef(), prop = curProp();
  const t = prop.tiles[y][x];
  const o = t.obj;
  const worn = (q) => (q.life ? ` · ${Math.round(((q.wear || 0) / q.life) * 100)}% worn` : '') + ` · refund ${Math.round(refundFraction(q) * 100)}%`;
  if (o && o.k === 'assembler') { ui.assemblerAt = { x, y }; openPanel('assembler'); return; }
  if (o && o.k === 'sorter') { ui.sorterAt = { x, y }; openPanel('sorter'); return; }
  if (o && o.k === 'rack') { ui.rackSel = { x, y }; openPanel('rackdetail'); return; }
  let msg;
  if (o && o.k === 'belt') {
    const up = beltUpgradeCost(o, def);
    msg = `➡️ ${BELT_TIERS[o.tier].name} conveyor${worn(o)}${up != null ? ` · upgrade to ${BELT_TIERS[o.tier + 1].name}: ${fmt(up)}` : ' · max speed'}`;
  }
  else if (o && o.k === 'splitter') msg = `🔀 Splitter${worn(o)}`;
  else if (o && o.k === 'rack') msg = `🗄️ Rack · holds ${rackCapOf(o)} products`;
  else if (o && MACHINES[o.k]) {
    const up = upgradeInfo(o, def);
    msg = `${MACHINES[o.k].icon} ${MACHINES[o.k].name} ${MACHINE_LEVELS[o.mk || 0].name}${worn(o)} · ${MACHINES[o.k].desc()} · ${up ? `⏫ ${up.name} (${MACHINE_LEVELS[(o.mk || 0) + 1].speed}× speed): ${up.locked ? `🔬 ${RESEARCH_BY_ID[up.locked].name}` : fmt(up.cost)}` : 'max speed'}`;
  }
  else if (t.base === 'broken') msg = `🧱 Damaged floor: nothing can walk or be built here. Select 🔨 Repair to fix it (${fmt(def.repairCost)})`;
  else if (t.base === 'floor') msg = (t.dirt || 0) >= DIRT.filthy ? '🪣 Filthy floor: nobody can walk here. A 🧹 Janitor or 🔨 Repair cleans it'
    : (t.dirt || 0) >= DIRT.dirty ? `Dirty floor (${Math.round(t.dirt)}%)` : 'Empty floor';
  else if (t.base === 'in') {
    const d = def.inDocks.find((k) => k.x === x && k.y === y);
    msg = d.receive ? `📥 Receiving dock · ${Object.values(prop.inbox).reduce((a, b) => a + b, 0)} waiting to unload`
      : `🚚 Supplier dock · brings ${Object.keys(d.cargo).map((k) => PRODUCTS[k].icon + ' ' + PRODUCTS[k].name).join(', ')}`;
  } else if (t.base === 'pillar') msg = 'Support pillar';
  if (msg) toast(msg);
}

function handleTap(x, y) {
  const prop = curProp();
  const t = prop.tiles[y][x];
  const tool = ui.tool;
  if ((t.base === 'in' || t.base === 'out') && t.locked) { tryBuyDock(x, y); return; }
  if (t.base === 'out' && tool !== 'remove') {
    ui.logSite = state.current;
    ui.logTab = 'dist';
    openPanel('logistics');
    return;
  }
  if (t.base === 'in' && tool !== 'remove' && (curDef().inDocks.find((k) => k.x === x && k.y === y) || {}).receive) {
    openPanel('recvdock');
    return;
  }
  if (t.base === 'in' && tool !== 'remove') {
    ui.supplyAt = { site: state.current, x, y }; // a supplier's door: deals and suppliers
    openPanel('supplier');
    return;
  }
  if (t.obj && t.obj.jammed && tool !== 'remove') { fixMachine(x, y); return; }
  // Building something different on top of an existing piece always asks first.
  const newKind = tool === 'facility' ? ui.facilityType : tool;
  const buildTool = tool && (isPlaceable(tool) || tool === 'rack' || tool === 'silo' || (tool === 'facility' && newKind));
  const outsideOnly = FACILITIES[newKind] && FACILITIES[newKind].outside && t.base === 'floor';
  if (buildTool && t.obj && t.obj.k !== newKind && !outsideOnly) { askReplace(x, y, newKind); return; }
  if (t.obj && FACILITIES[t.obj.k] && tool !== 'remove') {
    ui.facSel = { x, y };
    openPanel('facdetail');
    return;
  }
  if (!tool) { inspectTile(x, y); return; }
  if (tool === 'repair') {
    if (t.base === 'floor' && (t.dirt || 0) >= DIRT.dirty) {
      const cost = Math.max(1, Math.round(curDef().repairCost / 2));
      if (spend(cost, 'repair', 'Floor cleaning')) { t.dirt = 0; toast(`🧽 Cleaned for ${fmt(cost)}`); } else toast(`Need ${fmt(cost)}`);
    } else if (t.base !== 'broken') toast('Floor is fine here');
    else repairTile(x, y);
  } else if (tool === 'rack' || tool === 'silo') {
    if (!t.obj) { if (placeObj(x, y, tool, 0) && tool === 'silo') { ui.rackSel = { x, y }; openPanel('rackdetail'); } }
    else if (t.obj.k === 'rack') { ui.rackSel = { x, y }; openPanel('rackdetail'); }
    else toast('Remove what is here first');
  } else if (tool === 'facility') {
    const type = ui.facilityType;
    if (!type) { openPanel('facilities'); return; }
    if (facLockReason(FACILITIES[type])) { toast(facLockReason(FACILITIES[type])); return; }
    if (FACILITIES[type].onlySite && state.current !== FACILITIES[type].onlySite) { toast(`${FACILITIES[type].icon} ${FACILITIES[type].name} can only be built at the ${PROP_BY_ID[FACILITIES[type].onlySite].name}`); return; }
    if (t.obj) { toast('Remove what is here first'); return; }
    const f = FACILITIES[type];
    if (f.max && facCount(state.current, type) >= f.max) { toast(`Only ${f.max} ${f.name} per site`); return; }
    if (f.outside) {
      if (!isOutsideSpot(curDef(), prop, x, y)) { toast(`${f.icon} ${f.name}s go outside: tap a highlighted spot on the outer wall`); return; }
      const cost = buildCost(type, curDef());
      if (!spend(cost, 'build', f.name)) { toast(`Need ${fmt(cost)}`); return; }
      t.obj = { k: type, dir: 0, placedAt: state.clock };
      markLayoutDirty(state.current);
      toast(`${f.icon} ${f.name} built outside`);
      return;
    }
    if (placeObj(x, y, type, 0)) toast(`${f.icon} ${f.name} built`);
  } else if (tool === 'belt') {
    if (t.obj && t.obj.k === 'belt') rotateTile(x, y);
    else if (!t.obj) placeObj(x, y, 'belt', ui.lastDir);
    else if (isLinePiece(t.obj.k)) replaceObj(x, y, 'belt');
    else toast('Remove what is here first');
  } else if (tool === 'sorter' && t.obj && t.obj.k === 'sorter') {
    ui.sorterAt = { x, y };
    openPanel('sorter');
  } else if (tool === 'assembler' && t.obj && t.obj.k === 'assembler') {
    ui.assemblerAt = { x, y };
    openPanel('assembler');
  } else if (isPlaceable(tool)) {
    if (t.obj && t.obj.k === tool) rotateTile(x, y);
    else if (!t.obj || isLinePiece(t.obj.k)) {
      if (t.obj ? replaceObj(x, y, tool) : placeObj(x, y, tool, ui.lastDir)) {
        if (tool === 'sorter') toast(`Sorting ${PRODUCTS[t.obj.filter].icon} out the yellow arrow · tap it again to change`);
        if (tool === 'assembler') { ui.assemblerAt = { x, y }; openPanel('assembler'); }
      }
    } else toast('Remove what is here first');
  } else if (tool === 'upgrade') upgradeTile(x, y);
  else if (tool === 'rotate') rotateTile(x, y);
  else if (tool === 'remove') removeTile(x, y);
}

// ---------------- Pointer input ----------------
const drag = { active: false, last: null, start: null, moved: false, placed: new Set(), aimed: false, plan: [] };

// A dragged conveyor line becomes a plan: what each tile will get, and the cost.
function buildPlan(path) {
  const def = curDef(), prop = curProp();
  const tiles = [];
  let cost = 0, count = 0;
  path.forEach((p, i) => {
    const dir = i < path.length - 1 ? dirBetween(p, path[i + 1]) : dirBetween(path[i - 1], p);
    const t = prop.tiles[p.y][p.x];
    let action = 'skip';
    if (t.obj && t.obj.k === 'belt') action = i === 0 ? 'aim' : 'skip'; // joins an existing line
    else if (!t.obj && prepCost(t, def) >= 0) {
      action = 'place';
      cost += buildCost('belt', def) + prepCost(t, def);
      count++;
    }
    tiles.push({ x: p.x, y: p.y, dir, action });
  });
  return { tiles, cost, count };
}

function showConfirm() {
  const bar = $('confirmBar');
  const p = ui.pending;
  if (!p) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  $('confirmText').innerHTML = p.count
    ? `Place <b>${p.count}</b> conveyor${p.count > 1 ? 's' : ''} for <b class="${state.money < p.cost ? 'neg' : 'gold'}">${fmt(p.cost)}</b>?`
    : 'Re-aim this conveyor?';
}

function confirmPlan() {
  const p = ui.pending;
  ui.pending = null;
  showConfirm();
  if (!p) return;
  if (state.money < p.cost) { toast(`Need ${fmt(p.cost)}`); return; }
  for (const s of p.tiles) {
    const t = curProp().tiles[s.y][s.x];
    if (s.action === 'place' && !t.obj) placeObj(s.x, s.y, 'belt', s.dir);
    else if (s.action === 'aim' && t.obj && t.obj.k === 'belt') { t.obj.dir = s.dir; clearStuckItem(s.x, s.y); }
  }
  ui.lastDir = p.tiles[p.tiles.length - 1].dir;
  refreshToolbar();
}

function cancelPlan() {
  ui.pending = null;
  showConfirm();
}

function pointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function keyOf(x, y) { return x + ',' + y; }

function dirBetween(a, b) {
  if (b.x > a.x) return 1;
  if (b.x < a.x) return 3;
  if (b.y > a.y) return 2;
  return 0;
}

function dragStep(a, b) {
  const prop = curProp();
  const d = dirBetween(a, b);
  const ta = prop.tiles[a.y][a.x];
  const tb = prop.tiles[b.y][b.x];
  const tool = ui.tool;

  if (tool === 'belt') {
    // Just sketch the line; nothing is built until the player confirms.
    const back = drag.plan.findIndex((p) => p.x === b.x && p.y === b.y);
    if (back >= 0) drag.plan.length = back + 1; // dragged back over the line: trim it
    else drag.plan.push(b);
  } else if (isPlaceable(tool)) {
    if (drag.aimed) return;
    drag.aimed = true;
    ui.lastDir = d;
    const s = drag.start;
    const ts = prop.tiles[s.y][s.x];
    if (ts.obj && ts.obj.k === tool) {
      if (tool === 'sorter' && !ts.obj.split) {
        const out = sorterSideDir(ts.obj);
        ts.obj.out = out === d ? ts.obj.dir : out;
        delete ts.obj.side;
      }
      ts.obj.dir = d;
      clearStuckItem(s.x, s.y);
    }
    else if (!ts.obj) placeObj(s.x, s.y, tool, d);
  } else if (tool === 'repair' || tool === 'remove' || tool === 'upgrade' || tool === 'rack') {
    for (const p of [a, b]) {
      const k = keyOf(p.x, p.y);
      if (drag.placed.has(k)) continue;
      drag.placed.add(k);
      if (tool === 'rack') { if (!prop.tiles[p.y][p.x].obj) placeObj(p.x, p.y, 'rack', 0); } else if (tool === 'repair') repairTile(p.x, p.y);
      else if (tool === 'remove') removeTile(p.x, p.y);
      else upgradeTile(p.x, p.y);
    }
  }
}

function onPointerDown(e) {
  if (!state.current) return;
  const p = pointerPos(e);
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
  if (pinchDown(e, p)) return; // two fingers: zoom / pan
  drag.lastPx = p;
  drag.panning = false;
  const tile = screenToTile(p.x, p.y);
  if (!tile && !(ui.zoom > 1)) return;
  if (ui.marsView || !tile) { // Mars (and the margin when zoomed): tap on release, drag to pan
    Object.assign(drag, { active: true, mars: true, start: tile, moved: false, px: p, plan: [] });
    return;
  }
  drag.mars = false;
  drag.active = true;
  drag.start = tile;
  drag.last = tile;
  drag.moved = false;
  drag.aimed = false;
  drag.placed.clear();
  drag.plan = [tile];
  drag.px = p;
  if (ui.pending) cancelPlan(); // tapping the floor dismisses an unconfirmed line
}

function onPointerMove(e) {
  if (pinchMove(e, pointerPos(e))) return;
  if (!drag.active) return;
  const p = pointerPos(e);
  // Panning: one finger on Mars, with 🔍 Inspect, or off the grid, while zoomed in.
  if (ui.zoom > 1 && (drag.mars || !ui.tool)) {
    if (!drag.panning && Math.hypot(p.x - drag.px.x, p.y - drag.px.y) < 8) return;
    if (!drag.panning) drag.lastPx = drag.px;
    drag.panning = true; drag.moved = true;
    panBy(p.x - drag.lastPx.x, p.y - drag.lastPx.y);
    drag.lastPx = p;
    return;
  }
  if (drag.mars) { if (Math.hypot(p.x - drag.px.x, p.y - drag.px.y) > 8) drag.moved = true; return; }
  const tile = screenToTile(p.x, p.y);
  if (!tile) return;
  // Walk one tile at a time so fast swipes don't skip tiles.
  while (tile.x !== drag.last.x || tile.y !== drag.last.y) {
    const dx = tile.x - drag.last.x, dy = tile.y - drag.last.y;
    const next = Math.abs(dx) >= Math.abs(dy)
      ? { x: drag.last.x + Math.sign(dx), y: drag.last.y }
      : { x: drag.last.x, y: drag.last.y + Math.sign(dy) };
    drag.moved = true;
    dragStep(drag.last, next);
    drag.last = next;
  }
}

function onPointerUp(e) {
  if (e && pinchUp(e)) { drag.active = false; return; }
  if (!drag.active) return;
  drag.active = false;
  if (drag.panning) return;
  if (drag.mars) { if (!drag.moved && drag.start) marsTap(drag.start.x, drag.start.y, drag.px); return; }
  const person = !drag.moved && (!ui.tool || ui.tool === 'rotate') ? workerAt(drag.px.x, drag.px.y) : null;
  if (person) { ui.workerSel = person.id; openPanel('worker'); } else if (!drag.moved) tapOrDoubleTap(drag.start.x, drag.start.y);
  else if (ui.tool === 'belt' && drag.plan.length > 1) {
    ui.pending = buildPlan(drag.plan);
    showConfirm();
  }
  refreshToolbar();
}

// Taps on built things wait a moment: a second tap on the same tile asks to
// remove it instead. Taps on empty floor act immediately.
const DOUBLE_TAP_MS = 260;
function tapOrDoubleTap(x, y) {
  const t = curProp().tiles[y][x];
  const key = x + ',' + y;
  if (!t.obj) { clearTimeout(ui.tapTimer); ui.tapTimer = null; handleTap(x, y); return; }
  if (ui.tapTimer && ui.tapKey === key) {
    clearTimeout(ui.tapTimer);
    ui.tapTimer = null;
    ui.removeAt = { x, y };
    openPanel('confirmremove');
    return;
  }
  clearTimeout(ui.tapTimer);
  ui.tapKey = key;
  ui.tapTimer = setTimeout(() => { ui.tapTimer = null; handleTap(x, y); refreshToolbar(); }, DOUBLE_TAP_MS);
}

function objLabel(o) {
  if (o.k === 'belt') return `${BELT_TIERS[o.tier].name} conveyor`;
  if (o.k === 'rack') return '🗄️ Rack';
  if (o.k === 'splitter') return '🔀 Splitter';
  if (o.k === 'sorter') return '🚦 Sorter';
  if (o.k === 'assembler') return `🏭 ${o.recipe ? PRODUCTS[o.recipe].name + ' ' : ''}Assembler`;
  if (FACILITIES[o.k]) return `${FACILITIES[o.k].icon} ${FACILITIES[o.k].name}`;
  if (MACHINES[o.k]) return `${MACHINES[o.k].icon} ${MACHINES[o.k].name}`;
  return 'this';
}

function askReplace(x, y, kind) {
  ui.replaceAt = { x, y, kind };
  openPanel('confirmreplace');
}

function kindLabel(kind) {
  return objLabel(kind === 'belt' ? { k: 'belt', tier: 0 } : { k: kind });
}

function confirmReplaceHTML() {
  const at = ui.replaceAt;
  const o = at && curProp().tiles[at.y][at.x].obj;
  if (!o) return '<p class="intro">Nothing there anymore.</p>';
  const def = curDef();
  const back = refund(o, def);
  const cost = buildCost(at.kind, def);
  const net = cost - back;
  const f = FACILITIES[at.kind];
  const capped = f && f.max && facCount(state.current, at.kind) >= f.max;
  return `<p class="intro">Replace the <b>${objLabel(o)}</b> with ${at.kind === 'belt' ? 'a <b>conveyor</b>' : `a <b>${kindLabel(at.kind)}</b>`}?</p>
    <div class="stats risk">
      <div class="stat-row"><span>↩️ ${objLabel(o)} refund (${Math.round(refundFraction(o) * 100)}%)</span><b class="pos">+${fmt(back)}</b></div>
      <div class="stat-row"><span>🏗️ New ${at.kind === 'belt' ? 'conveyor' : kindLabel(at.kind)}</span><b class="neg">−${fmt(cost)}</b></div>
      <div class="stat-row"><span>Net</span><b class="${net > 0 ? 'neg' : 'pos'}">${net > 0 ? '−' : '+'}${fmt(Math.abs(net))}</b></div>
    </div>
    ${capped ? `<p class="warn">Only ${f.max} ${f.name} per site.</p>` : ''}
    <div class="confirm-row">
      <button class="btn secondary" data-act="close">Cancel</button>
      <button class="btn" data-act="doreplace" ${capped || state.money < net ? 'disabled' : ''}>🔁 Replace</button>
    </div>`;
}

// Swap whatever is on the tile for `kind` (refund the old, pay for the new).
function doReplace() {
  const at = ui.replaceAt;
  ui.replaceAt = null;
  if (!at) return;
  const prop = curProp(), def = curDef();
  const t = prop.tiles[at.y][at.x];
  const o = t.obj;
  if (!o) return;
  if (isLinePiece(o.k) && isLinePiece(at.kind)) {
    if (!replaceObj(at.x, at.y, at.kind)) return;
  } else {
    const net = buildCost(at.kind, def) - refund(o, def);
    if (state.money < net) { toast(`Need ${fmt(net)} more`); return; }
    const dir = o.dir == null ? ui.lastDir : o.dir;
    removeTile(at.x, at.y);
    if (!placeObj(at.x, at.y, at.kind, isBuilding(at.kind) ? 0 : dir)) return;
    toast(`🔁 Replaced with ${at.kind === 'belt' ? 'a conveyor' : kindLabel(at.kind)}`);
  }
  if (at.kind === 'assembler') { ui.assemblerAt = { x: at.x, y: at.y }; openPanel('assembler'); }
  else if (at.kind === 'sorter') toast('🚦 Tap the sorter again (with the Sorter tool) to choose what it sorts');
}

function confirmRemoveHTML() {
  const at = ui.removeAt;
  const o = at && curProp().tiles[at.y][at.x].obj;
  if (!o) return '<p class="intro">Nothing there anymore.</p>';
  const back = refund(o, curDef());
  const pct = Math.round(refundFraction(o) * 100);
  return `<p class="intro">Remove the <b>${objLabel(o)}</b>?<br>You'll get <b class="gold">${fmt(back)}</b> back (${pct}% refund).</p>
    <div class="confirm-row">
      <button class="btn secondary" data-act="close">Cancel</button>
      <button class="btn danger" data-act="doremove">🗑️ Remove (+${fmt(back)})</button>
    </div>`;
}

function initInput() {
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', (e) => { pinchUp(e); drag.active = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  for (const b of document.querySelectorAll('#actions button')) {
    b.addEventListener('click', () => openPanel(b.dataset.panel));
  }
  $('propBtn').addEventListener('click', () => openPanel('map'));
  $('rep').addEventListener('click', () => openPanel('research'));
  $('gems').addEventListener('click', () => openPanel('shop'));
  document.querySelector('#topbar .stat').addEventListener('click', () => openPanel('finance'));
  $('alertPill').addEventListener('click', () => openPanel('alerts'));
  $('heatBtn').addEventListener('click', () => openPanel('heat'));
  $('confirmYes').addEventListener('click', confirmPlan);
  $('confirmNo').addEventListener('click', cancelPlan);
  $('modalClose').addEventListener('click', closePanel);
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closePanel(); });
  $('modalBody').addEventListener('click', onPanelClick);
}
