# Decoration Field System Design

**Date:** 2026-06-06
**Status:** Approved
**Scope:** Field-based decoration placement system. Field 0 (substrate/soil) implementation first, architecture supports fields 1-7.

## Concept

Every tile has a **decoration field** — a sub-tile placement grid that determines what objects appear and where. Fields are numbered 0-7, resolved top-down (large objects claim space first), rendered bottom-up (substrate drawn first). The tile grid (1 tile = 32x32px) is subdivided into a decoration grid for sub-tile placement.

The decoration system is **biome-driven**: each biome defines which objects populate each field, at what density, using what placement algorithm. The tile itself provides connectivity (wang transitions, cliffs, water edges). Everything that makes the world visually rich operates on the decoration field, largely independent of tile boundaries.

## Field definitions (forest biome reference)

| Field | Name | Forest Objects | Grid | Density | Coverage |
|---|---|---|---|---|---|
| 0 | Substrate | Soil texture (loam) | 1x1 | 1.0 | Full tile, always |
| 1 | Ground cover | Leaf litter, moss | 8x8 | 0.6-0.8 | Variable |
| 2 | Ground flora | Grass blades, ferns | 8x8 | 0.3-0.5 | Variable |
| 3 | Small scatter | Flowers, mushrooms, pebbles | 8x8 | 0.02-0.10 | Sparse |
| 4 | Debris | Twigs, roots, bark | 8x8 | 0.05-0.15 | Sparse |
| 5 | Medium objects | Rocks, logs, stumps | 4x4 | 0.01-0.03 | Rare |
| 6 | Large objects | Trees, boulders | 2x2 | 0.04 | Rare |
| 7 | Overhead | Canopy, branches | 1x1 | Follows field 6 | Conditional |

Fields 0-4 are **micro-layer fields** (ground detail, z=1 visual layer).
Fields 5-6 are **object fields** (object layer, z=4-5, y-sorted with player).
Field 7 is the **canopy field** (roof layer, z=6, renders above player).

### Field variation by biome

The field NUMBER is consistent. The OBJECT changes by biome:

| Field | Forest | Beach | Desert | Arctic | Swamp |
|---|---|---|---|---|---|
| 0 | loam soil | sand | hot sand | frozen soil | peat mud |
| 1 | leaf litter | shell scatter | sand ripples | lichen/snow | moss/reeds |
| 2 | grass blades | sea grass | — | low lichen | reeds |
| 3 | wildflowers | shells | cacti | alpine blooms | bog flowers |
| 4 | twigs/leaves | driftwood | bones/stones | ice shards | rotting wood |
| 5 | rocks/logs | coral rock | sandstone | ice boulder | bog log |
| 6 | trees | palm tree | cactus | — | dead tree |
| 7 | tree canopy | palm fronds | — | — | hanging moss |

Density also varies by biome. Desert field 2 (ground flora) has near-zero density. Forest field 2 has 0.3-0.5.

### Density sources

Field densities are computed from existing tile data in `tile-micro-layers.js`:
- `fertility` — drives vegetation density
- `moisture` — drives ground cover, debris
- `slope` — reduces vegetation on steep terrain
- `heat` — influences biome-specific thresholds
- `vegetationDensity` — pre-computed composite value

No new noise fields needed.

## Resolution model

**Placement resolution** depends on the field:

- **Field 0 (substrate)**: 1x1 — one texture covers the whole tile. Single drawImage call.
- **Fields 1-4 (micro details)**: 8x8 grid = 64 candidate cells per tile. Each cell is 4x4px. Sprites can be 4-8px and placed at cell center with jitter.
- **Field 5 (medium objects)**: 4x4 grid = 16 candidate cells. Each cell is 8x8px. Objects are 8-16px.
- **Fields 6-7 (large objects)**: 2x2 or 1x1. Objects are 20-32px+, may extend beyond tile bounds.

### Occlusion

Resolved top-down during chunk compilation (not per-frame):

1. Field 6: If tree present, mark its footprint cells as claimed in fields 0-5
2. Field 5: If rock present, mark footprint cells as claimed in fields 0-4
3. Fields 4-1: Place sprites only in unclaimed cells
4. Field 0: Always renders (substrate is below everything)

The occlusion grid is a `Uint8Array(64)` (8x8) where each byte stores the field that claimed that cell, or 0 for unclaimed.

