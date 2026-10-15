'use strict';
// 🔗 Supply network: sites send each other what their assemblers use, and the
// Launch Site gets rocket parts as it needs them, without any setup. Each link
// can be switched off; each product's extras are sold or kept on the racks; and
// a product can still be put on a hand-made plan (⚙️ Advanced). Trucks are one
// shared pool: idle trucks go wherever cargo is waiting.

const NET = () => {
  const n = state.net || (state.net = { off: {}, extra: {} });
  if (!n.off) n.off = {};
  if (!n.extra) n.extra = {};
  return n;
};
const linkKey = (from, to, p) => `${from}>${to}|${p}`;
const linkOn = (from, to, p) => !NET().off[linkKey(from, to, p)];
const extraOf = (id, p) => NET().extra[`${id}|${p}`] || 'sell';
const isManual = (prop, p) => !!(prop.plans[p] && prop.plans[p].manual);

// Products a site puts out of its SHIP doors: its open supplier docks and its assemblers' products.
function siteMakes(id) {
  const def = PROP_BY_ID[id], prop = state.props[id], out = new Set();
  for (const d of def.inDocks) if (d.cargo && !prop.tiles[d.y][d.x].locked) for (const k of Object.keys(d.cargo)) out.add(k);
  for (const row of prop.tiles) for (const t of row) if (t.obj && t.obj.k === 'assembler' && t.obj.recipe) out.add(t.obj.recipe);
  return out;
}
// Raw materials the site buys at its own open supplier docks.
function siteBuys(id) {
  const def = PROP_BY_ID[id], prop = state.props[id], out = new Set();
  for (const d of def.inDocks) if (d.cargo && !prop.tiles[d.y][d.x].locked) for (const k of Object.keys(d.cargo)) out.add(k);
  return out;
}
// Ingredients the site's running assemblers use: { product: per-craft amount, summed }.
function siteUses(id) {
  const out = {};
  for (const row of state.props[id].tiles) for (const t of row) {
    const o = t.obj;
    if (!o || o.k !== 'assembler' || !o.recipe || o.mode === 'pause') continue;
    for (const [p, n] of Object.entries(RECIPES[o.recipe].in || {})) out[p] = (out[p] || 0) + n;
  }
  return out;
}
const launchTakes = (p) => state.launch.owned && (marsOn() ? marsAccepts(p) : !!LAUNCH.needs[p]);
// How much a site likes to have in hand or on the way: a few crafts' worth of each ingredient, all of
// them together fitting in part of its racks (so there's always room left for what it ships out).
// The Launch Site asks for exactly what the next rocket needs, so it has no target here.
function netTargets(to, uses) {
  const raw = {};
  for (const [p, n] of Object.entries(uses)) raw[p] = Math.max(NETWORK.minStock, Math.ceil(n * NETWORK.stockPerInput));
  const total = Object.values(raw).reduce((a, b) => a + b, 0);
  const budget = storageCap(to) * NETWORK.rackShare;
  const k = total > budget ? budget / total : 1;
  for (const p of Object.keys(raw)) raw[p] = Math.max(NETWORK.minStock, Math.floor(raw[p] * k));
  return raw;
}

