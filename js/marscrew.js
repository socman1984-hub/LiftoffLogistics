'use strict';
// 👥 Colonists at work: jobs at the buildings, dusty domes, and colony morale.
// Buildings run at 30% with nobody working them; caretakers keep domes clean;
// morale (clean homes, rec domes, room, food) scales everything the colony makes.

// Slots for a job: its building's working count × crew per building.
function jobSlots(job) {
  const j = MARS_JOBS[job];
  return j.at ? effMod(j.at) * j.per : Infinity;
}

// Who does what. Auto: engineers first (more while something is being built or
// repaired), then each job up to its slots in priority order; the rest are laborers.
let crewMemo = { at: -1, m: null, v: null };
function marsCrew() {
  const m = M();
  if (crewMemo.at === state.clock && crewMemo.m === m) return crewMemo.v;
  let left = m.colonists;
  const out = {};
  const busy = m.map.b.some((q) => !q.done) || !!m.events.meteor;
  for (const job of MARS_JOB_ORDER) {
    let want;
    if (m.crewMode === 'manual') want = (m.crewSet || {})[job] || 0;
    else if (job === 'engineer') want = busy ? Math.max(2, Math.ceil(m.colonists * 0.15)) : Math.ceil(m.colonists * 0.05);
    else want = jobSlots(job);
    if (job !== 'engineer') want = Math.min(want, jobSlots(job));
    out[job] = Math.max(0, Math.min(left, want));
    left -= out[job];
  }
  out.laborer = left;
  crewMemo = { at: state.clock, m, v: out };
  return out;
}

// Working buildings of a kind, weighted by staffing: 30% empty … 100% fully crewed.
function staffedEff(k) {
  const n = effMod(k);
  const job = Object.keys(MARS_JOBS).find((j) => MARS_JOBS[j].at === k);
  if (!job || !n) return n;
  const frac = Math.min(1, marsCrew()[job] / (n * MARS_JOBS[job].per));
  return n * (MARS_CREW.idleOutput + (1 - MARS_CREW.idleOutput) * frac);
}
const staffPct = (k) => { const n = effMod(k); return n ? staffedEff(k) / n : 0; };

// ---------- Dusty domes ----------
const domes = () => M().map.b.filter((q) => q.k === 'habitat' && q.done);
function stepDomes(dt) {
  const list = domes();
  if (!list.length) return;
  for (const q of list) q.dirt = Math.min(100, (q.dirt || 0) + MARS_CREW.dirtPerSec * dt);
  let clean = marsCrew().caretaker * MARS_CREW.cleanPerSec * dt;
  for (const q of [...list].sort((a, b) => b.dirt - a.dirt)) { // dirtiest first
    if (clean <= 0) break;
    const d = Math.min(q.dirt, clean);
    q.dirt -= d; clean -= d;
  }
}
const cleanliness = () => { const list = domes(); return list.length ? 1 - list.reduce((a, q) => a + (q.dirt || 0), 0) / (100 * list.length) : 1; };

// Domes within reach of a working Rec Dome.
function recCover() {
  const m = M(), list = domes();
  const recs = m.map.b.filter((q) => q.k === 'rec' && q.done && coversAt(m.map, q.x, q.y));
  if (!list.length || !recs.length || !effMod('rec')) return 0;
  return list.filter((d) => recs.some((r) => Math.max(Math.abs(r.x - d.x), Math.abs(r.y - d.y)) <= MARS_CREW.recRange)).length / list.length;
}

