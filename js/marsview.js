'use strict';
// 🔴 The Mars view: the base drawn on the main screen, like a warehouse site,
// with its own build bar. Warehouse sites keep running underneath; going to
// Mars only changes what's shown and what taps do.

const MARS_COLOR = { habitat: '#d9824f', solar: '#3a5a8c', greenhouse: '#3f8f4f', icemine: '#5aa7c8', pad: '#6b6f7a', station: '#7a5cc4', fusion: '#c4a23a', mine: '#6d4c3d', rec: '#c2557a', workshop: '#8a7a5a' };
const marsHud = () => (view.w < 520 ? 48 : 30); // px of status above the map (two lines on phones)

function goMars() {
  if (!marsOn()) { toast('🔴 Mars opens after your first rocket'); return; }
  M();
  ui.marsView = true;
  state.inMars = true;
  ui.tool = null;
  ui.marsTool = null;
  closePanel();
  layoutView();
  refreshTopbar();
  refreshToolbar();
  toast('🔴 Mars base: pick 🏗️ Build to place the kits your rockets bring');
}

function leaveMars() {
  ui.marsView = false;
  state.inMars = false;
}

function layoutMars() {
  const { cols, rows } = MARS_MAP, pad = 8;
  view.ts = Math.floor(Math.min((view.w - pad * 2) / cols, (view.h - pad * 2 - marsHud()) / rows));
  view.ox = Math.floor((view.w - view.ts * cols) / 2);
  view.oy = marsHud() + Math.floor((view.h - marsHud() - view.ts * rows) / 2);
}

function marsScreenToTile(px, py) {
  const x = Math.floor((px - view.ox) / view.ts), y = Math.floor((py - view.oy) / view.ts);
  return x < 0 || y < 0 || x >= MARS_MAP.cols || y >= MARS_MAP.rows ? null : { x, y };
}

