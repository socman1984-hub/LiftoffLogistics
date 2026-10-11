# Monetization plan: "pay to speed up, never pay to win"

## Principles

1. **Everything is earnable by playing.** Gems (💎) drop from normal play, so a free player can use every boost; paying only gets you there sooner.
2. **Boosts save time. They don't add power.** No boost unlocks a recipe, site, machine or research you couldn't otherwise get, and none raises a cap (staff max, slots, floor size).
3. **No randomized purchases.** No loot boxes and no gacha. You always know exactly what you're buying.
4. **No pressure tactics.** No countdown "deals", no punishing free players, and no energy systems that stop play.
5. **Respect the player's time offline.** In-play boosts only run while playing (game clock), and Night Crew hours are only used while actually away, so nothing is wasted.
6. **Offline is slower by design.** Sites earn 30% of their live rate while you're away (45% with research), up to 8h (12h). That rewards playing, and Night Crew lets paying or saving players catch up.

## Currency

| Source (free) | Gems |
|---|---|
| Starting balance | 10 |
| Each tutorial goal completed (20 goals) | 3 each, 60 total |
| Each contract completed | 1 |
| Daily login bonus | 5 |
| Each rocket launched | 50 |

A free player who plays daily earns roughly **10–20 gems/day**: enough for a Double Earnings or Time Warp every day or two. All values live in `GEMS` in `js/data.js`.

## What gems buy (implemented in `js/economy.js`; all listed in the 💎 Gem Store)

| Boost | Cost | Effect | Why it's fair |
|---|---|---|---|
| 💰 Double Earnings | 15 | Sales ×2 for 30 min of play | Same money as playing longer |
| ⏱️ Time Warp | 20 | Instantly collect 1 hour of current net income | Literally skips time; scales with what you built |
| 🚛 Express Freight | 10 | Inter-site trucks 3× faster for 30 min | Buying trucks achieves the same |
| 🧰 Emergency Crew | 5 | Fix every breakdown, service all equipment | Maintenance Techs do this for free over time |
| 🌙 Night Crew 4h / 8h / 24h | 10 / 18 / 45 | Sites earn at 100% (instead of 30%) for that many hours away; hours are banked and only used while offline | Offline income is a bonus on top of play, not a requirement |
| 💰 Double offline payout | 8 | Doubles the "welcome back" payout | Offer appears on the return screen |

Time Warp ignores Double Earnings so the two can't be stacked.

## Real-money gem packs (placeholder in the shop)

| Pack | Price | Gems/$ |
|---|---|---|
| 80 💎 | $1.99 | 40 |
| 450 💎 "Popular" | $9.99 | 45 |
| 1000 💎 "Best value" | $19.99 | 50 |

Keep the value curve gentle (no "99% bonus" whale bait).

## Other options worth adding later

- **Rewarded video ads (opt-in):** watch an ad for 2 gems or to double an offline payout. Cap it at about 5 per day. Ads must never be forced.
- **"Remove ads + supporter" one-time purchase ($4.99):** removes ad prompts, gives a cosmetic badge and 100 gems. A one-time fee feels fairest for this genre.
- **Cosmetics:** belt skins (chrome, neon), truck paint, warehouse themes, rocket paint jobs and launch effects. Zero gameplay impact, strong appeal.
- **Season / milestone pass (optional, later):** free track plus a paid track of *cosmetics and gems only*.
- **Starter pack (one-time, ~$2.99):** gems plus an exclusive cosmetic. Don't put power in it.

## Things to avoid

- Selling exclusive recipes, sites, machines or permanent multipliers.
- Raising caps for money (extra staff slots, extra contract slots).
- Gem prices so high that free play can't reasonably afford boosts.
- Interrupting play with store pop-ups. Offer boosts only at natural moments (the return screen, a stalled line).

## Technical path

1. Wrap the game with **Capacitor** for iOS/Android.
2. Use a billing plugin (e.g. RevenueCat or `cordova-plugin-purchase`) for consumable gem packs.
3. **Validate purchases server-side** before granting gems. Right now gems live in localStorage and are trivially editable, which is fine for a prototype but not for real money.
4. Move the save to a cloud account (also enables cross-device play) before launching paid items.
5. Platform rules: Apple and Google require their own billing for digital goods, and loot-box odds disclosure (not applicable; we don't use them).
