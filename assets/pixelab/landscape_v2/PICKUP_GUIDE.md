# PixelLab Landscape V2 — Pickup Guide

If you're resuming PixelLab generation for FreedomMMO/WizardGenie, read this first.

## Budget

- **~9,829 of 10,000 generations used** across 49 sessions
- **~171 remaining** (but realistically ~80 usable — some were consumed by failures/retries)
- To do significant new work, you'll need a budget top-up

## What's On Disk (6,723 PNGs)

### Wang Transition Tilesets — COMPLETE
55 biome-to-biome transition tilesets, each containing:
- 1 tileset spritesheet (128x128, 4x4 grid)
- 16 sliced 32x32 Wang tiles (`{name}__wang_0__v000.png` through `wang_15`)

Location: `transitions/{from}_to_{to}/wang/`

All 53 required game transitions are covered plus 2 extras (swamp_to_taiga, beach_to_river).
3 empty legacy dirs can be deleted: `forest_floor__to__swamp_ground`, `water_river__to__swamp_wet_mud`, `water_shallow__to__swamp_wet_mud`.

### Cliff/Elevation Tilesets — COMPLETE
14 biome-specific cliff tilesets, same 16-tile Wang format:
```
cliff_overlay (generic), grass_cliff, sand_cliff, snow_cliff, stone_cliff,
forest_cliff, volcanic_cliff, beach_cliff, swamp_cliff, savanna_cliff,
tundra_cliff, hills_cliff, steppe_cliff, mystic_cliff
```

### Base Wang Tiles — COMPLETE
22 biomes in `base/{biome}/wang/` (17 PNGs each: spritesheet + 16 tiles).
**Note:** These don't visually match transition tilesets. The renderer should source interior tiles from transition tilesets instead (see BIOME_INTERIOR_TILES.md).

### Surface Overlays — COMPLETE
Location: `surface_overlays/{name}/decals/`
- 22 biomes x 4 layers (detail, vegetation, scatter, atmospheric) = 16 tiles each
- 3 swamp-specific sets with 124-126 tiles each (algae_film, mud_pool, wet_mud_shine)
- 5 water biomes use "surface" instead of "scatter" (16 tiles each)
- 5 biome scatter dirs are empty (deep_ocean, lake, ocean, river, shallow_water) — water biomes don't have ground scatter

### Micro Decals
Location: `micro/{name}/decals/`
- 3 swamp-specific: 188-190 tiles each (dark_mud_flecks, moss_ground_cover, reeds_grass_blades)
- 7 biome-specific: 16 tiles each (beach, desert, forest, grassland, hills, savanna, tundra)
- Missing micro for: arctic, deep_ocean, dense_forest, lake, mountains, mystic, ocean, river, shallow_water, steppe, taiga, tropical, tundra, volcanic

### Medium Sprites (Swamp Only)
Location: `medium/{name}/sprites/`
- cattails: 59, moss_clump: 56, reeds: 63, root_cluster: 59
- **Only swamp has medium sprites.** All other biomes need equivalents.

### Object Sprites — COMPLETE
Location: `objects/{biome}_{family}/sprites/`
- 20 biomes, 112-113 objects each, ~2,360 total
- Mix of wildlife, interactive nodes, flora, rocks, structures, enchanted items
- Generated with `create_map_object` (transparent sprites)

## PixelLab API Quick Reference

### Tools That Work Reliably
| Tool | Output | Notes |
|------|--------|-------|
| `create_topdown_tileset` | 16-tile Wang tileset (opaque) | ~20 gens, 100-350s. Use for transitions, cliffs, overlays |
| `create_tiles_pro` | 16 opaque tiles | ~5 gens, fast. Use for surface overlays, micro decals |
| `create_map_object` | 1 transparent sprite | ~3 gens, was stuck at 95% in sessions 10-12. Use `get_object` (NOT `get_map_object`) to check status |

