'use strict';
// Tutorial: a guided walk through the basics for new players. Each step
// highlights what to press; finishing steps (and the whole thing) pays gems.
// After it, short 💡 lessons pop up the first time each bigger feature unlocks.

const TUTORIAL_STEP_GEMS = 3;
const TUTORIAL_DONE_GEMS = 10;
const LESSON_GEMS = 2;

const TUTORIAL = [
  {
    text: 'Welcome to <b>Liftoff Logistics</b>! First you need a warehouse. Open the <b>🗺️ Map</b> and buy the Rusty Shed.',
    target: '[data-panel="map"]', done: () => state.props.shed.owned,
  },
  {
    text: 'Trucks drop 🔩 steel at the green 🚚 door. Open <b>➡️ Conveyors</b> and pick <b>Conveyor</b>.',
    target: () => (ui.toolGroup === 'convey' ? '[data-tool="belt"]' : '[data-group="convey"]'),
    done: () => ui.tool === 'belt' || state.props.shed.earned > 0,
  },
  {
    text: '<b>Drag</b> from just under the 🚚 door down to the 📦 SHIP door. Green outlines show where you can build. Then tap <b>✅ Place</b>.',
    target: () => (ui.pending ? '#confirmYes' : null),
    done: () => state.props.shed.earned > 0 || countObj('belt') >= 4,
  },
  {
    text: 'Watch the boxes ride to the SHIP door. Every package that ships earns money. 💰',
    done: () => state.props.shed.earned > 0,
  },
  {
    text: 'Now build something worth more. Open <b>🏭 Machines</b>, pick <b>Assembler</b>, and tap one of your conveyors. It replaces it.',
    target: () => (ui.toolGroup === 'machines' ? '[data-tool="assembler"]' : '[data-group="machines"]'),
    done: () => hasObj('assembler'),
  },
  {
    text: 'Choose <b>🔲 Hull Panel</b>. It turns 2 🔩 steel into a panel that sells for more.',
    done: () => hasRecipe('panel'),
  },
  {
    text: 'Without a crew your assembler crawls at 25% speed. Open <b>🏗️ Manage → Staff</b> and hire an <b>👷 Assembler Operator</b>.',
    target: '[data-panel="building"]', done: () => anyStaff('operator'),
  },
  {
    text: 'Your operator walks over on repaired floor and starts building. Sell your first <b>🔲 Hull Panel</b>!',
    done: () => (state.props.shed.shipped.panel || 0) > 0,
  },
  {
    text: 'Tip: pick <b>🔍 Inspect</b> and tap anything (machines, racks, even people) to learn about it. The <b>🌡️</b> button shows overlays like wear and dirt.',
    target: '#heatBtn', manual: true,
  },
  {
    text: 'That\'s the basics! Follow the 🎯 goals to grow your supply chain all the way to a rocket. 🚀 Short 💡 lessons will pop up as new features unlock.',
    manual: true, final: true,
  },
];

