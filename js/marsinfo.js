'use strict';
// 🔎 Tap anything on Mars: building, Lander or colonist details.

// ---------- Colonists as people ----------
// Everyone gets a name, a job, a workplace and a home. Rebuilt from the crew numbers,
// so it always matches what the colony is actually doing.
const colonistName = (i) => {
  const L = WORKER_NAMES.length, first = WORKER_NAMES[(i * 7) % L];
  return i < L ? first : `${first} ${String.fromCharCode(65 + (Math.floor(i / L) * 5) % 26)}.`;
};
let peopleMemo = { at: -1, v: [] };
function marsPeople() {
  const m = M(), map = m.map;
  if (peopleMemo.at === state.clock && peopleMemo.n === m.colonists && peopleMemo.b === map.b.length) return peopleMemo.v;
  const crew = marsCrew(), out = [];
  const homes = map.b.filter((q) => q.k === 'habitat' && q.done);
  const perHome = MARS.perHabitat + rfx('marsCap');
  const site = map.b.find((q) => !q.done);
  const broken = m.events.meteor && map.b.find((q) => q.k === m.events.meteor && q.done);
  for (const job of [...MARS_JOB_ORDER, 'laborer']) {
    const j = MARS_JOBS[job];
    const places = j && j.at ? map.b.filter((q) => q.k === j.at && q.done && (!needsPower(q.k) || coversAt(map, q.x, q.y))) : [];
    for (let n = 0; n < crew[job]; n++) {
      // Fill each workplace before the next one.
      const at = j && j.at ? places[Math.min(places.length - 1, Math.floor(n / j.per))] : job === 'engineer' ? (broken || site || map.lander) : null;
      out.push({ i: out.length, job, at });
    }
  }
  for (const p of out) {
    p.name = colonistName(p.i);
    const h = Math.floor(p.i / perHome);
    p.home = h < homes.length ? homes[h] : null; // null: sheltering in the Lander
    if (!p.at) p.at = p.home || map.lander;
  }
  peopleMemo = { at: state.clock, n: m.colonists, b: map.b.length, v: out };
  return out;
}

function personTask(p) {
  const m = M(), q = p.at, mm = q && MARS_MODULES[q.k];
  switch (p.job) {
    case 'engineer':
      if (q && q.k && !q.done) return `🏗️ Building the ${mm.name} (${Math.round(q.prog * 100)}%)`;
      if (q && q.k && m.events.meteor === q.k) return `🔧 Repairing the ${mm.name} after the meteor strike (${m.events.fixed || 0}/${MARS.repairSpares} Spares)`;
      return '🔧 Checking the Lander’s systems, ready for the next build';
    case 'farmer': return '🌱 Tending the Greenhouse crops';
    case 'iceminer': return '⛏️ Cutting ice at the Ice Mine';
    case 'caretaker': return `🧹 Sweeping dust out of the domes${q && q.dirt != null ? ` (this one ${Math.round(q.dirt)}% dusty)` : ''}`;
    case 'miner': return '⛏️ Digging Rare Metals at the Metal Mine';
    case 'mechanic': return '🛠️ Turning ore into Spares Kits at the Workshop';
    case 'scientist': return '🧪 Running experiments at the Research Station';
    default: return '📦 Hauling supplies and scavenging for ore';
  }
}

// ---------- Panels ----------
PANELS.marsthing = {
  get title() { const s = ui.marsSel; if (!s) return 'Mars'; if (s.person != null) return '🧑‍🚀 Colonist'; const q = buildingAt(M().map, s.x, s.y); return q ? `${MARS_MODULES[q.k].icon} ${MARS_MODULES[q.k].name}` : '🛸 The Lander'; },
  html: () => marsThingHTML(),
};
LIVE_PANELS.push('marsthing');

function openMarsThing(sel) { ui.marsSel = sel; openPanel('marsthing'); }

function marsThingHTML() {
  const s = ui.marsSel, m = M(), map = m.map;
  if (!s) return '';
  if (s.person != null) return colonistHTML(marsPeople()[s.person]);
  if (isLander(map, s.x, s.y)) return landerHTML();
  const q = buildingAt(map, s.x, s.y);
  return q ? buildingHTML_(q) : '<p class="intro">Nothing here any more.</p>';
}