### Key Parameters for Wang Tilesets
```javascript
{
  tile_size: { width: 32, height: 32 },  // MUST be 32x32, never 16x16
  view: "high top-down",
  outline: "lineless",
  detail: "medium detail",
  transition_size: 0.5,
  base_tile_id_A: "...",  // chain from known base tiles for consistency
  base_tile_id_B: "...",
  transition_description: "..."  // e.g. "grassy slope transitioning to rocky hillside"
}
```

### Rate Limits
- Max 6 concurrent `create_map_object` calls
- `create_topdown_tileset` and `create_tiles_pro` are more forgiving
- Occasional CUDA OOM failures — just retry

### Checking Status
- `get_topdown_tileset(id)` — reliable for tilesets
- `get_object(id)` — reliable for objects (shows true completion)
- `get_map_object(id)` — LIES about 95% stuck. Never use for status checking.
- Objects auto-delete from PixelLab after ~8 hours — download promptly

### Slicing a Tileset Spritesheet
```bash
dir="transitions/{name}/wang"
name="{from}_to_{to}"
mkdir -p "$dir"
# Download spritesheet
curl -sL "{url}/image" -o "$dir/${name}__tileset.png"
# Slice 128x128 into 16 x 32x32
for row in 0 1 2 3; do for col in 0 1 2 3; do
  n=$((row * 4 + col))
  magick "$dir/${name}__tileset.png" -crop 32x32+$((col*32))+$((row*32)) +repage "$dir/${name}__wang_${n}__v000.png"
done; done
```

## Base Tile IDs (for Chaining)

These are PixelLab tile IDs used as `base_tile_id_A/B` when generating new tilesets. Chaining ensures visual consistency.

| Tile ID | Terrain |
|---------|---------|
| `a267b749-1927-4d39-b73d-06a39301013d` | swamp wet mud |
| `c9ce4900-726d-4b56-bb5c-9aa2fc3d191a` | lush green grass |
| `997894f5-3f3c-4d50-839e-2e32fa166a71` | dark forest floor |
| `e6bf01fc-1a4e-40c5-b242-e3bdef4e01e3` | flowing river water |
| `dc51d808-a3d4-4025-997e-75af468bcac9` | rocky hills |
| `5e7c32d0-e2e3-4308-adff-fa61e783e032` | shallow water (sandy) |
| `0a7ad061-3ecc-4716-9864-2ef4078e59df` | dry sandy beach |
| `71ed06d0-8c84-453c-a5a4-5c59e4522e54` | arid desert sand |
| `14b79358-c430-43a4-a043-c20fb0e5b904` | savanna grass |
| `b5d6431c-1397-43f8-8594-7d2b8fb09885` | mystic purple ground |
| `86422408-70e9-4721-862f-5643d5c3de8e` | dense forest floor |
| `9979a10a-e26f-4fd0-8fc3-3599ae8dcf47` | tropical forest floor |
| `098c093b-1d5f-4f91-9dfc-cacc9f4cffff` | taiga floor (pine/frost) |
| `4157436e-8eb7-4cae-b747-f38f0f9def27` | grey mountain rock |
| `abfe8223-2ffa-45b2-89ca-63308625acc5` | dark volcanic rock |
| `5dc10585-3e16-4b0f-982b-30fde69d11f9` | steppe ground |
| `acd82da8-9067-46fa-bdbe-4f50bae1eac6` | frozen tundra |

## Wang Tile System (Dual-Grid Corners)

PixelLab generates 16-tile Wang tilesets where each tile encodes 4 corners (NW, NE, SW, SE) as biome A ("from") or biome B ("to").

```javascript
// Corner bits: NW=8, NE=4, SW=2, SE=1. Bit=1 means "from" biome at that corner.
const CORNER_TO_WANG = [12,13,0,3,8,1,14,5,15,4,11,2,9,10,7,6];

// wang_6  = all 4 corners are "from" biome (biome A interior)
// wang_12 = all 4 corners are "to" biome (biome B interior)
```

Full mapping documented in `WANG_TILE_MAPPING.md`.

