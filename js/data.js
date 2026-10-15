'use strict';
// Static game data: directions, cargo, buildables, staff, research, properties.

// 0 = up, 1 = right, 2 = down, 3 = left
const DIRS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];
const opposite = (d) => (d + 2) % 4;

// ---- Cargo types ----
const CARGO = {
  standard: { name: 'Standard', icon: '📦', mult: 1, desc: 'Plain boxes. No special handling.' },
  fragile: { name: 'Fragile', icon: '🍷', mult: 1.8, desc: 'Smashes on Express belts unless shrink-wrapped.' },
  cold: { name: 'Cold', icon: '🧊', mult: 2.5, desc: 'Loses value every second until it passes a Chiller.' },
  bulky: { name: 'Bulky', icon: '🛋️', mult: 3, desc: 'Rides at 60% speed and takes machines twice as long.' },
};
const CARGO_IDS = Object.keys(CARGO);
const COLD_DECAY = 0.05; // fraction of value lost per second until chilled
const COLD_FLOOR = 0.3; // never drops below 30% of its fresh value
const BULKY_SPEED = 0.6;

// ---- Conveyors & machines ----
const BELT_TIERS = [
  { name: 'Basic', speed: 1.25, cost: 15, color: '#f2c94c', life: 1800 },
  { name: 'Fast', speed: 2.2, cost: 90, color: '#f2994a', life: 1400 },
  { name: 'Express', speed: 3.6, cost: 400, color: '#56ccf2', life: 1000, research: 'express' },
];

// Machines process a package at the tile centre, then pass it on. Each package
// only gets each machine's bonus once.
// All equipment (belts too) wears out and breaks down after `life` packages
// (randomised ±25%) unless a Maintenance Tech services it first.
const MACHINES = {
  scanner: {
    name: 'Scanner', past: 'scanned', icon: '🔍', color: '#c0392b', cost: 300, time: 0.5, life: 400,
    add: 0.5, // flat bonus: 50% of the product's base price
    desc: () => '+50% of base price (flat bonus)',
  },
  labeler: {
    name: 'Labeler', past: 'labeled', icon: '🏷️', color: '#d4a017', cost: 1500, time: 1.0, life: 300,
    mul: 1.5,
    desc: () => '+50% package value',
  },
  wrapper: {
    name: 'Wrapper', past: 'wrapped', icon: '🎁', color: '#2980b9', cost: 6000, time: 2.0, life: 220,
    mul: 2, research: 'wrapper',
    desc: () => 'x2 value · makes fragile cargo safe',
  },
  chiller: {
    name: 'Chiller', past: 'chilled', icon: '❄️', color: '#48a9c5', cost: 2500, time: 0.6, life: 320,
    mul: 1.3, only: 'cold', research: 'chiller',
    desc: () => 'Stops cold cargo spoiling, +30%',
  },
};
// Value machines can be upgraded with the ⏫ Upgrade tool: faster processing, so they stop capping a busy line.
const MACHINE_LEVELS = [
  { name: 'Mk I', speed: 1 },
  { name: 'Mk II', speed: 1.75, costMult: 3 },
  { name: 'Mk III', speed: 3, costMult: 8, research: 'qc' },
];
// Tapping broken equipment fixes it for a share of its price.
const FIX_FRACTION = { belt: 0.5, other: 0.15 };
const TECH_REPAIR_TIME = 5; // seconds for a tech to fix a breakdown
const TECH_PM_TIME = 3; // seconds for a preventive-maintenance service
const TECH_PM_REST = 6; // seconds a tech rests between services
const PM_THRESHOLD = 0.4; // techs service equipment once it's 40% worn
const EQUIP_PER_TECH = 30; // pieces of equipment one tech can cover

const SPLITTER = { name: 'Splitter', cost: 120, speed: 2.0, life: 2200 };
const SORTER = { name: 'Sorter', cost: 250, speed: 2.0, life: 2200, research: 'sorter', patience: 3 }; // patience: s a package waits at a jammed split exit before taking another
// Unlocked by owning later sites (see `unlock` on TOOLS / FACILITIES).
const BRIDGE = { name: 'Conveyor Bridge', cost: 300, speed: 2.0, life: 2500 }; // lines cross: packages keep going straight
const BUFFER = { name: 'Accumulator', cost: 900, speed: 2.0, life: 1800, cap: 20 }; // holds packages, feeds them out steadily
const SILO = { name: 'Silo', cost: 3000, cap: 100 }; // bulk storage for one product
const BENCH_MAX = 8; // research benches that count
const COBOT_RANGE = 3;
const FAB_RANGE = 2, FAB_SPEED = 0.5;
const DOCK_SPEED = 2.0;
const MACHINE_SPEED = 2.0;
const BASE_TRUCK_INTERVAL = 1.6; // seconds between packages per open IN dock

