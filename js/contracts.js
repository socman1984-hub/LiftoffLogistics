'use strict';
// Contracts: clients post orders ("sell 30 labeled circuit boards in 5 min").
// Completing one pays cash plus ⭐ reputation, which buys research.

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Products you can currently ship: raw material arriving at an open supplier
// dock, or anything an Assembler of yours is set to build.
function availableProducts() {
  const set = new Set();
  for (const def of PROPERTIES) {
    const p = state.props[def.id];
    if (!p.owned) continue;
    for (const d of def.inDocks) {
      if (p.tiles[d.y][d.x].locked || !d.cargo) continue;
      for (const k of Object.keys(d.cargo)) set.add(k);
    }
    for (const row of p.tiles) for (const t of row) if (t.obj && t.obj.k === 'assembler' && t.obj.recipe) set.add(t.obj.recipe);
  }
  return PRODUCT_IDS.filter((k) => set.has(k));
}

function availableReqs(product) {
  const reqs = [null, null, 'scanner', 'labeler'];
  if (hasResearch('wrapper')) reqs.push('wrapper');
  if (PRODUCTS[product].cls === 'cold' && hasResearch('chiller')) reqs.push('chiller', 'chiller');
  return reqs;
}

function shippedPerMin(product) {
  let n = 0;
  for (const s of shipLog) if (s.type === product) n++;
  return n; // shipLog covers the last 60s
}

function makeOffer() {
  const c = state.contracts;
  const products = availableProducts();
  if (!products.length) return null;
  // The very first contract is a gentle one.
  const first = c.done === 0 && c.active.length === 0 && c.offers.length === 0;
  const product = first ? products[0] : pick(products);
  const req = first ? null : pick(availableReqs(product));
  const minutes = first ? 5 : pick([3, 5, 5, 8]);
  const rate = Math.max(shippedPerMin(product), PRODUCTS[product].raw ? 4 : 2);
  const n = first ? 10 : Math.min(2000, Math.max(4, Math.round(rate * minutes * (req ? 0.35 : 0.5))));
  const reward = Math.round(n * PRODUCTS[product].value * (CONTRACT_REQ_MULT[req] || 1) * 2.5 * (1 + rfx('contractReward')));
  const stars = 1 + (req ? 1 : 0) + (minutes === 3 ? 1 : 0) + (PRODUCTS[product].raw ? 0 : 1) + rfx('stars');
  return {
    id: c.nextId++, client: pick(CLIENTS[PRODUCTS[product].cls]), product, req, n, progress: 0,
    minutes, reward, stars, expires: state.clock + OFFER_LIFETIME, deadline: null,
  };
}

function contractLabel(c) {
  const req = c.req ? `${MACHINES[c.req].icon} ${MACHINES[c.req].past} ` : '';
  return `${c.n} ${req}${PRODUCTS[c.product].icon} ${PRODUCTS[c.product].name}`;
}

function tickContracts() {
  const c = state.contracts;
  if (!state.current) return;

  // Offers expire and refill.
  c.offers = c.offers.filter((o) => o.expires > state.clock);
  if (c.offers.length < OFFER_COUNT && state.clock >= c.nextOfferAt) {
    const o = makeOffer();
    if (o) c.offers.push(o);
    c.nextOfferAt = state.clock + (c.offers.length === 1 ? 2 : OFFER_REFILL);
  }

  // Active contracts can run out of time.
  for (const a of c.active) {
    if (state.clock > a.deadline) {
      a.failed = true;
      toast(`❌ ${a.client} contract expired`);
    }
  }
  c.active = c.active.filter((a) => !a.failed);
}

function acceptContract(id) {
  const c = state.contracts;
  if (c.active.length >= contractSlots()) { toast('No free contract slots'); return; }
  const o = c.offers.find((x) => x.id === id);
  if (!o) return;
  c.offers = c.offers.filter((x) => x !== o);
  o.deadline = state.clock + o.minutes * 60;
  c.active.push(o);
  save();
}

function abandonContract(id) {
  const c = state.contracts;
  c.active = c.active.filter((x) => x.id !== id);
  save();
}

function onPackageShipped(it) {
  const c = state.contracts;
  for (const a of c.active) {
    if (a.product !== it.product || (a.req && !it.tags.includes(a.req))) continue;
    a.progress++;
    if (a.progress >= a.n) {
      a.complete = true;
      earn(a.reward, 'contracts', a.client);
      state.rep += a.stars;
      state.gems += GEMS.perContract;
      c.done++;
      toast(`✅ ${a.client}: +${fmt(a.reward)} +${a.stars}⭐ +${GEMS.perContract}💎`);
    }
    break; // a package fills one order
  }
  if (c.active.some((a) => a.complete)) {
    c.active = c.active.filter((a) => !a.complete);
    save();
  }
}
