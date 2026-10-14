'use strict';
// Canvas rendering of the current property.

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const view = { ts: 32, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  view.dpr = window.devicePixelRatio || 1;
  view.w = rect.width;
  view.h = rect.height;
  canvas.width = Math.round(rect.width * view.dpr);
  canvas.height = Math.round(rect.height * view.dpr);
  layoutView();
}

function layoutView() {
  if (ui.marsView) { layoutMars(); return; }
  const def = curDef();
  if (!def) return;
  layoutGrid(def.cols, def.rows); // fit, then zoom and pan (zoom.js)
}

function screenToTile(px, py) {
  if (ui.marsView) return marsScreenToTile(px, py);
  const def = curDef();
  if (!def) return null;
  const x = Math.floor((px - view.ox) / view.ts);
  const y = Math.floor((py - view.oy) / view.ts);
  if (x < 0 || y < 0 || x >= def.cols || y >= def.rows) return null;
  return { x, y };
}

// Small deterministic noise per tile for texture variety.
function tileNoise(x, y, k = 0) {
  let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function roundRect(x, y, w, h, r) {
  r = Math.max(0, r);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawFloor(px, py, s, x, y) {
  const n = tileNoise(x, y);
  const g = 138 + Math.floor(n * 12);
  ctx.fillStyle = `rgb(${g},${g + 5},${g + 11})`;
  ctx.fillRect(px, py, s, s);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
}

function drawBroken(px, py, s, x, y, showCost, cost) {
  const n = tileNoise(x, y);
  ctx.fillStyle = n < 0.5 ? '#5d5246' : '#665a4c';
  ctx.fillRect(px, py, s, s);
  // cracks
  ctx.strokeStyle = 'rgba(20,15,10,0.7)';
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.beginPath();
  const a = tileNoise(x, y, 1), b = tileNoise(x, y, 2);
  ctx.moveTo(px + s * a, py);
  ctx.lineTo(px + s * (0.3 + b * 0.4), py + s * 0.5);
  ctx.lineTo(px + s * (1 - a), py + s);
  ctx.moveTo(px + s * (0.3 + b * 0.4), py + s * 0.5);
  ctx.lineTo(px + s, py + s * b);
  ctx.stroke();
  // debris
  for (let i = 0; i < 3; i++) {
    const dx = tileNoise(x, y, 10 + i), dy = tileNoise(x, y, 20 + i);
    ctx.fillStyle = i === 0 ? '#3e352c' : '#7a6b59';
    const r = s * (0.08 + tileNoise(x, y, 30 + i) * 0.08);
    ctx.fillRect(px + dx * (s - r), py + dy * (s - r), r, r * 0.8);
  }
  if (showCost) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(px, py, s, s);
    ctx.fillStyle = '#ffe9a8';
    ctx.font = `600 ${Math.floor(s * 0.26)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmt(cost), px + s / 2, py + s / 2);
  }
}

function drawWall(px, py, s, x, y) {
  ctx.fillStyle = '#2f3542';
  ctx.fillRect(px, py, s, s);
  ctx.strokeStyle = '#252a35';
  ctx.lineWidth = 1;
  const off = y % 2 ? s / 2 : 0;
  ctx.beginPath();
  ctx.moveTo(px, py + s / 2 + 0.5); ctx.lineTo(px + s, py + s / 2 + 0.5);
  ctx.moveTo(px + ((off + s / 4) % s) + 0.5, py); ctx.lineTo(px + ((off + s / 4) % s) + 0.5, py + s / 2);
  ctx.moveTo(px + ((off + (3 * s) / 4) % s) + 0.5, py + s / 2); ctx.lineTo(px + ((off + (3 * s) / 4) % s) + 0.5, py + s);
  ctx.stroke();
}

function drawPillar(px, py, s, x, y) {
  drawFloor(px, py, s, x, y);
  const i = s * 0.15;
  ctx.fillStyle = '#4b5263';
  ctx.fillRect(px + i, py + i, s - 2 * i, s - 2 * i);
  ctx.fillStyle = '#5d6577';
  ctx.fillRect(px + i, py + i, s - 2 * i, s * 0.12);
  ctx.strokeStyle = '#f2c94c';
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.setLineDash([s * 0.12, s * 0.12]);
  ctx.strokeRect(px + i, py + i, s - 2 * i, s - 2 * i);
  ctx.setLineDash([]);
}

function drawArrow(cx, cy, size, dir, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((dir * Math.PI) / 2);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.8, size * 0.2);
  ctx.lineTo(-size * 0.8, size * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCargoIcons(cargo, px, py, s, yFrac) {
  const icons = Object.keys(cargo).map((k) => PRODUCTS[k].icon).join('');
  ctx.font = `${Math.floor(s * 0.2)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(icons, px + s / 2, py + s * yFrac);
}

function drawDock(t, px, py, s, time, dock, waiting) {
  const isIn = t.base === 'in';
  const recv = !!(dock && dock.receive);
  const cargo = dock && dock.cargo;
  if (t.locked) {
    // Boarded-up door in its type's colour (dimmed), clearly labelled.
    ctx.fillStyle = recv ? '#3d2449' : isIn ? '#17402b' : '#173a55';
    ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
    ctx.strokeStyle = recv ? '#8e5aa8' : isIn ? '#3c9a63' : '#3d84b8';
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.strokeRect(px + 2, py + 2, s - 4, s - 4);
    ctx.strokeStyle = 'rgba(122,92,58,0.85)';
    ctx.lineWidth = Math.max(1, s * 0.08);
    ctx.beginPath();
    ctx.moveTo(px + 3, py + s * 0.34); ctx.lineTo(px + s - 3, py + s * 0.5);
    ctx.moveTo(px + 3, py + s * 0.62); ctx.lineTo(px + s - 3, py + s * 0.46);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Type label strip.
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(px + 1, py + 1, s - 2, s * 0.27);
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${Math.floor(s * 0.17)}px system-ui`;
    const label = recv ? '📥 RECV' : isIn ? `${Object.keys(cargo || {}).map((k) => PRODUCTS[k].icon).join('')} IN` : '📦 SHIP';
    ctx.fillText(label, px + s / 2, py + s * 0.15);
    ctx.font = `${Math.floor(s * 0.22)}px system-ui`;
    ctx.fillText('🔒', px + s / 2, py + s * 0.48);
    // Price strip.
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(px + 1, py + s * 0.7, s - 2, s * 0.29);
    ctx.fillStyle = '#ffe9a8';
    ctx.font = `700 ${Math.floor(s * 0.21)}px system-ui`;
    ctx.fillText(fmt(t.price), px + s / 2, py + s * 0.85);
    return;
  }
  ctx.fillStyle = recv ? '#6c3483' : isIn ? '#1e8449' : '#1f6fa3';
  ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
  // roll-up door slats
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(px + 2, py + (s * i) / 5 + 0.5);
    ctx.lineTo(px + s - 2, py + (s * i) / 5 + 0.5);
    ctx.stroke();
  }
  ctx.font = `${Math.floor(s * 0.38)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(recv ? '📥' : isIn ? '🚚' : '📦', px + s / 2, py + s * (isIn ? 0.56 : 0.4));
  if (recv) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(px + 1, py + 1, s - 2, s * 0.27);
    ctx.fillStyle = waiting ? '#ffe9a8' : 'rgba(255,255,255,0.6)';
    ctx.font = `700 ${Math.floor(s * 0.2)}px system-ui`;
    ctx.fillText(waiting ? `${waiting} in` : 'RECV', px + s / 2, py + s * 0.15);
  }
  if (isIn && cargo) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(px + 1, py + 1, s - 2, s * 0.27);
    drawCargoIcons(cargo, px, py, s, 0.15);
  }
  if (isIn) {
    const pulse = 0.6 + 0.4 * Math.sin(time * 4);
    const d = DIRS[t.dir];
    drawArrow(px + s / 2 + d.x * s * 0.38, py + s / 2 + d.y * s * 0.38, s * 0.12, t.dir, `rgba(255,255,255,${pulse})`);
  } else {
    const cap = storageCap(state.current), used = storageUsed(state.current);
    const full = used >= cap;
    ctx.font = `800 ${Math.floor(s * 0.2)}px system-ui`;
    ctx.fillStyle = full ? '#ff8a8a' : '#ffe9a8';
    ctx.fillText(full ? 'FULL' : 'SHIP', px + s / 2, py + s * 0.8);
    // Storage rack fill bar.
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(px + s * 0.1, py + s * 0.9, s * 0.8, s * 0.07);
    ctx.fillStyle = full ? '#eb5757' : used / cap > 0.75 ? '#f2c94c' : '#6fcf97';
    ctx.fillRect(px + s * 0.1, py + s * 0.9, s * 0.8 * Math.min(1, used / cap), s * 0.07);
  }
}

// Does the neighbour on `side` of tile (x,y) push packages into it?
function feedsFrom(prop, def, x, y, side) {
  const nx = x + DIRS[side].x, ny = y + DIRS[side].y;
  if (nx < 0 || ny < 0 || nx >= def.cols || ny >= def.rows) return false;
  const n = prop.tiles[ny][nx];
  const toward = opposite(side);
  if (n.base === 'in') return !n.locked && n.dir === toward;
  const o = n.obj;
  if (!o) return false;
  if (o.k === 'rack' || FACILITIES[o.k]) return false; // buildings never push packages out
  if (o.k === 'splitter' || o.k === 'bridge') return true;
  if (o.k === 'sorter') return o.dir === toward || sorterMatchDirs(o).includes(toward);
  return o.dir === toward;
}

// Conveyor bridge: one line passes over the other.
function drawBridge(px, py, s) {
  ctx.fillStyle = '#3a3f47';
  ctx.fillRect(px + 2, py + s * 0.3, s - 4, s * 0.4);
  ctx.fillStyle = '#5d6d7e';
  roundRect(px + s * 0.3, py + 2, s * 0.4, s - 4, s * 0.08);
  ctx.fill();
  ctx.strokeStyle = '#f2c94c';
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.strokeRect(px + s * 0.3, py + 2, s * 0.4, s - 4);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `${Math.floor(s * 0.3)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🌉', px + s / 2, py + s / 2);
}

// Accumulator: a hopper with its queue count.
function drawBuffer(o, px, py, s) {
  const n = (o.q || []).length;
  ctx.fillStyle = '#2a2d33';
  ctx.fillRect(px + 2, py + 2, s - 4, s - 4);
  ctx.fillStyle = '#7d5a3c';
  roundRect(px + s * 0.1, py + s * 0.1, s * 0.8, s * 0.8, s * 0.12);
  ctx.fill();
  const k = n / BUFFER.cap;
  ctx.fillStyle = k >= 1 ? '#eb5757' : '#f2c94c';
  ctx.fillRect(px + s * 0.18, py + s * 0.82 - s * 0.6 * k, s * 0.64, s * 0.6 * k);
  ctx.fillStyle = '#fff';
  ctx.font = `800 ${Math.floor(s * 0.2)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), px + s / 2, py + s * 0.45);
  const d = DIRS[o.dir];
  drawArrow(px + s / 2 + d.x * s * 0.4, py + s / 2 + d.y * s * 0.4, s * 0.1, o.dir, '#ffffff');
}

// Silo: a round bin with its fill level.
function drawSilo(px, py, s, fill, used, cap) {
  ctx.fillStyle = '#2a2d33';
  ctx.fillRect(px + 2, py + 2, s - 4, s - 4);
  ctx.fillStyle = '#95a5a6';
  ctx.beginPath(); ctx.arc(px + s / 2, py + s / 2, s * 0.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#566573';
  ctx.beginPath(); ctx.arc(px + s / 2, py + s / 2, s * 0.32, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = fill >= 1 ? '#eb5757' : '#6fcf97';
  ctx.beginPath(); ctx.moveTo(px + s / 2, py + s / 2);
  ctx.arc(px + s / 2, py + s / 2, s * 0.32, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, fill)); ctx.fill();
  if (used > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(px + s * 0.2, py + s * 0.02, s * 0.6, s * 0.18);
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.floor(s * 0.12)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${used}/${cap}`, px + s / 2, py + s * 0.11);
  }
}

// Belts shape themselves from their neighbours, like factory games:
// fed only from one side -> curve; fed from behind + side(s) -> merge with inlets.
function beltShape(prop, def, x, y, o) {
  const back = opposite(o.dir);
  const left = (o.dir + 3) % 4;
  const right = (o.dir + 1) % 4;
  const fb = feedsFrom(prop, def, x, y, back);
  const fl = feedsFrom(prop, def, x, y, left);
  const fr = feedsFrom(prop, def, x, y, right);
  if (!fb && fl !== fr) return { curve: fl ? 'left' : 'right', inlets: [] };
  const inlets = [];
  if (fl) inlets.push('left');
  if (fr) inlets.push('right');
  return { curve: null, inlets };
}

function chevron(s) {
  ctx.beginPath();
  ctx.moveTo(-s * 0.2, s * 0.08);
  ctx.lineTo(0, -s * 0.08);
  ctx.lineTo(s * 0.2, s * 0.08);
  ctx.stroke();
}

// Local frame for a belt: origin at tile centre, output toward -y,
// mirrored so the "side" of interest is always local left (-x).
function beltFrame(o, px, py, s, mirror) {
  ctx.translate(px + s / 2, py + s / 2);
  ctx.rotate((o.dir * Math.PI) / 2);
  if (mirror) ctx.scale(-1, 1);
}

function drawBelt(o, px, py, s, time, sm, shape) {
  const tier = BELT_TIERS[o.tier];
  const h = s / 2;
  const inset = s * 0.06;
  const rw = Math.max(2, s * 0.09);
  const phase = (time * tier.speed * sm) % 1;

  if (shape && shape.curve) {
    // Quarter-turn from the local-left edge to the top edge, pivoting on the top-left corner.
    ctx.save();
    beltFrame(o, px, py, s, shape.curve === 'right');
    const cx = -h, cy = -h;
    const r1 = inset, r2 = s - inset;
    ctx.beginPath();
    ctx.arc(cx, cy, r2, 0, Math.PI / 2);
    ctx.arc(cx, cy, r1, Math.PI / 2, 0, true);
    ctx.closePath();
    ctx.fillStyle = '#2a2d33';
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = Math.max(1, s * 0.07);
    const arcLen = (Math.PI / 2) * h;
    for (let i = -1; i < 3; i++) {
      const t = ((i + phase) * (s / 2)) / arcLen;
      const th = (Math.PI / 2) * (1 - t);
      ctx.save();
      ctx.translate(cx + h * Math.cos(th), cy + h * Math.sin(th));
      ctx.rotate(Math.atan2(-Math.cos(th), Math.sin(th)) + Math.PI / 2);
      chevron(s);
      ctx.restore();
    }
    ctx.restore();
    ctx.strokeStyle = tier.color;
    ctx.lineWidth = rw;
    ctx.beginPath();
    ctx.arc(cx, cy, r1 + rw / 2, 0, Math.PI / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r2 - rw / 2, 0, Math.PI / 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Straight belt.
  ctx.save();
  beltFrame(o, px, py, s, false);
  ctx.fillStyle = '#2a2d33';
  ctx.fillRect(-h + inset, -h, s - 2 * inset, s);
  ctx.save();
  ctx.beginPath();
  ctx.rect(-h + inset, -h, s - 2 * inset, s);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = Math.max(1, s * 0.07);
  const offset = phase * (s / 2);
  for (let i = -1; i < 3; i++) {
    ctx.save();
    ctx.translate(0, h - i * (s / 2) - offset);
    chevron(s);
    ctx.restore();
  }
  ctx.restore();
  ctx.fillStyle = tier.color;
  ctx.fillRect(-h + inset, -h, rw, s);
  ctx.fillRect(h - inset - rw, -h, rw, s);
  ctx.restore();

  // Merge inlets: open the side rail and show packages joining.
  if (shape) {
    for (const side of shape.inlets) {
      ctx.save();
      beltFrame(o, px, py, s, side === 'right');
      const gap = s * 0.3;
      ctx.fillStyle = '#2a2d33';
      ctx.fillRect(-h, -gap, inset + rw, gap * 2);
      ctx.fillStyle = tier.color;
      ctx.fillRect(-h, -gap - rw, inset + rw, rw);
      ctx.fillRect(-h, gap, inset + rw, rw);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      const tx = -h + inset + rw + s * 0.02;
      ctx.beginPath();
      ctx.moveTo(tx + s * 0.1, 0);
      ctx.lineTo(tx, -s * 0.08);
      ctx.lineTo(tx, s * 0.08);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawSplitter(px, py, s) {
  const i = s * 0.06;
  ctx.fillStyle = '#2a2d33';
  ctx.fillRect(px + i, py + i, s - 2 * i, s - 2 * i);
  ctx.fillStyle = '#8e44ad';
  roundRect(px + s * 0.2, py + s * 0.2, s * 0.6, s * 0.6, s * 0.12);
  ctx.fill();
  for (let d = 0; d < 4; d++) {
    drawArrow(px + s / 2 + DIRS[d].x * s * 0.36, py + s / 2 + DIRS[d].y * s * 0.36, s * 0.09, d, '#d7b6ea');
  }
  ctx.font = `${Math.floor(s * 0.34)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🔀', px + s / 2, py + s / 2 + 1);
}

function drawMachine(o, px, py, s) {
  const m = MACHINES[o.k];
  const i = s * 0.06;
  ctx.fillStyle = '#2a2d33';
  ctx.fillRect(px + i, py + i, s - 2 * i, s - 2 * i);
  ctx.fillStyle = m.color;
  roundRect(px + s * 0.12, py + s * 0.12, s * 0.76, s * 0.76, s * 0.14);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  roundRect(px + s * 0.12, py + s * 0.12, s * 0.76, s * 0.2, s * 0.1);
  ctx.fill();
  ctx.font = `${Math.floor(s * 0.4)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(m.icon, px + s / 2, py + s / 2 + 1);
  const d = DIRS[o.dir];
  drawArrow(px + s / 2 + d.x * s * 0.4, py + s / 2 + d.y * s * 0.4, s * 0.1, o.dir, '#ffffff');
  if (o.mk) { // upgrade badge: II / III
    const r = s * 0.15, bx = px + s * 0.8, by = py + s * 0.2;
    ctx.fillStyle = o.mk >= 2 ? '#56ccf2' : '#f2994a';
    ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#10131a';
    ctx.font = `900 ${Math.floor(s * 0.15)}px system-ui`;
    ctx.fillText(o.mk >= 2 ? 'III' : 'II', bx, by + 1);
  }
}

function drawSorter(o, px, py, s) {
  const i = s * 0.06;
  ctx.fillStyle = '#2a2d33';
  ctx.fillRect(px + i, py + i, s - 2 * i, s - 2 * i);
  ctx.fillStyle = '#16a085';
  roundRect(px + s * 0.14, py + s * 0.14, s * 0.72, s * 0.72, s * 0.14);
  ctx.fill();
  ctx.font = `${Math.floor(s * 0.34)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((PRODUCTS[o.filter] || CARGO[o.filter]).icon, px + s / 2, py + s / 2 + 1);
  const d = DIRS[o.dir];
  drawArrow(px + s / 2 + d.x * s * 0.4, py + s / 2 + d.y * s * 0.4, s * 0.1, o.dir, '#ffffff');
  // Yellow arrow per exit for the sorted cargo, with its share when split.
  const split = sorterSplit(o);
  const dirs = sorterMatchDirs(o);
  const total = dirs.reduce((n, d) => n + split[d], 0);
  for (const sd of dirs) {
    const e = DIRS[sd];
    drawArrow(px + s / 2 + e.x * s * 0.4, py + s / 2 + e.y * s * 0.4, s * 0.12, sd, '#f2c94c');
    if (dirs.length > 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      const lx = px + s / 2 + e.x * s * 0.24, ly = py + s / 2 + e.y * s * 0.24;
      ctx.fillRect(lx - s * 0.17, ly - s * 0.08, s * 0.34, s * 0.16);
      ctx.fillStyle = '#f2c94c';
      ctx.font = `800 ${Math.floor(s * 0.13)}px system-ui`;
      ctx.fillText(`${Math.round((split[sd] / total) * 100)}%`, lx, ly + 1);
    }
  }
}

function drawAssembler(o, px, py, s, crewed) {
  const i = s * 0.04;
  ctx.fillStyle = '#2a2d33';
  ctx.fillRect(px + i, py + i, s - 2 * i, s - 2 * i);
  ctx.fillStyle = '#5b6b7a';
  roundRect(px + s * 0.08, py + s * 0.08, s * 0.84, s * 0.84, s * 0.12);
  ctx.fill();
  ctx.strokeStyle = '#f2c94c';
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.setLineDash([s * 0.1, s * 0.08]);
  roundRect(px + s * 0.08, py + s * 0.08, s * 0.84, s * 0.84, s * 0.12);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (!o.recipe) {
    ctx.font = `${Math.floor(s * 0.36)}px system-ui`;
    ctx.fillText('🏭', px + s / 2, py + s * 0.42);
    ctx.fillStyle = '#ffe9a8';
    ctx.font = `700 ${Math.floor(s * 0.18)}px system-ui`;
    ctx.fillText('SET', px + s / 2, py + s * 0.76);
  } else {
    const rec = RECIPES[o.recipe];
    ctx.font = `${Math.floor(s * 0.36)}px system-ui`;
    ctx.fillText(PRODUCTS[o.recipe].icon, px + s / 2, py + s * 0.4);
    // Ingredient pips: filled when the buffer has enough for the next build.
    const ings = Object.entries(rec.in);
    const w = s * 0.7 / ings.length;
    ings.forEach(([p, n], k) => {
      const have = Math.min(1, ((o.buf && o.buf[p]) || 0) / n);
      const bx = px + s * 0.15 + k * w;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(bx + 1, py + s * 0.66, w - 2, s * 0.08);
      ctx.fillStyle = have >= 1 ? '#6fcf97' : '#f2994a';
      ctx.fillRect(bx + 1, py + s * 0.66, (w - 2) * have, s * 0.08);
    });
    const k = Math.min(1, (o.craftT || 0) / rec.time);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(px + s * 0.15, py + s * 0.78, s * 0.7, s * 0.06);
    ctx.fillStyle = '#56ccf2';
    ctx.fillRect(px + s * 0.15, py + s * 0.78, s * 0.7 * k, s * 0.06);
  }
  const d = DIRS[o.dir];
  drawArrow(px + s / 2 + d.x * s * 0.42, py + s / 2 + d.y * s * 0.42, s * 0.09, o.dir, '#ffffff');
  if (o.recipe && assemblerIdle(o)) {
    // Paused, or the rocket already has enough: dim it and say why.
    ctx.fillStyle = 'rgba(20,22,27,0.6)';
    ctx.fillRect(px + s * 0.08, py + s * 0.08, s * 0.84, s * 0.84);
    ctx.fillStyle = o.mode === 'pause' ? 'rgba(90,96,110,0.95)' : 'rgba(39,174,96,0.95)';
    ctx.fillRect(px + s * 0.1, py + s * 0.02, s * 0.8, s * 0.2);
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${Math.floor(s * 0.14)}px system-ui`;
    ctx.fillText(o.mode === 'pause' ? '⏸ PAUSED' : '🚀 ENOUGH', px + s / 2, py + s * 0.12);
  } else if (o.recipe && !crewed) {
    ctx.fillStyle = 'rgba(160,30,30,0.85)';
    ctx.fillRect(px + s * 0.1, py + s * 0.02, s * 0.8, s * 0.2);
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${Math.floor(s * 0.14)}px system-ui`;
    ctx.fillText('NO CREW · 25%', px + s / 2, py + s * 0.12);
  } else if (crewed) {
    // Crew badge, top-right: how many operators are working here.
    const bx = px + s * 0.8, by = py + s * 0.2, br = s * 0.17;
    ctx.fillStyle = '#e67e22';
    ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.stroke();
    ctx.font = `${Math.floor(s * 0.15)}px system-ui`;
    ctx.fillText('👷', bx - br * 0.32, by + 1);
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${Math.floor(s * 0.16)}px system-ui`;
    ctx.fillText(String(crewed), bx + br * 0.45, by + 1);
  }
}

// Shelving; this rack's own boxes fill in, plus its fill count.
function drawRack(px, py, s, fill, k, used, cap) {
  const i = s * 0.06;
  ctx.fillStyle = '#3b3f46';
  ctx.fillRect(px + i, py + i, s - 2 * i, s - 2 * i);
  ctx.fillStyle = '#e67e22'; // uprights
  ctx.fillRect(px + i, py + i, s * 0.07, s - 2 * i);
  ctx.fillRect(px + s - i - s * 0.07, py + i, s * 0.07, s - 2 * i);
  const shelves = 3;
  for (let r = 0; r < shelves; r++) {
    const sy = py + i + ((r + 1) * (s - 2 * i)) / shelves;
    ctx.fillStyle = '#95a5a6';
    ctx.fillRect(px + i, sy - s * 0.04, s - 2 * i, s * 0.04);
    for (let c = 0; c < 3; c++) {
      const slot = r * 3 + c;
      // Stagger which slots fill first across racks so it looks natural.
      if ((slot * 7 + k * 3) % 9 >= Math.round(fill * 9)) continue;
      const bw = s * 0.22, bh = (s - 2 * i) / shelves - s * 0.08;
      ctx.fillStyle = BOX_COLORS[(slot + k) % 3];
      ctx.fillRect(px + s * 0.15 + c * s * 0.24, sy - s * 0.04 - bh, bw, bh);
    }
  }
  if (used > 0) {
    ctx.fillStyle = used >= cap ? 'rgba(160,30,30,0.9)' : 'rgba(0,0,0,0.7)';
    ctx.fillRect(px + s * 0.22, py + s * 0.02, s * 0.56, s * 0.18);
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.floor(s * 0.13)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${used}/${cap}`, px + s / 2, py + s * 0.11);
  }
}

function drawDirt(px, py, s, x, y, dirt) {
  const a = Math.min(1, dirt / DIRT.filthy);
  ctx.fillStyle = `rgba(92,64,36,${0.15 + a * 0.45})`;
  for (let i = 0; i < 3; i++) {
    const dx = tileNoise(x, y, 40 + i), dy = tileNoise(x, y, 50 + i);
    ctx.beginPath();
    ctx.ellipse(px + s * (0.2 + dx * 0.6), py + s * (0.2 + dy * 0.6), s * (0.1 + a * 0.18), s * (0.07 + a * 0.12), dx * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (dirt >= DIRT.filthy) {
    ctx.font = `${Math.floor(s * 0.36)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🪣', px + s / 2, py + s / 2);
  }
}

function drawFacility(o, px, py, s) {
  const f = FACILITIES[o.k];
  const i = s * 0.05;
  ctx.fillStyle = f.color;
  roundRect(px + i, py + i, s - 2 * i, s - 2 * i, s * 0.12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = Math.max(1, s * 0.04);
  roundRect(px + i, py + i, s - 2 * i, s - 2 * i, s * 0.12);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.floor(s * 0.44)}px system-ui`;
  ctx.fillText(f.icon, px + s / 2, py + s * 0.45);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `700 ${Math.floor(s * 0.14)}px system-ui`;
  ctx.fillText(f.name.split(' ')[0].toUpperCase(), px + s / 2, py + s * 0.84);
  if ((o.dirt || 0) >= DIRT.dirty) {
    const filthy = o.dirt >= DIRT.filthy;
    ctx.fillStyle = `rgba(92,64,36,${filthy ? 0.65 : 0.35})`;
    roundRect(px + s * 0.05, py + s * 0.05, s * 0.9, s * 0.9, s * 0.12);
    ctx.fill();
    ctx.font = `${Math.floor(s * 0.2)}px system-ui`;
    ctx.fillText('🪰', px + s * 0.22, py + s * 0.22);
    if (filthy) {
      ctx.fillStyle = 'rgba(160,30,30,0.9)';
      ctx.fillRect(px + s * 0.05, py + s * 0.62, s * 0.9, s * 0.2);
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${Math.floor(s * 0.13)}px system-ui`;
      ctx.fillText('FILTHY', px + s / 2, py + s * 0.72);
    }
  }
  if (f.levels && (o.lvl || 1) > 1) {
    ctx.fillStyle = '#f2c94c';
    ctx.font = `800 ${Math.floor(s * 0.15)}px system-ui`;
    ctx.fillText('★'.repeat(o.lvl - 1), px + s * 0.78, py + s * 0.16);
  }
}

// Shade restroom / break room coverage: the one being inspected, or all of
// a type while placing it.
function drawFacilityRanges(prop, def, s) {
  const show = [];
  if (ui.facSel && openPanelName === 'facdetail') {
    const o = prop.tiles[ui.facSel.y][ui.facSel.x].obj;
    if (o && FACILITIES[o.k] && FACILITIES[o.k].levels) show.push({ x: ui.facSel.x, y: ui.facSel.y, o });
  } else if (ui.tool === 'facility' && FACILITIES[ui.facilityType] && FACILITIES[ui.facilityType].levels) {
    prop.tiles.forEach((row, y) => row.forEach((t, x) => { if (t.obj && t.obj.k === ui.facilityType) show.push({ x, y, o: t.obj }); }));
  }
  for (const f of show) {
    const R = facLevel(f.o).range;
    ctx.fillStyle = `rgba(${FACILITIES[f.o.k].rangeTint},0.22)`;
    const x0 = Math.max(1, f.x - R), x1 = Math.min(def.cols - 2, f.x + R);
    const y0 = Math.max(1, f.y - R), y1 = Math.min(def.rows - 2, f.y + R);
    ctx.fillRect(view.ox + x0 * s, view.oy + y0 * s, (x1 - x0 + 1) * s, (y1 - y0 + 1) * s);
    ctx.strokeStyle = `rgba(${FACILITIES[f.o.k].rangeTint},0.9)`;
    ctx.lineWidth = 2;
    ctx.strokeRect(view.ox + x0 * s + 1, view.oy + y0 * s + 1, (x1 - x0 + 1) * s - 2, (y1 - y0 + 1) * s - 2);
  }
}

// Where the selected tool can be used: green = build, orange = repair first,
// yellow = replaces what's there, blue = act on it (upgrade/rotate/remove).
function placementHint(prop, def, x, y, tool) {
  const t = prop.tiles[y][x];
  const o = t.obj;
  const inside = x > 0 && y > 0 && x < def.cols - 1 && y < def.rows - 1;
  if (!inside) return null;
  if (tool === 'repair') return t.base === 'broken' || (t.base === 'floor' && (t.dirt || 0) >= DIRT.dirty) ? 'act' : null;
  if (tool === 'upgrade') return upgradeInfo(o, def) ? 'act' : null;
  if (tool === 'rotate') return o && !isBuilding(o.k) && o.k !== 'splitter' ? 'act' : null;
  if (tool === 'remove') return o ? 'remove' : null;
  const lineTool = isPlaceable(tool);
  if (tool === 'facility' && FACILITIES[ui.facilityType] && FACILITIES[ui.facilityType].outside) return null; // walls handled elsewhere
  if (!lineTool && tool !== 'rack' && tool !== 'facility') return null;
  if (!o) return t.base === 'floor' ? 'ok' : t.base === 'broken' ? 'repair' : null;
  const newKind = tool === 'facility' ? ui.facilityType : tool;
  if (newKind && o.k !== newKind && t.base === 'floor') return 'replace'; // asks before building over it
  return null;
}

const HINT_STYLE = {
  ok: ['rgba(111,207,151,0.13)', 'rgba(111,207,151,0.75)'],
  repair: ['rgba(242,153,74,0.12)', 'rgba(242,153,74,0.7)'],
  replace: ['rgba(242,201,76,0.12)', 'rgba(242,201,76,0.85)'],
  act: ['rgba(86,204,242,0.12)', 'rgba(86,204,242,0.8)'],
  remove: ['rgba(235,87,87,0.12)', 'rgba(235,87,87,0.8)'],
};

function drawPlacementHints(prop, def, s, time) {
  const tool = ui.tool;
  if (!tool || ui.heat) return;
  ctx.save();
  ctx.setLineDash([s * 0.14, s * 0.1]);
  ctx.lineDashOffset = -time * s * 0.3;
  ctx.lineWidth = Math.max(1, s * 0.04);
  for (let y = 0; y < def.rows; y++) {
    for (let x = 0; x < def.cols; x++) {
      const h = placementHint(prop, def, x, y, tool);
      if (!h) continue;
      const [fill, line] = HINT_STYLE[h];
      ctx.fillStyle = fill;
      ctx.fillRect(view.ox + x * s + 1, view.oy + y * s + 1, s - 2, s - 2);
      ctx.strokeStyle = line;
      ctx.strokeRect(view.ox + x * s + 3, view.oy + y * s + 3, s - 6, s - 6);
      if (tool === 'upgrade') {
        const up = upgradeInfo(prop.tiles[y][x].obj, def);
        const cost = up.cost;
        const locked = !!up.locked;
        const label = locked ? '🔒' : fmt(cost);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(view.ox + x * s + s * 0.08, view.oy + y * s + s * 0.34, s * 0.84, s * 0.32);
        ctx.fillStyle = locked ? '#ffffff' : state.money < cost ? '#ff8a8a' : '#ffe9a8';
        ctx.font = `800 ${Math.floor(s * 0.22)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, view.ox + (x + 0.5) * s, view.oy + (y + 0.5) * s);
        ctx.setLineDash([s * 0.14, s * 0.1]);
      }
    }
  }
  ctx.restore();
}

// Ghost of a conveyor line being drawn (or waiting for ✅ Place).
function drawLinePreview(prop, def, s) {
  const plan = ui.pending || (drag.active && ui.tool === 'belt' && drag.moved && drag.plan.length > 1 ? buildPlan(drag.plan) : null);
  if (!plan) return;
  for (const p of plan.tiles) {
    if (p.action === 'skip') continue;
    const px = view.ox + p.x * s, py = view.oy + p.y * s;
    ctx.fillStyle = p.action === 'aim' ? 'rgba(86,204,242,0.35)' : 'rgba(242,201,76,0.4)';
    ctx.fillRect(px + 2, py + 2, s - 4, s - 4);
    drawArrow(px + s / 2, py + s / 2, s * 0.2, p.dir, 'rgba(255,255,255,0.9)');
  }
}

function drawWorkers(r, s, time) {
  for (const w of r.workers) {
    if (w.role === 'operator' && w.mode === 'work' && !w.path.length) continue; // shown as the assembler's crew badge
    const look = ROLE_LOOK[w.role];
    const cx = view.ox + (w.fx + 0.5) * s, cy = view.oy + (w.fy + 0.5) * s;
    const bob = w.path.length ? Math.sin(time * 14 + w.id) * s * 0.03 : 0;
    const rad = s * 0.2;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(cx, cy + rad * 0.9, rad * 0.8, rad * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = look.color;
    ctx.beginPath(); ctx.arc(cx, cy + bob, rad, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = w.stuck ? '#ff4d4d' : 'rgba(255,255,255,0.8)';
    ctx.lineWidth = w.stuck ? Math.max(2, s * 0.07) : 1.5;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.floor(s * 0.24)}px system-ui`;
    ctx.fillText(look.icon, cx, cy + bob + 1);
    // Status bubble above the head.
    let bubble = null;
    if (w.stuck) bubble = '❗';
    else if (w.mode === 'break' && !w.path.length) bubble = FACILITIES[w.breakKind].icon;
    // Status badge, bottom-right: heading to a break, unhappy, or break due soon.
    const badge = workerBadge(r, w);
    if (badge) {
      const bx = cx + rad * 0.85, by = cy + bob + rad * 0.75;
      ctx.fillStyle = 'rgba(20,22,27,0.9)';
      ctx.beginPath(); ctx.arc(bx, by, s * 0.11, 0, Math.PI * 2); ctx.fill();
      ctx.font = `${Math.floor(s * 0.15)}px system-ui`;
      ctx.fillText(badge, bx, by + 1);
    }
    if (bubble) {
      ctx.font = `${Math.floor(s * 0.26)}px system-ui`;
      ctx.fillText(bubble, cx, cy - rad - s * 0.12 + Math.sin(time * 5) * s * 0.03);
    }
    // Tech job progress ring at the job tile.
    if (w.task && w.mode === 'work') {
      const t = w.task;
      const tx = view.ox + (t.x + 0.78) * s, ty = view.oy + (t.y + 0.24) * s;
      ctx.strokeStyle = t.kind === 'repair' ? '#f2c94c' : '#6fcf97';
      ctx.lineWidth = Math.max(2, s * 0.06);
      ctx.beginPath();
      ctx.arc(tx, ty, s * 0.18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, t.t / t.dur));
      ctx.stroke();
    }
  }
}

function drawJam(px, py, s, time) {
  const a = 0.35 + 0.25 * Math.sin(time * 8);
  ctx.fillStyle = `rgba(235,87,87,${a})`;
  roundRect(px + s * 0.08, py + s * 0.08, s * 0.84, s * 0.84, s * 0.14);
  ctx.fill();
  ctx.font = `${Math.floor(s * 0.42)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⚠️', px + s / 2, py + s / 2);
}

function itemPos(it, prop) {
  const c = { x: it.x + 0.5, y: it.y + 0.5 };
  const inD = DIRS[it.fromDir];
  const outDir = it.outDir == null ? opposite(it.fromDir) : it.outDir;
  const outD = DIRS[outDir];
  // Turning on a conveyor: ride a quarter-circle around the shared corner.
  const o = prop.tiles[it.y][it.x].obj;
  if (o && o.k === 'belt' && outDir !== opposite(it.fromDir) && outDir !== it.fromDir) {
    const a = it.p * (Math.PI / 2);
    const kx = c.x + (inD.x + outD.x) * 0.5, ky = c.y + (inD.y + outD.y) * 0.5;
    return {
      x: kx - 0.5 * (outD.x * Math.cos(a) + inD.x * Math.sin(a)),
      y: ky - 0.5 * (outD.y * Math.cos(a) + inD.y * Math.sin(a)),
    };
  }
  if (it.p < 0.5) {
    const k = it.p * 2;
    return { x: c.x + inD.x * 0.5 * (1 - k), y: c.y + inD.y * 0.5 * (1 - k) };
  }
  const k = (it.p - 0.5) * 2;
  return { x: c.x + outD.x * 0.5 * k, y: c.y + outD.y * 0.5 * k };
}

const BOX_COLORS = ['#c89f6a', '#b98a55', '#d2ab78'];

function drawItem(it, prop) {
  const s = view.ts;
  const pos = itemPos(it, prop);
  const bs = s * (it.type === 'bulky' ? 0.6 : 0.44);
  const x = view.ox + pos.x * s - bs / 2;
  const y = view.oy + pos.y * s - bs / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 2, y + 3, bs, bs);

  if (it.type === 'bulky') {
    ctx.fillStyle = '#8a7a52';
    ctx.fillRect(x, y, bs, bs);
    ctx.strokeStyle = '#5a4e32';
    ctx.lineWidth = Math.max(1, bs * 0.06);
    ctx.strokeRect(x, y, bs, bs);
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + bs, y + bs);
    ctx.moveTo(x + bs, y); ctx.lineTo(x, y + bs);
    ctx.stroke();
  } else if (it.type === 'cold') {
    // Fresh = icy blue; spoiling fades it toward murky green.
    const f = (it.fresh - COLD_FLOOR) / (1 - COLD_FLOOR);
    const rC = Math.round(150 + (1 - f) * 20);
    const gC = Math.round(200 - (1 - f) * 40);
    const bC = Math.round(240 - (1 - f) * 110);
    ctx.fillStyle = `rgb(${rC},${gC},${bC})`;
    ctx.fillRect(x, y, bs, bs);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, bs * 0.07);
    const cx = x + bs / 2, cy = y + bs / 2, rr = bs * 0.3;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI) / 3;
      ctx.moveTo(cx - Math.cos(a) * rr, cy - Math.sin(a) * rr);
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.stroke();
    if (it.tags.includes('chiller')) {
      ctx.strokeStyle = '#2d9cdb';
      ctx.lineWidth = Math.max(1.5, bs * 0.1);
      ctx.strokeRect(x, y, bs, bs);
    }
  } else {
    ctx.fillStyle = it.type === 'fragile' ? '#eadbb8' : BOX_COLORS[it.hue];
    ctx.fillRect(x, y, bs, bs);
    ctx.strokeStyle = '#7a5a33';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, bs - 1, bs - 1);
    if (it.type === 'fragile') {
      ctx.fillStyle = '#d63031';
      ctx.fillRect(x, y + bs * 0.4, bs, bs * 0.2);
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + bs * 0.44, y + bs * 0.44, bs * 0.12, bs * 0.12);
    } else {
      ctx.fillStyle = 'rgba(120,85,45,0.55)';
      ctx.fillRect(x + bs * 0.42, y, bs * 0.16, bs);
    }
  }

  if (it.tags.includes('scanner')) {
    ctx.fillStyle = '#111';
    for (let i = 0; i < 4; i++) ctx.fillRect(x + bs * (0.1 + i * 0.07), y + bs * 0.68, Math.max(1, bs * 0.03), bs * 0.2);
  }
  if (it.tags.includes('labeler')) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + bs * 0.6, y + bs * 0.1, bs * 0.32, bs * 0.24);
    ctx.fillStyle = '#d4a017';
    ctx.fillRect(x + bs * 0.64, y + bs * 0.16, bs * 0.2, bs * 0.04);
  }
  if (it.tags.includes('wrapper')) {
    ctx.fillStyle = 'rgba(120,200,255,0.35)';
    ctx.fillRect(x - 1, y - 1, bs + 2, bs + 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + bs * 0.15, y + bs * 0.85);
    ctx.lineTo(x + bs * 0.85, y + bs * 0.15);
    ctx.stroke();
  }
  // What's in the box.
  ctx.font = `${Math.floor(bs * 0.62)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(PRODUCTS[it.product].icon, x + bs / 2, y + bs / 2 + 1);
}

function render(tool) {
  if (ui.marsView && view.ts >= 4) { renderMars(); return; }
  const def = curDef();
  if (def && view.ts < 4) return; // no room to draw yet (hidden or zero-size canvas)
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = '#1e2229';
  ctx.fillRect(0, 0, view.w, view.h);
  if (!def) {
    ctx.fillStyle = '#9aa3b2';
    ctx.font = '600 16px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Buy a warehouse to get started 🏢', view.w / 2, view.h / 2);
    return;
  }
  const prop = curProp();
  const r = rt(state.current);
  const s = view.ts;
  const time = r.time;
  const sm = speedMult(state.current, prop);
  const dockDefs = {};
  for (const d of def.inDocks) dockDefs[d.x + ',' + d.y] = d;
  let waiting = 0;
  for (const p of Object.keys(prop.inbox)) waiting += prop.inbox[p];
  const racksIdx = rackIndex(state.current);
  const showRepair = tool === 'repair' || tool === 'belt';
  const repairCost = def.repairCost;

  for (let y = 0; y < def.rows; y++) {
    for (let x = 0; x < def.cols; x++) {
      const t = prop.tiles[y][x];
      const px = view.ox + x * s;
      const py = view.oy + y * s;
      switch (t.base) {
        case 'wall':
          drawWall(px, py, s, x, y);
          if (t.obj && FACILITIES[t.obj.k]) drawFacility(t.obj, px, py, s); // generators outside
          else if (tool === 'facility' && FACILITIES[ui.facilityType] && FACILITIES[ui.facilityType].outside && isOutsideSpot(def, prop, x, y)) {
            ctx.strokeStyle = 'rgba(242,201,76,0.8)';
            ctx.setLineDash([s * 0.12, s * 0.1]);
            ctx.lineWidth = Math.max(1, s * 0.05);
            ctx.strokeRect(px + 3, py + 3, s - 6, s - 6);
            ctx.setLineDash([]);
          }
          break;
        case 'broken': drawBroken(px, py, s, x, y, showRepair && tool === 'repair', repairCost); break;
        case 'pillar': drawPillar(px, py, s, x, y); break;
        case 'in':
        case 'out': {
          drawDock(t, px, py, s, time, dockDefs[x + ',' + y], waiting);
          const dd = dockDefs[x + ',' + y];
          if (t.base === 'in' && dd && !dd.receive && !t.locked) {
            const sp = supplyOf(prop, dd);
            const mark = sp.paused ? '⏸' : activeDeal(sp) ? '🤝' : '';
            if (mark) {
              ctx.font = `${Math.floor(s * 0.22)}px system-ui`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(mark, px + s * 0.82, py + s * 0.82);
            }
          }
          break;
        }
        default:
          drawFloor(px, py, s, x, y);
          if (t.dirt > DIRT.stain && !t.obj) drawDirt(px, py, s, x, y, t.dirt);
          if (t.obj) {
            if (t.obj.k === 'belt') drawBelt(t.obj, px, py, s, time, sm, beltShape(prop, def, x, y, t.obj));
            else if (t.obj.k === 'splitter') drawSplitter(px, py, s);
            else if (t.obj.k === 'bridge') drawBridge(px, py, s);
            else if (t.obj.k === 'buffer') drawBuffer(t.obj, px, py, s);
            else if (t.obj.k === 'sorter') drawSorter(t.obj, px, py, s);
            else if (t.obj.k === 'assembler') drawAssembler(t.obj, px, py, s, r.crewed.get(x + ',' + y) || 0);
            else if (t.obj.k === 'rack') {
              const info = racksIdx.get(x + ',' + y);
              const used = Math.min(info.cap, rackLoad(t.obj));
              if (t.obj.silo) drawSilo(px, py, s, used / info.cap, used, info.cap);
              else drawRack(px, py, s, used / info.cap, x * 31 + y * 17, used, info.cap);
              if (t.obj.allow) {
                const icons = t.obj.allow.slice(0, 3).map((p) => PRODUCTS[p].icon).join('') + (t.obj.allow.length > 3 ? '…' : '');
                ctx.fillStyle = 'rgba(0,0,0,0.75)';
                ctx.fillRect(px + s * 0.1, py + s * 0.76, s * 0.8, s * 0.2);
                ctx.font = `${Math.floor(s * 0.15)}px system-ui`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(icons, px + s / 2, py + s * 0.86);
              }
              if ((t.obj.lvl || 1) > 1) {
                ctx.fillStyle = '#f2c94c';
                ctx.font = `800 ${Math.floor(s * 0.15)}px system-ui`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('★'.repeat(t.obj.lvl - 1), px + s / 2, py + s * 0.92);
              }
            }
            else if (FACILITIES[t.obj.k]) drawFacility(t.obj, px, py, s);
            else drawMachine(t.obj, px, py, s);
          }
      }
    }
  }

  for (const it of r.items) drawItem(it, prop);

  // Worn equipment (over 75%) gets a small wrench so you can see what needs service soon.
  for (let y = 0; y < def.rows; y++) {
    for (let x = 0; x < def.cols; x++) {
      const o = prop.tiles[y][x].obj;
      if (!o || !o.life || o.jammed || (o.wear || 0) / o.life <= 0.75) continue;
      const cx = view.ox + (x + 0.2) * s, cy = view.oy + (y + 0.2) * s;
      ctx.fillStyle = 'rgba(230,126,34,0.95)';
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.14, 0, Math.PI * 2); ctx.fill();
      ctx.font = `${Math.floor(s * 0.16)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔧', cx, cy + 1);
    }
  }

  // Jammed machines draw over any stuck package.
  for (let y = 0; y < def.rows; y++) {
    for (let x = 0; x < def.cols; x++) {
      const o = prop.tiles[y][x].obj;
      if (o && o.jammed) drawJam(view.ox + x * s, view.oy + y * s, s, time);
    }
  }

  drawHeat(prop, def, r, s, time);
  drawPlacementHints(prop, def, s, time);
  drawLinePreview(prop, def, s);
  drawFacilityRanges(prop, def, s);
  drawWorkers(r, s, time);

  // Highlight a tile picked from the alerts list.
  if (ui.flash && ui.flash.until > performance.now()) {
    const a = 0.5 + 0.5 * Math.sin(performance.now() / 120);
    ctx.strokeStyle = `rgba(235,87,87,${a})`;
    ctx.lineWidth = Math.max(3, s * 0.12);
    ctx.strokeRect(view.ox + ui.flash.x * s + 2, view.oy + ui.flash.y * s + 2, s - 4, s - 4);
  }

  // Machine progress bars
  for (const it of r.items) {
    const t = prop.tiles[it.y][it.x];
    if (!t.obj || !MACHINES[t.obj.k] || it.processed || it.p < 0.5) continue;
    const m = MACHINES[t.obj.k];
    if (t.obj.jammed || (m.only && it.type !== m.only)) continue;
    const k = Math.min(1, it.proc / (m.time * (it.type === 'bulky' ? 2 : 1)));
    const px = view.ox + it.x * s, py = view.oy + it.y * s;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(px + s * 0.15, py + s * 0.82, s * 0.7, s * 0.08);
    ctx.fillStyle = '#6fcf97';
    ctx.fillRect(px + s * 0.15, py + s * 0.82, s * 0.7 * k, s * 0.08);
  }

  // Power overload warning.
  if (r.power != null && r.power < 1) {
    const label = `⚡ Overloaded: machines at ${Math.round(r.power * 100)}%`;
    ctx.font = `700 ${Math.max(11, Math.floor(s * 0.3))}px system-ui`;
    const w = ctx.measureText(label).width + 16;
    ctx.fillStyle = 'rgba(160,30,30,0.85)';
    roundRect(view.ox + (def.cols * s - w) / 2, view.oy + s * 1.1, w, s * 0.5, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, view.ox + (def.cols * s) / 2, view.oy + s * 1.35);
  }

  // Accident stoppage.
  if (r.shutdown > 0) {
    ctx.fillStyle = 'rgba(120,20,20,0.45)';
    ctx.fillRect(view.ox, view.oy, def.cols * s, def.rows * s);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.floor(s * 0.5)}px system-ui`;
    ctx.fillText('🚑 ACCIDENT', view.ox + (def.cols * s) / 2, view.oy + (def.rows * s) / 2 - s * 0.4);
    ctx.font = `600 ${Math.floor(s * 0.34)}px system-ui`;
    ctx.fillText(`Work resumes in ${Math.ceil(r.shutdown)}s`, view.ox + (def.cols * s) / 2, view.oy + (def.rows * s) / 2 + s * 0.3);
  }

  // Sale floaters
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const f of r.floaters) {
    const a = 1 - f.age / 1.2;
    ctx.font = `800 ${Math.floor(s * 0.32)}px system-ui`;
    ctx.fillStyle = `rgba(0,0,0,${a * 0.6})`;
    ctx.fillText(f.text, view.ox + f.x * s + 1, view.oy + (f.y - f.age * 0.8) * s + 1);
    ctx.fillStyle = `rgba(${f.color},${a})`;
    ctx.fillText(f.text, view.ox + f.x * s, view.oy + (f.y - f.age * 0.8) * s);
  }
}