// ---------- Morale ----------
function marsMorale() {
  const m = M(), K = MARS_MORALE, parts = [];
  if (!m.colonists) return { value: 1, parts };
  const clean = cleanliness();
  parts.push(['🧹 Clean domes', K.clean * (clean - 0.5) * 2]);
  const rec = recCover();
  if (rec) parts.push(['🎳 Rec Dome nearby', K.rec * rec]);
  const crowd = shelteringColonists() / m.colonists;
  if (crowd) parts.push(['🛸 Sheltering in the Lander', -K.crowd * crowd]);
  if (m.rations) parts.push(['🍞 Rationing', -K.ration]);
  if (m.events.sick) parts.push(['🦠 Sickness', -K.sick]);
  const need = marsNeeds();
  if (m.stock.food >= need.food * 2 && m.stock.water >= need.water * 2) parts.push(['📦 Well stocked', K.stocked]);
  const value = Math.max(0.2, Math.min(1.2, K.base + parts.reduce((a, [, d]) => a + d, 0)));
  return { value, parts };
}
const moraleMult = () => 0.5 + 0.5 * marsMorale().value;

// ---------- UI: crew & morale (Colony panel) ----------
function marsCrewHTML() {
  const m = M();
  if (!m.colonists) return '';
  const mo = marsMorale(), crew = marsCrew();
  const pct = Math.round(mo.value * 100), col = mo.value >= 0.9 ? '#6fcf97' : mo.value >= 0.6 ? '#f2c94c' : '#eb5757';
  let html = `<div class="mars-meter"><div class="mm-top"><span>🙂 Morale</span><span class="num">${pct}% · output ×${moraleMult().toFixed(2)}</span></div>
    <div class="bar"><div style="width:${Math.min(100, pct / 1.2)}%;background:${col}"></div></div>
    <div class="muted small">${mo.parts.map(([l, d]) => `${l} ${d >= 0 ? '+' : ''}${Math.round(d * 100)}`).join(' · ') || 'Steady'}${mo.value < MARS_MORALE.leaveBelow ? ' · <span class="neg">colonists are leaving</span>' : ''}</div></div>`;
  const manual = m.crewMode === 'manual';
  html += `<h3 class="sec">👥 Crew</h3><div class="choice"><span class="ctl-lbl">Jobs</span>
    <button class="chip ${!manual ? 'on' : ''}" data-act="marscrewmode" data-id="auto">✨ Auto</button>
    <button class="chip ${manual ? 'on' : ''}" data-act="marscrewmode" data-id="manual">👆 I choose</button></div>`;
  for (const job of MARS_JOB_ORDER) {
    const j = MARS_JOBS[job], slots = jobSlots(job), n = crew[job];
    if (j.at && !slots && !n) continue;
    const full = j.at ? n >= slots : true;
    html += `<div class="mars-step"><span>${j.icon} ${j.name} <span class="muted small">${j.desc}</span></span>
      <span class="muted small">${j.at ? `${n}/${slots}${full ? '' : ' · <span class="neg">short</span>'}` : `${n}`}</span>
      ${manual ? `<span class="dest-ctl"><button class="step" data-act="marscrew" data-id="${job}|-1" ${(m.crewSet[job] || 0) ? '' : 'disabled'}>−</button><b class="num">${m.crewSet[job] || 0}</b>
      <button class="step" data-act="marscrew" data-id="${job}|1" ${crew.laborer > 0 && (!j.at || (m.crewSet[job] || 0) < slots) ? '' : 'disabled'}>+</button></span>` : ''}</div>`;
  }
  html += `<p class="intro small">🧑‍🚀 ${crew.laborer} laborer${crew.laborer === 1 ? '' : 's'} (help build and scavenge ~1 🪨 Rare Metal each per window). Buildings with nobody on them run at ${Math.round(MARS_CREW.idleOutput * 100)}%.</p>`;
  return html;
}

function handleCrewAct(act, id) {
  const m = M();
  if (act === 'marscrewmode') {
    if (id === 'manual' && m.crewMode !== 'manual') { const c = marsCrew(); m.crewSet = {}; for (const j of MARS_JOB_ORDER) m.crewSet[j] = c[j]; }
    m.crewMode = id;
    crewMemo.at = -1;
    save();
    return true;
  }
  if (act === 'marscrew') {
    const [job, d] = id.split('|');
    m.crewSet = m.crewSet || {};
    m.crewSet[job] = Math.max(0, (m.crewSet[job] || 0) + Number(d));
    crewMemo.at = -1;
    save();
    return true;
  }
  return false;
}