// ---- Suppliers: who fills each raw-material door (see suppliers.js) ----
// `floor` is the hidden lowest price (share of their list price) they'll sign at.
const SUPPLIER_TIERS = {
  budget: { label: 'Budget', icon: '🏚️', price: 0.8, speed: 0.75, patience: 2, floor: [0.72, 0.86], note: 'cheap, slow and touchy' },
  standard: { label: 'Standard', icon: '🏢', price: 1, speed: 1, patience: 3, floor: [0.78, 0.92], note: 'fair all round' },
  express: { label: 'Express', icon: '🚀', price: 1.25, speed: 1.35, patience: 4, floor: [0.84, 0.96], note: 'fast and patient, but pricey' },
};
const SUPPLIER_TIER_IDS = Object.keys(SUPPLIER_TIERS);
const SUPPLIER_NAMES = {
  steel: ['Rustbelt Scrap', 'Ironclad Metals', 'Rapid Steel Co.'],
  copper: ['Penny Mines', 'Coppertop Supply', 'Volt Express'],
  silicon: ['Sandy Wafers', 'Silica Valley', 'Chipline Overnight'],
  titanium: ['Grey Rock Mining', 'Titan Alloys', 'Aerometal Express'],
  kerosene: ['Barrel Bros.', 'Coastal Fuels', 'Jetstream Energy'],
  lox: ['Chilly Gas Co.', 'Polar Oxygen', 'Cryo Rush'],
  composite: ['Fiber Works', 'Carbon Craft', 'Weave Express'],
  rareearth: ['Deep Dig Minerals', 'Rare Elements Ltd.', 'Prime Earth Couriers'],
  provisions: ['Farmhand Co-op', 'Harvest Wholesale', 'Fresh Freight'],
  default: ['Bargain Freight', 'Reliable Supply', 'Express Freight'],
};
// Longer contracts lower their floor. Tuned so careful haggling lands ~83% of list, an agent ~89%,
// and repeated lowballing ends in a walk-out (playthrough + simulation).
const DEAL_TERMS = [{ min: 10, bonus: 0 }, { min: 30, bonus: 0.02 }, { min: 60, bonus: 0.04 }];
const OFFER_STEPS = [0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
const AGENT_SHARE = 0.55; // a Purchasing Agent closes this much of the gap back up to list price
const AGENT_TERM = 30; // minutes per agent deal
const NEG_COOLDOWN = 180; // seconds a supplier won't talk after walking out

// Tools shown in the toolbar, in order.
const TOOLS = [
  { id: 'repair', name: 'Repair', icon: '🔨', tip: 'Tap or drag over damaged floor to repair it' },
  { id: 'belt', name: 'Conveyor', icon: '➡️', tip: 'Drag to lay conveyors · tap a conveyor to turn it' },
  { id: 'splitter', name: 'Splitter', icon: '🔀', tip: 'Deals packages out across its other sides' },
  { id: 'assembler', name: 'Assembler', icon: '🏭', tip: 'Builds products from ingredients · tap it again to pick a recipe' },
  { id: 'sorter', name: 'Sorter', icon: '🚦', research: 'sorter', tip: 'Pulls one product off the line · tap it again to configure' },
  { id: 'rack', name: 'Rack', icon: '🗄️', tip: 'Storage racks: each tile holds products waiting on trucks' },
  { id: 'silo', name: 'Silo', icon: '🫙', unlock: 'refinery', tip: 'Bulk storage: 100 of one product · tap it to pick which' },
  { id: 'bridge', name: 'Bridge', icon: '🌉', unlock: 'mill', tip: 'Lets two lines cross: packages go straight through it' },
  { id: 'buffer', name: 'Accumulator', icon: '🧺', unlock: 'foundry', tip: `Holds up to 20 packages and feeds them out steadily · out the arrow` },
  { id: 'facility', name: 'Facilities', icon: '🏢', tip: 'Restrooms, break rooms, ops center and more · pick a type' },
  { id: 'scanner', name: 'Scanner', icon: '🔍', tip: 'Tap to place · drag from it to aim its output' },
  { id: 'labeler', name: 'Labeler', icon: '🏷️', tip: 'Tap to place · drag from it to aim its output' },
  { id: 'chiller', name: 'Chiller', icon: '❄️', research: 'chiller', tip: 'Only affects cold cargo · others pass straight through' },
  { id: 'wrapper', name: 'Wrapper', icon: '🎁', research: 'wrapper', tip: 'Slow but doubles value · wrapped fragile cargo is safe' },
  { id: 'upgrade', name: 'Upgrade', icon: '⏫', tip: 'Tap conveyors and value machines (scanner, labeler…) to make them faster' },
  { id: 'rotate', name: 'Rotate', icon: '🔄', tip: 'Tap a conveyor or machine to turn it' },
  { id: 'remove', name: 'Remove', icon: '🗑️', tip: 'Tap or drag to remove (50% refund)' },
];

// Toolbar groups: one row of group buttons; tapping one opens its tools.
const TOOL_GROUPS = [
  { id: 'convey', name: 'Conveyors', icon: '➡️', tools: ['belt', 'splitter', 'sorter', 'bridge', 'buffer', 'upgrade'] },
  { id: 'machines', name: 'Machines', icon: '🏭', tools: ['assembler', 'scanner', 'labeler', 'chiller', 'wrapper'] },
  { id: 'build', name: 'Structures', icon: '🧱', tools: ['repair', 'rack', 'silo', 'facility'] },
  { id: 'edit', name: 'Edit', icon: '✋', tools: ['rotate', 'remove'] },
];

// ---- Per-property building upgrades ----
const UPGRADES = [
  {
    id: 'trucks', name: 'Truck Contracts', icon: '🚚', base: 150, growth: 1.75, max: 10,
    desc: 'Trucks arrive 15% more often',
  },
  {
    id: 'roof', name: 'Roof & Walls', icon: '🏚️', base: 400, growth: 2.2, max: 6,
    desc: '+25% value on every package shipped',
  },
  {
    id: 'power', name: 'Electrical', icon: '⚡', base: 500, growth: 1.9, max: 8,
    desc: "+8 ⚡ power capacity and +5% speed",
  },
];

// ---- Staff (per property, hired by headcount). Wages are per minute per
// person, scaled by property. ----
const STAFF = [
  { id: 'janitor', name: 'Janitor', icon: '🧹', wage: 8, max: 6, desc: 'Cleans dirty floors and buildings. Filthy ones can\'t be used' },
  {
    id: 'tech', name: 'Maintenance Tech', icon: '🔧', wage: 12, max: 6,
    desc: 'Fixes breakdowns for free and services worn equipment before it fails. Keeps offline output up.',
  },
  { id: 'operator', name: 'Assembler Operator', icon: '👷', wage: 10, max: 12, desc: 'Crews an assembler (without one it crawls at 25% speed). Up to 3 per assembler, +50% speed each extra' },
  { id: 'ops', name: 'Operations Manager', icon: '📋', wage: 25, max: 3, research: 'diagnostics', desc: '+10% line speed and +15% rack handling each' },
  { id: 'forklift', name: 'Forklift Operator', icon: '🚜', wage: 15, max: 6, desc: 'Puts products away in the racks and picks them out: +30 moves/min each' },
  { id: 'sales', name: 'Sales Rep', icon: '💼', wage: 25, max: 3, research: 'marketing', desc: '+10% value on packages shipped here, each' },
  { id: 'security', name: 'Security Guard', icon: '🛡️', wage: 10, max: 3, research: 'logistics', desc: 'Each guard halves package theft' },
  { id: 'safety', name: 'Safety Officer', icon: '⛑️', wage: 15, max: 2, research: 'hygiene', desc: 'Each cuts workplace accidents by 75%' },
  { id: 'hr', name: 'HR Manager', icon: '🗂️', wage: 20, max: 1, research: 'wellness', desc: 'Everyone else here costs 20% less in wages' },
  { id: 'buyer', name: 'Purchasing Agent', icon: '🧾', wage: 18, max: 1, research: 'negotiation', desc: 'Renews supplier deals at this site\'s doors automatically. Settles for less than you could get yourself' },
];
const STAFF_BY_ID = Object.fromEntries(STAFF.map((s) => [s.id, s]));
const HIRE_FEE_MINUTES = 10; // signing fee = 10 minutes of wages
// Specialists you can get away without at first: once a site is big enough (and the role is researched),
// going without one slowly makes things worse. Hiring calms it back down (3x faster than it built up).
const STAFF_NEEDS = {
  security: { minStaff: 4, rise: 1 / 2700, alt: 'securitybooth', label: '🦹 Thieves are getting bolder', tip: 'hire a 🛡️ Security Guard or build a Security Booth', effect: (v) => `theft ×${(1 + NEGLECT.theftMult * v).toFixed(1)}${v >= NEGLECT.breakInAt ? ', break-ins' : ''}` },
  safety: { minStaff: 6, rise: 1 / 3600, label: '🚑 Safety corners are being cut', tip: 'hire a ⛑️ Safety Officer', effect: (v) => `accidents ×${(1 + NEGLECT.accidentMult * v).toFixed(1)}${v >= NEGLECT.fineAt ? ', inspector fines' : ''}` },
  hr: { minStaff: 10, rise: 1 / 5400, label: '🗂️ Grievances are piling up', tip: 'hire an 🗂️ HR Manager', effect: (v) => `morale −${Math.round(NEGLECT.moraleHit * v * 100)}%` },
};
const NEGLECT = {
  fall: 3, // recovers this many times faster once covered
  theftMult: 3, breakInAt: 0.5, breakInPerMin: 0.1, breakInShare: 0.25, // security
  accidentMult: 3, fineAt: 0.5, fineMinutes: 6, // safety: fine = minutes of the site's wages
  moraleHit: 0.2, // HR
  alertAt: 0.25,
};
// Accidents: chance per staff member per minute; halts the building.
const ACCIDENT_RATE = 0.012;
const ACCIDENT_SHUTDOWN = 20; // seconds

// ---- Research (global, paid in ⭐ reputation from contracts) ----
// ---- Research: five branches, each a tree over 5 tiers ----
// A node needs everything in `req` (which may sit in another branch), costs
// ⭐ reputation plus cash, and takes time in the lab (one project at a time).
// `fx` effects add up across everything researched (see rfx()).
const RESEARCH_BRANCHES = [
  { id: 'prod', name: 'Production', icon: '🏭', desc: 'Faster lines, assemblers and new machines' },
  { id: 'ops', name: 'Operations', icon: '🔧', desc: 'Equipment, power and people' },
  { id: 'logi', name: 'Logistics', icon: '🚚', desc: 'Trucks, suppliers and storage' },
  { id: 'biz', name: 'Business', icon: '💼', desc: 'Contracts, prices and earnings' },
  { id: 'aero', name: 'Aerospace', icon: '🚀', desc: 'Rocket technology' },
  { id: 'colony', name: 'Colony', icon: '🔴', desc: 'Mars: needs, rockets and output (unlocks after your first launch)' },
];
// Default cost by tier: [⭐, $, seconds in the lab].
// Tuned by bot playthroughs: tier 1 lands in the first half hour, the whole
// tree takes ~24 hours of lab time (it keeps running while you're away).
// ⭐ rises steeply at tiers 3–5: a playthrough ended with 333⭐ unspent, so reputation is the late-game gate.
const RESEARCH_TIER_COST = [null, [2, 1500, 60], [5, 8000, 300], [18, 35000, 1200], [36, 120000, 2700], [60, 400000, 7200]];
const LAUNCH_STARS = 15; // ⭐ reputation per rocket launch
const RUSH_SECS_PER_GEM = 180; // 💎 to finish research now: 1 per 3 minutes left

const R = (b, t, c, id, icon, name, desc, req = [], fx = {}, cost) => ({ b, t, c, id, icon, name, desc, req, fx, ...(cost || {}) });
const RESEARCH = [
  // 🏭 Production
  R('prod', 1, 0, 'motors1', '⚙️', 'Tuned Motors', 'Belts and machines run 8% faster', [], { speed: 0.08 }),
  R('prod', 1, 1, 'sorter', '🚦', 'Sorting Systems', 'Unlocks the Sorter: pull one product or cargo type off a line', [], {}, { cost: 1, money: 500, time: 30 }),
  R('prod', 1, 2, 'wrapper', '🎁', 'Shrink Wrapping', 'Unlocks the Wrapper: ×2 value, protects fragile cargo'),
  R('prod', 2, 0, 'express', '💨', 'Express Belts', 'Unlocks Express conveyor upgrades', ['motors1']),
  R('prod', 2, 1, 'fastassembly', '🦾', 'Robotic Assembly', 'Assemblers work 20% faster', ['sorter'], { assembly: 0.2 }),
  R('prod', 2, 2, 'chiller', '❄️', 'Cold Chain', 'Unlocks the Chiller for cold cargo', ['wrapper']),
  R('prod', 3, 0, 'padding', '🫧', 'Air-Cushion Packing', 'Fragile cargo no longer breaks on Express belts', ['express']),
  R('prod', 3, 1, 'assembly2', '🏗️', 'Assembly Line II', 'Assemblers work another 20% faster', ['fastassembly'], { assembly: 0.2 }),
  R('prod', 3, 2, 'insulated', '🧤', 'Insulated Belts', 'Cold cargo spoils half as fast', ['chiller'], { coldDecay: 0.5 }),
  R('prod', 4, 0, 'motors2', '🏎️', 'High-Torque Motors', 'Belts and machines run another 12% faster', ['padding'], { speed: 0.12 }),
  R('prod', 4, 1, 'qc', '✅', 'Quality Control', '+10% value on every package', ['assembly2', 'wrapper'], { value: 0.1 }),
  R('prod', 4, 2, 'cryo', '🧊', 'Cryogenic Lines', 'Cold cargo barely spoils (stacks with Insulated Belts)', ['insulated'], { coldDecay: 0.4 }),
  R('prod', 5, 1, 'automation', '🤖', 'Full Automation', 'Assemblers +25% faster, and run at 60% (not 25%) with no crew', ['motors2', 'qc'], { assembly: 0.25, uncrewed: 0.6 }),
  // 🔧 Operations
  R('ops', 1, 0, 'maint', '🛠️', 'Heavy-Duty Parts', 'Equipment lasts 50% longer between breakdowns', [], { life: 0.5 }),
  R('ops', 1, 1, 'efficiency', '🔌', 'Efficient Motors', 'Machines draw 15% less power', [], { power: 0.15 }),
  R('ops', 1, 2, 'hygiene', '🧽', 'Easy-Clean Floors', 'Floors and buildings get dirty 25% slower', [], { dirt: 0.25 }),
  R('ops', 2, 0, 'diagnostics', '🩺', 'Diagnostics', 'Technicians fix breakdowns 50% faster', ['maint'], { repair: 0.5 }),
  R('ops', 2, 1, 'efficiency2', '💡', 'LED Lighting', 'Machines draw another 15% less power', ['efficiency'], { power: 0.15 }),
  R('ops', 2, 2, 'wellness', '🧘', 'Wellness Program', '+5% morale at every site', ['hygiene'], { morale: 0.05 }),
  R('ops', 3, 0, 'maint2', '⛓️', 'Industrial Parts', 'Equipment lasts another 50% longer', ['diagnostics'], { life: 0.5 }),
  R('ops', 3, 1, 'powergrid', '⚡', 'Smart Grid', '+25% power capacity at every site', ['efficiency2'], { powerCap: 0.25 }),
  R('ops', 3, 2, 'lean', '📉', 'Lean Operations', 'Staff wages -15%', ['wellness'], { wage: 0.15 }),
  R('ops', 4, 0, 'predictive', '📈', 'Predictive Maintenance', 'Equipment lasts 50% longer and repairs go 50% faster', ['maint2'], { life: 0.5, repair: 0.5 }),
  R('ops', 4, 1, 'safety', '🦺', 'Safety Culture', 'Half as many workplace accidents', ['powergrid', 'wellness'], { accident: 0.5 }),
  R('ops', 4, 2, 'lean2', '🎯', 'Six Sigma', 'Staff wages another -15%', ['lean'], { wage: 0.15 }),
  R('ops', 5, 1, 'cobots', '🦿', 'Cobots', '+10% speed and +5% morale at every site', ['predictive', 'lean2'], { speed: 0.1, morale: 0.05 }),
  // 🚚 Logistics
  R('logi', 1, 0, 'logistics', '🗺️', 'Logistics Network', 'Supplier trucks arrive 10% more often', [], { truckRate: 0.1 }),
  R('logi', 1, 1, 'forklift', '🚜', 'Forklift Training', 'Rack crews handle 25% more moves', [], { handling: 0.25 }),
  R('logi', 1, 2, 'routing', '🧭', 'Route Planning', 'Trucks between your sites drive 15% faster', [], { travel: 0.15 }),
  R('logi', 2, 0, 'logistics2', '📑', 'Supplier Contracts', 'Supplier trucks arrive another 10% more often', ['logistics'], { truckRate: 0.1 }),
  R('logi', 2, 1, 'pallet', '🛒', 'Pallet Jacks', 'Rack crews handle another 25% more moves', ['forklift'], { handling: 0.25 }),
  R('logi', 2, 2, 'fleet', '🚛', 'Semi Trailers', 'Trucks between your sites carry 50% more', ['routing'], { fleetCap: 0.5 }),
  R('logi', 3, 0, 'suppliers', '🤝', 'Supplier Network', 'Raw materials cost 20% less', ['logistics2'], { supplier: 0.2 }),
  R('logi', 3, 1, 'wms', '🖥️', 'Warehouse Software', 'Rack crews handle 50% more moves', ['pallet'], { handling: 0.5 }),
  R('logi', 3, 2, 'gps', '📍', 'GPS Dispatch', 'Trucks between your sites drive another 15% faster', ['fleet'], { travel: 0.15 }),
  R('logi', 4, 0, 'bulkraw', '📦', 'Bulk Freight', 'Raw materials 10% cheaper and supplier trucks 10% more often', ['suppliers'], { supplier: 0.1, truckRate: 0.1 }),
  R('logi', 4, 1, 'cameras', '📹', 'Security Cameras', 'Half as much theft at every site', ['wms'], { theft: 0.5 }),
  R('logi', 4, 2, 'doubletrail', '🚚', 'Double Trailers', 'Trucks between your sites carry another 50% more', ['gps'], { fleetCap: 0.5 }),
  R('logi', 5, 1, 'hub', '🌐', 'Logistics Hub', 'Supplier trucks 15% more often and site-to-site trips 20% faster', ['bulkraw', 'doubletrail'], { truckRate: 0.15, travel: 0.2 }),
  // 💼 Business
  R('biz', 1, 0, 'slots1', '👔', 'Account Manager', '+1 active contract slot', [], { slots: 1 }),
  R('biz', 1, 1, 'bulk', '🏷️', 'Bulk Purchasing', 'Building and upgrades 10% cheaper', [], { discount: 0.1 }),
  R('biz', 1, 2, 'marketing', '📣', 'Marketing', '+5% value on every package', [], { value: 0.05 }),
  R('biz', 2, 0, 'negotiation', '🗣️', 'Negotiation', 'New contract offers pay 20% more', ['slots1'], { contractReward: 0.2 }),
  R('biz', 2, 1, 'bulk2', '🧾', 'Volume Deals', 'Building and upgrades another 10% cheaper', ['bulk'], { discount: 0.1 }),
  R('biz', 2, 2, 'premium', '💎', 'Premium Clients', '+10% value on every package', ['marketing'], { value: 0.1 }),
  R('biz', 3, 0, 'slots2', '🏢', 'Sales Department', '+1 active contract slot', ['negotiation'], { slots: 1 }),
  R('biz', 3, 1, 'nightshift', '🌙', 'Night Shift', 'Offline earnings +7.5% and last 2 hours longer', ['bulk2'], { offline: 0.075, offlineHours: 2 }),
  R('biz', 3, 2, 'brand', '🏆', 'Brand Recognition', '+10% value on every package', ['premium'], { value: 0.1 }),
  R('biz', 4, 0, 'prestige', '🎩', 'Prestige Clients', '+1 ⭐ from every contract', ['slots2'], { stars: 1 }),
  R('biz', 4, 1, 'nightshift2', '🌃', 'Night Managers', 'Offline earnings another +7.5% and 2 more hours', ['nightshift'], { offline: 0.075, offlineHours: 2 }),
  R('biz', 4, 2, 'export', '🌍', 'Export Markets', 'Selling lowers market prices 40% less', ['brand'], { marketDrop: 0.4 }),
  R('biz', 5, 1, 'enterprise', '📊', 'Enterprise Sales', '+1 contract slot and offers pay another 25% more', ['prestige', 'export'], { slots: 1, contractReward: 0.25 }),
  // 🚀 Aerospace (opens once Production can assemble at speed)
  R('aero', 1, 1, 'aerospace', '🔭', 'Aerospace Program', 'Opens rocket-tech research', ['fastassembly'], {}, { cost: 4, money: 8000, time: 180 }),
  R('aero', 2, 0, 'propulsion', '🔥', 'Propulsion', 'Unlocks Turbopump and Rocket Engine recipes', ['aerospace']),
  R('aero', 2, 2, 'guidance', '🛰️', 'Guidance Systems', 'Unlocks Sensor Array, Flight Computer and Avionics recipes', ['aerospace']),
  R('aero', 3, 0, 'thermal', '🌡️', 'Thermal Protection', 'Unlocks the Heat Shield recipe', ['propulsion']),
  R('aero', 3, 1, 'habitat', '🫁', 'Crew Habitat', 'Unlocks the Life Support Unit recipe', ['guidance']),
  R('aero', 3, 2, 'photovoltaics', '☀️', 'Photovoltaics', 'Unlocks the Solar Array recipe', ['guidance']),
  R('aero', 4, 1, 'flighttest', '🧪', 'Flight Testing', '+50% ⭐ reputation from rocket launches', ['thermal', 'habitat'], { launchStars: 0.5 }),
  R('aero', 5, 1, 'reusable', '♻️', 'Reusable Boosters', 'Each rocket needs 20% fewer parts', ['flighttest', 'photovoltaics'], { launchParts: 0.2 }),
  // 🔴 Colony: the late-game sink for reputation and cash (open after the first launch)
  R('colony', 1, 0, 'hydroponics', '🥬', 'Hydroponics', 'Colonists need 15% less food', [], { marsFood: 0.15 }, { cost: 20, money: 300000, time: 600 }),
  R('colony', 1, 1, 'robotics', '🤖', 'Repair Drones', 'Modules need 25% fewer spares and get built 50% faster', [], { marsSpares: 0.25, marsBuild: 0.5 }, { cost: 20, money: 300000, time: 600 }),
  R('colony', 1, 2, 'recyclers', '♻️', 'Water Recyclers', 'Colonists need 15% less water and oxygen', [], { marsWater: 0.15 }, { cost: 20, money: 300000, time: 600 }),
  R('colony', 2, 0, 'domes2', '🏘️', 'Expanded Habitats', 'Each Habitat Dome holds 1 more colonist', ['hydroponics'], { marsCap: 1 }, { cost: 40, money: 800000, time: 1200 }),
  R('colony', 2, 1, 'heavylift', '🏋️', 'Heavy-Lift Rockets', '+8 cargo slots on every Mars rocket', ['robotics'], { marsSlots: 8 }, { cost: 40, money: 800000, time: 1200 }),
  R('colony', 2, 2, 'transit', '🛸', 'Ion Transit', 'Rockets reach Mars 30% faster', ['recyclers'], { marsTransit: 0.3 }, { cost: 40, money: 800000, time: 1200 }),
  R('colony', 3, 0, 'refining', '🔥', 'Rare Metal Refining', 'Colonists dig 50% more Rare Metals', ['domes2'], { marsMetals: 0.5 }, { cost: 70, money: 2000000, time: 2400 }),
  R('colony', 3, 1, 'rapidpad', '⏱️', 'Rapid Pad Turnaround', 'The launch pad resets 30 seconds faster', ['heavylift'], { marsTurn: 30 }, { cost: 70, money: 2000000, time: 2400 }),
  R('colony', 3, 2, 'medbay', '🩺', 'Colony Medicine', 'Rationing and sickness cost a quarter less output', ['transit'], { marsRation: 0.25 }, { cost: 70, money: 2000000, time: 2400 }),
  R('colony', 4, 1, 'fusion', '⚛️', 'Fusion Power', 'Unlocks the Fusion Core recipe and the Fusion Reactor module', ['refining'], {}, { cost: 110, money: 4000000, time: 3600 }),
  R('colony', 5, 1, 'terraform', '🌍', 'Terraforming Studies', 'Colonists make 25% more reputation and Rare Metals', ['fusion', 'rapidpad'], { marsOutput: 0.25 }, { cost: 180, money: 8000000, time: 7200 }),
];
for (const r of RESEARCH) {
  // Nodes that open up a job say so.
  const job = STAFF.find((st) => st.research === r.id);
  if (job) r.desc += ` · unlocks the ${job.icon} ${job.name} job`;
  const [cost, money, time] = RESEARCH_TIER_COST[r.t];
  if (r.cost == null) r.cost = cost;
  if (r.money == null) r.money = money;
  if (r.time == null) r.time = time;
}
const RESEARCH_BY_ID = Object.fromEntries(RESEARCH.map((r) => [r.id, r]));

// ---- Contracts ----
const CLIENTS = {
  standard: ['MegaMart', 'Bargain Bin', 'Corner Store Co.', 'Paper & Pulp'],
  fragile: ['Glassworks Co.', 'Fine China Ltd.', 'Vino Imports'],
  cold: ['FrostBite Foods', 'Polar Pops', 'Fresh Catch Seafood'],
  bulky: ['Comfy Couches', 'Big Box Appliances', 'Oak & Iron Furniture'],
};
const CONTRACT_REQ_MULT = { scanner: 1.3, labeler: 1.6, wrapper: 2.2, chiller: 1.5 };
const OFFER_COUNT = 3;
const OFFER_LIFETIME = 180; // seconds an unaccepted offer stays on the board
const OFFER_REFILL = 20; // seconds between new offers
const CONTRACT_REFRESH_GEMS = 3; // swap all offers for new ones

// ---- Products: what's on the belts ----
// `cls` is the handling class (see CARGO). Raw materials arrive by truck from
// suppliers, who charge `cost` per package; everything else is made in
// Assemblers. `value` is the base vendor price (the market moves it).
const PRODUCTS = {
  // Raw materials
  steel: { name: 'Steel Sheet', icon: '🔩', cls: 'standard', value: 4, cost: 2, raw: true },
  copper: { name: 'Copper Coil', icon: '🪙', cls: 'standard', value: 5, cost: 2.5, raw: true },
  silicon: { name: 'Silicon Wafer', icon: '💿', cls: 'fragile', value: 12, cost: 6, raw: true },
  titanium: { name: 'Titanium Billet', icon: '🥈', cls: 'standard', value: 18, cost: 9, raw: true },
  kerosene: { name: 'RP-1 Kerosene', icon: '⛽', cls: 'standard', value: 20, cost: 10, raw: true },
  lox: { name: 'Liquid Oxygen', icon: '🧊', cls: 'cold', value: 25, cost: 12, raw: true },
  composite: { name: 'Carbon Composite', icon: '🧱', cls: 'bulky', value: 40, cost: 20, raw: true },
  rareearth: { name: 'Rare Earth', icon: '💠', cls: 'fragile', value: 45, cost: 22, raw: true },
  // Components
  panel: { name: 'Hull Panel', icon: '🔲', cls: 'standard', value: 12 },
  wiring: { name: 'Wiring Harness', icon: '🧵', cls: 'standard', value: 14 },
  circuit: { name: 'Circuit Board', icon: '📟', cls: 'fragile', value: 40 },
  alloy: { name: 'Alloy Plate', icon: '🟦', cls: 'standard', value: 50 },
  valve: { name: 'Valve Assembly', icon: '🚰', cls: 'standard', value: 80 },
  sensor: { name: 'Sensor Array', icon: '📡', cls: 'fragile', value: 130 },
  computer: { name: 'Flight Computer', icon: '💻', cls: 'fragile', value: 260 },
  turbopump: { name: 'Turbopump', icon: '🌀', cls: 'bulky', value: 230 },
  // Rocket parts
  tank: { name: 'Fuel Tank', icon: '🛢️', cls: 'bulky', value: 90 },
  fuselage: { name: 'Fuselage Section', icon: '🛡️', cls: 'bulky', value: 100 },
  fuel: { name: 'Propellant Load', icon: '🧪', cls: 'cold', value: 120 },
  engine: { name: 'Rocket Engine', icon: '🔥', cls: 'bulky', value: 520 },
  avionics: { name: 'Avionics Suite', icon: '🛰️', cls: 'fragile', value: 480 },
  heatshield: { name: 'Heat Shield', icon: '🌡️', cls: 'bulky', value: 260 },
  lifesupport: { name: 'Life Support Unit', icon: '🫁', cls: 'fragile', value: 520 },
  solar: { name: 'Solar Array', icon: '☀️', cls: 'fragile', value: 300 },
  // Mars supplies (after the first launch)
  provisions: { name: 'Provisions', icon: '🌾', cls: 'cold', value: 8, cost: 4, raw: true },
  foodcrate: { name: 'Food Crate', icon: '🍞', cls: 'standard', value: 70 },
  canister: { name: 'Water/O₂ Canister', icon: '💧', cls: 'cold', value: 140 },
  spares: { name: 'Spares Kit', icon: '🔧', cls: 'standard', value: 170 },
  medkit: { name: 'Medical Kit', icon: '💊', cls: 'fragile', value: 260 },
  powercell: { name: 'Power Cell', icon: '🔋', cls: 'standard', value: 700 },
  // From Mars
  raremetal: { name: 'Rare Metals', icon: '🪨', cls: 'bulky', value: 4000, raw: true, mars: true },
  fusioncore: { name: 'Fusion Core', icon: '⚛️', cls: 'fragile', value: 15000 },
  superconductor: { name: 'Superconductor', icon: '🧲', cls: 'fragile', value: 6000 },
};
const PRODUCT_IDS = Object.keys(PRODUCTS);

// Assembler recipes, keyed by output product.
const RECIPES = {
  panel: { in: { steel: 2 }, time: 2 },
  wiring: { in: { copper: 2 }, time: 2 },
  circuit: { in: { silicon: 1, wiring: 1 }, time: 3 },
  alloy: { in: { titanium: 1, steel: 1 }, time: 3 },
  valve: { in: { alloy: 1, panel: 1 }, time: 3 },
  sensor: { in: { rareearth: 1, circuit: 1 }, time: 4, research: 'guidance' },
  computer: { in: { circuit: 2, sensor: 1 }, time: 5, research: 'guidance' },
  turbopump: { in: { alloy: 2, valve: 1 }, time: 5, research: 'propulsion' },
  tank: { in: { panel: 2, lox: 1 }, time: 4 },
  fuselage: { in: { panel: 2, composite: 1 }, time: 4 },
  fuel: { in: { kerosene: 2, lox: 1 }, time: 3 },
  engine: { in: { turbopump: 1, valve: 1, composite: 1 }, time: 6, research: 'propulsion' },
  avionics: { in: { computer: 1, sensor: 1, wiring: 1 }, time: 5, research: 'guidance' },
  heatshield: { in: { composite: 2, alloy: 1 }, time: 5, research: 'thermal' },
  lifesupport: { in: { lox: 1, computer: 1, wiring: 1 }, time: 5, research: 'habitat' },
  solar: { in: { silicon: 2, wiring: 1, alloy: 1 }, time: 5, research: 'photovoltaics' },
  foodcrate: { in: { provisions: 3, panel: 1 }, time: 3 },
  canister: { in: { lox: 2, alloy: 1 }, time: 3 },
  spares: { in: { valve: 1, circuit: 1, wiring: 1 }, time: 4 },
  medkit: { in: { sensor: 1, provisions: 2 }, time: 3 },
  powercell: { in: { solar: 2, circuit: 1 }, time: 4 },
  fusioncore: { in: { raremetal: 2, computer: 1, alloy: 2 }, time: 8, research: 'fusion' },
  superconductor: { in: { raremetal: 1, wiring: 2 }, time: 5, research: 'refining' },
};
const RECIPE_IDS = Object.keys(RECIPES);
const ASSEMBLER = { name: 'Assembler', cost: 400, life: 500, bufferRecipes: 2 };

const recipeText = (id) => Object.entries(RECIPES[id].in)
  .map(([p, n]) => `${n > 1 ? n + '× ' : ''}${PRODUCTS[p].icon}`).join(' + ');

// ---- Enterprise: map, trucking between sites, the rocket ----
// Map coordinates (viewBox 100 × 70).
const MAP_POS = {
  shed: { x: 9, y: 58 },
  mill: { x: 22, y: 25 },
  foundry: { x: 37, y: 52 },
  depot: { x: 50, y: 21 },
  refinery: { x: 61, y: 55 },
  lab: { x: 74, y: 30 },
  hub: { x: 89, y: 13 },
  launch: { x: 90, y: 57 },
};
const TRAVEL_PER_UNIT = 0.8; // seconds of truck travel per map unit
const TRUCK_CAP = 20; // products per truck
const TRUCK_BASE_COST = 2000;
const TRUCK_COST_GROWTH = 1.25; // each truck you own makes the next one 25% dearer
// Departure rules a route can use: seconds a part-loaded truck waits (null = only when full).
const TRUCK_WAITS = [
  { id: 'asap', label: 'ASAP', wait: 3 },
  { id: '10s', label: '10s', wait: 10 },
  { id: '30s', label: '30s', wait: 30 },
  { id: 'full', label: 'When full', wait: null },
];
const CAP_STEPS = [0, 10, 25, 50, 100, 250, 500, 1000]; // 0 = no cap
// 🔗 Supply network: a site keeps this many of an ingredient per unit its assemblers use per craft
// (at least minStock) in hand or on the way, all together using at most rackShare of its racks...
const NETWORK = { stockPerInput: 8, minStock: 6, rackShare: 0.5, strandedAfter: 60, lightLoad: 1 / 3, lightWait: 30 }; // ...cargo left this many seconds with no truck means "buy another"; a truck under a third full waits up to 30 s
// Storage: products waiting for a truck (or held for a full destination)
// sit on racks. When the racks are full, the SHIP doors stop taking them.
// Incoming goods (waiting at a receiving dock) use the racks too.
// Racks are tiles you build; each one upgrades on its own (see RACK.levels).
const STORAGE_BASE = 10; // staging space by the docks, no racks needed
const RACK = { cost: 150, slots: 15, perLevel: 5 };
// Each rack upgrades on its own: capacity by level, upgrade price as a
// multiple of the rack's build price.
RACK.levels = [15, 25, 35, 50];
RACK.upMult = [0, 2, 3.5, 5];
const rackCapOf = (o) => (o.silo ? SILO.cap : RACK.levels[(o.lvl || 1) - 1]);

// ---- Facilities: one-tile buildings for your staff ----
const FACILITIES = {
  restroom: {
    name: 'Restroom', icon: '🚻', color: '#4a6fa5', cost: 250, power: 0, rangeTint: '74,111,165',
    desc: 'Covers staff working within its range. Uncovered staff hurt morale.',
    levels: [{ range: 4, cap: 6, speed: 1 }, { range: 6, cap: 9, speed: 1.35 }, { range: 9, cap: 12, speed: 1.8 }],
  },
  breakroom: {
    name: 'Break Room', icon: '☕', color: '#8d6e63', cost: 350, power: 1, rangeTint: '141,110,99',
    desc: 'Covers staff working within its range. Keeps morale up.',
    levels: [{ range: 4, cap: 8, speed: 1 }, { range: 6, cap: 12, speed: 1.35 }, { range: 9, cap: 16, speed: 1.8 }],
  },
  opscenter: { name: 'Operations Center', icon: '🖥️', color: '#37474f', cost: 3000, power: 3, max: 1, research: 'diagnostics', desc: '+25% rack handling and +10% line speed (1 per site)' },
  firstaid: { name: 'First Aid Station', icon: '🩹', color: '#c0392b', cost: 1500, power: 1, research: 'hygiene', desc: 'Halves accidents; accidents stop work for 10s instead of 20s' },
  securitybooth: { name: 'Security Booth', icon: '🛡️', color: '#2c3e50', cost: 1200, power: 1, research: 'logistics', desc: 'Halves package theft (stacks with guards)' },
  maintshop: { name: 'Maintenance Shop', icon: '🔧', color: '#7f8c8d', cost: 2500, power: 2, research: 'maint', desc: 'Techs repair twice as fast and service gear more often' },
  generator: { name: 'Generator', icon: '🔌', color: '#b7950b', cost: 2000, power: -12, outside: true, research: 'efficiency', desc: '+12 ⚡ power capacity. Built outside, on the building\'s outer wall' },
  crane: { name: 'Loading Crane', icon: '🏗️', color: '#d35400', cost: 4000, power: 4, outside: true, unlock: 'depot', research: 'forklift', desc: '+50% rack handling here: trucks load and unload faster, forklifts are freed up. Built outside, on the outer wall' },
  bench: { name: 'Research Bench', icon: '🧪', color: '#16a085', cost: 6000, power: 3, unlock: 'lab', research: 'fastassembly', desc: `+25% research speed for every bench you own, at any site (up to ${BENCH_MAX})` },
  cargocenter: { name: 'Spaceport Cargo Center', icon: '📦', color: '#1f618d', cost: 20000, power: 5, max: 1, unlock: 'hub', onlySite: 'hub', research: 'heavylift', desc: 'Packs Mars cargo: +10 cargo slots per rocket and the pad resets 30 s faster. Built at the Mega Hub' },
  cobot: { name: 'Cobot Station', icon: '🦾', color: '#5d6d7e', cost: 8000, power: 4, unlock: 'hub', research: 'automation', desc: `A robot arm that counts as one extra crew member at every assembler within ${COBOT_RANGE} tiles. No wages, no breaks` },
  fabcell: { name: 'Precision Fab Cell', icon: '⚙️', color: '#6c3483', cost: 6000, power: 6, unlock: 'lab', research: 'automation', desc: `Tooling and jigs: assemblers within ${FAB_RANGE} tiles work ${FAB_SPEED * 100}% faster (one cell per assembler counts)` },
};
const FACILITY_IDS = Object.keys(FACILITIES);
for (const r of RESEARCH) {
  const facs = FACILITY_IDS.filter((k) => FACILITIES[k].research === r.id);
  if (facs.length) r.desc += ` · unlocks ${facs.map((k) => `${FACILITIES[k].icon} ${FACILITIES[k].name}`).join(', ')}`;
}
// Locked until its research is done (and, for some, until you own the site that unlocks it).
const facLockReason = (f) => (f.unlock && !unlockedBy(f.unlock) ? `Buy the ${PROP_BY_ID[f.unlock].name} to unlock`
  : f.research && !hasResearch(f.research) ? `🔬 Research ${RESEARCH_BY_ID[f.research].icon} ${RESEARCH_BY_ID[f.research].name} to unlock` : null);
// Owning a site unlocks its new buildings everywhere.
const unlockedBy = (site) => !site || (typeof state !== 'undefined' && state && state.props[site] && state.props[site].owned);
const UNLOCK_LIST = (site) => [
  ...TOOLS.filter((t) => t.unlock === site).map((t) => ({ icon: t.icon, name: t.name === 'Bridge' ? 'Conveyor Bridge' : t.name, desc: t.tip })),
  ...Object.values(FACILITIES).filter((f) => f.unlock === site).map((f) => ({ icon: f.icon, name: f.name, desc: f.desc })),
];
const FAC_UPGRADE_MULT = [0, 2, 4]; // upgrade to level 2 costs 2× the build price, level 3 costs 4×
const facLevel = (o) => FACILITIES[o.k].levels[(o.lvl || 1) - 1];
// ---- Dirt: floors get dirty from foot traffic, buildings from use / time ----
const DIRT = {
  perStep: 1.2, // floor dirt per worker step onto an empty floor tile
  perBreak: 9, // restroom / break room dirt per break taken there
  perSecond: 0.25, // other buildings get dirty slowly over time
  dirty: 60, // stains show
  filthy: 100, // unusable: floor blocks walking, buildings stop working
  cleanRate: 30, // dirt a janitor removes per second
  stain: 20, // stains become visible from here
  worthCleaning: 15, // janitors clean anything this dirty (below the visible-stain level)
};
// ---- Morale: low morale slows staff down and eventually makes them quit ----
const MORALE = {
  restroom: 0.3, // max penalty for staff without restroom coverage
  breakroom: 0.15,
  unpaid: 0.55, // not getting paid makes people leave
  accident: 0.15, // fades over accidentFade seconds
  accidentFade: 120,
  perFilthy: 0.02, // per filthy floor tile, up to filthyMax
  filthyMax: 0.15,
  hrBonus: 0.1,
  min: 0.2,
  warn: 0.7, // warning alert below this
  quit: 0.5, // below this, someone quits every quitAfter seconds
  quitAfter: 45,
};
// Site pay rate: paying above standard costs more and lifts morale.
const PAY_RATES = [
  { label: 'Standard', mult: 1, morale: 0 },
  { label: '+15%', mult: 1.15, morale: 0.05 },
  { label: '+30%', mult: 1.3, morale: 0.1 },
  { label: '+50%', mult: 1.5, morale: 0.15 },
];
const MAX_CREW = 3; // operators per assembler; each extra adds CREW_BONUS speed
const NO_CREW_SPEED = 0.25; // an assembler nobody runs still limps along (no soft-locks)
const CREW_BONUS = 0.5;
const STAFF_PER_RESTROOM = 6;
const STAFF_PER_BREAKROOM = 8;
// Rack handling: every put-away or pick is one "move". A site manages
// HANDLING_BASE moves/min alone; Forklift Operators add more.
const HANDLING_BASE = 10;
const FORKLIFT_CARRY = 10; // products a forklift brings an assembler from storage in one trip (one handling move)
const HANDLING_PER_OP = 30;
const HANDLING_BURST = 8; // moves that can bank up while handlers are idle

// The rocket is built in stages; parts fill the stages in order.
const LAUNCH = {
  id: 'launch', name: 'Launch Site', emoji: '🚀', price: 8000000,
  desc: 'A launch pad in the desert. Deliver every stage\'s parts, then light the candle.',
  stages: [
    { name: 'Booster Stage', icon: '🔥', needs: { fuselage: 8, tank: 6, engine: 5, fuel: 12 } },
    { name: 'Upper Stage', icon: '🛰️', needs: { fuselage: 4, tank: 2, engine: 1, avionics: 2, fuel: 4 } },
    { name: 'Crew Capsule', icon: '👨‍🚀', needs: { heatshield: 4, lifesupport: 2, avionics: 2, solar: 4 } },
  ],
  growth: 2, // each later rocket needs this many times more parts
};
// ---- Mars colony (after the first launch; see mars.js) ----
const MARS = {
  windowEvery: 1500, windowOpen: 300, transit: 360, firstWindow: 240, // seconds of play
  slots: 30, slotModule: 12, slotColonist: 2, perHabitat: 5, padRockets: 2, // the pad stocks parts for this many rockets
  solarPower: 3, foodPerColonist: 0.4, waterPerColonist: 0.4, sparesPerModule: 0.25,
  starsPerColonist: 1, metalsPerColonist: 2, metalValue: 4000,
  rationsBeforeLeaving: 3, minColonists: 2,
  dustChance: 0.15, requestChance: 0.5,
  emergencyGems: 25, repairSpares: 4, emergencySlots: 8, cargoBoostSlots: 15, powerCellBoost: 2, fusionPower: 12,
  padTurnaround: 90, // seconds the pad needs between launches (≈3 per window)
  milestones: [[10, 25], [25, 50], [50, 100], [100, 200]],
};
// Every flight to Mars needs this launch vehicle; the payload is what changes.
const VEHICLE = { fuselage: 4, tank: 3, engine: 2, fuel: 6, avionics: 1 };
const SUPPLY_PRODUCT = { food: 'foodcrate', water: 'canister', spares: 'spares', med: 'medkit', power: 'powercell' };
const SUPPLY_KINDS = Object.keys(SUPPLY_PRODUCT);
const MARS_EVENTS = {
  dust: { icon: '🌪️', name: 'Dust storm', chance: 0.12, windows: 2, desc: 'Solar output halved. 🔋 Power Cells in stock add 2 power each window (one used per window).' },
  meteor: { icon: '☄️', name: 'Meteor strike', chance: 0.08, desc: 'A module is knocked offline until 4 🔧 Spares Kits arrive to repair it (they go to the repair first, a few at a time is fine).' },
  sick: { icon: '🦠', name: 'Sickness', chance: 0.08, desc: 'Output down 30% until 2 💊 Medical Kits are in stock to treat it.' },
};
// 🌍 Project Terraform: the win. Three stages delivered to Mars in rocket cargo (1 slot per part).
// ⭐ sink for the late game: repeatable upgrades, bought outright (no lab time), after the first launch.
const MASTERY = [
  { id: 'value', icon: '💰', name: 'Market Mastery', fx: 'value', per: 0.03, desc: 'packages worth more' },
  { id: 'assembly', icon: '⚙️', name: 'Assembly Mastery', fx: 'assembly', per: 0.04, desc: 'assemblers faster' },
  { id: 'speed', icon: '💨', name: 'Logistics Mastery', fx: 'speed', per: 0.03, desc: 'belts and machines faster' },
  { id: 'mars', icon: '🔴', name: 'Colony Mastery', fx: 'marsOutput', per: 0.05, desc: 'more ⭐ and Rare Metals from Mars' },
];
const MASTERY_COST = { stars: 40, starGrowth: 1.25, money: 500000, moneyGrowth: 1.4 };
// Cash + 💎 sink: one-time megaprojects for the Mars push.
const MEGAPROJECTS = [
  { id: 'orbital', icon: '🛰️', name: 'Orbital Cargo Depot', money: 20e6, gems: 150, desc: '+20 cargo slots on every Mars rocket' },
  { id: 'spaceport', icon: '🏗️', name: 'Spaceport Expansion', money: 40e6, gems: 250, desc: 'The Launch Site stocks parts for 3 rockets (not 2) and the pad resets 30 s faster' },
  { id: 'exchange', icon: '🌐', name: 'Interplanetary Exchange', money: 75e6, gems: 400, desc: 'Rare Metals sell for 50% more' },
];
const TERRAFORM = [
  { id: 'atmo', icon: '🏭', name: 'Atmosphere Processors', pop: 20, research: 'fusion', needs: { fusioncore: 4, turbopump: 12, solar: 18 }, effect: 'Water/O₂ needs halved' },
  { id: 'shield', icon: '🧲', name: 'Magnetic Shield', pop: 40, needs: { fusioncore: 8, superconductor: 24, avionics: 6 }, effect: 'No more dust storms or meteor strikes' },
  { id: 'ocean', icon: '🌊', name: 'Ocean Seeding', pop: 80, research: 'terraform', needs: { fusioncore: 12, canister: 90, superconductor: 24, lifesupport: 12 }, effect: 'Mars is alive: you win' },
];
const LEGACY_BONUS = 0.1; // New Game+: +10% package value per completed game (up to 5)
const PAD_LEVELS = [{ cost: 1000000, cut: 20 }, { cost: 3000000, cut: 20 }, { cost: 8000000, cut: 20 }]; // launch pad upgrades: seconds off the turnaround
// 🗺️ The Mars base: modules land as kits, you place them on this map and colonists build them.
const MARS_MAP = {
  cols: 9, rows: 11, rocks: 10, iceFields: 2, iceSize: 4, veins: 2, veinSize: 3, // v = metal vein (Metal Mines)
  powerRange: { solar: 2, fusion: 3 }, // tiles (square) a power source covers
  shelterOutput: 0.5, // colonists still waiting for their dome shelter in the Lander and work at half pace
  buildBase: 0.5, buildPerEngineer: 0.25, buildPerLaborer: 0.04, // construction speed: Lander robots + crew
  relocateSpares: 2, relocateKeep: 0.6, // moving a finished building: Spares it costs, share of the work kept
};
const MARS_BUILD = { habitat: 240, solar: 180, greenhouse: 300, icemine: 300, pad: 480, station: 360, fusion: 600, mine: 360, rec: 300, workshop: 360, silo: 240 }; // seconds of work
const MARS_POWERED = ['greenhouse', 'icemine', 'station', 'pad', 'mine', 'rec', 'workshop']; // offline unless a power source covers them
// 👥 Colonist jobs. `at`: the building that has the slots (`per` each). Engineers build and repair; anyone left is a laborer.
const MARS_JOBS = {
  engineer: { icon: '🔧', name: 'Engineers', bubble: '🔧', desc: 'Build new sites and repair meteor damage' },
  farmer: { icon: '🌱', name: 'Farmers', at: 'greenhouse', per: 2, bubble: '🌱', desc: 'Tend the Greenhouses' },
  iceminer: { icon: '🧊', name: 'Ice crews', at: 'icemine', per: 2, bubble: '⛏️', desc: 'Run the Ice Mines' },
  caretaker: { icon: '🧹', name: 'Caretakers', at: 'habitat', per: 1, bubble: '🧹', desc: 'Keep the domes clean' },
  miner: { icon: '⛏️', name: 'Miners', at: 'mine', per: 3, bubble: '⛏️', desc: 'Dig Rare Metals' },
  mechanic: { icon: '🛠️', name: 'Mechanics', at: 'workshop', per: 2, bubble: '🛠️', desc: 'Make Spares from Rare Metals' },
  scientist: { icon: '🧪', name: 'Scientists', at: 'station', per: 2, bubble: '🧪', desc: 'Research for ⭐ reputation' },
};
// 🪨 Ore on Mars: mined Rare Metals wait in storage until a rocket flies home from the Landing Pad.
const MARS_STORE = { lander: 30, silo: 150, returnPerRocket: 60 };
const MARS_JOB_ORDER = ['engineer', 'farmer', 'iceminer', 'caretaker', 'miner', 'mechanic', 'scientist']; // auto-assign priority
const MARS_CREW = {
  idleOutput: 0.3, // a building with nobody working it runs at 30%
  metalsPerLaborer: 1, metalsPerMiner: 8, // Rare Metals per window: laborers scavenge, miners dig the real seams
  sparesPerWorkshop: 3, metalsPerSpare: 2, // a fully staffed Workshop turns 6 Rare Metals into 3 Spares a window
  dirtPerSec: 0.035, cleanPerSec: 0.08, // dome dust (0-100) and how fast one caretaker clears it
  recRange: 3,
};
// 🙂 Colony morale: 0.2 – 1.2. Output scales 0.5 + 0.5 × morale; very low morale sends people home.
const MARS_MORALE = { base: 0.7, clean: 0.2, rec: 0.2, crowd: 0.3, ration: 0.2, sick: 0.1, stocked: 0.05, leaveBelow: 0.35 };
const MARS_MODULES = {
  habitat: { name: 'Habitat Dome', icon: '🏠', payload: { fuselage: 4, lifesupport: 2, heatshield: 2 }, desc: 'Room for 5 colonists' },
  solar: { name: 'Solar Farm', icon: '⚡', payload: { solar: 6, wiring: 4 }, desc: `+${3} power for the other modules` },
  greenhouse: { name: 'Greenhouse', icon: '🌱', payload: { lifesupport: 2, solar: 4, panel: 10 }, max: 3, desc: 'Grows food: −25% food needed per level' },
  icemine: { name: 'Ice Mine', icon: '🧊', payload: { turbopump: 2, alloy: 4, sensor: 2 }, max: 3, desc: 'Makes water and oxygen: −25% Water/O₂ needed per level. Must be built on ice' },
  pad: { name: 'Landing Pad', icon: '🛬', payload: { alloy: 6, heatshield: 4, avionics: 2 }, max: 1, desc: 'Rockets refuel here and fly stored ore home: up to 60 Rare Metals each' },
  station: { name: 'Research Station', icon: '🔬', payload: { computer: 2, sensor: 4, avionics: 2 }, max: 1, desc: 'Colonists make +50% ⭐ reputation' },
  fusion: { name: 'Fusion Reactor', icon: '⚛️', payload: { fusioncore: 2, alloy: 6, heatshield: 2 }, max: 2, research: 'fusion', desc: '+12 power that dust storms can\'t touch' },
  mine: { name: 'Metal Mine', icon: '⛏️', payload: { alloy: 8, sensor: 2, heatshield: 2 }, max: 4, desc: 'Miners dig Rare Metals. Must be built on a 🟫 metal vein' },
  rec: { name: 'Rec Dome', icon: '🎳', payload: { panel: 10, computer: 2, lifesupport: 1 }, max: 3, desc: 'Lifts the morale of everyone living within 3 tiles' },
  workshop: { name: 'Workshop', icon: '🔧', payload: { alloy: 6, circuit: 4, panel: 6 }, max: 2, desc: 'Mechanics turn Rare Metals into 🔧 Spares on Mars' },
  silo: { name: 'Ore Silo', icon: '🛢️', payload: { alloy: 6, panel: 8 }, max: 4, desc: 'Stores 150 Rare Metals until a rocket flies them home' },
};

// 🧭 Expeditions: colonists head out across Mars and bring back materials for the base.
// Finds kept on Mars (samples turn into ⭐ when they're back; ore goes to ore storage).
const MARS_FINDS = {
  regolith: { icon: '🟤', name: 'Regolith' },
  salvage: { icon: '⚙️', name: 'Salvage' },
  ice: { icon: '❄️', name: 'Ice' },
  crystal: { icon: '🔮', name: 'Crystals' },
};
// `finds`: amount per explorer (before skills); `rover`: rover level needed; `risk`: chance of trouble (halves the haul).
const MARS_ZONES = [
  { id: 'plains', icon: '🏜️', name: 'Dust Plains', time: 180, rover: 0, risk: 0.05, finds: { regolith: 4, salvage: 0.5, ice: 0.5 }, desc: 'Close and safe. Plenty of regolith' },
  { id: 'crash', icon: '🛰️', name: 'Probe Crash Site', time: 240, rover: 0, risk: 0.1, finds: { salvage: 3, regolith: 1, samples: 0.4 }, desc: 'Old landers and probes to strip for salvage' },
  { id: 'ice', icon: '🧊', name: 'Polar Ice Shelf', time: 300, rover: 1, risk: 0.12, finds: { ice: 4, regolith: 1, samples: 0.3 }, desc: 'Ice to melt into water and oxygen' },
  { id: 'lava', icon: '🌋', name: 'Lava Tubes', time: 360, rover: 1, risk: 0.2, finds: { crystal: 1.5, raremetal: 2, salvage: 0.5, samples: 0.5 }, artifact: 0.05, desc: 'Caves lined with crystals and ore' },
  { id: 'canyon', icon: '🏔️', name: 'Valles Marineris', time: 540, rover: 2, risk: 0.3, finds: { crystal: 3, raremetal: 5, ice: 1, samples: 1.2 }, artifact: 0.15, desc: 'The great canyon: rich finds, real danger' },
];
// What each job adds on an expedition. Material keys: extra share per explorer of that job.
// `safe`: cuts the chance of trouble (each one multiplies it by 1 − safe). `artifact`: better odds of a rare find.
const MARS_SKILLS = {
  engineer: { safe: 0.4, salvage: 0.5, desc: 'fewer mishaps, more salvage' },
  miner: { raremetal: 1, crystal: 0.75, desc: 'more ore and crystals' },
  scientist: { samples: 1, artifact: 0.5, desc: 'more samples, spot rare finds' },
  iceminer: { ice: 1, desc: 'more ice' },
  mechanic: { salvage: 1, desc: 'more salvage' },
  farmer: { regolith: 0.5, desc: 'more regolith' },
  caretaker: { safe: 0.15, regolith: 0.25, desc: 'keep the gear working' },
  laborer: { desc: 'an extra pair of hands' },
};
const MARS_EXPLORE = {
  groupPower: 0.85, // haul grows with party size, a little less than 1:1
  tripRations: 3, // explorers eat and drink this many times what they would at home, for the length of the trip (at least 1 🍞 and 1 💧)
  samplesStars: 3, // ⭐ per sample brought home (+50% with a working Research Station)
  artifactGems: 10, artifactStars: 25,
  maxParty: [4, 7, 10], // on foot, Rover, Heavy Rover
  roverSpeed: [0, 0.2, 0.35], // trips this much shorter
  stayBehind: 2, // colonists who always stay at the base
};
// 🛠️ Made on Mars from expedition finds. `stock`: a supply it adds to; `rover`: the rover level it gives; `module`: a kit.
const MARS_FAB = [
  { id: 'spares', icon: '🔧', name: 'Spares Kit', cost: { salvage: 5, regolith: 2 }, stock: 'spares' },
  { id: 'water', icon: '💧', name: 'Water/O₂ Canister', cost: { ice: 5 }, stock: 'water' },
  { id: 'power', icon: '🔋', name: 'Power Cell', cost: { crystal: 3, salvage: 2 }, stock: 'power' },
  { id: 'rover1', icon: '🚙', name: 'Rover', cost: { salvage: 25, regolith: 15 }, rover: 1, desc: 'Reaches the Ice Shelf and Lava Tubes; parties up to 7, trips 20% shorter' },
  { id: 'rover2', icon: '🚜', name: 'Heavy Rover', cost: { salvage: 40, crystal: 12, ice: 10 }, rover: 2, desc: 'Reaches Valles Marineris; parties up to 10, trips 35% shorter' },
  { id: 'kit-silo', module: 'silo', cost: { regolith: 30, salvage: 10 } },
  { id: 'kit-solar', module: 'solar', cost: { salvage: 20, crystal: 8 } },
  { id: 'kit-greenhouse', module: 'greenhouse', cost: { regolith: 30, ice: 20, salvage: 10 } },
  { id: 'kit-workshop', module: 'workshop', cost: { salvage: 30, regolith: 20 } },
  { id: 'kit-rec', module: 'rec', cost: { regolith: 40, ice: 10, crystal: 6 } },
  { id: 'kit-habitat', module: 'habitat', cost: { regolith: 60, salvage: 20, ice: 10, crystal: 6 } },
];

// Total parts per product across all stages.
LAUNCH.needs = {};
for (const st of LAUNCH.stages) for (const [p, n] of Object.entries(st.needs)) LAUNCH.needs[p] = (LAUNCH.needs[p] || 0) + n;

// ---- Market: selling floods demand, which recovers over time ----
const MARKET = {
  drop: { raw: 0.003, part: 0.006, rocket: 0.02 }, // demand lost per unit sold
  recover: 0.012, // fraction of the gap back to normal recovered per second
  floor: 0.35, // demand never falls below 35%
  eventEvery: [180, 360], // seconds between market events
  eventLength: 150,
};
const productTier = (p) => (PRODUCTS[p].raw ? 'raw' : LAUNCH.needs[p] ? 'rocket' : 'part');

// ---- Power: machines draw ⚡, each site has a capacity ----
const POWER_DRAW = { scanner: 2, labeler: 3, chiller: 3, wrapper: 5, assembler: 4, sorter: 1 };
const POWER_PER_LEVEL = 8; // Electrical upgrade

// ---- Gems: premium currency, earnable in play (and later purchasable) ----
const GEMS = {
  start: 10,
  perObjective: 3,
  perContract: 1,
  perLaunch: 50,
  daily: 5,
};
// Boosts only save time; nothing here is unobtainable without paying.
// kind: 'play' = runs on the in-game clock, 'instant' = one-shot,
//       'away' = banks hours of Night Crew earnings (40% speed) for time spent offline.
const BOOSTS = [
  { id: 'double', kind: 'play', name: 'Double Earnings', icon: '💰', cost: 15, dur: 1800, desc: 'Every sale pays 2× for 30 minutes of play' },
  { id: 'freight', kind: 'play', name: 'Express Freight', icon: '🚛', cost: 10, dur: 1800, desc: 'Trucks between your sites drive 3× faster for 30 minutes of play' },
  { id: 'warp', kind: 'instant', name: 'Time Warp', icon: '⏱️', cost: 20, desc: 'Instantly collect 1 hour of your current net income' },
  { id: 'cargo', kind: 'instant', name: 'Cargo Boost', icon: '📦', cost: 12, desc: '+15 cargo slots on your next Mars rocket' },
  { id: 'crew', kind: 'instant', name: 'Emergency Crew', icon: '🧰', cost: 5, desc: 'Instantly fix every breakdown and service all equipment' },
  { id: 'night4', kind: 'away', hours: 4, name: 'Night Crew · 4 hours', icon: '🌙', cost: 10, desc: 'Your sites earn at 40% speed for your next 4 hours away' },
  { id: 'night8', kind: 'away', hours: 8, name: 'Night Crew · 8 hours', icon: '🌙', cost: 18, desc: '40% earnings for your next 8 hours away (a good night\'s sleep)' },
];
// Offline earnings: a fraction of your average rate over the last few minutes.
// The full fraction for the first OFFLINE_FULL_HOURS away, then half of it, up to the cap.
const OFFLINE_BASE_RATE = 0.15;
const OFFLINE_BASE_HOURS = 6;
const OFFLINE_FULL_HOURS = 2;
const NIGHT_CREW_RATE = 0.4; // a Night Crew keeps sites at 40% while you're away
const RATE_AVG_SECS = 300; // offline pay uses a ~5 minute rolling average, not a momentary spike
// Coming-soon catalog entries (cosmetics never affect gameplay).
const COSMETICS = [
  { icon: '✨', name: 'Belt skins', desc: 'Chrome, neon and wood conveyor styles' },
  { icon: '🎨', name: 'Truck paint', desc: 'Custom liveries for your fleet' },
  { icon: '🚀', name: 'Rocket paint jobs', desc: 'Show off at launch' },
];
const OFFLINE_DOUBLE_COST = 8;
// Placeholder store listings; real payments need app-store billing.
const GEM_PACKS = [
  { gems: 80, price: '$1.99' },
  { gems: 450, price: '$9.99', tag: 'Popular' },
  { gems: 1000, price: '$19.99', tag: 'Best value' },
];

// ---- Properties ----
// IN docks: { x, y, dir, price, cargo: {product: weight} } bring raw material
// from suppliers, or { ..., receive: true } unload trucks from your other sites.
// price 0 = open from the start. OUT docks accept from any side.
const PROPERTIES = [
  {
    id: 'shed', name: 'Rusty Shed', emoji: '🛖', role: 'Metal shop',
    desc: 'A leaky tin shed on the edge of town. Steel and copper suppliers deliver here.',
    price: 1500, cols: 8, rows: 12, costMult: 1, theft: 0.02, power: 10,
    repairCost: 8, brokenPct: 0.8,
    inDocks: [
      { x: 2, y: 0, dir: 2, price: 0, cargo: { steel: 1 } },
      { x: 5, y: 0, dir: 2, price: 400, cargo: { copper: 1 } },
    ],
    outDocks: [
      { x: 4, y: 11, price: 0 },
    ],
    pillars: [],
  },
  {
    id: 'mill', name: 'Old Textile Mill', emoji: '🏭', role: 'Electronics',
    desc: 'Brick, big, and full of pigeons. Silicon arrives here (a second silicon dock opens on the west wall). Perfect for circuit boards.',
    price: 20000, cols: 10, rows: 14, costMult: 3, theft: 0.04, power: 14,
    repairCost: 30, brokenPct: 0.85,
    inDocks: [
      { x: 2, y: 0, dir: 2, price: 0, cargo: { silicon: 1 } },
      { x: 5, y: 0, dir: 2, price: 0, receive: true },
      { x: 8, y: 0, dir: 2, price: 9000, cargo: { copper: 1 } },
      { x: 0, y: 6, dir: 1, price: 15000, cargo: { silicon: 1 } },
    ],
    outDocks: [
      { x: 3, y: 13, price: 0 },
      { x: 7, y: 13, price: 6000 },
      { x: 9, y: 9, price: 10000 },
    ],
    pillars: [[3, 4], [6, 4], [3, 9], [6, 9]],
  },
  {
    id: 'foundry', name: 'Old Foundry', emoji: '⚒️', role: 'Alloys & valves',
    desc: 'A soot-black foundry by the rail yard. Titanium billets arrive here.',
    price: 120000, cols: 10, rows: 14, costMult: 6, theft: 0.05, power: 16,
    repairCost: 60, brokenPct: 0.85,
    inDocks: [
      { x: 2, y: 0, dir: 2, price: 0, cargo: { titanium: 1 } },
      { x: 5, y: 0, dir: 2, price: 0, receive: true },
      { x: 8, y: 0, dir: 2, price: 40000, cargo: { steel: 1 } },
      { x: 0, y: 6, dir: 1, price: 60000, receive: true },
    ],
    outDocks: [
      { x: 3, y: 13, price: 0 },
      { x: 7, y: 13, price: 30000 },
      { x: 9, y: 9, price: 50000 },
    ],
    pillars: [[3, 4], [6, 4], [3, 9], [6, 9]],
  },
  {
    id: 'depot', name: 'Regional Depot', emoji: '🏬', role: 'Tanks & structures',
    desc: 'A former cold-storage depot. Liquid oxygen and carbon composite come in here.',
    price: 400000, cols: 11, rows: 16, costMult: 10, theft: 0.06, power: 20,
    repairCost: 100, brokenPct: 0.85,
    inDocks: [
      { x: 2, y: 0, dir: 2, price: 0, cargo: { lox: 1 } },
      { x: 5, y: 0, dir: 2, price: 0, receive: true },
      { x: 8, y: 0, dir: 2, price: 80000, cargo: { steel: 1 } },
      { x: 0, y: 4, dir: 1, price: 120000, cargo: { composite: 1 } },
      { x: 0, y: 10, dir: 1, price: 200000, receive: true },
      { x: 10, y: 3, dir: 3, price: 150000, cargo: { provisions: 1 } }, // for Mars food crates
    ],
    outDocks: [
      { x: 3, y: 15, price: 0 },
      { x: 7, y: 15, price: 60000 },
      { x: 10, y: 7, price: 100000 },
      { x: 10, y: 12, price: 150000 },
    ],
    pillars: [[3, 4], [7, 4], [3, 8], [7, 8], [3, 12], [7, 12]],
  },
  {
    id: 'refinery', name: 'Coastal Refinery', emoji: '🏗️', role: 'Propellant',
    desc: 'Tanks and pipes on the docks. Kerosene flows in; propellant loads roll out.',
    price: 900000, cols: 11, rows: 15, costMult: 15, theft: 0.07, power: 22,
    repairCost: 150, brokenPct: 0.85,
    inDocks: [
      { x: 2, y: 0, dir: 2, price: 0, cargo: { kerosene: 1 } },
      { x: 5, y: 0, dir: 2, price: 0, receive: true },
      { x: 8, y: 0, dir: 2, price: 300000, cargo: { lox: 1 } },
      { x: 0, y: 7, dir: 1, price: 400000, receive: true },
    ],
    outDocks: [
      { x: 3, y: 14, price: 0 },
      { x: 7, y: 14, price: 200000 },
      { x: 10, y: 7, price: 350000 },
    ],
    pillars: [[3, 4], [7, 4], [3, 10], [7, 10]],
  },
  {
    id: 'lab', name: 'Clean Room Lab', emoji: '🔬', role: 'Sensors & computers',
    desc: 'A spotless lab in the hills. Rare earths arrive under armed guard.',
    price: 2000000, cols: 11, rows: 16, costMult: 22, theft: 0.07, power: 24,
    repairCost: 250, brokenPct: 0.85,
    inDocks: [
      { x: 2, y: 0, dir: 2, price: 0, cargo: { rareearth: 1 } },
      { x: 5, y: 0, dir: 2, price: 0, receive: true },
      { x: 8, y: 0, dir: 2, price: 700000, cargo: { silicon: 1 } },
      { x: 0, y: 5, dir: 1, price: 900000, receive: true },
      { x: 0, y: 11, dir: 1, price: 1200000, cargo: { copper: 1 } },
    ],
    outDocks: [
      { x: 3, y: 15, price: 0 },
      { x: 7, y: 15, price: 500000 },
      { x: 10, y: 8, price: 800000 },
    ],
    pillars: [[3, 4], [7, 4], [3, 8], [7, 8], [3, 12], [7, 12]],
  },
  {
    id: 'hub', name: 'Mega Fulfillment Hub', emoji: '🏟️', role: 'Engines & final assembly',
    desc: 'The big leagues. Final assembly: assemblers here work 50% faster, and rocket parts made here are worth 50% more.',
    asmSpeed: 1.5, rocketBonus: 0.5,
    price: 5000000, cols: 12, rows: 18, costMult: 35, theft: 0.08, power: 28,
    repairCost: 350, brokenPct: 0.9,
    inDocks: [
      { x: 2, y: 0, dir: 2, price: 0, cargo: { composite: 1 } },
      { x: 5, y: 0, dir: 2, price: 0, receive: true },
      { x: 9, y: 0, dir: 2, price: 1500000, receive: true },
      { x: 0, y: 5, dir: 1, price: 2500000, cargo: { titanium: 1 } },
      { x: 0, y: 11, dir: 1, price: 3500000, cargo: { steel: 0.5, copper: 0.5 } },
      { x: 11, y: 3, dir: 3, price: 5000000, cargo: { lox: 1 } },
    ],
    outDocks: [
      { x: 3, y: 17, price: 0 },
      { x: 8, y: 17, price: 700000 },
      { x: 11, y: 9, price: 1200000 },
      { x: 11, y: 14, price: 2000000 },
    ],
    pillars: [[4, 4], [8, 4], [4, 9], [8, 9], [4, 14], [8, 14]],
  },
];

const PROP_BY_ID = Object.fromEntries(PROPERTIES.map((p) => [p.id, p]));

// Raw products delivered by this property's supplier docks.
function rawProductsOf(def) {
  const set = new Set();
  for (const d of def.inDocks) if (d.cargo) for (const k of Object.keys(d.cargo)) set.add(k);
  return PRODUCT_IDS.filter((k) => set.has(k));
}

const hasReceiveDock = (def) => def.inDocks.some((d) => d.receive);
const siteName = (id) => (id === 'launch' ? LAUNCH.name : PROP_BY_ID[id].name);
const siteEmoji = (id) => (id === 'launch' ? LAUNCH.emoji : PROP_BY_ID[id].emoji);

function fmt(n) {
  const neg = n < 0;
  n = Math.abs(n);
  let s;
  if (n < 10) s = n % 1 === 0 ? String(n) : n.toFixed(1);
  else if (n < 1e4) s = Math.floor(n).toLocaleString('en-US');
  else {
    const units = ['K', 'M', 'B', 'T', 'Qa'];
    let i = -1;
    while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
    s = (n < 100 ? n.toFixed(n < 10 ? 2 : 1) : Math.floor(n)) + units[i];
  }
  return (neg ? '-$' : '$') + s;
}

function fmtTime(secs) {
  secs = Math.max(0, Math.ceil(secs));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
