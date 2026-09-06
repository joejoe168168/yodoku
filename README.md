# Yodoku 🦖

## Deploy with GitHub and Vercel

This is a Vercel-ready static site: `index.html` is the entry point and `vercel.json` supplies safe cache headers for the service worker and app shell. No build command or environment variables are required. Import the GitHub repository into Vercel and leave the framework preset as **Other** with empty build and output commands.

A cute Queens-style logic puzzle. Place one dino in every **row**, **column** and **colour region** —
and dinos never touch, not even diagonally. Starring **Yo**, an original chubby dinosaur.

Tap the logo to cycle **Yodoku → Kodoku → Pigdoku → Sludoko**, or choose a character directly in Settings. Meet **Ko**, a round-eared koala carrying eucalyptus, **Pip**, a pink pig with a curly tail, and **Snoo**, a cosy brown sloth with little claws. Switching keeps the same puzzle, notes, undo history and statistics. The choice persists after reload, including offline play.

All four characters have normal, happy and surprised expressions, placement sparkles, a greeting and a celebration. Ko has a soft eucalyptus/lavender palette and leaf confetti; Pip has blush/peach colours and heart confetti; Snoo has warm woodland colours and low gentle chimes. Animations respect reduced motion. Sounds are short original chimes, with a lower, softer sound set for Ko and brighter bouncy chimes for Pip; Settings includes mute and a sound preview. Audio starts only after interaction.

The [asset gallery](assets/index.html) includes SVG/PNG poses, eight animated GIFs and twenty-four WAV sound effects. GIFs are optional exports; gameplay uses lightweight SVG/CSS. The game shell caches sounds for offline play; the optional gallery exports are not precached. Installed home-screen branding remains Yodoku; the in-game title and browser favicon follow the selected character.

To regenerate the committed assets, run `npm install --prefix .qa --no-audit --no-fund sharp gifenc`, then `node build-assets.cjs`. This is a development tool; Vercel needs no build step.

## Play
Open `index.html` in any browser, or serve the folder (recommended, so the offline service worker and
"Add to Home Screen" work):

```bash
npx serve .          # or: python3 -m http.server 8080
```

On iPhone: open the page in Safari → Share → **Add to Home Screen**. It launches full-screen like an app,
respects the notch/home-bar safe areas, and works offline after the first visit.

