# Atmosphere, Lighting & Chunk Streaming — Design

**Date:** 2026-06-10
**Status:** Approved by user
**Companion data:** `2026-06-10-biome-atmosphere-tuning.json` (user's per-biome tuner selections — ground truth)

## Goals

1. Dramatic, opinionated, per-biome lighting and atmosphere: color grading, mood direction, long steep-sun shadows, sunbeams (god rays), cloud shadows, fog, water reflections, phase-tinted precipitation.
2. Seamless spatial blending of atmosphere between biomes — no perceptible snap when walking across borders (hard requirement).
3. Fix nighttime being too dark via per-biome "night floor".
4. Eliminate chunk-adoption stutter while walking.
5. Faster time-to-playable: gate on viewport + 1-chunk ring complete, stream the rest invisibly. The player must never see an unpainted tile.

Non-goals: re-architecting the asset pipeline; reducing total asset download; 2D-canvas parity with the GL look.

## Architecture: GL atmosphere pass (Approach A + 2D particle reuse)

All spatial/color atmosphere work happens in the existing WebGL2 present shader in `gl-compositor.js`, following the proven water-shimmer-field pattern. Existing 2D precipitation particles are kept and color-synced.

### 1. Core data flow

- **`src/world/biome-atmosphere.js`** (new): the 21 tuned biome configs (mood, hue, sat, con, bri, warm, fog, shadow, night) plus the 4 mood definitions (filmic / painterly / muted / chiaroscuro) translated from the tuner's CSS into shader math — each mood = a tone curve + two gradient overlays with blend modes, warmth-scaled. Exposes `getAtmosphere(biomeId)`. Single place to fine-tune.
- **Atmosphere field texture**: per visible tile, pack atmosphere params into an RGBA data texture (2 texels/tile: hue·sat·con·bri + warm·fog·shadow·night + mood index), built alongside the wave field. Rebuilt only when the visible chunk set changes, not per frame. Built by **`src/render/atmosphere-pass.js`** (new).
- **Spatial blending**: shader samples the field with bilinear filtering + 5-tap blur at ~24-tile radius. Every parameter cross-fades positionally over a wide band — same spatial logic as terrain Wang-tile blending. Blend radius is a tunable constant.
- **Time-of-day**: `lighting.js` PHASES remain the source of truth (sun angle, ambient, phase tint, fog tint). Final color = phase lighting × biome grade × mood curve.
- **Night floor**: per-biome `night` value clamps minimum brightness at deep night (desert 0 = brutal dark; deep_ocean 53 = readable). Fixes "nighttime too dark".
- **Live tuning**: all params arrive as uniforms/texture data; dev hook `window.atmo.set(biome, partial)` for in-game nudging; final values written back to the config module.

### 2. Light & shadow effects

- **Long shadows — stretched silhouettes**: decoration sprites (trees, rocks, cacti; F4+ and mid-size F2/F3 flora) get a second instanced GL draw: same texture sampled alpha-only as a dark silhouette, skewed along sun azimuth, stretched by `shadowLength`, scaled by biome shadow slider, opacity fading toward the tip. Up to ~4× object height at dawn/golden/dusk; short at noon. Renders below the sprite layer.
  - **Fallback**: sprites under ~24px draw a stretched/angled soft ellipse blob instead.
- **Steeper sun**: retune `sun()` in `lighting.js` — lower sun height at dawn/dusk (longer shadows, raked warm light) and slightly widened golden_hour/dusk phase windows so dramatic light lasts.
- **Cloud shadows**: two octaves of scrolling value-noise in the shader, thresholded into soft patches darkening terrain ~12–20%, drifting with `weather.wind`; density tied to `weather.clouds`. Clouds themselves are never drawn.
- **God rays**: screen-space angled banded gradient from sun azimuth in the present shader (no extra pass). Visible at dawn/golden/dusk or when biome fog is high; intensity = sun warmth × fog density; slow shimmer.
- **Fog**: replaces flat radial gradient — per-biome density, color from phase `fogTint`, subtle scrolling noise, thicker at screen edges, stronger at dawn/night.
- **Water reflections**: extends wave-field path — specular sun/sky glints on water tiles aligned with sun azimuth (golden sparkle path at golden hour); stronger shimmer amplitude in wind.
- **Precipitation**: existing 2D rain/snow particles kept, tinted by current phase + biome grade.

### 3. Chunk stutter & time-to-playable

- **Time-budgeted adoption** (`chunk-provider.js`): replace `maxAdoptPerFrame=1` with a frame-budget loop (<3ms/frame; tightens to 1.5ms while the player is moving). At most one GL texture upload per frame.
- **Upload off critical path**: texture upload happens immediately after adoption (not lazily at first draw), so the hitch never lands on a first-visibility frame.
- **Distance-priority loading**: worker compile queue sorted by distance from the player's viewport, re-sorted as the player moves — chunks ahead of the walk direction compile first.
- **Ready gate = viewport + 1 ring**: loading screen drops when every chunk in viewport + 1-chunk safety ring is painted; remainder streams with leftover budget. Player never sees an unpainted tile.

### 4. Boundaries & fallback

- New: `src/world/biome-atmosphere.js`, `src/render/atmosphere-pass.js`.
- Modified: `gl-compositor.js` (shader blocks: grading, fog, rays, cloud shadows, water specular), GL instanced sprite path (silhouette shadow draw), `lighting.js` (sun retune, phase windows), `chunk-provider.js` (budget + priority + ready gate), `canvas-renderer.js` (remove old flat tint/fog when GL active; particle tinting).
- No changes to world-gen or asset pipeline.
- **2D fallback (no WebGL)**: simplified — screen-average biome grade as tint fillRect, blob shadows, existing fog. Functional only; GL is the primary path and is default-on.

### 5. Testing

Headless Playwright (swiftshader), `l` to freeze sun phase, known biome coordinates:

- Per-biome grading visibly differs (screenshot diffs across biomes at the same phase).
- Shadows lengthen at golden hour vs noon.
- No hard seam crossing a known biome border (scan a strip of pixels across the boundary for discontinuity).
- Night floor respected per biome (deep_ocean night brighter than desert night).
- Frame-time sampling while auto-walking: no adoption hitches above budget; no regression vs baseline.
- Load-to-playable time measured before/after the ready-gate change.

## Key decisions (user-confirmed)

- Shadows: **A — stretched silhouettes** with blob fallback for tiny sprites.
- Clouds/sunbeams: **A — cloud shadows on ground + god rays**; no visible cloud sprites.
- Stutter occurs **while walking** (edge pop-in hitches) — primary target.
- Load goal: **playable sooner**, with the constraint that it must *feel* fully loaded — viewport must be complete even while the rest streams.
- Architecture: **A (GL atmosphere pass) + C (keep 2D precipitation, color-synced)**.
- Biome transitions must be spatially blended and effectively unnoticeable.
