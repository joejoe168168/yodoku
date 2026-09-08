# Ember & Tide — a Forest Temple co-op platformer

Single-file HTML remake in the spirit of *Fireboy and Watergirl in the Forest Temple*.
Open `ember-tide.html` in any modern browser. No build step, no dependencies (Google Fonts optional).

## Controls
- Ember (Fireboy): ← → move, ↑ jump — walks through lava, dies in water
- Tide (Watergirl): A D move, W jump — swims through water, dies in lava
- Green goo kills both. R restart · P/Esc pause · M mute · Shift/Tab swap hero in Solo mode

## Mechanics
Elemental pools, red/blue gems, walk-through levers, hold-buttons, elevators & gates,
auto-cycling ferries, pushable crates (they float in any pool and can hold buttons),
counterweight plates (weight on A sinks A and lifts B), paired exit doors.
Rank A = all gems + under par, B = one of the two, C = finished. Progress saved in localStorage.

## Levels (29 chambers)
1 First Steps · 2 Crate Expectations · 3 Goo Gully · 4 The Shaft · 5 Counterweight
6 Bridge of Goo · 7 Twin Towers · 8 River Crossing · 9 Crate Tower · 10 Curtain Call
11 Crate Ferry · 12 Gatekeepers · 13 Split Shaft · 14 Tidal Pools · 15 Lava Falls
16 Ferry Relay · 17 Crate Lift · 18 Double Cross · 19 The Final Chamber

Bonus chambers, unlocked after the original campaign:
20 Ashen Stairway · 21 Signal Exchange · 22 Reservoir Run · 23 Lantern Lift
24 Island Hoppers · 25 Cargo Lock · 26 Elemental Divide · 27 Falling Gardens
28 A Helping Hand · 29 Temple Afterglow

Existing ranks and best times keep their original level numbers. Players who already
completed level 19 automatically unlock level 20 when opening the updated game.
The level map fits all 29 chambers in four rows.

Run `node ember-tide/qa-bonus-levels.cjs` from the repository root to validate all
map dimensions and replay levels 20–29 using the production physics. Each bonus
route collects every gem and reaches both exits without deaths, under par time.
The original 19 chambers were previously verified by a scripted physics bot.

Curtains / deep pools: a vertical column of lava/water tiles (a tile with the same liquid above it)
renders as a falling curtain — only the matching hero can walk through it.

`levels-pack.js` holds levels 10–18 as standalone objects, ready to paste into any other build's LEVELS array.

## Editing levels
Levels live in the `LEVELS` array inside the file: a 32×20 ASCII map
(`#` stone, `L` lava, `~` water, `G` goo, `F/W` spawns, `f/w` doors, `r/b` gems)
plus an `ents` list (plat / lever / button / box / pulley). See the legend comment above the array.
