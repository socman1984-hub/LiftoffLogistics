'use strict';
// Research: a tech tree in five branches. Each node costs ⭐ + cash and
// spends time in the lab, one project at a time (💎 can rush it).

const researchById = (id) => RESEARCH_BY_ID[id];
const branchOf = (id) => RESEARCH_BRANCHES.find((b) => b.id === id);

function researchState(r) {
  if (hasResearch(r.id)) return 'done';
  if (state.lab && state.lab.id === r.id) return 'active';
  if (!researchMet(r)) return 'locked';
  return 'open';
}

const labTime = (s) => (s < 60 ? `${s}s` : `${Math.round(s / 60)} min`);
const canAffordResearch = (r) => state.rep >= r.cost && state.money >= r.money;
const rushCost = () => (state.lab ? Math.max(1, Math.ceil(state.lab.left / RUSH_SECS_PER_GEM)) : 0);

function startResearch(id) {
  const r = researchById(id);
  if (!r || state.lab || researchState(r) !== 'open' || !canAffordResearch(r)) return;
  state.rep -= r.cost;
  spend(r.money, 'research', r.name);
  state.lab = { id, left: r.time };
  toast(`🔬 Researching ${r.name} (${labTime(r.time)})`);
  save();
}

function cancelResearch() {
  const r = state.lab && researchById(state.lab.id);
  if (!r || !confirm(`Stop researching ${r.name}? You get the ⭐ and cash back.`)) return;
  state.rep += r.cost;
  earn(r.money, 'refunds', `Research cancelled: ${r.name}`);
  state.lab = null;
  save();
}

function finishResearch() {
  const r = researchById(state.lab.id);
  state.research[r.id] = true;
  state.lab = null;
  toast(`🔬 ${r.name} researched! ${r.desc}`);
  if (typeof refreshToolbar === 'function') refreshToolbar();
  save();
}

function rushResearch() {
  const cost = rushCost();
  if (!state.lab || state.gems < cost) return;
  state.gems -= cost;
  finishResearch();
}

// Lab time passes with the game clock (and while away; see main.js).
// Research Benches at any site speed the lab up.
function labSpeed() {
  let n = 0;
  for (const def of PROPERTIES) if (state.props[def.id].owned) n += facCount(def.id, 'bench');
  return 1 + 0.25 * Math.min(BENCH_MAX, n);
}

function stepLab(dt) {
  if (!state.lab) return;
  state.lab.left -= dt * labSpeed();
  if (state.lab.left <= 0) finishResearch();
}

// ---- Panel ----
function researchHTML() {
  if (!ui.resBranch) ui.resBranch = 'prod';
  const done = RESEARCH.filter((r) => hasResearch(r.id)).length;
  let html = `<div class="res-head"><span>⭐ <b>${state.rep}</b> reputation · <b>${fmt(state.money)}</b></span><span class="muted">${done}/${RESEARCH.length} researched</span></div>`;
  html += labHTML();
  html += '<div class="res-tabs">' + RESEARCH_BRANCHES.map((b) => {
    const nodes = RESEARCH.filter((r) => r.b === b.id);
    const n = nodes.filter((r) => hasResearch(r.id)).length;
    const ready = !state.lab && nodes.some((r) => researchState(r) === 'open' && canAffordResearch(r));
    return `<button class="res-tab ${ui.resBranch === b.id ? 'on' : ''}" data-act="resbranch" data-id="${b.id}">
      <span class="ic">${b.icon}</span><span class="nm">${b.name}</span><span class="ct">${n}/${nodes.length}${ready ? ' •' : ''}</span></button>`;
  }).join('') + '</div>';
  const br = branchOf(ui.resBranch);
  html += `<p class="intro small">${br.icon} <b>${br.name}</b>: ${br.desc}. Tap a node for details. Lines show what each one needs first.</p>`;
  html += nodeDetailHTML();
  html += treeHTML(ui.resBranch);
  return html;
}

function labHTML() {
  if (!state.lab) {
    return '<div class="lab idle">🔬 <b>Lab idle</b> · pick something to research below</div>';
  }
  const r = researchById(state.lab.id);
  const pct = Math.max(0, Math.min(100, (1 - state.lab.left / r.time) * 100));
  const gems = rushCost();
  const sp = labSpeed();
  return `<div class="lab"><div class="lab-top"><span>${r.icon} <b>${r.name}</b></span><span>${fmtTime(Math.max(0, state.lab.left / sp))} left${sp > 1 ? ` · 🧪 ×${sp}` : ''}</span></div>
    <div class="bar"><div style="width:${pct}%"></div></div>
    <div class="lab-btns"><button class="btn small secondary" data-act="rescancel">Cancel</button>
    <button class="btn small gem" data-act="resrush" ${state.gems < gems ? 'disabled' : ''}>⚡ Finish now · ${gems} 💎</button></div></div>`;
}

