# Grassland Pilot — Overnight Progress Report

**Date:** 2026-06-21 (worked through the night per your "go as far as you can")
**Branch:** `motion-eval-system` — all work committed.
**Screenshots:** `docs/pilot-screenshots/` (01 village overview, 02 fieldstone wall+doors, 03 headless facade mock, 04 crop-strategy comparison)

## TL;DR

**Grassland buildings now render with per-building, varied-but-coherent materials in the real game, verified end to end.** I wired the generated grassland library into the live render path, made the wall tiling look good, and confirmed it works by driving the actual game and rendering the real ship code. Two things are deliberately left for your eye: the **roof texture is flat (needs slope shading)** and the **decoupled Aperture doors/windows were not built** (the visible pilot didn't need them, and they're the subjective-art part you wanted to judge).

## What's done and verified ✅

1. **Material assignment (Approach B, building-gen untouched).** `resolved-buildings.js` stamps `biome / wallSlug / roofSlug` onto every building at the `settlementCandidates` chokepoint, via **rendezvous hashing**. Headless test (`scripts/_test_material_assignment.mjs`) proves determinism, coherence, even distribution, and the gradual-adoption property (adding a 5th material moved **82/400** buildings, **318 unchanged**).
2. **Per-material GL render** (`building-occluder.js`) with stone_brick fallback for the 20 not-yet-generated biomes. Roofs skinned with the assigned roof texture instead of soil (`roof-ingame.js`).
3. **Zoom-robust facade-tile wall sampling.** The first attempt (mod-4 column) fragmented diagonal timber braces; I compared four strategies (screenshot 04) and switched to drawing each tile's slice of a uniformly-scaled 4-tile facade unit — preserves braces/coursing AND tiles to any width at any zoom (screenshot 03).
4. **Confirmed live in-game.** Served the client, drove it with Playwright, and:
   - Resolved **364 grassland buildings**, each with a coherent `wall/roof` pair, all 4×4 combinations appearing across the village — proof the full pipeline (gen → stamp → assignment) works in the real game.
   - Headless Chromium can't do WebGL (the GL *display* is black), so I rendered the **real `drawBuildingTextured` ship code** to a 2D canvas with the real assets → screenshots **01** (village: distinct gold-thatch / green-sod / red-clay roofs + stone & timber walls) and **02** (a fieldstone wall with doors/windows and clean coursing).

Commits this session:
- `feat(buildings): wire per-building material assignment + render (Part C)`
- `feat(render): zoom-robust facade-tile wall sampling for pilot assets`
- (earlier) the manifest, generation pipeline, grassland v1 assets, specs, preview harness.

## Decisions I made autonomously (second-guess freely)

- **No re-gen needed for the visible pilot.** The facade-tile rendering makes the existing 128² grassland assets tile cleanly, so I did *not* regenerate walls. (The spec's per-tile re-gen is now optional, not required, for a good look.)
- **Field names** `wallSlug` / `roofSlug`; **pilot wear = normal**; **all 16 wall×roof combos** (separate hash salts); **door/window shape varied per building** from the hash.
- **Doors render as the baked facade door** (closed) for now — not the decoupled procedural Aperture.

## What needs your eye / not done ⚠️

1. **Roof texture is flat (top priority).** Roofs now use the right material (thatch/clay/sod) instead of soil — but the texture is painted as a flat fill, so the procedural roof's height-steps show as concentric color bands instead of a shaded pitched roof (screenshots 01/02). Two paths: (a) multiply the texture by the procedural material's slope shading in `drawRoof`, or (b) map `roofSlug` → the existing procedural roof *recipe* (shingle/slate/clay/thatch/sod are already shaded) and skip the flat PNG. You leaned toward "paint textures on" — I'd recommend (a). Your call.
2. **Aperture system not built.** Doors/windows are still the baked facade feature, not the decoupled, game-registered, procedurally-swinging leaf we specced (`2026-06-20-aperture-and-material-integration-design.md`, Part B). The visible pilot didn't need it, and the doorway-opening art + leaf normalization are exactly what you wanted to judge. This is the clear next chunk.
3. **Other 20 biomes** have material slugs assigned but no generated assets → they render stone_brick (honest absence). Scale-out is additive whenever you want it.

## How to see it yourself (live, with real WebGL)

A static server may still be running on :8099. If not:
```
python -m http.server 8099   # from the project root
```
Open `http://localhost:8099/` in your browser (real WebGL works there), then in the console:
```js
_player.x = 1175; _player.y = 305;   // a grassland village (seed 42)
```
Walk around — you'll see the varied/coherent materials live. (`window._buildingMaterials` isn't a toggle yet; tell me if you want one for A/B vs stone_brick.)

## Suggested next session

1. Fix roof shading (path a or b above) — biggest visual win.
2. Build the Aperture doors/windows (decoupled leaf + procedural swing) per the spec.
3. Optionally scale generation to `forest, desert, mountains` (additive, ~30 min each).