## Field 0 specification (substrate/soil) — IMPLEMENTATION TARGET

### What it does

Places a full-coverage soil texture on every non-water tile, drawn at partial alpha so the wang tile shows through. Variant selection is driven by tile climate data for natural clustering.

### Assets available

Already generated via PixelLab `create_1_direction_object`:

- **Base tiles** (64 full-coverage): `assets/pixelab/landscape_v2/micro/soil/loam_base/soil_base__loam__v{NNN}.png`
- **Accent sprites** (64 irregular patches): `assets/pixelab/landscape_v2/micro/soil/loam/soil__loam__v{NNN}.png`

All 32x32px RGBA PNGs with alpha transparency.

### Variant clustering

Group 64 base variants into 4 families by visual character (after manual or automated sorting):

- **Family 0** (indices 0-15): Darkest, wettest-looking
- **Family 1** (indices 16-31): Mid-tone fertile
- **Family 2** (indices 32-47): Lighter, drier
- **Family 3** (indices 48-63): Most textured/granular

Family selection from tile data:

```js
function soilFamily(tile) {
  const slope = tile.layers?.[7]?.slope ?? 0;
  if (slope > 0.4) return 3;  // granular on slopes
  const richness = tile.climate.moisture * 0.6 + tile.layers[6].fertility * 0.4;
  if (richness > 0.65) return 0;  // wet-dark
  if (richness > 0.35) return 1;  // rich-medium
  return 2;                        // dry-light
}
```

Variant within family: `rand2(wx, wy, 6001)`. 8% scatter override: `rand2(wx, wy, 6002) > 0.92`.

### Rendering

Two sub-passes per tile:

**Pass A — Base texture** (always):
- Pick variant from family
- Draw at `globalAlpha = 0.65 + moisture * 0.20` (0.65-0.85 range)
- Full tile coverage, one drawImage call

**Pass B — Accent sprite** (~50% of tiles):
- `rand2(wx, wy, 6010) < 0.5` → place accent
- Jitter position by ±4px
- Draw at full alpha
- Adds organic patchiness

### Integration point

Replace `paintSoil()` in `src/render/micro-layer-painter.js`. The function signature already receives tile, position, size, and atlas. Add soil bitmaps to the atlas/preload system.

### Asset preloading

Add soil sprites to the worker's image preload alongside wang tiles. 128 images (64 base + 64 accent) at 32x32 = ~500KB total. Loaded in one batch, takes <1 second.

### Performance budget

- **Draw calls per tile**: 1-2 (base + optional accent)
- **At 400 visible tiles**: 400-600 draw calls
- **Memory**: ~500KB for all soil variants
- **Computation**: Zero per-frame — variant selection is deterministic from tile coordinates

## Data structure (future fields)

When fields 1+ are implemented, the decoration system will store pre-computed placements per chunk:

```js
// Computed once during chunk compilation in worker
chunk.decorations[tileIndex] = {
  grid: new Uint8Array(64),  // 8x8 occlusion map
  placements: [              // ordered by field, ready to draw
    { field: 0, key: 'soil_base_loam_42', x: 0, y: 0, w: 32, h: 32, alpha: 0.75 },
    { field: 2, key: 'grass_07', x: 12, y: 8, w: 8, h: 10, alpha: 1.0 },
    // ...
  ]
};
```

Field 0 doesn't need the grid or placements array — it's always one full-tile texture. The grid/placements structure is scaffolded for fields 1+.

## Files to modify

- `src/render/micro-layer-painter.js` — Replace `paintSoil()` with sprite-based version
- `src/world/chunk-worker.js` — Add soil sprites to preload
- `src/render/wang-image-list.js` — Add soil URL generation (or separate preload list)

## Files unchanged

- `src/world/tile-micro-layers.js` — Already computes soil material, coverage, fertility
- `src/world/biome-definitions.js` — Already defines materials per biome

## Test plan

1. Soil base tile renders on every forest tile with alpha blending
2. Wang tile visible through soil at partial opacity
3. Variant clustering creates natural zones (wet areas = dark soil, dry = light)
4. Accent sprites add organic variation without grid pattern
5. No performance regression (check fps/draw time in diagnostic)
6. Walk between biomes — soil renders correctly in forest, absent in water
