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
  { name: 'Basic', speed: 1.25, cost: 15, color: '#f2c94c', life: 700 },
  { name: 'Fast', speed: 2.2, cost: 90, color: '#f2994a', life: 550 },
  { name: 'Express', speed: 3.6, cost: 400, color: '#56ccf2', life: 400, research: 'express' },
];

// Machines process a package at the tile centre, then pass it on. Each package
// only gets each machine's bonus once.
// All equipment (belts too) wears out and breaks down after `life` packages
// (randomised ±25%) unless a Maintenance Tech services it first.
const MACHINES = {
  scanner: {
    name: 'Scanner', past: 'scanned', icon: '🔍', color: '#c0392b', cost: 300, time: 0.5, life: 150,
    add: 0.5, // flat bonus: 50% of the product's base price
    desc: () => '+50% of base price (flat bonus)',
  },
  labeler: {
    name: 'Labeler', past: 'labeled', icon: '🏷️', color: '#d4a017', cost: 1500, time: 1.0, life: 120,
    mul: 1.5,
    desc: () => '+50% package value',
  },
  wrapper: {
    name: 'Wrapper', past: 'wrapped', icon: '🎁', color: '#2980b9', cost: 6000, time: 2.0, life: 90,
    mul: 2, research: 'wrapper',
    desc: () => 'x2 value · makes fragile cargo safe',
  },
  chiller: {
    name: 'Chiller', past: 'chilled', icon: '❄️', color: '#48a9c5', cost: 2500, time: 0.6, life: 130,
    mul: 1.3, only: 'cold', research: 'chiller',
    desc: () => 'Stops cold cargo spoiling, +30%',
  },
};
// Tapping broken equipment fixes it for a share of its price.
const FIX_FRACTION = { belt: 0.5, other: 0.15 };
const TECH_REPAIR_TIME = 5; // seconds for a tech to fix a breakdown
const TECH_PM_TIME = 3; // seconds for a preventive-maintenance service
const TECH_PM_REST = 6; // seconds a tech rests between services
const PM_THRESHOLD = 0.4; // techs service equipment once it's 40% worn
const EQUIP_PER_TECH = 30; // pieces of equipment one tech can cover

const SPLITTER = { name: 'Splitter', cost: 120, speed: 2.0, life: 900 };
const SORTER = { name: 'Sorter', cost: 250, speed: 2.0, life: 900, research: 'sorter' };
const DOCK_SPEED = 2.0;
const MACHINE_SPEED = 2.0;
const BASE_TRUCK_INTERVAL = 2.0; // seconds between packages per open IN dock

// Tools shown in the toolbar, in order.
const TOOLS = [
  { id: 'repair', name: 'Repair', icon: '🔨', tip: 'Tap or drag over damaged floor to repair it' },
  { id: 'belt', name: 'Conveyor', icon: '➡️', tip: 'Drag to lay conveyors · tap a conveyor to turn it' },
  { id: 'splitter', name: 'Splitter', icon: '🔀', tip: 'Deals packages out across its other sides' },
  { id: 'assembler', name: 'Assembler', icon: '🏭', tip: 'Builds products from ingredients · tap it again to pick a recipe' },
  { id: 'sorter', name: 'Sorter', icon: '🚦', research: 'sorter', tip: 'Pulls one product off the line · tap it again to configure' },
  { id: 'rack', name: 'Rack', icon: '🗄️', tip: 'Storage racks: each tile holds products waiting on trucks' },
  { id: 'facility', name: 'Facilities', icon: '🏢', tip: 'Restrooms, break rooms, ops center and more · pick a type' },
  { id: 'scanner', name: 'Scanner', icon: '🔍', tip: 'Tap to place · drag from it to aim its output' },
  { id: 'labeler', name: 'Labeler', icon: '🏷️', tip: 'Tap to place · drag from it to aim its output' },
  { id: 'chiller', name: 'Chiller', icon: '❄️', research: 'chiller', tip: 'Only affects cold cargo · others pass straight through' },
  { id: 'wrapper', name: 'Wrapper', icon: '🎁', research: 'wrapper', tip: 'Slow but doubles value · wrapped fragile cargo is safe' },
  { id: 'upgrade', name: 'Upgrade', icon: '⏫', tip: 'Tap conveyors to upgrade their speed' },
  { id: 'rotate', name: 'Rotate', icon: '🔄', tip: 'Tap a conveyor or machine to turn it' },
  { id: 'remove', name: 'Remove', icon: '🗑️', tip: 'Tap or drag to remove (50% refund)' },
];