// ---------- Drawing ----------
function renderMars() {
  const m = M(), map = m.map, s = view.ts, now = performance.now() / 1000;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  const sky = ctx.createLinearGradient(0, 0, 0, view.h);
  sky.addColorStop(0, '#1d1016'); sky.addColorStop(1, '#3a1a12');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, view.w, view.h);
  const kit = ui.marsTool === 'build' ? ui.marsKit : null;
  const showPower = kit && (needsPower(kit) || MARS_MAP.powerRange[kit]);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let y = 0; y < map.t.length; y++) for (let x = 0; x < map.t[0].length; x++) {
    const px = view.ox + x * s, py = view.oy + y * s, ter = map.t[y][x], n = tileNoise(x, y);
    // Ground
    if (ter === 'i') {
      ctx.fillStyle = `hsl(${198 + n * 8}, 55%, ${80 - n * 8}%)`;
      ctx.fillRect(px, py, s, s);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(px + s * 0.15, py + s * 0.2, s * 0.35, s * 0.08);
    } else {
      ctx.fillStyle = `hsl(${16 + n * 6}, ${52 + n * 8}%, ${38 + n * 6}%)`;
      ctx.fillRect(px, py, s, s);
      if (n > 0.6) { ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath(); ctx.arc(px + s * (0.25 + n * 0.5), py + s * (0.7 - n * 0.3), s * 0.09, 0, Math.PI * 2); ctx.fill(); }
    }
    if (ter === 'v') { // metal vein: dark ore with glints
      ctx.fillStyle = `hsl(${20 + n * 6}, 25%, ${24 + n * 5}%)`;
      ctx.fillRect(px, py, s, s);
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = `rgba(230, 200, 140, ${0.5 + 0.4 * Math.sin(now * 2 + i + x * 3 + y)})`;
        ctx.fillRect(px + s * (0.15 + ((i * 37 + x * 13) % 70) / 100), py + s * (0.15 + ((i * 53 + y * 17) % 70) / 100), s * 0.07, s * 0.07);
      }
    }
    if (ter === 'r') {
      ctx.fillStyle = '#5a2c1d';
      ctx.beginPath();
      ctx.moveTo(px + s * 0.15, py + s * 0.8); ctx.lineTo(px + s * 0.3, py + s * 0.3); ctx.lineTo(px + s * 0.55, py + s * 0.18);
      ctx.lineTo(px + s * 0.85, py + s * 0.45); ctx.lineTo(px + s * 0.88, py + s * 0.82); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.moveTo(px + s * 0.3, py + s * 0.3); ctx.lineTo(px + s * 0.55, py + s * 0.18); ctx.lineTo(px + s * 0.5, py + s * 0.45); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
    if (showPower && ter !== 'r' && coversAt(map, x, y)) { ctx.fillStyle = 'rgba(255, 214, 102, 0.16)'; ctx.fillRect(px, py, s, s); }
  }
  // Lander
  const L = map.lander, lx = view.ox + L.x * s, ly = view.oy + L.y * s;
  ctx.fillStyle = '#2f333d';
  ctx.beginPath(); ctx.arc(lx + s / 2, ly + s / 2, s * 0.44, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#9aa4b8'; ctx.lineWidth = Math.max(1, s * 0.05); ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.font = `${Math.floor(s * 0.55)}px system-ui`;
  ctx.fillText('🛸', lx + s / 2, ly + s / 2 + 1);
  // Buildings
  const dmgLeft = { ...m.damaged };
  for (const q of map.b) {
    const mm = MARS_MODULES[q.k], px = view.ox + q.x * s, py = view.oy + q.y * s;
    const broken = q.done && dmgLeft[q.k] > 0 && (dmgLeft[q.k]--, true);
    const off = q.done && needsPower(q.k) && !coversAt(map, q.x, q.y);
    ctx.globalAlpha = q.done ? 1 : 0.55;
    ctx.fillStyle = MARS_COLOR[q.k];
    roundRect(px + s * 0.08, py + s * 0.08, s * 0.84, s * 0.84, s * 0.16);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    roundRect(px + s * 0.08, py + s * 0.08, s * 0.84, s * 0.22, s * 0.12);
    ctx.fill();
    ctx.fillStyle = '#000'; // emoji take the fill's alpha in some browsers
    ctx.font = `${Math.floor(s * 0.48)}px system-ui`;
    ctx.fillText(mm.icon, px + s / 2, py + s / 2 + 1);
    ctx.globalAlpha = 1;
    if (q.k === 'habitat' && q.done && (q.dirt || 0) > 15) { // dust settling on the dome
      ctx.fillStyle = `rgba(120, 70, 35, ${Math.min(0.55, (q.dirt / 100) * 0.6)})`;
      roundRect(px + s * 0.08, py + s * 0.08, s * 0.84, s * 0.84, s * 0.16);
      ctx.fill();
      if (q.dirt >= 50) { ctx.fillStyle = '#000'; ctx.font = `${Math.floor(s * 0.22)}px system-ui`; ctx.fillText('🟤', px + s * 0.2, py + s * 0.22); }
    }
    if (!q.done) { // scaffolding + progress
      ctx.strokeStyle = '#f2c94c'; ctx.lineWidth = Math.max(1, s * 0.04); ctx.setLineDash([s * 0.1, s * 0.08]);
      ctx.strokeRect(px + s * 0.1, py + s * 0.1, s * 0.8, s * 0.8); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(px + s * 0.14, py + s * 0.78, s * 0.72, s * 0.1);
      ctx.fillStyle = '#f2c94c'; ctx.fillRect(px + s * 0.14, py + s * 0.78, s * 0.72 * q.prog, s * 0.1);
      if (q === map.b.find((b) => !b.done)) { ctx.fillStyle = '#000'; ctx.font = `${Math.floor(s * 0.3)}px system-ui`; ctx.fillText('🏗️', px + s * 0.8, py + s * 0.22 + Math.sin(now * 4) * s * 0.03); }
    }
    if (broken || off) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(px + s * 0.8, py + s * 0.2, s * 0.17, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000'; ctx.font = `${Math.floor(s * 0.24)}px system-ui`; ctx.fillText(broken ? '💥' : '🔌', px + s * 0.8, py + s * 0.21);
    }
  }
  // Colonists at work: each job's crew at its buildings, engineers on the build site, laborers about.
  drawMarsCrew(map, s, now);
  // Where the chosen kit can go.
  if (kit) for (let y = 0; y < map.t.length; y++) for (let x = 0; x < map.t[0].length; x++) {
    if (placeProblem(map, kit, x, y)) continue;
    ctx.strokeStyle = needsPower(kit) && !coversAt(map, x, y) ? '#f2994a' : '#6fcf97';
    ctx.lineWidth = Math.max(2, s * 0.06);
    ctx.setLineDash([s * 0.14, s * 0.1]);
    ctx.lineDashOffset = -now * s * 0.3;
    ctx.strokeRect(view.ox + x * s + 3, view.oy + y * s + 3, s - 6, s - 6);
    ctx.setLineDash([]);
  }
  if (ui.marsTool === 'move') for (const q of map.b) if (q.done || q.prog === 0) {
    ctx.strokeStyle = '#56ccf2'; ctx.lineWidth = Math.max(2, s * 0.06);
    ctx.strokeRect(view.ox + q.x * s + 3, view.oy + q.y * s + 3, s - 6, s - 6);
  }
  // Dust storm haze
  if (m.events.dust > 0) {
    ctx.fillStyle = 'rgba(190, 110, 60, 0.22)';
    ctx.fillRect(view.ox, view.oy, s * map.t[0].length, s * map.t.length);
    ctx.strokeStyle = 'rgba(240, 190, 140, 0.35)'; ctx.lineWidth = 1;
    for (let i = 0; i < 30; i++) {
      const sx = view.ox + ((i * 97 + now * 120) % (s * map.t[0].length)), sy = view.oy + ((i * 53) % (s * map.t.length));
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + s * 0.6, sy + s * 0.08); ctx.stroke();
    }
  }
  // Status line
  const q = map.b.find((b) => !b.done);
  const kits = Object.values(m.kits).reduce((a, b) => a + b, 0);
  const shelter = shelteringColonists();
  const mo = m.colonists ? Math.round(marsMorale().value * 100) : null;
  const parts = [`🧑‍🚀 ${m.colonists} · 🏠 ${marsCap()}${shelter ? ` (${shelter} in Lander)` : ''}${mo != null ? ` · ${mo >= 90 ? '😀' : mo >= 60 ? '🙂' : '😟'} ${mo}%` : ''}`,
    marsWindowOpen() ? '🟢 window open' : `🪐 ${fmtSecs(marsWindowIn())}`,
    q ? `🏗️ ${MARS_MODULES[q.k].name} ${Math.round(q.prog * 100)}%` : '',
    kits ? `📦 ${kits} kit${kits > 1 ? 's' : ''} to place` : '',
    (() => { const n = map.b.filter((b) => b.done && needsPower(b.k) && !coversAt(map, b.x, b.y)).length; return n ? `🔌 ${n} without power` : ''; })()].filter(Boolean);
  ctx.font = '600 13px system-ui';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f3d9c7';
  const one = parts.join('   ');
  if (ctx.measureText(one).width <= view.w - 20) ctx.fillText(one, 10, marsHud() / 2 + 2);
  else { ctx.fillText(parts.slice(0, 2).join('   '), 10, 14); ctx.fillText(parts.slice(2).join('   '), 10, 34); }
  ctx.textAlign = 'center';
}

