# Façade-Block Building Pilot — Morning Handoff (2026-06-22)

You asked me to replace the ugly per-tile wall/roof/door assembly with **large PixelLab-generated
whole-building sprites** ("façade blocks"), keep the placement + interior systems, generate the
grassland set, and have something to look at. **Done — and it works.** Buildings now render as
coherent, attractive sprites through the GL pipeline instead of seam-y assembled tiles.

## How to see it
1. Branch: **`building-facade-blocks`** (off `motion-eval-system`). `git checkout building-facade-blocks`.
2. Dev server on `:8123` (no-cache). Load the grassland settlement (seed 42 ≈ x1835–1965, y2005–2098;
   e.g. spawn near the manor at 1928,2036 or the house at 1863,2040).
3. It's **ON by default**. Toggle old vs new in the console: `window._facadeBlocks = false` (old tile
   path) / `true` (façades).
4. Reference screenshots I captured: `tools/_fac_house.png`, `_fac_manor.png`, `_fac_civic.png`,
   `_fac_bazaar.png`, `_fac_play.png`, `_floor1.png` (upper-floor interior).

## What works
- **Exterior façades** — 12 grassland archetypes (cottage, house, shopfront, workshop, barn, chapel,
  civic_hall, manor, temple, round_tower, apartment, market_stall), 16 sprite variants. Verified
  in-game: **house, manor, civic_hall, market_stall** all render beautifully, lit/toned by GL,
  grounded on terrain, depth-sorted with each other and the player.
- **Interior consistency (1:1)** — walking into a building shows the diegetic floor built from the
  SAME `footprint.sections` the sprite is anchored to, so interior ⟷ exterior match by construction.
  Entering auto-suppresses the exterior sprite (the building layer is gated `!_inside`).
- **Multi-floor navigation** — verified: manor floor 0 (lobby) → floor 1 (residential) via the
  existing stair/lift system; camera recedes + outer world dims per floor. The **automated lift**
  (auto-ascend; push south to descend) is the pre-existing mechanism and uses the same verified
  `changeFloor` core — its marker appears only in buildings with >3 above-ground floors (apartments/
  towers), so use one of those to see the lift specifically.
- **Honest absence** — open/object "buildings" (well, fountain, monument, bridge…) draw NOTHING
  rather than a fake brown walled box. The old tile path is fully preserved as the fallback.

## Console knobs
- `window._facadeBlocks` — master on/off (default on).
- `window._facadeFit = { groundOffsetTiles, heightScale }` — nudge every building's vertical anchor
  / overall size live.
- `window._reloadFacadeManifest()` — re-fetch the manifest after regenerating sprites.

## The asset pipeline (so you can extend it)
- Generate: PixelLab `create_map_object`, **`view: "side"`** (KEY: this reliably gives a flat FRONT
  ELEVATION; `low top-down` often comes back isometric for tower/complex shapes and clashes with the
  axis-aligned grid). Max canvas 400×400, ~15–30s each, **auto-deletes after 8h** (download at once).
- Post-process: `node scripts/gen-facade-manifest.mjs` — trims PixelLab's baked grass apron
  (green-key in the bottom band + connected-component island drop), measures anchors, writes
  `assets/pixelab/buildings/facade/facade-manifest.json`. Re-runnable.
- Layout: `assets/pixelab/buildings/facade/grassland/<archetype>/whole__v*.png` (used), `raw__v*.png`
  (pre-trim), `iso__v*.png` (rejected isometric rolls, excluded).
- Type → archetype mapping + per-archetype `HEIGHT_TILES`: `src/render/facade-archetypes.js`.

## Key code
- `src/render/building-facade.js` — the renderer (`drawBuildingFacade`, manifest load, variant pick,
  height-scaled + footprint-centered placement).
- `src/render/building-occluder.js:~530` — the one seam: `drawBuildingTextured` calls the façade
  first; falls through to old tiles only for UNMANAGED types. Depth pass reuses this → occlusion free.
- `src/render/door-leaves.js`, `src/render/building-shadow.js` — skip façade-managed buildings.
- Spec: `docs/superpowers/specs/2026-06-22-building-facade-blocks-design.md`.

## Known limitations / what I'd do next (your call)
1. **Faint base remnant** on a few sprites (e.g. manor has a pale ground-halo ghost the apron-trim
   couldn't fully sever). Minor; barn/house are clean. Options: regenerate those with `view:side`
   (which produced the cleanest bases), or a smarter base crop.
2. **Per-archetype size tuning** — `HEIGHT_TILES` are first-pass; manor/civic read slightly tall.
   Easy to dial via `window._facadeFit.heightScale` then bake into `facade-archetypes.js`.
3. **8 of 12 archetypes verified in-game by code path, not by eye** (their sprites are all good;
   placement is uniform). Worth spawning at each type once.
4. **Interior visual polish** — floors render as a flat tiled material (pre-existing interior system,
   unchanged by this pivot). Consistency + navigation work; making interiors *pretty* is a separate
   pass.
5. **Other biomes** — only grassland generated (as requested). Same pipeline scales: generate per
   biome into `facade/<biome>/`, re-run the manifest script.
6. **Branch not pushed** — committed locally on `building-facade-blocks`; say the word and I'll push.

## The one judgment call you asked me to make
You said: if this won't work, go back to the old way — but the old way looked terrible. **It works.**
PixelLab's strength is coherent discrete objects (whole buildings), which is exactly what the tile
approach couldn't do. We do it this way.