const row = (label, value) => `<div class="stat-row"><span>${label}</span><b>${value}</b></div>`;

function landerHTML() {
  const m = M(), shelter = shelteringColonists(), kits = Object.entries(m.kits).filter(([, n]) => n > 0);
  return `<p class="intro">Where every rocket sets down. Colonists without a finished dome live here, and it keeps a little ore.</p>
    <div class="stats risk">
      ${row('🛸 Sheltering here', shelter ? `<span class="neg">${shelter} (half pace)</span>` : 'nobody')}
      ${row('🪨 Ore storage', `${MARS_STORE.lander} of the colony’s ${oreCap()}`)}
      ${row('📦 Kits waiting', kits.length ? kits.map(([k, n]) => `${MARS_MODULES[k].icon}×${n}`).join(' ') : 'none')}
      ${row('🔧 Spares on hand', m.stock.spares)}
    </div>`;
}

function buildingHTML_(q) {
  const m = M(), map = m.map, mm = MARS_MODULES[q.k], k = q.k;
  const powered = !needsPower(k) || coversAt(map, q.x, q.y);
  const dmg = q.done && m.events.meteor === k && (m.damaged[k] || 0) > 0;
  let status;
  if (!q.done) status = `🏗️ Under construction · ${Math.round(q.prog * 100)}%`;
  else if (!powered) status = '<span class="neg">🔌 Offline: no power reaches it</span>';
  else if (dmg) status = `<span class="neg">💥 Meteor damage · repair ${m.events.fixed || 0}/${MARS.repairSpares} 🔧</span>`;
  else status = '✅ Working';
  let html = `<p class="intro">${mm.desc}</p><div class="stats risk">${row('Status', status)}`;
  const jobId = Object.keys(MARS_JOBS).find((j) => MARS_JOBS[j].at === k);
  const here = marsPeople().filter((p) => p.at === q && p.job !== 'laborer' && p.job !== 'caretaker' || (k === 'habitat' && p.job === 'caretaker' && p.at === q));
  if (jobId && q.done) {
    const j = MARS_JOBS[jobId];
    html += row(`${j.icon} ${j.name}`, `${here.filter((p) => p.job === jobId).length} / ${j.per}${here.length < j.per ? ' <span class="neg">short</span>' : ''}`);
  }
  const pw = marsPower().frac;
  if (q.done) {
    if (k === 'habitat') {
      const res = marsPeople().filter((p) => p.home === q);
      html += row('🏠 Residents', `${res.length} / ${MARS.perHabitat + rfx('marsCap')}`);
      html += row('🟤 Dust', `${Math.round(q.dirt || 0)}%${(q.dirt || 0) >= 50 ? ' <span class="neg">needs a caretaker</span>' : ''}`);
      const recs = map.b.filter((r) => r.k === 'rec' && r.done && coversAt(map, r.x, r.y) && Math.max(Math.abs(r.x - q.x), Math.abs(r.y - q.y)) <= MARS_CREW.recRange);
      html += row('🎳 Rec Dome nearby', recs.length ? 'yes (+morale)' : 'no');
    }
    if (MARS_MAP.powerRange[k]) {
      const r = MARS_MAP.powerRange[k];
      const reach = map.b.filter((b) => b !== q && needsPower(b.k) && Math.max(Math.abs(b.x - q.x), Math.abs(b.y - q.y)) <= r).length;
      html += row('⚡ Power', `+${k === 'solar' ? MARS.solarPower + (m.events.dust ? ' (halved: dust storm)' : '') : MARS.fusionPower}`);
      html += row('📡 Reach', `${r} tiles · ${reach} building${reach === 1 ? '' : 's'} powered`);
    }
    if (k === 'greenhouse' || k === 'icemine') html += row(k === 'greenhouse' ? '🍞 Food needed' : '💧 Water/O₂ needed', `−${Math.round(25 * staffPct(k) * pw)}% from this one`);
    if (k === 'mine') html += row('🪨 Ore per window', `~${Math.round(MARS_CREW.metalsPerMiner * here.length * pw)}`);
    if (k === 'workshop') html += row('🔧 Spares per window', `~${Math.floor(MARS_CREW.sparesPerWorkshop * staffPct(k) * pw)} (uses ${MARS_CREW.metalsPerSpare} ore each)`);
    if (k === 'station') html += row('⭐ Reputation', `+${Math.round(50 * staffPct(k) * pw)}% from colonists`);
    if (k === 'rec') html += row('🏠 Domes in reach', `${map.b.filter((d) => d.k === 'habitat' && d.done && Math.max(Math.abs(d.x - q.x), Math.abs(d.y - q.y)) <= MARS_CREW.recRange).length}`);
    if (k === 'silo') html += row('🪨 Ore stored (all storage)', `${m.ore} / ${oreCap()}`);
    if (k === 'pad') html += row('🚀 Return flights', `each landing rocket flies up to ${MARS_STORE.returnPerRocket} ore home · ${m.ore} waiting`);
  }
  html += '</div>';
  if (here.length) html += `<h3 class="sec">Who’s here</h3><div class="choice">${here.slice(0, 12).map((p) => `<button class="chip" data-act="marsperson" data-id="${p.i}">🧑‍🚀 ${p.name}</button>`).join('')}</div>`;
  const canMove = q.done || q.prog === 0;
  if (canMove) html += `<button class="btn secondary" style="width:100%;margin-top:10px" data-act="marsrelocate" data-id="${q.x},${q.y}">🚚 Relocate${q.done ? ` · ${MARS_MAP.relocateSpares} 🔧` : ' · free'}</button>
    <p class="intro small">${q.done ? `Packs it up to place somewhere else; it keeps ${Math.round(MARS_MAP.relocateKeep * 100)}% of its build.` : 'Building hasn’t started, so moving it costs nothing.'}</p>`;
  return html;
}

