'use strict';
// Version and release notes (shown in Help). Newest first; bump GAME_VERSION with each release.

const GAME_VERSION = '0.9.3';

const RELEASE_NOTES = [
  { v: '0.9.3', date: 'Oct 13, 2026', title: 'Easier taps', notes: [
    'The tutorial card’s Hide and Skip are now proper buttons, spaced apart and easier to tap on a phone.',
  ] },
  { v: '0.9.2', date: 'Oct 13, 2026', title: 'Updates', notes: [
    'The game now checks for new versions and offers to update, so phones stop getting stuck on an old cached copy.',
    'Fixed How to Play showing blank, or showing the last screen you were on.',
  ] },
  { v: '0.9.1', date: 'Oct 13, 2026', title: 'Stuck staff fix', notes: [
    'Staff who end up cut off (boxed in by new building, or standing at a door that got blocked) now walk back in through an open door, so they stop reporting they “can’t reach” restrooms, break rooms and machines that are actually reachable.',
  ] },
  { v: '0.9.0', date: 'Oct 13, 2026', title: 'Lessons', notes: [
    'New 💡 lessons pop up the first time each feature unlocks: contracts, research, suppliers and haggling, trucks between sites, specialists, the Launch Site, Mars, colonists and Mastery. Each pays a couple of 💎 the first time.',
    'Help → 🎓 Tutorial & tips: resume the tutorial if you hid or skipped it, start it over, turn lesson pop-ups on or off, and replay any lesson.',
    'Help sections for later parts of the game stay locked until you get there.',
  ] },
  { v: '0.8.1', date: 'Oct 13, 2026', title: 'Door fix', notes: [
    'Staff now come in through any open door. A machine right inside the ship door no longer locks everyone out (and the Worker access overlay no longer shows the whole site red).',
    'Help now shows the version number and these release notes.',
  ] },
  { v: '0.8.0', date: 'Oct 12, 2026', title: 'Specialists matter', notes: [
    'Security Guards, Safety Officers and HR Managers become needed as a site grows: going without them slowly raises theft (then rack break-ins), accidents (then inspector fines) and grievances. Staff cards flag them as "needed".',
    'Test mode: jumping to a stage now builds every site\'s layout as if you\'d played to that point.',
  ] },
  { v: '0.7.0', date: 'Oct 12, 2026', title: 'Building Mars', notes: [
    'Go to Mars like a warehouse site: the base fills the screen with its own build bar.',
    'Modules land as kits that you place on a map and colonists build. Ice Mines go on ice, Metal Mines on metal veins, and most buildings need a Solar Farm or Fusion Reactor in reach.',
    'Colonists have jobs (farmers, ice crews, caretakers, miners, mechanics, scientists, engineers), dusty domes and morale.',
    'New modules: Metal Mine, Rec Dome, Workshop and Ore Silo. Ore waits on Mars until rockets fly it home.',
    'Tap any building, the Lander or a colonist to see what they\'re doing. Relocate moves buildings.',
  ] },
  { v: '0.6.0', date: 'Oct 12, 2026', title: 'Late-game goals', notes: [
    'Mastery: repeatable upgrades for spare ⭐ and cash. Megaprojects: big one-off builds for cash and 💎.',
    'Scanners, Labelers, Wrappers and Chillers upgrade to Mk II and Mk III.',
    'Sorter splits now follow the ratio you set.',
    'Warnings when Terraform parts or a module eat parts the rocket needs.',
  ] },
  { v: '0.5.0', date: 'Oct 11, 2026', title: 'Winning', notes: [
    'Project Terraform: bring Mars to life to win, with an ending cinematic and New Game+.',
    'Precision Fab Cell speeds up nearby assemblers.',
    'Test mode can jump to any stage of the game.',
    'Contracts show how likely you are to fill them; refresh offers with 💎.',
    'Rebalanced Mars, meteor repairs and emergency drops from full playthroughs.',
  ] },
  { v: '0.4.0', date: 'Oct 11, 2026', title: 'Liftoff and Mars', notes: [
    'First launch cinematic; later rockets can launch automatically.',
    'Mars colony: launch windows, base modules, supplies, colonists, events and Rare Metals.',
    'Colony research branch and launch pad upgrades.',
  ] },
  { v: '0.3.0', date: 'Oct 11, 2026', title: 'Running a business', notes: [
    'Choose suppliers and haggle for better prices; pause a supplier\'s deliveries.',
    'Each new site unlocks new buildings; specialist jobs and facilities unlock through research.',
    'Clearer fleet management with live truck status; forklifts restock assemblers from storage.',
    'Offline earnings toned down; Night Crew keeps sites running while you\'re away.',
  ] },
  { v: '0.2.0', date: 'Oct 11, 2026', title: 'Depth', notes: [
    'Tutorial, placement previews and timed refunds.',
    'Finances panel: tap your money to see where it comes from and goes.',
    'Research tech tree with branches and lab time.',
    'Racks keep their own stock, can be limited to chosen products, and stored stock can be sold.',
    'Sorter ratio splits, worker pay rates and worker status.',
  ] },
  { v: '0.1.0', date: 'Oct 10, 2026', title: 'First playable', notes: [
    'Conveyors, assemblers and warehouses: turn raw materials into rocket parts.',
  ] },
];

function releaseNotesHTML() {
  return RELEASE_NOTES.map((r, i) => `<details class="help-sec" ${i === 0 ? 'open' : ''}><summary>v${r.v} · ${r.title} <span class="muted small">${r.date}</span></summary>
    <ul>${r.notes.map((n) => `<li>${n}</li>`).join('')}</ul></details>`).join('');
}

// ---- Updates: phones can keep an old copy of the page cached. Check for a newer
// version now and then, and reload fresh (a new URL skips the cache; the save stays).
const verNum = (v) => v.split('.').map(Number).reduce((a, n) => a * 1000 + n, 0);
async function checkForUpdate() {
  try {
    const res = await fetch(`js/releases.js?check=${Date.now()}`, { cache: 'no-store' });
    const m = (await res.text()).match(/GAME_VERSION = '([\d.]+)'/);
    if (!m || verNum(m[1]) <= verNum(GAME_VERSION) || ui.updateOffered === m[1]) return;
    ui.updateOffered = m[1];
    showMessage('🔄 Update available', `<p class="intro">Version <b>v${m[1]}</b> is out (you have v${GAME_VERSION}). Your game is saved; updating just reloads the page.</p>
      <button class="btn" style="width:100%;margin-bottom:8px" data-act="appupdate">Update now</button>`, { noClose: true });
    $('modalBody').insertAdjacentHTML('beforeend', '<button class="btn secondary" style="width:100%" data-act="close">Later</button>');
  } catch (e) { /* offline: try again later */ }
}
function applyUpdate() {
  save();
  const q = new URLSearchParams(location.search);
  q.set('u', Date.now().toString(36));
  location.replace(`${location.pathname}?${q}`);
}