// ---------- Taps ----------
function marsTap(x, y) {
  const m = M(), map = m.map, q = buildingAt(map, x, y);
  if (ui.marsTool === 'build' && ui.marsKit && !q) {
    const k = ui.marsKit, why = placeProblem(map, k, x, y);
    if (why) { toast(why); return; }
    placeKit(k, x, y);
    toast(`🏗️ ${MARS_MODULES[k].icon} ${MARS_MODULES[k].name} site marked${needsPower(k) && !coversAt(map, x, y) ? ' · ⚠️ no power reaches here yet' : ''}`);
    if (!(m.kits[k] > 0)) { ui.marsTool = null; ui.marsKit = null; }
    save();
    refreshToolbar();
    return;
  }
  if (ui.marsTool === 'move') {
    if (!q) { toast('Tap a building to relocate it'); return; }
    if (!q.done && q.prog > 0) { toast('Wait until it’s finished, or relocate it before building starts'); return; }
    if (q.done) {
      if (m.stock.spares < MARS_MAP.relocateSpares) { toast(`🔧 Relocating takes ${MARS_MAP.relocateSpares} Spares Kits on Mars (${m.stock.spares} there)`); return; }
      m.stock.spares -= MARS_MAP.relocateSpares;
      m.kitHead[q.k] = (m.kitHead[q.k] || 0) + 1; // keeps most of the work
    }
    map.b.splice(map.b.indexOf(q), 1);
    syncMods(m);
    m.kits[q.k] = (m.kits[q.k] || 0) + 1;
    ui.marsTool = 'build'; ui.marsKit = q.k;
    toast(`📦 ${MARS_MODULES[q.k].icon} ${MARS_MODULES[q.k].name} packed up${q.done ? ` (−${MARS_MAP.relocateSpares} 🔧, it rebuilds ${Math.round((1 - MARS_MAP.relocateKeep) * 100)}% of the work)` : ''}: tap its new spot`);
    save();
    refreshToolbar();
    return;
  }
  handleMarsTile(`${x},${y}`); // inspect
}

