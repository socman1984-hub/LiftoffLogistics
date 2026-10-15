'use strict';
// 🧭 Expeditions: send a party of colonists out across Mars. Bigger parties bring
// back more, and each job has its specialty (miners find ore and crystals, engineers
// keep everyone out of trouble...). Finds are made into supplies, rovers and module
// kits right on Mars. One party out at a time; they're away from their jobs meanwhile.

const ZONE_BY_ID = Object.fromEntries(MARS_ZONES.map((z) => [z.id, z]));
const awayCount = () => (state.mars && state.mars.exp ? state.mars.exp.n : 0);
const partySize = (party) => Object.values(party || {}).reduce((a, n) => a + n, 0);
const maxParty = () => MARS_EXPLORE.maxParty[M().rover] || MARS_EXPLORE.maxParty[0];
const tripTime = (z) => Math.round(z.time * (1 - (MARS_EXPLORE.roverSpeed[M().rover] || 0)));
const tripSupplies = (n) => Math.ceil(n / MARS_EXPLORE.supplyPer); // 🍞 and 💧 each
const zoneOpen = (z) => M().rover >= z.rover;
const ROVER_NAME = ['on foot', '🚙 Rover', '🚜 Heavy Rover'];

// Who could go, by job: those at home now plus anyone already out with the party.
function explorersAvailable() {
  const crew = marsCrew(), exp = M().exp, out = {};
  for (const job of Object.keys(MARS_SKILLS)) out[job] = (crew[job] || 0) + (exp ? exp.party[job] || 0 : 0);
  return out;
}
// The planned party, trimmed to who's available and the size limits.
function explorePlan() {
  const m = M();
  if (!m.expPlan) m.expPlan = { zone: 'plains', party: { laborer: 2 } };
  const avail = explorersAvailable(), party = {};
  let room = Math.min(maxParty(), Math.max(0, m.colonists - MARS_EXPLORE.stayBehind));
  for (const job of Object.keys(MARS_SKILLS)) {
    const n = Math.max(0, Math.min(m.expPlan.party[job] || 0, avail[job], room));
    if (n) { party[job] = n; room -= n; }
  }
  const zone = ZONE_BY_ID[m.expPlan.zone] && zoneOpen(ZONE_BY_ID[m.expPlan.zone]) ? m.expPlan.zone : 'plains';
  return { zone, party, n: partySize(party) };
}

// What a party should bring home (luck = 1 for the estimate). Each explorer counts 1,
// plus their job's specialty; the haul grows a little slower than the party.
function expHaul(z, party, luck = () => 1) {
  const out = {};
  for (const [mat, per] of Object.entries(z.finds)) {
    let effort = 0;
    for (const [job, n] of Object.entries(party)) effort += n * (1 + ((MARS_SKILLS[job] || {})[mat] || 0));
    if (effort > 0) out[mat] = per * Math.pow(effort, MARS_EXPLORE.groupPower) * luck();
  }
  return out;
}
function expRisk(z, party) {
  let r = z.risk;
  for (const [job, n] of Object.entries(party)) r *= Math.pow(1 - ((MARS_SKILLS[job] || {}).safe || 0), n);
  return r;
}
function expArtifact(z, party) {
  if (!z.artifact) return 0;
  let k = 1;
  for (const [job, n] of Object.entries(party)) k += n * ((MARS_SKILLS[job] || {}).artifact || 0);
  return Math.min(0.6, z.artifact * k);
}
const samplesStars = () => MARS_EXPLORE.samplesStars * (effMod('station') ? 1.5 : 1);

// Why this party can't leave right now (or null).
function expProblem(plan) {
  const m = M(), z = ZONE_BY_ID[plan.zone];
  if (m.exp) return 'A party is already out';
  if (!zoneOpen(z)) return `${z.name} needs a ${ROVER_NAME[z.rover]}`;
  if (!plan.n) return 'Pick who goes';
  const need = tripSupplies(plan.n);
  if (m.stock.food < need || m.stock.water < need) return `Needs ${need} 🍞 and ${need} 💧 from the colony’s stock`;
  return null;
}

function sendExpedition(quiet) {
  const m = M(), plan = explorePlan(), why = expProblem(plan);
  if (why) { if (!quiet) toast(`🧭 ${why}`); return false; }
  const z = ZONE_BY_ID[plan.zone], need = tripSupplies(plan.n);
  m.stock.food -= need; m.stock.water -= need;
  if (m.crewMode === 'manual') for (const [job, n] of Object.entries(plan.party)) if (m.crewSet[job]) m.crewSet[job] = Math.max(0, m.crewSet[job] - n);
  m.exp = { zone: z.id, party: plan.party, n: plan.n, startAt: state.clock, backAt: state.clock + tripTime(z) };
  crewMemo.at = -1;
  toast(`🧭 ${plan.n} explorer${plan.n > 1 ? 's' : ''} set off for ${z.icon} ${z.name} · back in ${fmtSecs(tripTime(z))}`);
  save();
  return true;
}