## Features
- **Extreme 10×10** adds a larger challenge with ten distinct, connected colour regions and one logic-solvable solution. It has its own saved progress, undo history and statistics. Daily keeps its existing schedule.
- **Varied friends** adds bow ties, explorer hats and cosy scarves to all four themes. Looks stay consistent by region and never indicate whether a move is correct. Toggle them in Settings; tap the character previews for a greeting and sound.
- **Your cosy collection** awards permanent milestones at 1, 5, 15 and 30 puzzles solved across any mode. Hints are welcome; there are no deadlines. See collection progress in Settings and after each win.
- Compact phone layout keeps the board nearly full width, hides the welcome banner during play, and uses one-row controls. On small landscape screens the controls sit beside the board. Idle feedback collapses; mistakes and hints expand when needed.
- Tap **7 colours** (or the current board's colour count) to inspect every region, including tiny one-square regions. Select a numbered colour to highlight its squares. One-square regions are valid puzzle clues.
- Generated and saved boards are checked for exactly N connected regions and a valid solution. Invalid saved boards are backed up under `yodoku.recovery.<mode>` in local storage before a fresh puzzle is loaded.
- Endless generated puzzles at **Easy 6×6 · Normal 7×7 · Hard 8×8 · Ultra 9×9**, each with exactly one
  solution and solvable by pure logic (no guessing), plus **Extreme 10×10**.
- **Daily** puzzle — same board for everyone each day, with streaks.
- **Cycle**, **Dino**, and **X mark** tools; drag to paint or erase X notes. **Auto X starts off**, with a visible toggle beside the board. Turning it off removes automatic notes and preserves manual notes.
- Redrawn SVG dinosaur with normal, happy, and surprised expressions; matching home-screen icons, a garden palette, and responsive desktop/mobile layouts.
- Keyboard: focus the board with Tab, use arrows to move, D to place/remove a dino, X to mark/unmark, Delete to clear, and Ctrl/Cmd+Z to undo. Dialogs support Escape and keep keyboard focus inside.
- Gentle mistake feedback outlines every conflicting dino, adds an **!** badge and surprised face, and explains the rule below the board. Tap **Next conflict** to inspect another issue; **Undo move** fixes accidental input. A full but invalid board always explains why it is unfinished. No lives or penalties.
- The progress bar counts dinos without rule conflicts; it does not secretly check the solution. Optional **Check against solution** in Settings flags incorrect placements too (off by default).
- **Region patterns & numbers** in Settings make regions identifiable without colour. Both accessibility settings persist across visits.
- **Hints** have three deliberate stages: an area to consider, an explanation, and exact cells on request. Hints never play a move for you; the next move or Dismiss clears them. One hint is counted per sequence.
- Open **Help → Try a 30-second practice** for an interactive four-step lesson on placement, notes, diagonal spacing, and completing a board. Practice never changes your saved puzzle or stats.
- At completion every dino celebrates before the win screen opens. Reduced motion skips confetti and minimizes animations.
- Mistake highlighting, logic-based **hints** that point at the next deduction, undo, clear, timer,
  best times, share card with emoji grid, sounds & haptics (all toggleable in Settings).
- Progress, the exact puzzle layout, and undo history are saved per mode in `localStorage`, so you can switch tabs or reload and come back. The timer pauses in Help/Settings and while the page is hidden. Reduced-motion preferences disable confetti and board transitions.

## Browser checks

Run `node qa-extreme.cjs` for 250 Extreme boards covering ten connected regions, unique solutions, logic solvability, completion, deterministic generation and rejection of missing regions.

The detailed feature audit, confirmed fixes, coverage and limitations are in [AUDIT.md](AUDIT.md). Additional regression commands are `node qa-engine-audit.cjs`, `node qa-gameplay-audit.cjs`, and `node qa-offline-audit.cjs`.

Run `node qa-regions.cjs` for a 1,000-puzzle regression covering region counts, connectivity, valid placements, uniqueness, and malformed data across all four difficulties.
Run `npm install --prefix .qa --no-audit --no-fund playwright sharp`, then `node qa.cjs` (uses installed Microsoft Edge). This checks manual/automatic notes, persistence, keyboard and touch input, drag undo, rule feedback, invalid completion, solution checking, patterns, graduated hints, the separate touch tutorial, reduced-motion completion, and responsive layouts. It also regenerates the icons and preview screenshots. Phone coverage uses browser touch emulation; physical Safari/iOS and Android checks are still recommended.

## Files
| File | What |
|---|---|
| `index.html` | Markup, styles, and the SVG sprite for Yo (normal / happy / oops faces), egg, X mark and UI icons |
| `engine.js` | Puzzle generator, uniqueness solver, human-style logic solver (difficulty rating + hints), daily seed |
| `app.js` | Game UI: touch input, auto-X bookkeeping, undo history, timer, stats, win screen, confetti, share |
| `manifest.json`, `sw.js` | PWA manifest and offline cache |
| `icons/` | `icon.svg` source plus rendered PNGs (apple-touch-icon 180, 192, 512, maskable 512) |

## How puzzles are made (engine.js)
1. Pick a random valid dino layout (one per row/col, none touching).
2. Grow one colour region out of each dino with weighted random flood-fill.
3. If the board has more than one solution, nudge boundary cells that an alternate solution depends on
   (keeping regions connected) until it is unique.
4. Grade it with a human-style solver (singles → confined regions → region sets → one-step lookahead)
   and keep sampling until the score lands in the difficulty band. Typical generation time: a few ms.

`Yodoku.generate({ difficulty: 'hard', seed: 123 })` uses a fixed candidate budget so the same seed and game version give the same board on different devices. Existing saved layouts are retained across updates. Daily uses the local calendar date; finishing after midnight credits the puzzle's date, and the Today button opens the new Daily.

When changing the app shell, bump the cache version in `sw.js`. The service worker installs and serves a matching set of files for each release, including offline.