// ---------- Build bar ----------
const MARS_GROUPS = [
  { id: 'inspect', icon: '🔍', name: 'Inspect' },
  { id: 'build', icon: '🏗️', name: 'Build', tray: true },
  { id: 'move', icon: '🚚', name: 'Relocate' },
  { id: 'auto', icon: '✨', name: 'Auto-place' },
  { id: 'colony', icon: '📊', name: 'Colony' },
];

function buildMarsBar() {
  const bar = $('toolbar');
  const tray = document.createElement('div'); tray.id = 'marsTray'; tray.className = 'hidden';
  const groups = document.createElement('div'); groups.id = 'marsGroups'; groups.className = 'hidden';
  bar.appendChild(tray); bar.appendChild(groups);
  for (const g of MARS_GROUPS) {
    const b = document.createElement('button');
    b.className = 'group'; b.dataset.group = g.id;
    b.innerHTML = `<span class="ico">${g.icon}</span><span class="lbl">${g.name}</span>${g.tray ? '<span class="caret">▴</span>' : ''}`;
    b.addEventListener('click', () => marsGroupClick(g.id));
    groups.appendChild(b);
  }
  for (const k of Object.keys(MARS_MODULES)) {
    const b = document.createElement('button');
    b.className = 'tool'; b.dataset.kit = k;
    b.innerHTML = `<span class="ico">${MARS_MODULES[k].icon}</span><span class="lbl">${MARS_MODULES[k].name.split(' ')[0]}</span><span class="cost"></span>`;
    b.addEventListener('click', () => marsKitClick(k));
    tray.appendChild(b);
  }
}

function marsGroupClick(id) {
  if (id === 'inspect') { ui.marsTool = null; ui.marsTray = false; toast('🔍 Tap anything on Mars to see what it is'); }
  else if (id === 'build') ui.marsTray = !ui.marsTray;
  else if (id === 'move') { ui.marsTool = ui.marsTool === 'move' ? null : 'move'; ui.marsTray = false; if (ui.marsTool) toast(`🚚 Relocate: tap a building (blue outline) to pack it up, then tap its new spot. Finished buildings cost ${MARS_MAP.relocateSpares} 🔧 Spares and keep ${Math.round(MARS_MAP.relocateKeep * 100)}% of their build`); }
  else if (id === 'auto') { const n = autoPlaceKits(); toast(n ? `✨ ${n} kit${n > 1 ? 's' : ''} placed` : 'No kits waiting to be placed'); ui.marsTool = null; ui.marsKit = null; save(); }
  else if (id === 'colony') { ui.mapSel = 'launch'; ui.marsTab = 'base'; openPanel('map'); }
  refreshToolbar();
}

function marsKitClick(k) {
  const m = M();
  if (!(m.kits[k] > 0)) {
    toast(`📦 No ${MARS_MODULES[k].name} kits on Mars. Send one in a rocket's cargo plan (Launch Site → Next launch)`);
    return;
  }
  ui.marsTool = 'build'; ui.marsKit = k; ui.marsTray = false;
  const mm = MARS_MODULES[k];
  toast(`${mm.icon} ${mm.name}: tap a green tile${needsPower(k) ? ' (orange = no power there)' : ''}${k === 'icemine' ? ' · ice only' : ''}${MARS_MAP.powerRange[k] ? ` · powers ${MARS_MAP.powerRange[k]} tiles around it` : ''}`);
  refreshToolbar();
}