function expReturn() {
  const m = M(), e = m.exp, z = ZONE_BY_ID[e.zone];
  const trouble = Math.random() < expRisk(z, e.party);
  const raw = expHaul(z, e.party, () => (0.8 + Math.random() * 0.4) * (trouble ? 0.5 : 1));
  const haul = {};
  for (const [mat, v] of Object.entries(raw)) { const n = Math.floor(v) + (Math.random() < v % 1 ? 1 : 0); if (n) haul[mat] = n; }
  for (const k of Object.keys(MARS_FINDS)) if (haul[k]) m.finds[k] = (m.finds[k] || 0) + haul[k];
  let lost = 0;
  if (haul.raremetal) { const keep = Math.min(haul.raremetal, Math.max(0, oreCap() - m.ore)); m.ore += keep; lost = haul.raremetal - keep; }
  let stars = Math.round((haul.samples || 0) * samplesStars()), gems = 0;
  const artifact = Math.random() < expArtifact(z, e.party);
  if (artifact) { stars += MARS_EXPLORE.artifactStars; gems += MARS_EXPLORE.artifactGems; }
  state.rep += stars; state.gems += gems;
  if (m.crewMode === 'manual') for (const [job, n] of Object.entries(e.party)) if (job !== 'laborer') m.crewSet[job] = (m.crewSet[job] || 0) + n;
  m.exp = null;
  m.expTrips = (m.expTrips || 0) + 1;
  m.expLast = { zone: z.id, n: e.n, haul, stars, gems, trouble, artifact, lost };
  crewMemo.at = -1;
  toast(`🧭 Explorers back from ${z.icon} ${z.name}${trouble ? ' (a rough trip: half the haul left behind)' : ''}: ${haulText(haul) || 'nothing useful'}${stars ? ` · +${stars} ⭐` : ''}${artifact ? ` · 🏺 an ancient-looking find! +${gems} 💎` : ''}${lost ? ` · ${lost} 🪨 lost (ore storage full)` : ''}`);
  if (m.expRepeat && !sendExpedition(true)) toast(`🧭 The next party can’t leave: ${expProblem(explorePlan())}`);
}

function stepExpeditions() {
  const m = M();
  if (m.exp && state.clock >= m.exp.backAt) expReturn();
}

const FIND_ICON = (mat) => (MARS_FINDS[mat] ? MARS_FINDS[mat].icon : mat === 'raremetal' ? '🪨' : mat === 'samples' ? '🧫' : '?');
const haulText = (h, approx) => Object.entries(h).filter(([, n]) => approx ? n >= 0.05 : n).map(([mat, n]) => `${FIND_ICON(mat)} ${approx ? `~${n < 1 ? n.toFixed(1) : Math.round(n)}` : n}`).join(' · ');

// ---------- 🛠️ Making things from finds ----------
const fabTitle = (f) => (f.module ? `${MARS_MODULES[f.module].name} kit` : f.name);
const fabIcon = (f) => (f.module ? MARS_MODULES[f.module].icon : f.icon);
const fabName = (f) => `${fabIcon(f)} ${fabTitle(f)}`;
const fabAfford = (f) => Object.entries(f.cost).every(([k, n]) => (M().finds[k] || 0) >= n);
function fabProblem(f) {
  const m = M();
  if (f.rover) return m.rover >= f.rover ? 'Already built' : m.rover < f.rover - 1 ? 'Build the 🚙 Rover first' : null;
  if (f.module) {
    const mm = MARS_MODULES[f.module];
    if (!moduleAllowed(f.module)) return mm.max && modCount(f.module) + pendingCount(f.module) >= mm.max ? `At most ${mm.max}` : 'Needs a 🏠 Habitat first';
  }
  return null;
}
function fabricate(id) {
  const m = M(), f = MARS_FAB.find((q) => q.id === id);
  if (!f) return;
  const why = fabProblem(f);
  if (why) { toast(`🛠️ ${why}`); return; }
  if (!fabAfford(f)) { toast(`🛠️ Not enough: needs ${costText(f.cost)}`); return; }
  for (const [k, n] of Object.entries(f.cost)) m.finds[k] -= n;
  if (f.stock) m.stock[f.stock] += 1;
  if (f.rover) m.rover = f.rover;
  if (f.module) { m.kits[f.module] = (m.kits[f.module] || 0) + 1; if (m.autoBuild) autoPlaceKits(); }
  toast(`🛠️ Made on Mars: ${fabName(f)}${f.module ? (m.autoBuild ? ' (placed for you)' : ': place it with 🏗️ Build') : ''}`);
  save();
}
const costText = (c) => Object.entries(c).map(([k, n]) => `${MARS_FINDS[k].icon} ${n}`).join(' ');