## What Could Be Generated Next (Priority Order)

### 1. Medium Sprites for Non-Swamp Biomes (~600 gens)
Only swamp has medium-size transparent sprites. Every other biome needs 3-4 families of 50+ sprites each. Use `create_map_object` with descriptions like "pixel art tall grass clump, medium size, transparent background".

### 2. Micro Decals for Remaining Biomes (~200 gens)
13 biomes lack micro scatter decals. Use `create_tiles_pro` (16 per call) with descriptions like "tiny pixel art pebbles and ground detail scatter".

### 3. Object Animations & Variants (~3+ gens each)
All 2,360 objects are static single-frame sprites. Could generate:
- Idle animations (swaying trees, flickering flames)
- Interaction states (harvested bush, opened chest)
- Damage states (broken rock, wilted plant)
- Seasonal variants

Use `animate_object` or `create_object_state` with the existing object IDs. **Caution:** Objects auto-delete after ~8 hours, so stored objects from previous sessions won't be available for animation. You'd need to re-upload or re-create them first.

### 4. Additional Transition Variants (~20 gens each)
Could generate v001 variants of key transitions for visual variety. Store as `__wang_N__v001.png` alongside existing v000 files.

### 5. Water/Ocean-Specific Scatter (~80 gens)
5 water biome scatter overlay dirs are empty (deep_ocean, lake, ocean, river, shallow_water). Could add underwater particle effects, wave patterns, bubbles.

## Renderer Integration Status

### Working
- Wang tile selection via `CORNER_TO_WANG` lookup in `chunk-render-cache.js`
- 55 transition pairs registered in `TRANSITION_PAIRS`
- Interior tiles sourced from transition tilesets via `BIOME_INTERIOR` in `tile-painter.js`
- Palette color fill as loading fallback

### Recently Fixed (may need testing)
- `nearestTransitionPair` was dead code — fixed by separating it from `transitionPair` in the radius scan. Edge tiles get `transitionPair` (computed corner mask), interior tiles get `nearestTransitionPair` (fixed interior mask wang_6/12).
- Scan radius increased from ±8 to ±16 for better transition-consistent coverage.
- Render version bumped to `wang-corner-v19` to invalidate stale caches.
- See `RENDERING_FIX_GUIDE.md` for full details on the color band fix.

### Not Yet Implemented
- Cliff overlay rendering (tiles exist on disk, no renderer integration)
- Surface overlay application (1,464 overlay tiles exist, not rendered)
- Object rendering from landscape_v2 sprites
- Medium sprite scattering

## Key Docs in This Directory

| File | Purpose |
|------|---------|
| `PROGRESS.md` | Session-by-session generation log with per-biome counts |
| `WANG_TILE_MAPPING.md` | CORNER_TO_WANG lookup table with all 16 tile descriptions |
| `BIOME_INTERIOR_TILES.md` | Which transition tileset to source each biome's interior from |
| `ELEVATION_CLIFF_DESIGN.md` | Cliff/elevation overlay system design |
| `RENDERING_FIX_GUIDE.md` | 4 prioritized fixes for terrain color bands |
| `BIOME_BASE_PIPELINE.md` | Original biome layer stack pipeline design |
| `PICKUP_GUIDE.md` | This file |

## Lessons Learned

1. **Wang tilesets MUST be 32x32** — 16x16 doesn't work with the game renderer
2. **`get_map_object` lies** — always use `get_object` for true completion status
3. **`tiles_pro` = opaque, `map_object` = transparent** — never mix these up
4. **Base tiles don't match transitions** — always source interiors from transition tilesets
5. **Objects auto-delete after ~8 hours** — download immediately when complete
6. **Chain base_tile_ids** — ensures cross-tileset color consistency
7. **Max 6 concurrent map_objects** — more causes 429 rate limits
8. **CUDA OOM failures happen** — just retry with same params
9. **PixelLab queue congests** — ETAs increase over time, be patient