// Every link: who makes it → who needs it. Rebuilt about once a second.
let netMemo = { at: -1, v: null };
function netLinks() {
  const sec = Math.floor(state.clock);
  if (netMemo.at === sec && netMemo.ver === netVer) return netMemo.v;
  const owned = PROPERTIES.filter((d) => state.props[d.id].owned).map((d) => d.id);
  const makes = {}, uses = {}, buys = {};
  for (const id of owned) { makes[id] = siteMakes(id); uses[id] = siteUses(id); buys[id] = siteBuys(id); }
  const links = [], unmet = [];
  for (const to of owned) {
    if (!hasReceiveDock(PROP_BY_ID[to])) continue;
    const target = netTargets(to, Object.fromEntries(Object.entries(uses[to]).filter(([p]) => !buys[to].has(p))));
    for (const p of Object.keys(uses[to])) {
      if (buys[to].has(p)) continue; // its own supplier brings it
      // Sites that make it. When two sites both make and use it, only the earlier one sends, so nothing ping-pongs.
      const from = owned.filter((s) => s !== to && makes[s].has(p) && !(uses[s][p] && makes[to].has(p) && owned.indexOf(s) > owned.indexOf(to)));
      if (!from.length) { if (!makes[to].has(p)) unmet.push({ to, p }); continue; }
      for (const f of from) links.push({ from: f, to, p, cap: target[p], on: linkOn(f, to, p) });
    }
  }
  if (state.launch.owned) {
    for (const f of owned) for (const p of makes[f]) if (launchTakes(p)) links.push({ from: f, to: 'launch', p, cap: 0, on: linkOn(f, 'launch', p) });
  }
  netMemo = { at: sec, ver: netVer, v: { links, unmet } };
  return netMemo.v;
}
let netVer = 0;
const netChanged = () => { netVer++; autoMemo.clear(); };

// The plan a product follows when it's on automatic: every switched-on link
// (equal shares while they have room), then extras sold or kept.
const autoMemo = new Map();
function autoPlan(id, p) {
  const k = `${id}|${p}`, sec = Math.floor(state.clock), hit = autoMemo.get(k);
  if (hit && hit.at === sec) return hit.plan;
  const dests = netLinks().links.filter((l) => l.from === id && l.p === p && l.on).map((l) => ({ to: l.to, w: 1, cap: l.cap }));
  const plan = { dests, overflow: extraOf(id, p) === 'keep' ? 'keep' : 'sell', auto: true };
  autoMemo.set(k, { at: sec, plan });
  return plan;
}
const propIdOf = new WeakMap();
function idOfProp(prop) {
  let id = propIdOf.get(prop);
  if (!id) { id = PROPERTIES.find((d) => state.props[d.id] === prop).id; propIdOf.set(prop, id); }
  return id;
}

// ---------- 🚚 Shared truck pool ----------
// Once a second, every empty truck at a loading dock (and every truck in the garage)
// is up for grabs: it goes to the route with the most cargo nobody is loading yet.
// Rocket parts and routes with no truck at all go first, so nothing is starved.
function stepDispatch() {
  const cap = truckCap();
  const live = [];
  for (const [key, f] of Object.entries(state.fleet)) {
    const [from, to] = key.split('>');
    const src = state.props[from];
    if (!src || !src.owned) continue;
    f.trucks = f.units.filter((u) => u.phase !== 'load' || u.n).length; // empty ones at the dock go back to the pool
    live.push({ f, to, waiting: Object.values(src.outbox[to] || {}).reduce((a, b) => a + b, 0) });
  }
  let free = idleTrucks();
  while (free > 0) {
    let best = null, top = 0;
    for (const r of live) {
      const busy = r.f.units.filter((u) => u.phase !== 'load' || u.n).length; // trucks already working this route
      // Room coming: trucks loading here, trucks driving back here empty, and ones just handed out.
      const room = r.f.units.filter((u) => u.phase === 'load' && u.n).reduce((a, u) => a + cap - u.n, 0)
        + r.f.units.filter((u) => u.phase === 'back').length * cap + Math.max(0, r.f.trucks - busy) * cap;
      const short = r.waiting - room;
      if (short <= 0) continue;
      const score = short * (r.to === 'launch' ? 2 : 1) * (r.f.trucks ? 1 : 2);
      if (score > top) { top = score; best = r; }
    }
    if (!best) break;
    best.f.trucks++;
    free--;
  }
  // How long each route's cargo has sat with no truck coming for it.
  for (const r of live) r.f.dry = r.waiting > 0 && !r.f.trucks && !r.f.units.length ? (r.f.dry || 0) + 1 : 0;
}
// Cargo that has sat a while with no truck to take it (shown as "buy more trucks"). Brief
// waits while every truck is out are normal: a truck frees up within a trip or two.
function cargoStranded() {
  let n = 0;
  for (const [key, f] of Object.entries(state.fleet)) {
    const [from, to] = key.split('>');
    if (!state.props[from] || !state.props[from].owned || (f.dry || 0) < NETWORK.strandedAfter) continue;
    n += Object.values(state.props[from].outbox[to] || {}).reduce((a, b) => a + b, 0);
  }
  return n;
}
const trucksOnRoad = () => Object.values(state.fleet).reduce((a, f) => a + f.units.length, 0);