// ---------- Panel (🔴 Mission Control → 🧭 Explore) ----------
function exploreHTML() {
  const m = M();
  if (m.colonists <= MARS_EXPLORE.stayBehind && !m.exp) return `<p class="intro">🧭 Expeditions need more than ${MARS_EXPLORE.stayBehind} colonists on Mars: ${MARS_EXPLORE.stayBehind} always stay to mind the base. Send colonists in a rocket’s cargo plan.</p>`;
  let html = '';
  if (m.exp) {
    const z = ZONE_BY_ID[m.exp.zone], left = Math.max(0, m.exp.backAt - state.clock), all = m.exp.backAt - m.exp.startAt;
    html += `<div class="truck-row go"><span class="tr-ic">${z.icon}</span><div class="tr-body">
      <div class="tr-text">${m.exp.n} explorer${m.exp.n > 1 ? 's' : ''} at ${z.name} · back in ${fmtSecs(left)}</div>
      <div class="bar tr-bar"><div style="width:${Math.min(100, (1 - left / all) * 100)}%"></div></div>
      <div class="muted small">${partyText(m.exp.party)} · away from their jobs</div></div></div>`;
  } else if (m.expLast) {
    const l = m.expLast, z = ZONE_BY_ID[l.zone];
    html += `<p class="intro small">Last trip (${z.icon} ${z.name}, ${l.n}): ${haulText(l.haul) || 'nothing useful'}${l.stars ? ` · +${l.stars} ⭐` : ''}${l.artifact ? ` · 🏺 +${l.gems} 💎` : ''}${l.trouble ? ' · <span class="warn-text">ran into trouble</span>' : ''}</p>`;
  }
  html += `<div class="mars-parts">${Object.entries(MARS_FINDS).map(([k, f]) => `<span>${f.icon} ${m.finds[k] || 0} ${f.name}</span>`).join('')}</div>`;
  html += `<p class="intro small">Getting around: <b>${ROVER_NAME[m.rover]}</b> · parties up to ${maxParty()} · ${m.expTrips || 0} trip${m.expTrips === 1 ? '' : 's'} so far</p>`;

  // Where to
  const plan = explorePlan(), z = ZONE_BY_ID[plan.zone];
  html += '<h3 class="sec">🧭 Plan a trip</h3><div class="choice">' + MARS_ZONES.map((q) => `<button class="chip ${plan.zone === q.id ? 'on' : ''} ${zoneOpen(q) ? '' : 'faint'}" data-act="expzone" data-id="${q.id}">${zoneOpen(q) ? q.icon : '🔒'} ${q.name}</button>`).join('') + '</div>';
  html += `<p class="intro small">${z.icon} <b>${z.name}</b>: ${z.desc}. ${fmtSecs(tripTime(z))} there and back. Finds: ${Object.keys(z.finds).map(FIND_ICON).join(' ')}${z.artifact ? ' · 🏺 a chance of something rare' : ''}.</p>`;

  // Who goes
  const avail = explorersAvailable(), room = Math.min(maxParty(), Math.max(0, m.colonists - MARS_EXPLORE.stayBehind));
  html += `<h3 class="sec">👥 Who goes <span class="muted small">${plan.n}/${room}</span></h3>`;
  for (const [job, sk] of Object.entries(MARS_SKILLS)) {
    if (!avail[job]) continue;
    const j = MARS_JOBS[job], n = plan.party[job] || 0;
    html += `<div class="mars-step"><span>${j ? `${j.icon} ${j.name}` : '🧑‍🚀 Laborers'} <span class="muted small">${sk.desc}</span></span>
      <span class="muted small">${avail[job]} here</span>
      <span class="dest-ctl"><button class="step" data-act="expparty" data-id="${job}|-1" ${n ? '' : 'disabled'}>−</button><b class="num">${n}</b>
      <button class="step" data-act="expparty" data-id="${job}|1" ${n < avail[job] && plan.n < room ? '' : 'disabled'}>+</button></span></div>`;
  }
  // What to expect
  const need = tripSupplies(plan.n), risk = expRisk(z, plan.party), art = expArtifact(z, plan.party);
  const est = expHaul(z, plan.party);
  html += `<div class="stats risk">
    <div class="stat-row"><span>Expected haul</span><b>${plan.n ? haulText(est, true) : '—'}</b></div>
    ${z.finds.samples ? `<div class="stat-row"><span>🧫 Samples</span><b>+${samplesStars()} ⭐ each${effMod('station') ? ' (🔬 Station +50%)' : ''}</b></div>` : ''}
    <div class="stat-row"><span>⚠️ Chance of trouble</span><b class="${risk > 0.15 ? 'neg' : ''}">${Math.round(risk * 100)}% <span class="muted small">(halves the haul; 🔧 engineers help)</span></b></div>
    ${art ? `<div class="stat-row"><span>🏺 Rare find</span><b>${Math.round(art * 100)}% · +${MARS_EXPLORE.artifactGems} 💎 +${MARS_EXPLORE.artifactStars} ⭐</b></div>` : ''}
    <div class="stat-row"><span>Takes from stock</span><b>${plan.n ? `🍞 ${need} · 💧 ${need}` : '—'} <span class="muted small">(have ${m.stock.food} · ${m.stock.water})</span></b></div></div>`;
  const why = expProblem(plan);
  html += `<button class="btn launch" data-act="expsend" ${why ? 'disabled' : ''}>${why && m.exp ? `🧭 Party out · back in ${fmtSecs(Math.max(0, m.exp.backAt - state.clock))}` : why || `🧭 Send ${plan.n} to ${z.name}`}</button>`;
  html += `<div class="choice"><span class="ctl-lbl">When they’re back</span>
    <button class="chip ${!m.expRepeat ? 'on' : ''}" data-act="exprepeat" data-id="off">✋ Stay home</button>
    <button class="chip ${m.expRepeat ? 'on' : ''}" data-act="exprepeat" data-id="on">🔁 Head out again</button></div>`;
  html += `<p class="intro small">Explorers leave their jobs while they’re away (jobs refill from the rest of the colony) and take 1 🍞 and 1 💧 per ${MARS_EXPLORE.supplyPer} explorers. ${MARS_EXPLORE.stayBehind} colonists always stay behind.</p>`;

  // Make things
  html += '<h3 class="sec">🛠️ Make on Mars</h3>';
  for (const f of MARS_FAB) {
    const why2 = fabProblem(f);
    if (f.rover && m.rover >= f.rover) continue;
    if (f.module && MARS_MODULES[f.module].research && !hasResearch(MARS_MODULES[f.module].research)) continue;
    const have = (k, n) => `<span class="${(m.finds[k] || 0) >= n ? 'pos' : ''}">${MARS_FINDS[k].icon} ${Math.min(n, m.finds[k] || 0)}/${n}</span>`;
    const desc = f.desc || (f.module ? `${MARS_MODULES[f.module].desc}. Skips the rocket` : `Adds 1 to the colony’s stock (${m.stock[f.stock]} now)`);
    html += card(fabIcon(f), fabTitle(f), desc,
      Object.entries(f.cost).map(([k, n]) => have(k, n)).join(' ') + (why2 ? ` · <span class="warn-text">${why2}</span>` : ''),
      `<button class="btn" data-act="expfab" data-id="${f.id}" ${!why2 && fabAfford(f) ? '' : 'disabled'}>Make</button>`);
  }
  return html;
}
const partyText = (party) => Object.entries(party).filter(([, n]) => n).map(([job, n]) => `${MARS_JOBS[job] ? MARS_JOBS[job].icon : '🧑‍🚀'} ${n}`).join(' ');

function handleExploreAct(act, id) {
  const m = M();
  if (act === 'expzone') {
    const z = ZONE_BY_ID[id];
    if (!zoneOpen(z)) { toast(`🔒 ${z.name} needs a ${ROVER_NAME[z.rover]} (🛠️ Make on Mars, below)`); return true; }
    explorePlan(); m.expPlan.zone = id; save(); return true;
  }
  if (act === 'expparty') {
    const [job, d] = id.split('|');
    const plan = explorePlan();
    m.expPlan.party = { ...plan.party, [job]: Math.max(0, (plan.party[job] || 0) + Number(d)) };
    save();
    return true;
  }
  if (act === 'expsend') { sendExpedition(); return true; }
  if (act === 'exprepeat') { m.expRepeat = id === 'on'; save(); return true; }
  if (act === 'expfab') { fabricate(id); return true; }
  return false;
}
