'use strict';
// Boot, game loop, autosave, offline earnings.

const STEP = 1 / 60;

// Offline income per minute: each building's net rate, cut when it's short
// of Maintenance Techs (unattended breakdowns would stall it).
function offlinePerMin(rates) {
  let sum = 0;
  for (const id of Object.keys(rates || {})) {
    if (rates[id] > 0) sum += rates[id] * (0.4 + 0.6 * maintCoverage(state.props[id]));
  }
  return sum;
}

function currentRates() {
  const rates = {};
  for (const def of PROPERTIES) if (state.props[def.id].owned) rates[def.id] = propNet(def.id);
  return rates;
}

const fmtDur = (secs) => {
  const mins = Math.round(secs / 60);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
};

// While you're away, sites earn a fraction of their live rate, except for
// time covered by banked Night Crew hours, which earns at NIGHT_CREW_RATE. Without
// one, the first OFFLINE_FULL_HOURS pay the full offline rate, the rest half of it.
function awardOffline(fromMs, rates) {
  const awaySecs = (Date.now() - fromMs) / 1000;
  if (awaySecs > 0) stepLab(awaySecs); // the lab keeps working while you're away
  const rate = offlinePerMin(rates);
  if (awaySecs < 30 || rate <= 0) return;
  const full = Math.min(awaySecs, state.awayBoost || 0);
  const slow = Math.min(awaySecs - full, offlineCapSec());
  state.awayBoost = Math.max(0, (state.awayBoost || 0) - full);
  const fresh = Math.min(slow, OFFLINE_FULL_HOURS * 3600), tired = slow - fresh;
  const earned = (rate / 60) * (full * NIGHT_CREW_RATE + (fresh + tired * 0.5) * offlineRate());
  earn(earned, 'offline', fmtDur(awaySecs));
  ui.lastOffline = earned;
  const pct = Math.round(offlineRate() * 100);
  let breakdown = full
    ? `🌙 ${fmtDur(full)} at ${Math.round(NIGHT_CREW_RATE * 100)}% (Night Crew)${slow ? ` + ${fmtDur(slow)} on the skeleton crew` : ''}`
    : `${fmtDur(fresh)} at ${pct}% speed${tired ? `, then ${fmtDur(tired)} at ${Math.round(pct / 2)}%` : ''} (no one on shift)`;
  if (awaySecs - full > offlineCapSec()) breakdown += `<br><span class="muted">Offline earnings stop after ${fmtDur(offlineCapSec())}.</span>`;
  showMessage('Welcome back! 👋', `<p class="intro">You were away <b>${fmtDur(awaySecs)}</b> and your sites earned
    <b style="color:var(--accent)">${fmt(earned)}</b>.</p>
    <p class="intro small">${breakdown}${state.awayBoost ? `<br>🌙 ${fmtDur(state.awayBoost)} of Night Crew still banked.` : ''}</p>
    <button class="btn gem" style="width:100%;margin-bottom:8px" data-act="offline2x" ${state.gems < OFFLINE_DOUBLE_COST ? 'disabled' : ''}>
      Double it for ${OFFLINE_DOUBLE_COST} 💎 (you have ${state.gems})</button>
    <button class="btn secondary" style="width:100%" data-act="openshop">🌙 Book a Night Crew for next time</button>`);
}

let lastFrame = performance.now();
let acc = 0;
let uiTimer = 0;
let saveTimer = 0;
let mapTick = 0;

function frame(now) {
  let dt = (now - lastFrame) / 1000;
  lastFrame = now;
  dt = Math.min(dt, 0.25);
  acc += dt * devSpeed; // test mode can fast-forward
  while (acc >= STEP) {
    stepWorld(STEP);
    acc -= STEP;
  }

  uiTimer += dt;
  if (uiTimer > 0.25) {
    uiTimer = 0;
    refreshTopbar();
    refreshToolbar();
    refreshObjective();
    refreshAlerts();
    refreshHeatUI();
    refreshTutorial();
    // The map's buttons rebuild less often; its trucks animate every tick.
    mapTick = (mapTick + 1) % 6;
    if (LIVE_PANELS.includes(openPanelName) && (!SLOW_PANELS.includes(openPanelName) || mapTick === 0)) renderPanel();
    if (openPanelName === 'map') updateMapDynamic();
    if (openPanelName === 'logistics' || openPanelName === 'recvdock') updateFleetDynamic();
  }
  saveTimer += dt;
  if (saveTimer > 5) {
    saveTimer = 0;
    save();
  }

  requestAnimationFrame(frame); // schedule first so one bad frame can't stop the game
  try { render(ui.tool); } catch (e) { console.error(e); }
}

// Offline earnings when the app is backgrounded (phones suspend rAF).
let hiddenAt = null;
let hiddenRates = {};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    hiddenRates = currentRates();
    save();
  } else if (hiddenAt) {
    awardOffline(hiddenAt, hiddenRates);
    hiddenAt = null;
    lastFrame = performance.now();
  }
});
window.addEventListener('pagehide', save);

function boot() {
  const loaded = load();
  state = loaded || newState();
  if (loaded) { restoreRuntime(loaded.snap); delete state.snap; }
  buildToolbar();
  initInput();
  new ResizeObserver(resizeCanvas).observe(canvas);
  resizeCanvas();
  initDev();
  initTutorial();
  dailyBonus();
  refreshTopbar();
  refreshObjective();
  if (!state.current) openPanel('map');
  else if (loaded) awardOffline(loaded.savedAt, loaded.lastRates || { [loaded.current]: loaded.lastRate });
  requestAnimationFrame(frame);
}

boot();
