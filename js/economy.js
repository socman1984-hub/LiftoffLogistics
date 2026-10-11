'use strict';
// Economy UI: the Market (live prices + contracts) and the 💎 Boost Shop.
//
// Monetization rule of thumb: gems only ever save time. Everything a boost
// does can be achieved by playing, and gems are earnable in play (goals,
// contracts, daily bonus, launches). See docs/MONETIZATION.md.

function marketTabsHTML() {
  const tabs = [['prices', '💹 Prices'], ['contracts', '📋 Contracts']];
  return `<div class="tabs">${tabs.map(([id, name]) =>
    `<button class="tab ${ui.marketTab === id ? 'on' : ''}" data-act="mtab" data-id="${id}">${name}${id === 'contracts' && state.contracts.active.length ? ` (${state.contracts.active.length})` : ''}</button>`).join('')}</div>`;
}

function marketHTML() {
  if (!ui.marketTab) ui.marketTab = 'prices';
  return marketTabsHTML() + (ui.marketTab === 'prices' ? pricesHTML() : contractsHTML());
}

function pricesHTML() {
  const e = state.market.event;
  let html = '<p class="intro small">Selling a lot of one product pushes its price down; it recovers over a few minutes. '
    + 'Rocket parts flood the market fastest. Spread your sales, fill contracts, or truck goods up the chain.</p>';
  if (e && e.until > state.clock) {
    const p = PRODUCTS[e.product];
    html += `<p class="${e.mult > 1 ? 'boom' : 'warn'}">${e.mult > 1 ? '📈 Boom' : '📉 Glut'}: ${p.icon} ${p.name} at ${Math.round(e.mult * 100)}% for ${fmtTime(e.until - state.clock)}</p>`;
  }
  for (const id of PRODUCT_IDS) {
    const P = PRODUCTS[id];
    const d = demandOf(id);
    const price = marketPrice(id);
    const ev = eventMult(id);
    const tag = P.raw ? `raw · supplier ${fmt(supplierCost(id))}` : LAUNCH.needs[id] ? '🚀 rocket part' : 'component';
    const locked = RECIPES[id] && RECIPES[id].research && !hasResearch(RECIPES[id].research);
    html += `<div class="price-row ${locked ? 'locked' : ''}">
      <div class="pr-icon">${P.icon}</div>
      <div class="pr-info"><div class="pr-name">${P.name}</div><div class="pr-tag">${tag}${locked ? ' · 🔒 research' : ''}</div>
        <div class="bar demand"><div style="width:${Math.round(d * 100)}%;background:${d > 0.8 ? '#6fcf97' : d > 0.55 ? '#f2c94c' : '#eb5757'}"></div></div></div>
      <div class="pr-price"><b class="${ev > 1 ? 'pos' : ev < 1 || d < 0.7 ? 'neg' : ''}">${fmt(price)}</b><span>${Math.round(d * ev * 100)}%</span></div>
    </div>`;
  }
  return html;
}

// ---------------- Gem store ----------------
function boostCard(b) {
  let meta = '', label = `${b.cost} 💎`;
  if (b.kind === 'play') {
    const until = state.boosts[b.id] || 0;
    if (until > state.clock) {
      meta = `<span class="pos">Active · ${fmtTime(until - state.clock)} left</span>`;
      label = `+${b.dur / 60}m · ${b.cost}💎`;
    }
  }
  return card(b.icon, b.name, b.desc, meta,
    `<button class="btn gem" data-act="boost" data-id="${b.id}" ${state.gems < b.cost ? 'disabled' : ''}>${label}</button>`);
}

