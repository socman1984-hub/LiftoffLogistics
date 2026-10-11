'use strict';
// Heatmap overlays: color the warehouse floor to show one thing at a time
// (wear, damaged floor, worker access, congestion, facility coverage).

const HEAT_MODES = {
  wear: { name: 'Wear & breakdowns', icon: '🔧', desc: 'Equipment from fresh (green) to about to break (red). Broken equipment flashes.' },
  floor: { name: 'Floor condition', icon: '🧱', desc: 'Damaged floor that blocks walking and building, with the total repair cost.' },
  access: { name: 'Worker access', icon: '🚶', desc: 'Where staff can walk from the door (green) and where they can\'t (red).' },
  traffic: { name: 'Congestion', icon: '📦', desc: 'Where packages sit waiting on your belts. Find the bottlenecks.' },
  dirt: { name: 'Cleanliness', icon: '🧽', desc: 'How dirty floors and buildings are, from clean (green) to filthy (red).' },
  coverage: { name: 'Facility coverage', icon: '🚻', desc: 'Areas in range of a restroom and a break room (green), one of them (yellow), or neither (red).' },
};

function heatMenuHTML() {
  let html = '<p class="intro small">Overlays color the floor to show one thing at a time.</p>';
  html += card('🚫', 'Off', 'Normal view', '', `<button class="btn ${ui.heat ? 'secondary' : ''}" data-act="heat" data-id="off">${ui.heat ? 'Use' : 'On'}</button>`, ui.heat ? '' : 'current');
  for (const [id, m] of Object.entries(HEAT_MODES)) {
    html += card(m.icon, m.name, m.desc, '', `<button class="btn ${ui.heat === id ? '' : 'secondary'}" data-act="heat" data-id="${id}">${ui.heat === id ? 'On' : 'Show'}</button>`, ui.heat === id ? 'current' : '');
  }
  return html;
}

// Green → yellow → red for 0..1.
function heatColor(v, a) {
  v = Math.max(0, Math.min(1, v));
  const r = v < 0.5 ? Math.round(80 + v * 2 * 175) : 255;
  const g = v < 0.5 ? 210 : Math.round(210 - (v - 0.5) * 2 * 170);
  return `rgba(${r},${g},60,${a})`;
}

// Congestion: seconds packages have recently waited on each tile (decays).
function accumulateTraffic(def, r, dt) {
  if (!r.traffic || r.traffic.length !== def.cols * def.rows) r.traffic = new Float32Array(def.cols * def.rows);
  const decay = Math.exp(-dt / 20);
  for (let i = 0; i < r.traffic.length; i++) r.traffic[i] *= decay;
  for (const it of r.items) if (it.wait > 0) r.traffic[it.y * def.cols + it.x] += dt;
}

// Tiles staff can reach from the door, recomputed twice a second.
function accessMap(prop, def, r) {
  if (r.access && r.time - r.accessAt < 0.5) return r.access;
  const seen = new Uint8Array(def.cols * def.rows);
  const door = entranceOf(prop, def);
  const queue = [door.y * def.cols + door.x];
  seen[queue[0]] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi], cx = cur % def.cols, cy = (cur / def.cols) | 0;
    for (const d of DIRS) {
      const nx = cx + d.x, ny = cy + d.y;
      if (!walkable(prop, def, nx, ny) || seen[ny * def.cols + nx]) continue;
      seen[ny * def.cols + nx] = 1;
      queue.push(ny * def.cols + nx);
    }
  }
  r.access = seen;
  r.accessAt = r.time;
  return seen;
}