// 💡 Lessons: shown once, the first time `when()` is true (after the basics tutorial).
const owned = () => PROPERTIES.filter((d) => state.props[d.id].owned).length;
const LESSONS = [
  { id: 'contracts', icon: '📋', title: 'Contracts', when: () => state.props.shed.earned > 300 && state.contracts.offers.length > 0, steps: [
    { text: 'Buyers are offering <b>📋 contracts</b>: ship a number of one product before time runs out, for cash, ⭐ reputation and 💎. Open <b>💹 Market</b>.', target: '[data-panel="contracts"]', done: () => openPanelName === 'contracts' || state.contracts.active.length > 0 },
    { text: 'Each offer shows how likely you are to fill it, based on what you\'ve actually been shipping. <b>Accept</b> one you can do.', done: () => state.contracts.active.length > 0 },
    { text: 'Contracts are your main source of ⭐, which pays for 🔬 Research. If time runs out you just lose the contract, so it\'s fine to try. 🔄 New offers costs a few 💎.', manual: true },
  ] },
  { id: 'research', icon: '🔬', title: 'Research', when: () => state.rep >= 2 && Object.keys(state.research).length < 3, steps: [
    { text: 'You have ⭐ reputation to spend. Open <b>🔬 Research</b>.', target: '[data-panel="research"]', done: () => openPanelName === 'research' || !!state.lab },
    { text: 'The tree has branches; each node needs the ones above it. Tap an open node and <b>start</b> it (it costs ⭐ and cash).', done: () => !!state.lab },
    { text: 'The lab works on one project at a time, even while you\'re away. 💎 can finish one early. Research unlocks new machines, staff, buildings and bonuses.', manual: true },
  ] },
  { id: 'suppliers', icon: '🤝', title: 'Suppliers and haggling', when: () => owned() >= 2 || state.props.shed.earned > 8000, steps: [
    { text: 'Raw materials come from <b>suppliers</b>. Tap a green <b>🚚 IN door</b> (with 🔍 Inspect) to see who supplies it.', done: () => openPanelName === 'supplier' || openPanelName === 'negotiate' },
    { text: 'Pick <b>Budget</b> (cheap, slow), <b>Standard</b> or <b>Express</b> (fast, pricey), or tap <b>🤝 Negotiate</b> to haggle a cheaper deal. Watch their mood: lowball and they walk away for a while.', manual: true },
    { text: 'Deals run for a set time. Later a 🧾 Purchasing Agent can renew them for you, and ⏸ pauses a door that\'s flooding a line.', manual: true },
  ] },
  { id: 'trucks', icon: '🚚', title: 'Trucks between sites', when: () => owned() >= 2, steps: [
    { text: 'Your sites can supply each other. Open <b>🗺️ Map → 🚚 Logistics</b>.', target: '[data-panel="map"]', done: () => openPanelName === 'logistics' },
    { text: 'In <b>Distribution</b>, give a product a destination (another site); anything extra is sold. In <b>Fleet</b>, make sure the route has a 🚚 truck. Trucked-in goods arrive at the purple 📥 receiving door.', manual: true },
  ] },
  { id: 'specialists', icon: '⚠️', title: 'Specialists a big site needs', when: () => PROPERTIES.some((d) => state.props[d.id].owned && Object.keys(STAFF_NEEDS).some((r) => staffNeedOpen(state.props[d.id], r) && !staffNeedMet(d.id, state.props[d.id], r))), steps: [
    { text: 'One of your sites is big enough to need a specialist: a 🛡️ Security Guard, ⛑️ Safety Officer or 🗂️ HR Manager. Open <b>🏗️ Manage → Staff</b> and look for <b>⚠️ needed</b>.', target: '[data-panel="building"]', done: () => openPanelName === 'building' },
    { text: 'Going without them is fine for a while, but it slowly gets worse: more theft and break-ins, more accidents and fines, unhappy staff. Hire one and it calms down.', manual: true },
  ] },
  { id: 'launch', icon: '🚀', title: 'The Launch Site', when: () => state.launch.owned && state.launch.count < 1, steps: [
    { text: 'The 🚀 Launch Site is yours! Open the <b>🗺️ Map</b> and tap it to see the parts each rocket stage needs.', target: '[data-panel="map"]', done: () => openPanelName === 'map' && ui.mapSel === 'launch' },
    { text: 'Send rocket parts there with <b>🚚 Logistics</b> (add 🚀 Launch Site as a destination). When all three stages are full, press <b>LAUNCH</b>!', manual: true },
  ] },
  { id: 'mars', icon: '🔴', title: 'Mars', when: () => state.launch.count >= 1, steps: [
    { text: 'Next stop: Mars! In <b>🚀 Launch Site → Mission Control</b>, plan each rocket\'s cargo: a base module, colonists and supply crates. Rockets fly during launch windows.', manual: true },
    { text: 'Modules land as kits you build yourself. Go to <b>🗺️ Map → 🔴 Go to Mars base</b>.', target: '[data-panel="map"]', done: () => !!ui.marsView },
    { text: 'Use <b>🏗️ Build</b> to place kits (green tiles are OK, orange means no power reaches). Tap buildings and colonists to see what they\'re doing. 📊 Colony shows supplies and crew.', manual: true },
  ] },
  { id: 'colony', icon: '👥', title: 'Colonists at work', when: () => state.mars && state.mars.colonists >= 8, steps: [
    { text: 'Your colonists now have <b>jobs</b>: farmers, ice crews, miners, caretakers and more. Buildings with nobody on them run at 30%.', manual: true },
    { text: '<b>🙂 Morale</b> scales everything Mars makes. Keep domes clean, build a 🎳 Rec Dome, and don\'t let them ration or crowd the Lander. Check it in 📊 Colony.', manual: true },
  ] },
  { id: 'mastery', icon: '🏅', title: 'Mastery', when: () => state.launch.count >= 1 && state.rep >= 60 && typeof masteryOpen === 'function' && masteryOpen(), steps: [
    { text: 'Spare ⭐? Open <b>🔬 Research → 🏅 Mastery</b> for repeatable upgrades, and 🌌 Megaprojects for cash and 💎.', target: '[data-panel="research"]', done: () => openPanelName === 'research' && ui.resView === 'mastery' },
  ] },
];
const LESSON_BY_ID = Object.fromEntries(LESSONS.map((l) => [l.id, l]));