function refreshMarsBar() {
  const m = M();
  const kits = Object.values(m.kits).reduce((a, b) => a + b, 0);
  for (const b of $('marsGroups').children) {
    const g = b.dataset.group;
    b.classList.toggle('active', g === 'inspect' ? !ui.marsTool : g === 'build' ? ui.marsTool === 'build' : g === 'move' ? ui.marsTool === 'move' : false);
    b.classList.toggle('open', g === 'build' && !!ui.marsTray);
    if (g === 'build') {
      const k = ui.marsTool === 'build' && ui.marsKit;
      b.querySelector('.ico').textContent = k ? MARS_MODULES[k].icon : '🏗️';
      b.querySelector('.lbl').textContent = k ? MARS_MODULES[k].name.split(' ')[0] : kits ? `Build (${kits})` : 'Build';
      b.querySelector('.caret').textContent = ui.marsTray ? '▾' : '▴';
    }
  }
  $('marsTray').classList.toggle('hidden', !ui.marsTray);
  for (const b of $('marsTray').children) {
    const k = b.dataset.kit, mm = MARS_MODULES[k], n = m.kits[k] || 0;
    b.classList.toggle('hidden', !!(mm.research && !hasResearch(mm.research) && !n));
    b.classList.toggle('active', ui.marsTool === 'build' && ui.marsKit === k);
    b.classList.toggle('locked', !n);
    b.querySelector('.cost').textContent = n ? `×${n}` : '0 kits';
  }
}

// Colonist sprites. Up to ~24 drawn; each stands at its job and bobs, with a bubble now and then.
function drawMarsCrew(map, s, now) {
  const m = M(), crew = marsCrew();
  if (!m.colonists) return;
  const scale = Math.min(1, 24 / m.colonists); // big colonies: show a sample
  const spots = [];
  for (const job of MARS_JOB_ORDER) {
    const j = MARS_JOBS[job];
    let where = [];
    if (job === 'engineer') {
      const site = map.b.find((b) => !b.done) || (m.events.meteor && map.b.find((b) => b.k === m.events.meteor && b.done));
      where = site ? [site] : [map.lander];
    } else where = map.b.filter((b) => b.k === j.at && b.done && coversAt(map, b.x, b.y) || (b.k === j.at && b.done && !needsPower(b.k)));
    const n = Math.round(crew[job] * scale);
    for (let i = 0; i < n && where.length; i++) spots.push({ at: where[i % where.length], bubble: j.bubble, i: spots.length, work: true });
  }
  const others = map.b.filter((b) => b.done);
  for (let i = 0; i < Math.round(crew.laborer * scale); i++) spots.push({ at: others.length ? others[(i * 5) % others.length] : map.lander, from: map.lander, i: spots.length });
  ctx.fillStyle = '#000';
  for (const w of spots) {
    const k = w.i * 2.399; // golden-angle offsets so crews spread around a building
    let wx, wy;
    if (w.from) { // laborers stroll between the Lander and a building
      const t = (Math.sin(now * 0.3 + w.i * 1.7) + 1) / 2;
      wx = w.from.x + (w.at.x - w.from.x) * t; wy = w.from.y + (w.at.y - w.from.y) * t;
    } else { wx = w.at.x + Math.cos(k) * 0.42; wy = w.at.y + Math.sin(k) * 0.42; }
    const bob = Math.sin(now * 3 + w.i) * s * 0.03;
    const cx = view.ox + (wx + 0.5) * s, cy = view.oy + (wy + 0.5) * s + bob;
    ctx.font = `${Math.floor(s * 0.3)}px system-ui`;
    ctx.fillText('🧑‍🚀', cx, cy);
    if (w.work && Math.sin(now * 0.8 + w.i * 2.1) > 0.6) { // working: show what they're doing
      ctx.font = `${Math.floor(s * 0.2)}px system-ui`;
      ctx.fillText(w.bubble, cx + s * 0.14, cy - s * 0.2);
    }
  }
}