// Toolbar groups: one row of group buttons; tapping one opens its tools.
const TOOL_GROUPS = [
  { id: 'convey', name: 'Conveyors', icon: '➡️', tools: ['belt', 'splitter', 'sorter', 'upgrade'] },
  { id: 'machines', name: 'Machines', icon: '🏭', tools: ['assembler', 'scanner', 'labeler', 'chiller', 'wrapper'] },
  { id: 'build', name: 'Building', icon: '🧱', tools: ['repair', 'rack', 'facility'] },
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
  { id: 'operator', name: 'Assembler Operator', icon: '👷', wage: 10, max: 12, desc: 'Crews an assembler (it only runs with an operator beside it). Up to 3 per assembler, +50% speed each extra' },
  { id: 'ops', name: 'Operations Manager', icon: '📋', wage: 25, max: 3, desc: '+10% line speed and +15% rack handling each' },
  { id: 'forklift', name: 'Forklift Operator', icon: '🚜', wage: 15, max: 6, desc: 'Puts products away in the racks and picks them out: +30 moves/min each' },
  { id: 'sales', name: 'Sales Rep', icon: '💼', wage: 25, max: 3, desc: '+10% value on packages shipped here, each' },
  { id: 'security', name: 'Security Guard', icon: '🛡️', wage: 10, max: 3, desc: 'Each guard halves package theft' },
  { id: 'safety', name: 'Safety Officer', icon: '⛑️', wage: 15, max: 2, desc: 'Each cuts workplace accidents by 75%' },
  { id: 'hr', name: 'HR Manager', icon: '🗂️', wage: 20, max: 1, desc: 'Everyone else here costs 20% less in wages' },
];
const STAFF_BY_ID = Object.fromEntries(STAFF.map((s) => [s.id, s]));
const HIRE_FEE_MINUTES = 10; // signing fee = 10 minutes of wages
// Accidents: chance per staff member per minute; halts the building.
const ACCIDENT_RATE = 0.012;
const ACCIDENT_SHUTDOWN = 20; // seconds

