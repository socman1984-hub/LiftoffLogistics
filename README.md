# Liftoff Logistics (prototype)

**Version:** see `GAME_VERSION` in `js/releases.js` (also shown at the top of ❓ Help, with release notes).

**Play online:** https://socman1984-hub.github.io/LiftoffLogistics/ (GitHub Pages, updated on every push to `main`).

Buy run-down warehouses, repair them, and build conveyor systems that move packages
from truck docks to shipping docks. More throughput means more money. Upgrade the line
and the building, then expand to bigger properties.

## Run it

No build step. Serve the folder and open it in a browser (works on a phone too):

```bash
python -m http.server 5173
```

Then open http://localhost:5173. To try it on your phone, open `http://<your-PC-IP>:5173`
on the same Wi-Fi network.

## Test mode

Open the game with `?dev=1` (e.g. http://localhost:5173/?dev=1) to get a 🧪 button in the top bar:
game speed ×1–×25, free money/⭐/💎, unlock all research and sites, open docks, repair floors, max
upgrades, extra trucks, fix everything, toggle breakdowns, finish contracts, skip goals, trigger market
events and fill rocket stages. Without the flag, players never see it. Code: `js/dev.js`.

## Controls

- **Toolbar**: one row of groups: 🔍 Inspect · ➡️ Conveyors · 🏭 Machines · 🧱 Structures · ✋ Edit. Tap a
  group to open its tools; tap a selected tool again to put it away.
- **🎓 Tutorial**: new games start with a guided walkthrough (+3 💎 per step, +10 💎 to finish). The card's
  **Hide** and **Skip** buttons tuck it away; ❓ Help → **🎓 Tutorial & tips** resumes it where you left off, starts
  it over, or shows a hidden card.
- **💡 Lessons**: after the basics, a short lesson pops up the first time each feature unlocks (contracts,
  research, suppliers & haggling, trucks between sites, specialists, the Launch Site, Mars, colonists at work,
  Mastery), highlighting what to press; +2 💎 each the first time. Turn them off, or replay any one, in
  Help → Tutorial & tips. Help sections for later parts of the game stay 🔒 until you get there.
- **🔍 Zoom**: pinch with two fingers (up to 4×), the ＋ / － buttons under 🌡️, or the mouse wheel; ⤢ fits it all
  back. While zoomed, pan with two fingers, or one finger with 🔍 Inspect selected (one finger always pans on
  Mars). One-finger building works as normal; a second finger cancels it, so pinching never lays conveyors.
- **Building**: valid spots are outlined whenever a tool is selected (green = build, orange = repair first,
  yellow = replaces what's there). Tap to place one piece; drag a conveyor line to preview it, then
  **✅ Place** or **✖ Cancel**. Building something different on top of an existing piece asks to
  confirm first (showing the refund, the new cost and the net), then swaps it (line pieces keep their
  direction).
- **Refunds**: 100% if removed within 2 minutes of building, sliding to 25% over the next 10 minutes.
  **Double-tap** anything you built to remove it (asks first, shows the refund).
- **💵 Finances**: tap your money (top-left) to see income and costs by category (last minute, 10 min,
  session), each site's running rates, and a feed of recent one-off charges and credits.
- **Jobs behind research**: Janitors, Techs, Operators and Forklift Operators are open from the start; the
  specialists unlock through research: 💼 Sales Rep (Marketing), 🛡️ Security (Logistics Network), ⛑️ Safety
  (Easy-Clean Floors), 📋 Ops Manager (Diagnostics), 🗂️ HR (Wellness Program), 🧾 Purchasing Agent (Negotiation).
  Facilities work the same way: Restrooms, Break Rooms and Racks are open; 🔌 Generator (Efficient Motors),
  🔧 Maintenance Shop (Heavy-Duty Parts), 🩹 First Aid (Easy-Clean Floors), 🛡️ Security Booth (Logistics Network),
  🖥️ Ops Center (Diagnostics), and the site unlocks also need 🏗️ Forklift Training, 🧪 Robotic Assembly, 🦾 Full Automation.
- **People**: tap a worker (🔍 Inspect) to see who they are, what they're doing, mood, pace and wage, let them
  go, or raise the site's pay rate (+15/30/50% wages for +5/10/15% morale). Badges on worker icons show
  who is unhappy (😟/😠), heading to a break (🚻/☕) or due one soon (⏳).
- **🔍 Inspect** (no tool selected): tapping shows what's there (wear, contents, costs) and opens
  assembler, sorter, rack and facility details without building anything.
- **🌡️ Overlays** (top-right of the warehouse): heatmaps for wear & breakdowns, floor condition, worker
  access, congestion, and facility coverage. Equipment over 75% worn always shows a small 🔧.
- **⚠️ Problems** pill: stuck workers, unreachable buildings and uncrewed assemblers; tap to jump there.
  Staff come in through any unlocked door with open floor just inside (a machine parked in front of one door
  doesn't lock them out), and anyone cut off (boxed in, or at a blocked door) walks back in by another door.
- **🔄 Updates**: the game checks for a newer version a few seconds after loading and every 10 minutes, and
  offers **Update now** (saves, then reloads at a fresh URL so phones don't keep a cached old copy).

## How it plays

**Goal: build a rocket.** Grow from a rusty shed into a supply chain that builds rocket parts.

- **7 warehouses**, each with its own raw material and role: 🛖 Rusty Shed (🔩 🪙), 🏭 Old Textile Mill (💿),
  ⚒️ Old Foundry (🥈 titanium), 🏬 Regional Depot (🧊 🧱), 🏗️ Coastal Refinery (⛽ kerosene),
  🔬 Clean Room Lab (💠 rare earth), 🏟️ Mega Hub (final assembly: assemblers 50% faster, rocket parts worth
  +50%), plus the 🚀 Launch Site. Staff cost more at bigger sites (wages scale a bit slower than build costs).
  Buying a site shows a **💡 Make it pay** checklist (roof, sales reps, scanner/labeler, wrapper), also on Manage → Upgrades.
- **🆕 Each site unlocks a new building** (usable everywhere once you own it): 🏭 Mill → 🌉 Conveyor Bridge
  (two lines cross), ⚒️ Foundry → 🧺 Accumulator (holds 20 packages, feeds them out steadily), 🏬 Depot →
  🏗️ Loading Crane (outside; +50% rack handling), 🏗️ Refinery → 🫙 Silo (100 of one product), 🔬 Lab →
  🧪 Research Bench (+25% research speed each, up to 8) and ⚙️ Precision Fab Cell (after 🔬 Full Automation:
  assemblers within 2 tiles work 50% faster), 🏟️ Hub → 🦾 Cobot Station (extra crew for assemblers within 3 tiles).
- **⚠️ Specialists a growing site needs**: once researched, going without them gets slowly worse (it builds over
  45–90 min, then fades 3× faster once covered): 🛡️ Security Guard or Security Booth at 4+ staff (theft up to ×4, then
  rack break-ins), ⛑️ Safety Officer at 6+ staff (accidents up to ×4, then inspector fines of a few minutes' wages),
  🗂️ HR Manager at 10+ staff (grievances, morale up to −20%). Staff cards say "needed" and show the current cost;
  site alerts warn past 25%. Ops Manager, Sales Rep and Purchasing Agent stay optional.
- **🚚 Suppliers**: tap a raw-material door to pick its supplier (Budget: cheap and slow · Standard · Express: fast
  and pricey) and **🤝 negotiate** a contract: make offers, read their mood, and don't run out their patience. Longer
  contracts get lower prices. A 🧾 **Purchasing Agent** renews deals automatically, but settles for less.
  You can also **⏸ pause** a door's deliveries when a line has more raw material than it can use.
- **🏭 Assemblers** turn ingredients into products (pick a recipe; wrong items back up, so sort first).
  Each has a mode: ▶ Run, ⏸ Pause, or 🚀 *Until the rocket has enough* (stops while the launch pad has enough
  of its part, letting shared ingredients flow on to the next assembler):

  | Product | Recipe | Product | Recipe |
  | --- | --- | --- | --- |
  | 🔲 Hull Panel | 2 🔩 | 🛢️ Fuel Tank 🚀 | 2 🔲 + 🧊 |
  | 🧵 Wiring | 2 🪙 | 🛡️ Fuselage 🚀 | 2 🔲 + 🧱 |
  | 📟 Circuit Board | 💿 + 🧵 | 🧪 Propellant 🚀 | 2 ⛽ + 🧊 |
  | 🟦 Alloy Plate | 🥈 + 🔩 | 🔥 Rocket Engine 🚀 | 🌀 + 🚰 + 🧱 |
  | 🚰 Valve | 🟦 + 🔲 | 🛰️ Avionics 🚀 | 💻 + 📡 + 🧵 |
  | 📡 Sensor Array | 💠 + 📟 | 🌡️ Heat Shield 🚀 | 2 🧱 + 🟦 |
  | 💻 Flight Computer | 2 📟 + 📡 | 🫁 Life Support 🚀 | 🧊 + 💻 + 🧵 |
  | 🌀 Turbopump | 2 🟦 + 🚰 | ☀️ Solar Array 🚀 | 2 💿 + 🧵 + 🟦 |

- **🚚 Logistics → Distribution**: for every product a site ships, set a plan: any mix of destinations
  (💰 sell, 🗄️ store here, another site's 📥 receiving dock, or the 🚀 Launch Site) with **weights** (exact
  weighted split) and optional **stock caps**, plus an overflow rule for when all are full (sell, or back up).
- **🗄️ Racks** are tiles you build with the Rack tool (drag to paint). Each holds 15 products and can
  be upgraded on its own (tap it) to 25 / 35 / 50, plus 10 slots of dock staging. Racks hold goods waiting for an outgoing truck,
  goods trucked in (waiting at the 📥 dock), and anything sent to **🗄️ Store here**. The bar on each SHIP
  door shows how full they are. Full racks back up the line, and arriving trucks wait to unload.
  Stored stock leaves on a truck when a destination has room, or via "Sell stored stock".
  Tap a rack to choose **what goes on it** (anything, or only certain products) to reserve space for specific goods.
  When an assembler is about to run out of an ingredient that's in storage (not enough for the craft after this
  one, and no conveyor delivered it in the last 10 s), a 🚜 Forklift Operator fetches up to 10 at a time from the
  nearest rack and drops them at the assembler. It costs one handling move per trip, and those trips go first (they
  can borrow moves ahead of docks and trucks). Forklifts finish a delivery before taking a break. Each assembler can be
  set to belt-only.
- **🌉 Bridges** have two lanes: east-west and north-south packages cross at the same time and only wait for room ahead.
- **👷 Workers walk the floor**: every staff member is a visible worker who path-finds over repaired
  floor and doors (stepping over conveyors), never over broken floor, walls, machines, racks or
  facilities. **Assembler Operators** crew assemblers (an assembler only runs while its operator stands
  beside it); techs walk to repairs before fixing; forklifts shuttle to racks; ops/security/safety staff
  man their facility; everyone takes breaks at restrooms and break rooms. Stuck workers show ❗ and raise
  a **⚠️ problems** pill on the warehouse screen; tap it for details and to highlight the spot.
- **🧽 Dirt & 🧹 janitors**: foot traffic dirties floors; restrooms and break rooms get dirty with each
  break and other buildings over time. Filthy floor blocks walking and filthy buildings stop working.
  Janitors clean automatically; 🔨 Repair (floors) and a building's details (Clean now) also work.
- **😊 Morale**: built from restroom/break room coverage, paid wages, recent accidents and filthy floors
  (+HR Manager). Low morale slows staff (down to 40% pace); below 50% for a while, staff quit.
- **🏢 Facilities** (Facility tool, one tile each): 🚻 Restroom and ☕ Break Room cover staff working within their
  range (up to a capacity; tap one for details and to upgrade range/capacity/break speed) and keep **morale** up (low morale weakens staff and raises accidents); 🖥️ Operations Center (+25% handling,
  +10% speed, 1 per site), 🩹 First Aid (−50% accidents, shorter stoppages), 🛡️ Security Booth (−50% theft),
  🔧 Maintenance Shop (techs 2× faster), 🔌 Generator (+12 ⚡).
- **🚜 Rack handling**: every put-away, truck load, truck unload and pick is one *move*. A site manages
  10 moves/min alone; each Forklift Operator adds 30, Operations Managers add 15% each. Goods sold
  straight to vendors skip the racks.
- **🚚 Logistics → Fleet**: each route lists its trucks live (loading n/cap with a departure countdown, idle time,
  arrival time, stuck unloading and why), with advice, Send now and Assign idle trucks. Buy trucks into your garage and assign them to routes; set each route's
  departure rule (ASAP / 10s / 30s / when full). Routes with no trucks pile up. New sites come with a truck; each truck you own makes the next 25% dearer.
- **⏫ Machine upgrades**: the Upgrade tool also works on value machines (Scanner, Labeler, Wrapper, Chiller):
  Mk II works 1.75× as fast (3× its build price), Mk III 3× as fast (8×, after 🔬 Quality Control), so they stop
  capping a busy line. Upgraded machines show a II / III badge.
- **Sell vs. supply**: Scanners, Labelers and Wrappers raise only the *sale* price.
- **🚀 Launch Site**: three stages (Booster, Upper Stage, Crew Capsule): 12 🛡️, 8 🛢️, 6 🔥, 16 🧪, 4 🛰️,
  4 🌡️, 2 🫁, 4 ☀️. Later rockets need 2× the parts.
- **Conveyors**: drag to draw; they curve and show merges automatically. Each tile holds one package,
  so belt speed caps throughput. Tiers: Basic → Fast → Express (research).
- **Handling classes**: fragile (💿📟🛰️) smashes on Express belts unless wrapped; cold (🧊) spoils until
  chilled; bulky (🧱🛢️🛡️🔥) rides at 60% speed and takes machines twice as long.
- **Sorters** pull a product (or a whole handling class) out a chosen side; **Splitters** deal packages
  out evenly.
- **Breakdowns**: all equipment wears with use and breaks down ⚠️. Tap to fix, or hire Maintenance Techs.
- **Staff** (per site, by headcount, paid per minute): Maintenance Tech, Operations Manager, Forklift
  Operator, Sales Rep, Security Guard (theft), Safety Officer (accidents), HR Manager.
- **Economy**: suppliers charge for raw materials (~half their price); the **💹 Market** price of each
  product drops as you sell it and recovers over time, with random booms and gluts.
- **⚡ Power**: machines and assemblers draw power; overloading a site slows them. Electrical adds capacity.
- **Research gates** advanced recipes: Propulsion (🌀 🔥), Guidance (📡 💻 🛰️), Thermal (🌡️), Habitat (🫁), Photovoltaics (☀️).
- **🚀 Launching**: the first rocket launches when you press LAUNCH, with a full cinematic (countdown, ignition,
  liftoff, staging, into space; skippable). After that, rockets can launch automatically as soon as their parts
  arrive (Launch Site → Auto-launch), with no animation. The Map button shows 🚀 when one is waiting.
- **🔴 Mars colony** (after the first rocket): every launch flies to Mars during a **launch window** (every 25 min of
  play, open 5 min; 6-minute trip; the pad needs 90 s between launches). Each rocket needs a fixed launch vehicle
  (4 🛡️ 3 🛢️ 2 🔥 6 🧪 1 🛰️; the pad stocks parts for two rockets) plus a 30-slot cargo manifest: one base module (12 slots: 🏠 Habitat, ⚡ Solar Farm,
  🌱 Greenhouse, 🧊 Ice Mine, 🛬 Landing Pad, 🔬 Research Station), colonists (2 slots) and supply crates (1 slot):
  🍞 Food Crate (3 🌾 Provisions + 🔲), 💧 Water/O₂ Canister (2 🧊 + 🟦), 🔧 Spares Kit (🚰 + 📟 + 🧵). Provisions come
  from a new supplier door on the Regional Depot. Colonists use supplies each window and make ⭐, 💎 and Rare Metals
  (sold once a Landing Pad flies them home); shortages mean rationing at half output and, after a while, colonists
  going home, never a wipe. Dust storms, colonist requests, population milestones and a 25 💎 emergency supply drop (one per launch window). Mission Control warns when
  terraform parts are starving the rocket (e.g. Turbopumps sent up instead of becoming Engines).
- **🗺️ Mars base map**: modules land as **kits**. Go to Mars like switching sites (🗺️ Map → 🔴 Go to Mars base): the
  base fills the main screen and the bottom bar becomes a Mars build bar (🔍 Inspect · 🏗️ Build · 📦 Move · ✨ Auto-place ·
  📊 Colony). Pick a kit and tap a tile on the 9×11 map (🛸
  Lander in the middle, 🪨 rocks you can't build on, two 🧊 ice fields); colonists build one site at a time (4–10 min of
  work, +4% speed per colonist, +50% with 🤖 Repair Drones). Ice Mines must sit on ice. Greenhouses, Ice Mines, the
  Research Station and the Landing Pad are offline unless a ⚡ Solar Farm (2 tiles) or ⚛️ Fusion Reactor (3 tiles)
  covers them. Colonists whose dome isn't finished shelter in the Lander at half output. 🚚 Relocate packs a building
  up to place it again (free before building starts; finished ones cost 2 🔧 Spares and keep 60% of the work);
  ✨ auto-place handles it all for players who'd rather not.
- **🔎 Details & 🪨 ore storage**: tapping a building, the Lander or a colonist on Mars opens a panel (crew, power, output,
  dust, residents; a colonist's name, job, current task and home). Mined Rare Metals are stored on Mars (Lander 30, each
  🛢️ Ore Silo +150; overflow is lost) and every rocket that lands at a working 🛬 Landing Pad flies up to 60 home.
- **👥 Colonist jobs & 🙂 morale**: colonists work at the buildings: farmers (Greenhouse, 2 each), ice crews (Ice Mine, 2),
  caretakers (1 per dome, keep the dust down), miners (⛏️ Metal Mine on a 🟫 metal vein, 3; ~8 Rare Metals each per window),
  mechanics (🔧 Workshop, 2; 6 Rare Metals → 3 Spares a window), scientists (Research Station, 2) and engineers (build and
  repair; repairs need one). Unstaffed buildings run at 30%; jobs fill automatically or by hand in 📊 Colony. Morale
  (base 70%: clean domes ±20, 🎳 Rec Dome within 3 tiles +20, Lander crowding −30, rationing −20, sickness −10, well
  stocked +5) scales output by 0.5 + 0.5 × morale, and below 35% colonists head home. New modules: ⛏️ Metal Mine (max 4),
  🎳 Rec Dome (max 3), 🔧 Workshop (max 2); all need power. Rare Metals now come mostly from mines (laborers scavenge 1 each).
  The colony runs on the game clock, so it pauses while you're away.
  **Later colony stage:** a 🔴 **Colony** research branch (after the first launch: lower needs, bigger habitats,
  heavy-lift rockets, faster transit and pad turnaround, Rare Metal refining, gentler rationing, ⚛️ Fusion Power,
  Terraforming); ☄️ meteor strikes (repair with Spares), 🦠 sickness (💊 Medical Kits) and 🌪️ dust storms (🔋 Power
  Cells); Rare Metals sold on arrival or delivered to a site for ⚛️ Fusion Cores (2 🪨 + 💻 + 2 🟦), which build the
  ⚛️ Fusion Reactor module; 🚧 launch pad upgrades; the 📦 Spaceport Cargo Center at the Mega Hub (+10 slots, faster
  pad); and a 💎 Cargo Boost.
- **🌍 Winning: Project Terraform** — three Mars stages delivered in rocket cargo: 🏭 Atmosphere Processors (20
  colonists + Fusion Power; halves water needs), 🧲 Magnetic Shield (40 colonists; ends dust storms and meteors) and
  🌊 Ocean Seeding (80 colonists + Terraforming Studies). Finishing plays an ending cinematic and a victory screen with
  your stats; then keep playing or start 🔁 New Game+ (+10% value per win, up to +50%). The 🏆 Road to victory tracker
  on the Map shows progress. New: 🧲 Superconductor (Rare Metals + Wiring).
- **Contracts** pay cash, ⭐ reputation and 💎 (rocket launches pay ⭐ too). **Research** is a tech tree in five branches (Production, Operations, Logistics, Business, Aerospace), 60 nodes over 5 tiers. Each node needs its prerequisites (some cross branches), costs ⭐ + cash, and takes 30 s–2 h in the lab, one project at a time (💎 can finish it early).
- **🏅 Mastery** (after the first launch, a Research tab): four repeatable upgrades bought with ⭐ + cash (no lab
  time): Market +3% value, Assembly +4% speed, Logistics +3% speed, Colony +5% Mars output per level; each level
  costs 25% more ⭐ and 40% more cash. **🌌 Megaprojects** (cash + 💎, one-off): 🛰️ Orbital Cargo Depot (+20 cargo
  slots, $20M + 150 💎), 🏗️ Spaceport Expansion (pad stocks 3 rockets, resets 30 s faster, $40M + 250 💎),
  🌐 Interplanetary Exchange (Rare Metals sell +50%, $75M + 400 💎). Mission Control also warns when the chosen
  module (e.g. a Fusion Reactor) eats parts Terraform still needs.
- **💎 Gems & boosts**: earnable premium currency for time-saving boosts. See
  [docs/MONETIZATION.md](docs/MONETIZATION.md).
- Test mode (`?dev=1`) can **🎬 jump to a stage**: new game, Shed, Mill, Foundry, Depot, Refinery, Lab, rocket ready to
  launch, Mars begins, growing colony and late colony, each with typical money, ⭐, gems, research, sites and upgrades,
  and every site built the way the playtest bot would have it by then (conveyor trunk, assemblers with recipes,
  sorters, racks, facilities, staff, value machines, distribution plans and trucks; `js/devlayout.js`).
  Use it with `?slot=test&dev=1` so your main save is safe.
- Add `?slot=name` to the URL (for example `?slot=test`) to play a separate save without touching your main one.
- Progress autosaves to localStorage, including a snapshot of the live floor (workers, packages on belts, recent
  sales and the finance ledger) so a reload picks up where you left off. While you're away, sites earn **15%** of their ~5-minute average rate for the first 2 hours, then half that, up to 6 hours (Night Shift / Night Managers research add +7.5% and +2 h each; scaled by maintenance coverage). A 🌙 **Night Crew** from the 💎 Gem Store keeps them at 40% for 4/8 banked hours.

## Code layout

| File | Purpose |
| --- | --- |
| `js/data.js` | Tunable data: properties, machines, belt tiers, upgrades, research, Mars modules/jobs, number formatting |
| `js/releases.js` | `GAME_VERSION`, release notes (Help), and the update check |
| `js/state.js` | Game state, layout generation, save/load, cost helpers, theft/accident/neglect rules |
| `js/sim.js` | Simulation: spawning, assemblers, sorters, cargo rules, breakdowns, routing, trucking, selling |
| `js/workers.js` | Walking workers: doors, path-finding, roles, breaks, morale, alerts |
| `js/heat.js` | Heatmap overlays |
| `js/contracts.js` | Contract offers, confidence, deadlines, rewards |
| `js/render.js` | Canvas drawing for warehouse sites |
| `js/ui.js` | Toolbar, panels, Help, objectives, touch input |
| `js/zoom.js` | Zoom & pan (pinch, buttons, wheel) and grid layout |
| `js/enterprise.js` | Map view, logistics (distribution plans + fleet), launch site, assembler recipes |
| `js/economy.js` | Market prices panel, 💎 boost shop, daily bonus |
| `js/research.js` | Research tree, lab, Mastery and Megaprojects |
| `js/suppliers.js` | Supplier tiers, negotiation, purchasing agents |
| `js/launchfx.js` / `js/endingfx.js` | First-launch and victory cinematics |
| `js/mars.js` | Mars colony: windows, cargo, base map, construction, supplies, events, ore, Terraform |
| `js/marscrew.js` | Colonist jobs, dusty domes, morale, Crew panel |
| `js/marsview.js` | The Mars screen: canvas drawing, build bar, taps |
| `js/marsinfo.js` | Tap details for Mars buildings, the Lander and colonists |
| `js/tutorial.js` | Basics tutorial, feature lessons, Tutorial & tips in Help |
| `js/finance.js` | Finances panel (money ledger by category) |
| `js/dev.js` / `js/devlayout.js` | Test mode (`?dev=1`): cheats, game speed, stage jumps with built layouts |
| `js/main.js` | Boot, fixed-step game loop, autosave, offline earnings |

Balance lives almost entirely in `js/data.js`. When shipping a change:

- bump the `?v=` number in `index.html` so browsers don't serve stale copies;
- for anything players notice, bump `GAME_VERSION` and add a note to the top of `RELEASE_NOTES` in
  `js/releases.js` (notes are single-quoted strings: write apostrophes as ’);
- a local git pre-commit hook refuses to commit if any `js/*.js` file has a syntax error.

## Path to app stores

The game is plain HTML5 Canvas, so it can be wrapped as a native iOS/Android app with
[Capacitor](https://capacitorjs.com/) without a rewrite. If the game outgrows Canvas
(3D, heavy effects), the sim/data layers port cleanly to Godot or Unity.