function countObj(kind) {
  let n = 0;
  for (const def of PROPERTIES) {
    const p = state.props[def.id];
    if (p.owned) for (const row of p.tiles) for (const t of row) if (t.obj && t.obj.k === kind) n++;
  }
  return n;
}

const lessonState = () => state.lessons || (state.lessons = { done: {}, cur: null, off: false });
function tutorialActive() {
  return state.tutorial && state.tutorial.active && state.tutorial.step < TUTORIAL.length;
}
const lessonActive = () => !tutorialActive() && !!lessonState().cur;

function advanceTutorial() {
  const t = state.tutorial;
  const step = TUTORIAL[t.step];
  t.step++;
  const pay = !t.noGems;
  if (step.final || t.step >= TUTORIAL.length) {
    t.active = false;
    t.done = true;
    if (pay) state.gems += TUTORIAL_DONE_GEMS;
    toast(pay ? `🎓 Tutorial complete! +${TUTORIAL_DONE_GEMS} 💎` : '🎓 Tutorial complete!');
  } else {
    if (pay) state.gems += TUTORIAL_STEP_GEMS;
    toast(pay ? `🎓 Nice! +${TUTORIAL_STEP_GEMS} 💎` : '🎓 Nice!');
  }
  save();
}

function advanceLesson() {
  const ls = lessonState(), cur = ls.cur, L = LESSON_BY_ID[cur.id];
  cur.step++;
  if (cur.step >= L.steps.length) {
    const pay = !ls.done[cur.id];
    ls.done[cur.id] = true;
    ls.cur = null;
    if (pay) state.gems += LESSON_GEMS;
    toast(`💡 ${L.title}: got it${pay ? ` · +${LESSON_GEMS} 💎` : ''}`);
  }
  save();
}

// Start the next lesson whose feature has just unlocked (one at a time, tips on).
function checkLessons() {
  const ls = lessonState();
  if (ls.cur || ls.off || tutorialActive()) return;
  for (const L of LESSONS) {
    if (ls.done[L.id]) continue;
    let ok = false;
    try { ok = L.when(); } catch (e) { ok = false; }
    if (ok) { ls.cur = { id: L.id, step: 0 }; ui.tutMin = false; save(); return; }
  }
}

function startLesson(id) {
  lessonState().cur = { id, step: 0 };
  ui.tutMin = false;
  save();
}

let tutGlow = [];
function refreshTutorial() {
  const card = document.getElementById('tutCard');
  for (const el of tutGlow) el.classList.remove('tut-glow');
  tutGlow = [];
  checkLessons();
  let step, head, body, gemNote;
  if (tutorialActive()) {
    // Auto-advance steps whose goal is met (several at once if needed).
    while (tutorialActive() && !TUTORIAL[state.tutorial.step].manual && TUTORIAL[state.tutorial.step].done()) advanceTutorial();
    if (!tutorialActive()) { card.classList.add('hidden'); return; }
    const i = state.tutorial.step;
    step = TUTORIAL[i];
    head = `🎓 Tutorial ${i + 1}/${TUTORIAL.length}`;
    gemNote = state.tutorial.noGems ? '' : `+${TUTORIAL_STEP_GEMS} 💎 for this step`;
    body = step.manual ? `<button class="btn small tut-ok" data-tut="ok">${step.final ? (state.tutorial.noGems ? 'Finish' : `Finish (+${TUTORIAL_DONE_GEMS} 💎)`) : 'Got it'}</button>` : `<div class="muted">${gemNote}</div>`;
  } else if (lessonActive()) {
    const ls = lessonState();
    const L = LESSON_BY_ID[ls.cur.id];
    if (!L) { ls.cur = null; card.classList.add('hidden'); return; }
    while (ls.cur && !L.steps[ls.cur.step].manual && L.steps[ls.cur.step].done()) advanceLesson();
    if (!ls.cur) { card.classList.add('hidden'); return; }
    step = L.steps[ls.cur.step];
    const last = ls.cur.step === L.steps.length - 1;
    head = `💡 ${L.icon} ${L.title}${L.steps.length > 1 ? ` ${ls.cur.step + 1}/${L.steps.length}` : ''}`;
    body = step.manual ? `<button class="btn small tut-ok" data-tut="ok">${last ? `Got it${ls.done[L.id] ? '' : ` (+${LESSON_GEMS} 💎)`}` : 'Next'}</button>` : '';
  } else { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  card.classList.toggle('min', !!ui.tutMin);
  const html = ui.tutMin
    ? `<button class="tut-pill" data-tut="expand">${head.split(' ').slice(0, 2).join(' ')} ▾</button>`
    : `<div class="tut-head">${head}<span><button class="tut-skip" data-tut="min">– hide</button><button class="tut-skip" data-tut="skip">Skip</button></span></div>
    <div class="tut-text">${step.text}</div>${body}`;
  if (card.dataset.html !== html) { card.innerHTML = html; card.dataset.html = html; }
  const sel = typeof step.target === 'function' ? step.target() : step.target;
  if (sel && !ui.tutMin) for (const el of document.querySelectorAll(sel)) { el.classList.add('tut-glow'); tutGlow.push(el); }
}

function initTutorial() {
  document.getElementById('tutCard').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tut]');
    if (!b) return;
    const lesson = !tutorialActive() && lessonActive();
    if (b.dataset.tut === 'ok') { if (lesson) advanceLesson(); else advanceTutorial(); }
    else if (b.dataset.tut === 'min') ui.tutMin = true;
    else if (b.dataset.tut === 'expand') ui.tutMin = false;
    else if (b.dataset.tut === 'skip') {
      if (lesson) { const ls = lessonState(); ls.done[ls.cur.id] = ls.done[ls.cur.id] || 'skipped'; ls.cur = null; toast('💡 Lesson skipped. Replay it any time from ❓ Help → Tutorial & tips'); save(); }
      else if (confirm('Skip the tutorial? You can pick it up again from ❓ Help → Tutorial & tips.')) {
        state.tutorial.active = false;
        state.tutorial.skipped = true;
        save();
      }
    }
    refreshTutorial();
  });
}

