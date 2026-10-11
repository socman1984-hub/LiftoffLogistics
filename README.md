# Liftoff Logistics (prototype)

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

- **Toolbar**: one row of groups: 🔍 Inspect · ➡️ Conveyors · 🏭 Machines · 🧱 Building · ✋ Edit. Tap a
  group to open its tools; tap a selected tool again to put it away.
- **🔍 Inspect** (no tool selected): tapping shows what's there (wear, contents, costs) and opens
  assembler, sorter, rack and facility details without building anything.
- **🌡️ Overlays** (top-right of the warehouse): heatmaps for wear & breakdowns, floor condition, worker
  access, congestion, and facility coverage. Equipment over 75% worn always shows a small 🔧.
- **⚠️ Problems** pill: stuck workers, unreachable buildings and uncrewed assemblers; tap to jump there.

## How it plays

**Goal: build a rocket.** Grow from a rusty shed into a supply chain that builds rocket parts.

- **7 warehouses**, each with its own raw material and role: 🛖 Rusty Shed (🔩 🪙), 🏭 Old Textile Mill (💿),
  ⚒️ Old Foundry (🥈 titanium), 🏬 Regional Depot (🧊 🧱), 🏗️ Coastal Refinery (⛽ kerosene),
  🔬 Clean Room Lab (💠 rare earth), 🏟️ Mega Hub (final assembly), plus the 🚀 Launch Site.
- **🏭 Assemblers** turn ingredients into products (pick a recipe; wrong items back up, so sort first):

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
- **🚚 Logistics → Fleet**: buy trucks into your garage and assign them to routes; set each route's
  departure rule (ASAP / 10s / 30s / when full). Routes with no trucks pile up. New sites come with a truck.
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
- **Contracts** pay cash, ⭐ reputation and 💎; **Research** spends ⭐ on machines, recipes and perks.
- **💎 Gems & boosts**: earnable premium currency for time-saving boosts. See
  [docs/MONETIZATION.md](docs/MONETIZATION.md).
- Progress autosaves to localStorage. Sites earn **30%** of their live rate while you're away (45% with Night Shift research, scaled by maintenance coverage); a 🌙 **Night Crew** from the 💎 Gem Store keeps them at 100% for 4/8/24 banked hours.

## Code layout

| File | Purpose |
| --- | --- |
| `js/data.js` | Tunable data: properties, machines, belt tiers, upgrades, number formatting |
| `js/state.js` | Game state, layout generation, save/load, cost helpers |
| `js/sim.js` | Simulation: spawning, assemblers, cargo rules, breakdowns, routing, trucking, selling |
| `js/workers.js` | Walking workers: path-finding, roles, breaks, alerts |
| `js/heat.js` | Heatmap overlays |
| `js/contracts.js` | Contract offers, deadlines, rewards |
| `js/enterprise.js` | Map view, logistics (distribution plans + fleet), launch site, assembler recipes |
| `js/economy.js` | Market prices panel, 💎 boost shop, daily bonus |
| `js/dev.js` | Test mode (`?dev=1`): cheats and game speed for playtesting |
| `js/render.js` | Canvas drawing |
| `js/ui.js` | Toolbar, panels, objectives, touch input |
| `js/main.js` | Boot, fixed-step game loop, autosave, offline earnings |

Balance lives almost entirely in `js/data.js`. Bump the `?v=` number in `index.html`
after changing files so browsers don't serve stale copies.

## Path to app stores

The game is plain HTML5 Canvas, so it can be wrapped as a native iOS/Android app with
[Capacitor](https://capacitorjs.com/) without a rewrite. If the game outgrows Canvas
(3D, heavy effects), the sim/data layers port cleanly to Godot or Unity.
