# Ancient Age

A mobile-first 3D real-time strategy game for the browser. Pick **Egypt**, **Greece**
or **Rome**, build a settlement from three villagers and a town centre, and raze the
enemy town centre before they raze yours. A match runs roughly 8–15 minutes.

Everything you see is generated at runtime from procedural Three.js geometry — there
are no textures, models or audio files in the repository.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle in dist/
npm run preview  # serve the built bundle
npm run typecheck
```

## Deploying

The build is a fully static bundle — no server, no runtime asset fetches — so it can be
hosted anywhere that serves files. `vite.config.ts` sets `base: './'`, so the bundle
works from a subdirectory as well as from a domain root.

`.github/workflows/deploy.yml` builds every push (typecheck + build) and publishes the
default branch to GitHub Pages. To turn it on once, in the repository: **Settings →
Pages → Build and deployment → Source: GitHub Actions**. The next push to the default
branch publishes to `https://<owner>.github.io/<repo>/`; the run's deploy job prints the
live URL.

Any other static host works the same way — build with `npm run build` and serve `dist/`
(Netlify, Vercel, Cloudflare Pages: build command `npm run build`, output directory
`dist`).

## Playing

Touch keeps the one-finger scheme; a mouse and keyboard get the Age of Empires
conventions instead. Both are live at once, so a hybrid laptop behaves sensibly
whichever you reach for.

| | Touch | Mouse / keyboard |
|---|---|---|
| Look around | drag | screen edge, `WASD` / arrow keys, or middle-drag |
| Zoom | pinch | scroll wheel, or `+` / `-` |
| Select | tap a unit or building | left-click, or left-drag a box |
| Add to selection | — | `Shift` + left-click |
| Select all of a type | double-tap a unit | double-click (everything on screen) |
| Move / attack / gather | tap the ground, an enemy or a resource | **right-click** the same |
| Build | **Build** → pick a building → drag the ghost → release | `B`, pick, left-click to place, right-click to cancel |
| Menu | ☰ | `Esc` |
| Centre on base | 🏠 button | `Space` or `H` |

### Keyboard

| Key | |
|---|---|
| `W` `A` `S` `D` | scroll the map (arrow keys do the same) |
| `Q` `E` `R` `T` `Y` | the buttons of whichever panel is open |
| `Z` `X` `C` `V` | the build menu's category tabs |
| `Shift` + `1`…`0` | assign a control group (`Ctrl` also works where the browser allows it) |
| `1`…`0` | select that group; press twice to jump to it |
| `H` | select your town centre |
| `B` | build menu |
| `.` / `,` | next / previous idle villager |
| `Delete` | delete the selected units |
| `F1` or `?` | the full controls reference |

The grid hotkeys follow the panel: with the town centre selected `Q` trains a villager,
and with the build menu open `Q` picks the first building on the open tab while `X`
switches to Military. The rows step around `WASD`, which belongs to the camera. Every
button carries its letter, so the key under a button is always the one that presses it.

The right-hand rail selects your whole army, cycles idle villagers, recentres on the
town centre and mutes sound. Left-click or drag the minimap to move the camera;
right-click it to send the selection there.

`?seed=12345` replays a specific map, `?enemy=rome` forces the opponent's
civilisation, and `?fps=1` shows a frame counter.

## The loop

Gather food, wood, gold and stone → build houses for population, a storehouse near
your woodline, a barracks and an archery range → research **Bronze Age** at the town
centre → raise your faction monument to unlock your elite unit and its doctrine →
push out and destroy the enemy town centre. Resource nodes deplete, so farms and
docks matter in the late game.

The opponent runs the same rules you do: it manages a demand-driven worker economy,
builds drop-off points near what it is mining, techs up, walls itself in with towers,
defends when raided, and sends attack waves that grow in size and composition. It
will win if you sit still.

### Civilisations

| | Passive | Elite | Doctrine (monument) |
|---|---|---|---|
| **Egypt** | Farms cost 25% less and hold 40% more food; villagers gather food 15% faster | War Chariot — fast ranged elite | +2 attack, +20% speed for chariots |
| **Greece** | Melee units +2 armour; towers +2 range and +20% damage | Hoplite — heavily armoured spearman | +35 HP, +2 armour for hoplites |
| **Rome** | Buildings raised 35% faster with +20% HP | Legionary — fast swordsman, bonus damage to buildings | +4 attack; buildings slowly self-repair |

## Architecture

Simulation and rendering are separate. `src/sim` never imports Three.js, and `src/render`
never mutates game state — it reads the simulation each frame and interpolates.

```
src/
  core/       seeded RNG, small math helpers
  sim/        the game itself, headless and deterministic for a given seed
    data.ts     unit / building / tech / faction tables and all balance numbers
    grid.ts     navigation grid + A* with string-pulled paths
    mapgen.ts   terrain, coastline, cliffs, resource and decoration placement
    game.ts     entities, economy, construction, production, combat, victory
    ai.ts       the skirmish opponent
  render/     Three.js: procedural geometry, instancing, effects, minimap
  ui/         DOM overlay (HUD, build menu, screens) and inline SVG icons
  input/      unified pointer handling for touch and mouse
  audio/      Web Audio synthesis, no assets
```

The simulation runs on a fixed 20 Hz timestep; the renderer interpolates between the
previous and current tick, so visuals stay smooth independently of frame rate.

### Performance notes

- Every unit and building is a single merged, vertex-coloured geometry, drawn through
  a shared `InstancePool` — a full match renders in roughly 40–75 draw calls.
- Instance pools track a high-water mark so unused slots cost nothing.
- Path requests are budgeted per tick and throttled per unit; paths are string-pulled
  so units take direct routes.
- Shadow casters are limited and the shadow frustum follows the camera.
- The renderer picks defaults from the device (pixel ratio, shadows) and drops
  quality automatically if the frame rate stays low.

## Licence

MIT.
