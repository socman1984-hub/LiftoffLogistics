'use strict';
// 🔍 Zoom & pan for the main view (warehouse sites and Mars). Pinch with two fingers,
// the ＋/－ buttons, or the mouse wheel. While zoomed, two fingers (or one finger with
// 🔍 Inspect, or anywhere on Mars) move the view around.

const ZOOM = { min: 1, max: 4, step: 1.4 };
if (ui.zoom == null) ui.zoom = 1;
if (!ui.pan) ui.pan = { x: 0, y: 0 };

// Fit `cols × rows` tiles in the canvas, then apply zoom and pan (kept from showing empty space).
function layoutGrid(cols, rows, top = 0) {
  const pad = 8;
  view.fit = Math.max(4, Math.floor(Math.min((view.w - pad * 2) / cols, (view.h - pad * 2 - top) / rows)));
  view.ts = Math.max(4, Math.floor(view.fit * ui.zoom));
  const cw = view.ts * cols, ch = view.ts * rows;
  const cx = Math.floor((view.w - cw) / 2), cy = top + Math.floor((view.h - top - ch) / 2);
  let ox = cx + ui.pan.x, oy = cy + ui.pan.y;
  ox = cw + pad * 2 <= view.w ? cx : Math.max(view.w - cw - pad, Math.min(pad, ox));
  oy = ch + pad * 2 <= view.h - top ? cy : Math.max(view.h - ch - pad, Math.min(top + pad, oy));
  view.ox = ox; view.oy = oy;
  ui.pan = { x: ox - cx, y: oy - cy };
}

// Zoom keeping the point under (px, py) where it is (or the centre).
function setZoom(z, px = view.w / 2, py = view.h / 2) {
  z = Math.max(ZOOM.min, Math.min(ZOOM.max, z));
  const wx = (px - view.ox) / view.ts, wy = (py - view.oy) / view.ts; // tile coords under the point
  ui.zoom = z;
  layoutView();
  ui.pan.x += Math.round(px - (view.ox + wx * view.ts));
  ui.pan.y += Math.round(py - (view.oy + wy * view.ts));
  layoutView();
  refreshZoomUI();
}
function panBy(dx, dy) { ui.pan.x += dx; ui.pan.y += dy; layoutView(); }
function resetZoom() { ui.zoom = 1; ui.pan = { x: 0, y: 0 }; layoutView(); refreshZoomUI(); }

function refreshZoomUI() {
  const el = $('zoomCtl');
  if (!el) return;
  $('zoomFit').classList.toggle('hidden', ui.zoom <= 1.01);
  $('zoomOut').disabled = ui.zoom <= 1.01;
  $('zoomIn').disabled = ui.zoom >= ZOOM.max - 0.01;
}

// ---- Two-finger pinch: tracked alongside the normal one-finger input ----
const pinch = { pts: new Map(), active: false };
const pinchMid = () => { const [a, b] = [...pinch.pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };

// Returns true when the event belongs to a pinch (the caller should ignore it).
function pinchDown(e, p) {
  pinch.pts.set(e.pointerId, p);
  if (pinch.pts.size === 2) {
    // A second finger: this is a pinch, not a build. Drop whatever the first finger started.
    drag.active = false; drag.plan = []; drag.placed.clear();
    const m = pinchMid();
    Object.assign(pinch, { active: true, d0: Math.max(10, m.d), z0: ui.zoom, last: m });
    return true;
  }
  return pinch.active;
}
function pinchMove(e, p) {
  if (!pinch.pts.has(e.pointerId)) return false;
  pinch.pts.set(e.pointerId, p);
  if (!pinch.active || pinch.pts.size < 2) return pinch.active;
  const m = pinchMid();
  setZoom(pinch.z0 * (m.d / pinch.d0), m.x, m.y);
  panBy(m.x - pinch.last.x, m.y - pinch.last.y);
  pinch.last = m;
  return true;
}
function pinchUp(e) {
  pinch.pts.delete(e.pointerId);
  if (!pinch.pts.size) { const was = pinch.active; pinch.active = false; return was; }
  return pinch.active;
}

function initZoom() {
  $('zoomIn').addEventListener('click', () => setZoom(ui.zoom * ZOOM.step));
  $('zoomOut').addEventListener('click', () => (ui.zoom / ZOOM.step <= 1.05 ? resetZoom() : setZoom(ui.zoom / ZOOM.step)));
  $('zoomFit').addEventListener('click', resetZoom);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = pointerPos(e);
    setZoom(ui.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), p.x, p.y);
  }, { passive: false });
  refreshZoomUI();
}