function nodeDetailHTML() {
  const r = ui.resSel && researchById(ui.resSel);
  if (!r || r.b !== ui.resBranch) return '';
  const st = researchState(r);
  const reqs = r.req.map((id) => {
    const q = researchById(id);
    const other = q.b !== r.b ? ` <span class="muted">(${branchOf(q.b).name})</span>` : '';
    return `<span class="${hasResearch(id) ? 'pos' : 'neg'}">${hasResearch(id) ? '✓' : '✗'} ${q.icon} ${q.name}</span>${other}`;
  }).join(', ');
  let btn;
  if (st === 'done') btn = '<button class="btn secondary" disabled>✓ Researched</button>';
  else if (st === 'active') btn = '<button class="btn secondary" disabled>In the lab…</button>';
  else if (st === 'locked') btn = '<button class="btn secondary" disabled>🔒 Needs the ones above</button>';
  else if (state.lab) btn = '<button class="btn secondary" disabled>Lab busy</button>';
  else btn = `<button class="btn" data-act="research" data-id="${r.id}" ${canAffordResearch(r) ? '' : 'disabled'}>🔬 Research</button>`;
  const short = (ok, s) => `<span class="${ok ? '' : 'neg'}">${s}</span>`;
  return `<div class="res-detail ${st}"><div class="rd-top"><span class="rd-ic">${r.icon}</span><div>
      <div class="rd-name">${r.name} <span class="muted">· tier ${r.t}</span></div><div class="rd-desc">${r.desc}</div></div></div>
    ${r.req.length ? `<div class="rd-req">Needs: ${reqs}</div>` : ''}
    ${st === 'done' ? '' : `<div class="rd-cost">${short(state.rep >= r.cost, `⭐ ${r.cost}`)} · ${short(state.money >= r.money, fmt(r.money))} · ⏱️ ${labTime(r.time)}</div>`}
    ${btn}</div>`;
}

// Nodes on a 3-column grid, one row per tier, with lines to their prerequisites.
function treeHTML(branch) {
  const nodes = RESEARCH.filter((r) => r.b === branch);
  const rows = Math.max(...nodes.map((r) => r.t));
  const ROW = 96, NODE = 68; // px per tier row, node height
  const cx = (c) => 50 + c * 100;
  let lines = '';
  for (const r of nodes) {
    for (const id of r.req) {
      const q = researchById(id);
      if (q.b !== branch) continue;
      const on = hasResearch(id);
      const x1 = cx(q.c), y1 = (q.t - 1) * ROW + NODE, x2 = cx(r.c), y2 = (r.t - 1) * ROW;
      const my = (y1 + y2) / 2;
      lines += `<path d="M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}" class="${on ? 'on' : ''}"/>`;
    }
  }
  const H = (rows - 1) * ROW + NODE;
  let html = `<div class="tree" style="height:${H}px">
    <svg viewBox="0 0 300 ${H}" preserveAspectRatio="none">${lines}</svg>`;
  for (const r of nodes) {
    const st = researchState(r);
    const cross = r.req.filter((id) => researchById(id).b !== branch);
    const tag = st === 'done' ? '✓' : st === 'active' ? '⏳' : st === 'locked' ? '🔒' : `⭐${r.cost}`;
    const afford = st === 'open' && canAffordResearch(r) && !state.lab;
    html += `<button class="node ${st} ${afford ? 'ready' : ''} ${ui.resSel === r.id ? 'sel' : ''}" data-act="ressel" data-id="${r.id}"
      style="left:${(r.c * 100 + 6) / 3}%;top:${(r.t - 1) * ROW}px;width:${88 / 3}%;height:${NODE}px">
      <span class="n-ic">${r.icon}</span><span class="n-nm">${r.name}</span><span class="n-tag">${tag}${cross.length ? ' 🔗' : ''}</span></button>`;
  }
  return html + '</div>';
}

function handleResearchAct(act, id) {
  if (act === 'resbranch') { ui.resBranch = id; ui.resSel = null; return true; }
  if (act === 'ressel') {
    ui.resSel = ui.resSel === id ? null : id;
    // The details sit above the tree; bring them into view after the re-render.
    if (ui.resSel) setTimeout(() => { const el = document.querySelector('.res-detail'); if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 0);
    return true;
  }
  if (act === 'research') { startResearch(id); return true; }
  if (act === 'rescancel') { cancelResearch(); return true; }
  if (act === 'resrush') { rushResearch(); return true; }
  return false;
}

// Something worth a badge: lab idle and a node you can start now.
const researchReady = () => !state.lab && RESEARCH.some((r) => researchState(r) === 'open' && canAffordResearch(r));
