'use strict';
// Tutorial: a guided walk through the basics for new players. Each step
// highlights what to press; finishing steps (and the whole thing) pays gems.

const TUTORIAL_STEP_GEMS = 3;
const TUTORIAL_DONE_GEMS = 10;

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
    text: 'That\'s the basics! Follow the 🎯 goals to grow your supply chain all the way to a rocket. 🚀',
    manual: true, final: true,
  },
];

function countObj(kind) {
  let n = 0;
  for (const def of PROPERTIES) {
    const p = state.props[def.id];
    if (p.owned) for (const row of p.tiles) for (const t of row) if (t.obj && t.obj.k === kind) n++;
  }
  return n;
}

function tutorialActive() {
  return state.tutorial && state.tutorial.active && state.tutorial.step < TUTORIAL.length;
}

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

let tutGlow = [];
function refreshTutorial() {
  const card = document.getElementById('tutCard');
  for (const el of tutGlow) el.classList.remove('tut-glow');
  tutGlow = [];
  if (!tutorialActive()) { card.classList.add('hidden'); return; }
  // Auto-advance steps whose goal is met (several at once if needed).
  while (tutorialActive() && !TUTORIAL[state.tutorial.step].manual && TUTORIAL[state.tutorial.step].done()) advanceTutorial();
  if (!tutorialActive()) { card.classList.add('hidden'); return; }
  const i = state.tutorial.step;
  const step = TUTORIAL[i];
  card.classList.remove('hidden');
  card.classList.toggle('min', !!ui.tutMin);
  const html = ui.tutMin
    ? `<button class="tut-pill" data-tut="expand">🎓 ${i + 1}/${TUTORIAL.length} ▾</button>`
    : `<div class="tut-head">🎓 Tutorial ${i + 1}/${TUTORIAL.length}<span><button class="tut-skip" data-tut="min">– hide</button><button class="tut-skip" data-tut="skip">Skip</button></span></div>
    <div class="tut-text">${step.text}</div>
    ${step.manual ? `<button class="btn small tut-ok" data-tut="ok">${step.final ? (state.tutorial.noGems ? 'Finish' : `Finish (+${TUTORIAL_DONE_GEMS} 💎)`) : 'Got it'}</button>` : state.tutorial.noGems ? '' : `<div class="muted">+${TUTORIAL_STEP_GEMS} 💎 for this step</div>`}`;
  if (card.dataset.html !== html) { card.innerHTML = html; card.dataset.html = html; }
  const sel = typeof step.target === 'function' ? step.target() : step.target;
  if (sel) for (const el of document.querySelectorAll(sel)) { el.classList.add('tut-glow'); tutGlow.push(el); }
}

function initTutorial() {
  document.getElementById('tutCard').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tut]');
    if (!b) return;
    if (b.dataset.tut === 'ok') advanceTutorial();
    else if (b.dataset.tut === 'min') ui.tutMin = true;
    else if (b.dataset.tut === 'expand') ui.tutMin = false;
    else if (b.dataset.tut === 'skip' && confirm('Skip the tutorial? You can restart it from ❓ Help.')) {
      state.tutorial.active = false;
      save();
    }
    refreshTutorial();
  });
}

function restartTutorial() {
  // Gems are only paid once per step, even when replaying.
  state.tutorial = { active: true, step: 0, done: state.tutorial && state.tutorial.done, replay: true };
  if (state.tutorial.done) {
    // Replays skip already-finished steps automatically but pay nothing extra.
    state.tutorial.noGems = true;
  }
}