function restartTutorial() {
  // Gems are only paid once per step, even when replaying.
  state.tutorial = { active: true, step: 0, done: state.tutorial && state.tutorial.done, replay: true };
  if (state.tutorial.done) state.tutorial.noGems = true; // replays pay nothing extra
  lessonState().cur = null;
  ui.tutMin = false;
}

// Pick the basics tutorial up where it was left (after Skip or hide).
function resumeTutorial() {
  const t = state.tutorial || (state.tutorial = { step: 0 });
  t.active = true;
  t.skipped = false;
  lessonState().cur = null;
  ui.tutMin = false;
  save();
}

// ❓ Help: tutorial status, tips on/off, and every unlocked lesson to replay.
function tutorialHelpHTML() {
  const t = state.tutorial || {}, ls = lessonState();
  const status = tutorialActive() ? `in progress (step ${t.step + 1}/${TUTORIAL.length})` : t.done ? 'finished ✅' : `stopped at step ${Math.min(TUTORIAL.length, (t.step || 0) + 1)}/${TUTORIAL.length}`;
  let html = `<details class="help-sec" open><summary>🎓 Tutorial & tips</summary>
    <p class="intro small">Basics tutorial: <b>${status}</b>.</p>
    <div class="choice">
      ${!t.done && !tutorialActive() ? '<button class="chip on" data-act="tutresume">▶ Resume tutorial</button>' : ''}
      <button class="chip" data-act="tutorial">🔁 Start over</button>
      ${ui.tutMin ? '<button class="chip" data-act="tutshow">👁 Show the tutorial card</button>' : ''}
    </div>
    <div class="choice"><span class="ctl-lbl">💡 Tips when features unlock</span>
      <button class="chip ${!ls.off ? 'on' : ''}" data-act="tipson">On</button>
      <button class="chip ${ls.off ? 'on' : ''}" data-act="tipsoff">Off</button></div>`;
  const seen = LESSONS.filter((L) => ls.done[L.id] || (ls.cur && ls.cur.id === L.id));
  html += seen.length ? `<p class="intro small">Replay a lesson:</p><div class="choice">${seen.map((L) => `<button class="chip" data-act="lesson" data-id="${L.id}">${L.icon} ${L.title}</button>`).join('')}</div>`
    : '<p class="intro small">💡 Lessons appear here as you unlock new features.</p>';
  return html + '</details>';
}

function handleTutorialAct(act, id) {
  if (act === 'tutresume') { resumeTutorial(); closePanel(); return 'stop'; }
  if (act === 'tutshow') { ui.tutMin = false; closePanel(); return 'stop'; }
  if (act === 'tipson') { lessonState().off = false; save(); return true; }
  if (act === 'tipsoff') { lessonState().off = true; lessonState().cur = null; save(); return true; }
  if (act === 'lesson') { startLesson(id); closePanel(); return 'stop'; }
  return false;
}