function colonistHTML(p) {
  if (!p) return '<p class="intro">They’ve headed home.</p>';
  const m = M(), j = MARS_JOBS[p.job], mo = Math.round(marsMorale().value * 100);
  const where = p.at && p.at.k ? `${MARS_MODULES[p.at.k].icon} ${MARS_MODULES[p.at.k].name}` : '🛸 The Lander';
  return `<div class="colonist-card"><div class="cc-face">🧑‍🚀</div><div><div class="cc-name">${p.name}</div>
      <div class="muted small">${j ? `${j.icon} ${j.name.replace(/s$/, '')}` : '📦 Laborer'}</div></div></div>
    <p class="intro"><b>Now:</b> ${personTask(p)}</p>
    <div class="stats risk">
      ${row('📍 Working at', where)}
      ${row('🏠 Lives in', p.home ? `🏠 Habitat Dome (${Math.round(p.home.dirt || 0)}% dusty)` : '<span class="neg">🛸 the Lander (no dome yet, half pace)</span>')}
      ${row('🙂 Colony morale', `${mo}%`)}
    </div>
    ${m.crewMode === 'manual' ? '' : '<p class="intro small">Jobs are assigned automatically; change them in 📊 Colony → Crew.</p>'}
    ${p.at && p.at.k ? `<button class="btn secondary" style="width:100%" data-act="marsat" data-id="${p.at.x},${p.at.y}">${MARS_MODULES[p.at.k].icon} See the ${MARS_MODULES[p.at.k].name}</button>` : ''}`;
}

function handleMarsInfoAct(act, id) {
  if (act === 'marsperson') { ui.marsSel = { person: Number(id) }; return true; }
  if (act === 'marsat') { const [x, y] = id.split(',').map(Number); ui.marsSel = { x, y }; return true; }
  if (act === 'marsrelocate') {
    const [x, y] = id.split(',').map(Number);
    closePanel();
    if (!ui.marsView) goMars();
    ui.marsTool = 'move';
    marsTap(x, y);
    return 'stop';
  }
  return false;
}
