# Building Shadows — phase 1 (ground) + phase 2 (façade drape)

**Branch:** `motion-eval-system` · **Date:** 2026-06-18
**Files:** `src/render/building-shadow.js` (new, self-contained), one hook in `src/render/canvas-renderer.js`, one getter in `src/render/building-renderer.js`. Tests: `sim/test/building-shadow.test.js` (21).
**No worker edits.** Pure main-thread 2D pass.

## What it does
Buildings cast a ground shadow projected **away from the sun**, with length that grows with
`aboveGroundFloors` and with how low the sun sits (`sun.shadowLength`: 0.9 noon → 3.75 dusk).
The shape is the footprint swept in the shadow direction (convex hull of footprint corners ∪
corners+projection). Only the **wake** renders — the ground fill is clipped to exclude every
building's footprint (even-odd: screen rect + each footprint), so a shadow never paints over the
building casting it, nor lies flat "under" a neighbour. When a shadow reaches a **neighbour** it
climbs the neighbour's visible south façade ("drench the surface at a different height") instead —
the drape is drawn unclipped (the wall it darkens sits over the footprint on purpose).

## How it's wired
- `building-renderer.js` exports `getCachedBuildings()` → the same resolved set `updateBuildingClaims()`
  refreshes each frame (canvas-renderer.js:331). No second resolve.
- `canvas-renderer.js`: one guarded call **right after `drawRoofs`** (≈:352), **before** the player/F2
  sprites. So shadows darken terrain + roofs, the player stands **on** the shadow, and walls occlude nothing.
- All shadow regions (ground hulls + façade drape rects) go into **one** nonzero-winding fill at a single
  alpha — overlapping neighbour shadows **merge** instead of double-darkening at the seams.

## Style (matches existing object shadows)
`#2a2e2b` at `0.18 × sun.ambient` (large-object-renderer.js tree-shadow tint/alpha), so shadows fade
to nothing at night. Hard-gated off when `!sun.isDaytime`.

## Height respect (the shared mask)
Shadows now respect relative height — a short object's shadow can't draw over a taller building.
`drawBuildingShadows` builds + publishes a per-frame **height mask** (`getBuildingHeightMask()` /
`window._buildingHeightMask`): a `Uint8Array` grid (cell 8px) where each cell = the tallest building
storeys over that screen pixel (footprint + the `8+(storeys-1)*4`-tile wall/roof north band), 0 = open.
The rule any shadow applies: a contribution survives only if `casterStoreys >= sampleHeight(landing)`.
- **My drape** climbs only `min(caster, neighbour)` storeys (a 1-storey shadow can't scale a 5-storey wall).
- **My ground shadows** are additionally clipped off any taller building's silhouette.
- **Grass (F2) shadows** are the other agent's: they consume the mask per the contract in
  `docs/superpowers/2026-06-19-shadow-height-contract.md` (sample at the shadow landing point, grass = 0
  storeys → drop the shadow where mask>0). The shadow gallery demonstrates the effect with toggles.

## Debug / tuning knobs (console)
- `window._buildingShadows = false` — hide all building shadows.
- `window._buildingShadowDrape = false` — disable only the phase-2 façade drape (keep ground shadows).
- `window._buildingShadowScale = 1.4` — multiply ground-shadow length (visual tuning). Default
  `DEFAULT_SCALE = 1.49`, calibrated in `tools/shadow-gallery.html` (2026-06-19); the knob overrides it.

A per-feature size/length tuner (the project convention) is a sensible follow-up; the scale knob above
is the seam to wire it to.

## Phase-2 alignment dependency (for the roof/chunk agent)
The façade drape darkens the **worker-baked** south-wall stack. Its screen rect is derived from the
**shared** `WALL_CONFIG` (`wallHeight: 4`, `wallYOffset: 0.25`) — the exact constants the worker uses
(`worker-chunk-renderer.js:1352` `WY/WH`, `:1469` `ssy5 = tsy(fbY) - wH + round(tileSize*WY) - sst*wH`).
So it aligns **by construction**. If the worker's per-story stacking math changes (offset ≠ `sst*wH`, or a
different `wallHeight`), update `facadeRect()` in `building-shadow.js` to match — it reads `WALL_CONFIG`,
so a `WALL_CONFIG` change tracks automatically; a change to the *stacking formula* does not.

## Not done yet (future)
- **Partial-height climb:** the drape currently darkens the neighbour's **full** façade band when its
  base is in shadow. A taller caster should climb higher than a short one — clamp drape height by the
  caster's remaining shadow length at that point.
- **GL parity:** in GL scene mode the 2D fill lands on the overlay canvas above the GL terrain (same as
  roofs/water overlay today). Packing building quads into the GL shadow pass is the eventual unified path.
- **Multi-section silhouette:** phase 1 uses the bounding-box rectangle for the ground hull; an
  outer-edge-only sweep would tighten non-rectangular footprints.

## Verify in-game
Walk to a settlement at **dawn/dusk** (long shadows) — shadows point away from the sun, lengthen toward
dusk, fade at night, and tall buildings throw longer shadows that climb shorter neighbours' near walls.