// Pause or resume one link. Pausing takes effect at once: whatever was still waiting
// at the dock for that site goes back on the racks, or is sold if this product's extras are sold.
function toggleLink(key) {
  const n = NET(), [route, p] = key.split('|'), [from, to] = route.split('>');
  const what = `${PRODUCTS[p].icon} ${PRODUCTS[p].name} from ${siteName(from)} to ${siteName(to)}`;
  if (n.off[key]) { delete n.off[key]; netChanged(); toast(`▶ Sending ${what} again`); save(); return; }
  n.off[key] = true;
  netChanged();
  const src = state.props[from], box = src.outbox[to] || {}, q = box[p] || 0;
  let note = '';
  if (q) {
    delete box[p];
    src.held[p] = (src.held[p] || 0) + q;
    if (extraOf(from, p) === 'keep') note = ` · ${q} waiting went back on the racks`;
    else note = ` · ${q} waiting sold for ${fmt(sellStored(from, p, q))}`;
    syncRacks(from);
  }
  toast(`⏸ Paused ${what}${note}. Anything already on a truck still arrives`);
  save();
}

// ---------- Panel: 🔗 Network ----------
// What's at a site (or the pad) or on its way there.
function netStock(to, p) {
  if (to === 'launch') return launchStock(p);
  let n = state.props[to].inbox[p] || 0;
  for (const d of PROPERTIES) if (state.props[d.id].owned && d.id !== to) n += ((state.props[d.id].outbox[to] || {})[p] || 0) + inTransit(d.id, to, p);
  return n;
}

function trucksBoxHTML() {
  const stranded = cargoStranded(), road = trucksOnRoad(), cost = truckCost();
  return `<div class="garage"><div><b>🚚 ${state.garage.trucks}</b> truck${state.garage.trucks === 1 ? '' : 's'} · ${road} out working
    <div class="${stranded ? 'neg' : 'muted'}">${!state.garage.trucks ? 'Buy a truck to move goods between sites' : stranded ? `⚠️ ${stranded} waiting for a truck: buy another` : '✅ Keeping up'} · each carries ${truckCap()}</div></div>
    <div class="garage-btns"><button class="btn small" data-act="buytruck" ${state.money < cost ? 'disabled' : ''}>Buy ${fmt(cost)}</button></div></div>`;
}