function shopHTML() {
  const pct = Math.round(offlineRate() * 100);
  let html = `<div class="gem-balance">💎 <b>${state.gems}</b> gems</div>
    <p class="intro small">Gems only save time; nothing here unlocks anything you can't get by playing.
    Earn them free from goals (+${GEMS.perObjective}), contracts (+${GEMS.perContract}), a daily bonus (+${GEMS.daily}) and each launch (+${GEMS.perLaunch}).</p>`;

  html += '<h3 class="sec">⚡ While you play</h3>';
  for (const b of BOOSTS.filter((x) => x.kind === 'play')) html += boostCard(b);

  html += '<h3 class="sec">🌙 While you\'re away</h3>';
  html += `<p class="intro small">Normally your sites earn at <b>${pct}%</b> speed while you're offline (up to ${fmtDur(offlineCapSec())}).
    A Night Crew keeps them at <b>100%</b>. Hours are banked and only used while you're actually away.</p>`;
  if (state.awayBoost > 0) html += `<p class="boom">🌙 Banked: ${fmtDur(state.awayBoost)} of full-speed away time</p>`;
  for (const b of BOOSTS.filter((x) => x.kind === 'away')) html += boostCard(b);
  html += card('💰', 'Double offline payout', `Shown on the welcome-back screen: doubles what you earned while away`, '',
    `<button class="btn secondary" disabled>${OFFLINE_DOUBLE_COST} 💎</button>`);

  html += '<h3 class="sec">🛠️ Instant help</h3>';
  for (const b of BOOSTS.filter((x) => x.kind === 'instant')) html += boostCard(b);

  html += '<h3 class="sec">🎨 Cosmetics (coming soon)</h3>';
  for (const c of COSMETICS) html += card(c.icon, c.name, c.desc, '', '<button class="btn secondary" disabled>Soon</button>', 'done');

  html += '<h3 class="sec">💎 Get more gems</h3>';
  html += '<p class="intro small">Gem packs will be sold through the App Store / Google Play once the game ships. Not available in this prototype.</p>';
  html += '<div class="packs">';
  for (const p of GEM_PACKS) {
    html += `<button class="pack" disabled>${p.tag ? `<span class="pack-tag">${p.tag}</span>` : ''}<span class="pack-gems">💎 ${p.gems}</span><span class="pack-price">${p.price}</span></button>`;
  }
  html += '</div>';
  return html;
}

function buyBoost(id) {
  const b = BOOSTS.find((x) => x.id === id);
  if (!b || state.gems < b.cost) return;
  if (id === 'warp') {
    // Use the un-boosted rate so Double Earnings doesn't stack into the warp.
    const gain = Math.max(0, netRate() - (boostActive('double') ? totalRate() / 2 : 0)) * 60;
    if (gain <= 0) { toast('Nothing to warp. Get some income flowing first'); return; }
    state.gems -= b.cost;
    state.money += gain;
    toast(`⏱️ Time Warp: +${fmt(gain)}`);
  } else if (id === 'crew') {
    let fixed = 0;
    for (const def of PROPERTIES) {
      const p = state.props[def.id];
      if (!p.owned) continue;
      for (const row of p.tiles) for (const t of row) {
        if (!t.obj) continue;
        if (t.obj.jammed) fixed++;
        unjam(t.obj);
      }
    }
    state.gems -= b.cost;
    toast(`🧰 Emergency Crew fixed ${fixed} breakdown${fixed === 1 ? '' : 's'} and serviced everything`);
  } else if (b.kind === 'away') {
    state.gems -= b.cost;
    state.awayBoost = (state.awayBoost || 0) + b.hours * 3600; // banks up
    toast(`🌙 Night Crew booked: ${fmtDur(state.awayBoost)} of full-speed away time banked`);
  } else {
    state.gems -= b.cost;
    state.boosts[id] = Math.max(state.boosts[id] || 0, state.clock) + b.dur; // stacks extend time
    toast(`${b.icon} ${b.name} active!`);
  }
  save();
}

// Gems for showing up each day.
function dailyBonus() {
  const today = new Date().toDateString();
  if (state.lastDaily === today) return;
  const first = state.lastDaily == null;
  state.lastDaily = today;
  if (first) return; // the starting gems cover day one
  state.gems += GEMS.daily;
  toast(`📅 Daily bonus: +${GEMS.daily} 💎`);
}

function activeBoostText() {
  const parts = BOOSTS.filter((b) => b.kind === 'play' && boostActive(b.id))
    .map((b) => `${b.icon} ${fmtTime(state.boosts[b.id] - state.clock)}`);
  if (state.awayBoost > 0) parts.push(`🌙 ${Math.round(state.awayBoost / 3600)}h`);
  return parts.join(' ');
}