// ---- Research (global, paid in ⭐ reputation from contracts) ----
const RESEARCH = [
  { id: 'sorter', name: 'Sorting Systems', icon: '🚦', cost: 1, desc: 'Unlocks the Sorter: pull one cargo type off a line' },
  { id: 'wrapper', name: 'Shrink Wrapping', icon: '🎁', cost: 2, desc: 'Unlocks the Wrapper: x2 value, protects fragile cargo' },
  { id: 'chiller', name: 'Cold Chain', icon: '❄️', cost: 2, desc: 'Unlocks the Chiller for cold cargo' },
  { id: 'maint', name: 'Heavy-Duty Parts', icon: '🛠️', cost: 2, desc: 'All equipment lasts twice as long between breakdowns' },
  { id: 'slots1', name: 'Account Manager', icon: '🤝', cost: 2, desc: '+1 active contract slot' },
  { id: 'express', name: 'Express Belts', icon: '💨', cost: 3, desc: 'Unlocks Express conveyor upgrades' },
  { id: 'lean', name: 'Lean Operations', icon: '📉', cost: 3, desc: 'Staff wages -30%' },
  { id: 'bulk', name: 'Bulk Purchasing', icon: '🏷️', cost: 3, desc: 'Building and upgrades 15% cheaper' },
  { id: 'insulated', name: 'Insulated Belts', icon: '🧤', cost: 3, req: 'chiller', desc: 'Cold cargo spoils half as fast' },
  { id: 'logistics', name: 'Logistics Network', icon: '🗺️', cost: 4, desc: 'Trucks arrive 10% more often everywhere' },
  { id: 'nightshift', name: 'Night Shift', icon: '🌙', cost: 4, desc: 'Offline earnings 45% (was 30%), up to 12h' },
  { id: 'slots2', name: 'Sales Department', icon: '🏢', cost: 5, req: 'slots1', desc: '+1 active contract slot' },
  { id: 'padding', name: 'Air-Cushion Packing', icon: '🫧', cost: 5, req: 'express', desc: 'Fragile cargo no longer breaks on Express belts' },
  { id: 'premium', name: 'Premium Clients', icon: '💎', cost: 6, req: 'bulk', desc: '+15% value on all packages everywhere' },
  { id: 'fleet', name: 'Semi Trailers', icon: '🚛', cost: 3, desc: 'Trucks between your sites carry 50% more' },
  { id: 'propulsion', name: 'Propulsion', icon: '🔥', cost: 4, desc: 'Unlocks Turbopump and Rocket Engine recipes' },
  { id: 'guidance', name: 'Guidance Systems', icon: '🛰️', cost: 5, desc: 'Unlocks Sensor Array, Flight Computer and Avionics recipes' },
  { id: 'photovoltaics', name: 'Photovoltaics', icon: '☀️', cost: 5, req: 'guidance', desc: 'Unlocks the Solar Array recipe' },
  { id: 'thermal', name: 'Thermal Protection', icon: '🌡️', cost: 5, req: 'propulsion', desc: 'Unlocks the Heat Shield recipe' },
  { id: 'habitat', name: 'Crew Habitat', icon: '🫁', cost: 6, req: 'guidance', desc: 'Unlocks the Life Support Unit recipe' },
  { id: 'efficiency', name: 'Efficient Motors', icon: '🔌', cost: 3, desc: 'Machines draw 25% less power' },
  { id: 'suppliers', name: 'Supplier Network', icon: '🤝', cost: 4, desc: 'Raw materials cost 20% less' },
  { id: 'fastassembly', name: 'Robotic Assembly', icon: '🦾', cost: 4, desc: 'Assemblers work 30% faster' },
];
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
};
const RECIPE_IDS = Object.keys(RECIPES);
const ASSEMBLER = { name: 'Assembler', cost: 400, life: 200, bufferRecipes: 2 };

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
const TRUCK_BASE_COST = 2000; // price of your next truck grows ×1.45 per truck owned
// Departure rules a route can use: seconds a part-loaded truck waits (null = only when full).
const TRUCK_WAITS = [
  { id: 'asap', label: 'ASAP', wait: 3 },
  { id: '10s', label: '10s', wait: 10 },
  { id: '30s', label: '30s', wait: 30 },
  { id: 'full', label: 'When full', wait: null },
];
const CAP_STEPS = [0, 10, 25, 50, 100, 250, 500, 1000]; // 0 = no cap
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
const rackCapOf = (o) => RACK.levels[(o.lvl || 1) - 1];