function drawHeat(prop, def, r, s, time) {
  const mode = ui.heat;
  if (!mode) return;
  const fill = (x, y, color) => { ctx.fillStyle = color; ctx.fillRect(view.ox + x * s, view.oy + y * s, s, s); };
  const inside = (x, y) => x > 0 && y > 0 && x < def.cols - 1 && y < def.rows - 1;
  const acc = mode === 'access' ? accessMap(prop, def, r) : null;
  let maxTraffic = 1;
  if (mode === 'traffic' && r.traffic) for (const v of r.traffic) maxTraffic = Math.max(maxTraffic, v);
  const pulse = 0.45 + 0.3 * Math.sin(time * 6);
  for (let y = 0; y < def.rows; y++) {
    for (let x = 0; x < def.cols; x++) {
      const t = prop.tiles[y][x];
      const o = t.obj;
      if (mode === 'wear') {
        if (o && o.jammed) fill(x, y, `rgba(235,40,40,${pulse})`);
        else if (o && o.life) fill(x, y, heatColor((o.wear || 0) / o.life, 0.5));
      } else if (mode === 'floor') {
        if (t.base === 'broken') fill(x, y, 'rgba(235,60,60,0.55)');
        else if (t.base === 'floor') fill(x, y, 'rgba(80,210,120,0.18)');
      } else if (mode === 'access') {
        if (!inside(x, y)) continue;
        if (walkable(prop, def, x, y)) fill(x, y, acc[y * def.cols + x] ? 'rgba(80,210,120,0.3)' : 'rgba(235,60,60,0.45)');
        else if (o && t.base === 'floor') {
          // Buildings are reachable if staff can stand next to them.
          const ok = DIRS.some((d) => acc[(y + d.y) * def.cols + (x + d.x)]);
          ctx.strokeStyle = ok ? 'rgba(80,210,120,0.9)' : 'rgba(235,60,60,0.95)';
          ctx.lineWidth = Math.max(2, s * 0.08);
          ctx.strokeRect(view.ox + x * s + 2, view.oy + y * s + 2, s - 4, s - 4);
        } else if (t.base === 'broken') fill(x, y, 'rgba(120,40,40,0.5)');
      } else if (mode === 'traffic') {
        const v = r.traffic ? r.traffic[y * def.cols + x] / maxTraffic : 0;
        if (v > 0.03) fill(x, y, heatColor(v, 0.55));
      } else if (mode === 'dirt') {
        const d = o && FACILITIES[o.k] ? o.dirt || 0 : t.base === 'floor' && !o ? t.dirt || 0 : -1;
        if (d >= 0) fill(x, y, d >= DIRT.filthy ? `rgba(235,40,40,${pulse})` : heatColor(d / DIRT.filthy, 0.45));
      } else if (mode === 'coverage') {
        if (!inside(x, y) || t.base === 'wall') continue;
        let rest = false, brk = false;
        prop.tiles.forEach((row, fy) => row.forEach((ft, fx) => {
          const fo = ft.obj;
          if (!fo || !FACILITIES[fo.k] || !FACILITIES[fo.k].levels) return;
          if (Math.max(Math.abs(fx - x), Math.abs(fy - y)) <= facLevel(fo).range) { if (fo.k === 'restroom') rest = true; else brk = true; }
        }));
        fill(x, y, rest && brk ? 'rgba(80,210,120,0.3)' : rest || brk ? 'rgba(242,201,76,0.35)' : 'rgba(235,60,60,0.3)');
      }
    }
  }
}

function heatLegend() {
  const mode = ui.heat;
  if (!mode || !state.current) return '';
  const prop = curProp(), def = curDef(), r = rt(state.current);
  const m = HEAT_MODES[mode];
  let extra = '';
  if (mode === 'wear') {
    let broken = 0, worn = 0;
    for (const row of prop.tiles) for (const t of row) if (t.obj && t.obj.life) { if (t.obj.jammed) broken++; else if (t.obj.wear / t.obj.life > 0.75) worn++; }
    extra = `${broken} broken · ${worn} over 75% worn`;
  } else if (mode === 'floor') {
    let n = 0;
    for (const row of prop.tiles) for (const t of row) if (t.base === 'broken') n++;
    extra = `${n} damaged tiles · ${fmt(n * def.repairCost)} to repair all`;
  } else if (mode === 'access') extra = 'green = reachable · red = cut off';
  else if (mode === 'dirt') {
    let filthy = 0;
    for (const row of prop.tiles) for (const t of row) if ((t.dirt || 0) >= DIRT.filthy || (t.obj && (t.obj.dirt || 0) >= DIRT.filthy)) filthy++;
    extra = `${filthy} filthy · ${prop.staff.janitor} janitor${prop.staff.janitor === 1 ? '' : 's'}`;
  }
  else if (mode === 'traffic') extra = 'yellow → red = longer waits';
  else if (mode === 'coverage') extra = 'green both · yellow one · red none';
  return `${m.icon} <b>${m.name}</b> · ${extra}`;
}

function refreshHeatUI() {
  const legend = document.getElementById('heatLegend');
  const btn = document.getElementById('heatBtn');
  if (!legend || !btn) return;
  const html = heatLegend();
  legend.classList.toggle('hidden', !html);
  if (legend.innerHTML !== html) legend.innerHTML = html;
  btn.classList.toggle('on', !!ui.heat);
  btn.textContent = ui.heat ? HEAT_MODES[ui.heat].icon : '🌡️';
}