function networkHTML() {
  NET().seen = true;
  const { links, unmet } = netLinks();
  let html = `<p class="intro small">Your sites send each other what their assemblers use${state.launch.owned ? ', and the 🚀 Launch Site gets the parts the next rocket needs' : ''}. Anything nobody needs is sold (or kept: see 🏭 Sites). Tap a <b>from</b> button to pause that link, and again to resume it.</p>`;
  html += trucksBoxHTML();
  const dests = [...PROPERTIES.map((d) => d.id), 'launch'];
  const launchNeed = state.launch.owned ? launchNeeds() : {};
  let any = false;
  for (const to of dests) {
    let mine = links.filter((l) => l.to === to);
    if (to === 'launch') mine = mine.filter((l) => (launchNeed[l.p] || 0) > 0 || netStock('launch', l.p) > (state.launch.parts[l.p] || 0));
    const missing = unmet.filter((u) => u.to === to);
    if (!mine.length && !missing.length) continue;
    any = true;
    const n = new Set(mine.map((l) => l.p)).size + missing.length;
    html += `<div class="net-site ${to === 'launch' ? 'launch' : ''}"><div class="net-site-head"><span class="net-site-ic">${siteEmoji(to)}</span>
      <div><b>${siteName(to)}</b><div class="muted small">receives ${n} product${n === 1 ? '' : 's'}</div></div></div>`;
    const byP = {};
    for (const l of mine) (byP[l.p] || (byP[l.p] = [])).push(l);
    for (const [p, ls] of Object.entries(byP)) {
      const have = netStock(to, p);
      const want = to === 'launch' ? launchNeed[p] || 0 : ls[0].cap;
      const col = have >= want ? 'pos' : have > 0 ? '' : 'neg';
      const paused = ls.every((l) => !l.on);
      html += `<div class="net-row ${paused ? 'paused' : ''}"><span class="net-prod">${PRODUCTS[p].icon} ${PRODUCTS[p].name}<span class="muted small ${paused ? '' : col}"> · ${paused ? `⏸ paused${have ? ` (${have} still there)` : ''}` : `${have}/${want} ${to === 'launch' ? 'for the next rocket' : 'there or on the way'}`}</span></span>
        <span class="net-from">${ls.map((l) => `<button class="chip small net-link ${l.on ? 'on' : 'off'}" data-act="netlink" data-id="${linkKey(l.from, l.to, l.p)}" title="${l.on ? 'Tap to pause' : 'Tap to resume'}">${l.on ? '▶' : '⏸'} ${siteEmoji(l.from)} ${siteName(l.from)}</button>`).join('')}</span></div>`;
    }
    for (const u of missing) html += `<div class="net-row"><span class="net-prod">${PRODUCTS[u.p].icon} ${PRODUCTS[u.p].name}</span><span class="muted small warn-text">none of your sites ship it</span></div>`;
    html += '</div>';
  }
  if (!any) html += `<p class="intro">Nothing to send yet. Set an assembler's recipe at one site, and the site that makes its ingredients starts trucking them over.</p>`;
  return html;
}

// ---------- Panel: 🏭 Sites (what each product does, extras, ⚙️ Advanced) ----------
function siteProductsHTML(id) {
  const prop = state.props[id];
  const products = relevantProducts(id);
  if (!products.length) return '<p class="intro">Nothing ships from here yet. Open a supplier dock or set an assembler recipe.</p>';
  let html = `<p class="intro small">What happens to each product leaving ${siteName(id)}'s SHIP doors.</p>`;
  for (const p of products) {
    if (isManual(prop, p)) { html += manualPlanHTML(id, p); continue; }
    const plan = autoPlan(id, p), keep = extraOf(id, p) === 'keep';
    const to = plan.dests.map((d) => `${siteEmoji(d.to)} ${siteName(d.to)}`).join(', ');
    html += `<div class="plan"><div class="plan-head"><span>${PRODUCTS[p].icon} <b>${PRODUCTS[p].name}</b><span class="muted"> · sells ${fmt(marketPrice(p))}</span></span>
      <button class="link-btn" data-act="padv" data-id="${id}|${p}">⚙️ Advanced</button></div>
      <div class="plan-sum-line">${to ? `🚚 Goes to ${to} when they need it` : 'No site needs it'}${prop.held[p] ? ` · 🗄️ ${prop.held[p]} kept` : ''}</div>
      <div class="choice"><span class="ctl-lbl">Extras</span>
        <button class="chip small ${!keep ? 'on' : ''}" data-act="pextra" data-id="${id}|${p}|sell">💰 Sell</button>
        <button class="chip small ${keep ? 'on' : ''}" data-act="pextra" data-id="${id}|${p}|keep">🗄️ Keep on racks</button></div>
      ${keep ? '<div class="muted small">Kept stock goes out when a site needs it; when the racks are full, the rest is sold.</div>' : ''}</div>`;
  }
  return html;
}