// ---- Facilities: one-tile buildings for your staff ----
const FACILITIES = {
  restroom: {
    name: 'Restroom', icon: '🚻', color: '#4a6fa5', cost: 400, power: 0, rangeTint: '74,111,165',
    desc: 'Covers staff working within its range. Uncovered staff hurt morale.',
    levels: [{ range: 4, cap: 6, speed: 1 }, { range: 6, cap: 9, speed: 1.35 }, { range: 9, cap: 12, speed: 1.8 }],
  },
  breakroom: {
    name: 'Break Room', icon: '☕', color: '#8d6e63', cost: 600, power: 1, rangeTint: '141,110,99',
    desc: 'Covers staff working within its range. Keeps morale up.',
    levels: [{ range: 4, cap: 8, speed: 1 }, { range: 6, cap: 12, speed: 1.35 }, { range: 9, cap: 16, speed: 1.8 }],
  },
  opscenter: { name: 'Operations Center', icon: '🖥️', color: '#37474f', cost: 3000, power: 3, max: 1, desc: '+25% rack handling and +10% line speed (1 per site)' },
  firstaid: { name: 'First Aid Station', icon: '🩹', color: '#c0392b', cost: 1500, power: 1, desc: 'Halves accidents; accidents stop work for 10s instead of 20s' },
  securitybooth: { name: 'Security Booth', icon: '🛡️', color: '#2c3e50', cost: 1200, power: 1, desc: 'Halves package theft (stacks with guards)' },
  maintshop: { name: 'Maintenance Shop', icon: '🔧', color: '#7f8c8d', cost: 2500, power: 2, desc: 'Techs repair twice as fast and service gear more often' },
  generator: { name: 'Generator', icon: '🔌', color: '#b7950b', cost: 2000, power: -12, outside: true, desc: '+12 ⚡ power capacity. Built outside, on the building\'s outer wall' },
};
const FACILITY_IDS = Object.keys(FACILITIES);
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
  worthCleaning: 35, // janitors start on things this dirty
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
const MAX_CREW = 3; // operators per assembler; each extra adds CREW_BONUS speed
const CREW_BONUS = 0.5;
const STAFF_PER_RESTROOM = 6;
const STAFF_PER_BREAKROOM = 8;
// Rack handling: every put-away or pick is one "move". A site manages
// HANDLING_BASE moves/min alone; Forklift Operators add more.
const HANDLING_BASE = 10;
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
//       'away' = banks hours of full-speed earnings for time spent offline.
const BOOSTS = [
  { id: 'double', kind: 'play', name: 'Double Earnings', icon: '💰', cost: 15, dur: 1800, desc: 'Every sale pays 2× for 30 minutes of play' },
  { id: 'freight', kind: 'play', name: 'Express Freight', icon: '🚛', cost: 10, dur: 1800, desc: 'Trucks between your sites drive 3× faster for 30 minutes of play' },
  { id: 'warp', kind: 'instant', name: 'Time Warp', icon: '⏱️', cost: 20, desc: 'Instantly collect 1 hour of your current net income' },
  { id: 'crew', kind: 'instant', name: 'Emergency Crew', icon: '🧰', cost: 5, desc: 'Instantly fix every breakdown and service all equipment' },
  { id: 'night4', kind: 'away', hours: 4, name: 'Night Crew · 4 hours', icon: '🌙', cost: 10, desc: 'Your sites earn at full speed for your next 4 hours away' },
  { id: 'night8', kind: 'away', hours: 8, name: 'Night Crew · 8 hours', icon: '🌙', cost: 18, desc: 'Full-speed earnings for your next 8 hours away (a good night\'s sleep)' },
  { id: 'night24', kind: 'away', hours: 24, name: 'Night Crew · 24 hours', icon: '🌙', cost: 45, desc: 'Full-speed earnings for your next 24 hours away' },
];
// Offline earnings without a Night Crew: a fraction of your live rate.
const OFFLINE_BASE_RATE = 0.3;
const OFFLINE_RESEARCH_RATE = 0.45; // with Night Shift research
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
      { x: 5, y: 0, dir: 2, price: 600, cargo: { copper: 1 } },
    ],
    outDocks: [
      { x: 4, y: 11, price: 0 },
    ],
    pillars: [],
  },
  {
    id: 'mill', name: 'Old Textile Mill', emoji: '🏭', role: 'Electronics',
    desc: 'Brick, big, and full of pigeons. Silicon arrives here. Perfect for circuit boards.',
    price: 20000, cols: 10, rows: 14, costMult: 3, theft: 0.04, power: 14,
    repairCost: 30, brokenPct: 0.85,
    inDocks: [
      { x: 2, y: 0, dir: 2, price: 0, cargo: { silicon: 1 } },
      { x: 5, y: 0, dir: 2, price: 0, receive: true },
      { x: 8, y: 0, dir: 2, price: 9000, cargo: { copper: 1 } },
      { x: 0, y: 6, dir: 1, price: 15000, cargo: { steel: 1 } },
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
    desc: 'The big leagues. Room to assemble the most advanced rocket parts.',
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
