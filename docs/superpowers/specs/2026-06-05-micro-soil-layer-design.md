# Micro Soil Layer Design

**Date:** 2026-06-05
**Status:** Approved (revised)
**Scope:** Generate soil sprite overlays via PixelLab, render as first micro layer above wang tiles. Forest biome first, then all biomes.

## Context

The diagnostic overlay shows `micro soil+ground_cover+foliage_blades+flowers` for forest tiles. The data model (`tile-micro-layers.js`) already computes soil material, coverage, physics, and reactions for every non-water tile. What's missing is art assets and sprite-based rendering. Currently `paintSoil()` in `micro-layer-painter.js` draws a procedural ellipse — a placeholder.

This spec covers **layer 7** from `LANDSCAPE_LAYER_ENUMERATION_FROM_SPECS.md` (Soil/Mud/Dirt Detail Layer) and the soil kind from the micro layer system in `tile-micro-layers.js`.

## Layer position

```
Wang tile (base terrain, z=-2)         [exists, working]
  Shading overlay (z=-1)               [exists, working]
    Soil base tile (z=1, sub-0a)       [THIS SPEC — full coverage at ~75% alpha]
      Soil accent sprite (z=1, sub-0b) [THIS SPEC — scattered patches at full alpha]
        Ground cover (z=1, sub-1)      [future]
          Foliage blades (z=1, sub-2)  [future]
            Flowers/debris (z=1, sub-3)[future]
```

Soil is the bottommost sub-layer within visual layer z=1 (Ground Detail). It has two sub-components:
- **Base tiles**: Full-coverage 32x32 soil textures rendered at partial alpha (~70-80%) for contiguous coverage. The wang tile bleeds through underneath.
- **Accent sprites**: Irregular soil patches with alpha edges, scattered on top at full alpha for organic patchiness — clumps, dark spots, texture breaks.

## Soil materials by biome

From `soilMaterial()` in `tile-micro-layers.js`:

| Material | Biomes | Notes |
|---|---|---|
| `loam` | forest, dense_forest, tropical_forest, taiga, grassland, savanna, steppe | Default fertile soil. 7 biomes share it. |
| `sand` | beach, desert | Dry granular. |
| `frozen_soil` | tundra, arctic | Icy/permafrost texture. |
| `rocky_soil` | mountains, hills, volcanic | Gravel/stone fragments. |
| `peat_mud` | swamp | Dark wet organic. |
| `aether_loam` | mystic | Glowing/magical soil. |

Water biomes (ocean, river, lake, shallow_water, deep_ocean) return early with `water_body` — no soil layer.

**Reuse vs. regenerate decision:**
- Biomes sharing a material (e.g., forest + grassland both use `loam`) start with the same sprite batch.
- If visual testing reveals a biome needs a different tone (e.g., darker forest loam vs. drier savanna loam), generate a variant batch with a modified prompt and store under a sub-key like `loam_dark` or `loam_dry`.
- Start with one batch per material (6 batches total). Split only when visual testing demands it.

## Generation strategy

### Phase 1: Style-matched base tiles

Use `create_map_object` with the player's current wang tile as `background_image` to generate a style-matched soil texture. This ensures the soil belongs visually with the existing terrain art.

**Parameters:**
```
tool: create_map_object
description: "top-down seamless soil texture, dark fertile forest loam,
              edge-to-edge coverage, subtle granular variation, damp earth
              tones, no outline"
width: 32
height: 32
view: "high top-down"
detail: "medium detail"
outline: "lineless"
shading: "medium shading"
background_image: {current wang tile the player is standing on}
```

### Phase 2: Batch base tiles

Use `create_1_direction_object` at `size=32` to generate 64 full-coverage soil texture candidates.

**Parameters:**
```
tool: create_1_direction_object
description: "top-down seamless soil texture tile, dark fertile forest loam
              filling entire square, edge-to-edge coverage, subtle granular
              variation, damp earth tones, no outline, no border, continuous
              ground texture"
size: 32
view: "top-down"
```

Review, select best ~60. These are the base coverage tiles.

### Phase 3: Batch accent sprites

Use `create_1_direction_object` at `size=32` to generate 64 irregular soil patch candidates.

**Parameters:**
```
tool: create_1_direction_object
description: "top-down pixel art soil patch, dark fertile forest loam,
              organic irregular shape with alpha-transparent edges, slight
              surface texture and patchiness, small clumps and granules
              visible, damp earth tones, lineless, no outline"
size: 32
view: "top-down"
```

Review, select best ~60. These are the accent/scatter sprites.

### Phase 4: Biome expansion

Repeat Phases 1-3 for each remaining material with biome-appropriate prompts.

## Asset storage

```
assets/pixelab/landscape_v2/micro/soil/{material}_base/
  soil_base__{material}__v000.png    (full-coverage base tiles)
  ...
  soil_base__{material}__v059.png

assets/pixelab/landscape_v2/micro/soil/{material}/
  soil__{material}__v000.png         (irregular accent sprites)
  ...
  soil__{material}__v059.png
```

## Variant clustering with tile data

Variants are NOT placed purely randomly. The system uses tile climate data to create natural spatial clustering.

### Family grouping

Sort/group the 64 base variants into ~4 families by visual character after generation:
- **Family 0 (wet-dark):** Darkest, dampest-looking variants
- **Family 1 (rich-medium):** Mid-tone fertile soil
- **Family 2 (dry-light):** Lighter, drier-looking variants
- **Family 3 (granular):** Most textured/clumpy variants

### Family selection from tile data

Use existing tile climate values to select which family dominates:

```js
function soilFamily(tile) {
  const moisture = tile.climate.moisture;    // 0-1
  const fertility = tile.layers[6].fertility; // 0-1
  const slope = tile.layers?.[7]?.slope ?? 0; // 0-1

  // Wet + fertile → dark variants
  // Dry + low fertility → light variants
  // Steep slope → granular variants
  if (slope > 0.4) return 3;                 // granular on slopes
  const richness = moisture * 0.6 + fertility * 0.4;
  if (richness > 0.65) return 0;             // wet-dark
  if (richness > 0.35) return 1;             // rich-medium
  return 2;                                  // dry-light
}
```

### Variant selection within family

```js
function soilVariant(tile, familySize, totalVariants) {
  const family = soilFamily(tile);
  const familyStart = family * familySize;

  // 8% chance: scatter — pick any variant from full pool
  if (rand2(tile.wx, tile.wy, 6002) > 0.92) {
    return Math.floor(rand2(tile.wx, tile.wy, 6003) * totalVariants);
  }

  // Normal: pick within family
  const localPick = Math.floor(rand2(tile.wx, tile.wy, 6001) * familySize);
  return familyStart + localPick;
}
```

### Result

- Wet forest valleys naturally cluster dark, rich soil variants
- Dry hilltops cluster lighter, drier variants
- Steep slopes get granular/clumpy variants
- 8% scatter breaks up zones for dynamism
- All deterministic from world coordinates — reproducible from seed
- No extra noise fields needed — reuses existing tile climate data

### Accent sprite placement

Accent sprites follow the same family logic but with additional controls:
- **Frequency**: Not every tile gets an accent. Use `organicPresence()` or a threshold (~40-60% of tiles).
- **Offset**: Jitter position by ±4px so accents don't align to tile grid.
- **Scale**: Optionally draw at 0.8-1.2x for size variation.

## Rendering integration

### Paint function

Replace `paintSoil()` in `micro-layer-painter.js`:

```js
function paintSoil(ctx, layer, tile, sx, sy, size, sun, atlas) {
  if (!atlas) return;

  // Base tile — partial alpha for wang bleed-through
  const baseVariant = soilVariant(tile, 16, 64);
  const baseKey = `soil_base_${layer.material}_${baseVariant}`;
  const baseSprite = atlas.get(baseKey);
  if (baseSprite) {
    // Alpha varies with moisture — wetter = more soil visible
    ctx.globalAlpha = 0.65 + tile.climate.moisture * 0.20;
    ctx.drawImage(baseSprite, sx, sy, size, size);
    ctx.globalAlpha = 1.0;
  }

  // Accent patch — scattered, full alpha
  if (rand2(tile.wx, tile.wy, 6010) < 0.5) {
    const accentVariant = Math.floor(rand2(tile.wx, tile.wy, 6011) * 64);
    const accentKey = `soil_${layer.material}_${accentVariant}`;
    const accentSprite = atlas.get(accentKey);
    if (accentSprite) {
      const ox = (rand2(tile.wx, tile.wy, 6012) - 0.5) * size * 0.25;
      const oy = (rand2(tile.wx, tile.wy, 6013) - 0.5) * size * 0.25;
      ctx.drawImage(accentSprite, sx + ox, sy + oy, size, size);
    }
  }
}
```

### Alpha variation from tile data

Base tile alpha is not fixed — it responds to moisture:
- `moisture=0.3` → alpha ~0.71 (wang shows through more)
- `moisture=0.6` → alpha ~0.77
- `moisture=0.9` → alpha ~0.83 (soil dominates)

This creates natural visual variation without needing different art per moisture level.

## Performance considerations

- **Memory:** 128 sprites (64 base + 64 accent) x 32x32 x 4 bytes = ~524 KB per material. All 6 materials = ~3 MB. Negligible.
- **Draw calls:** 1-2 `drawImage` per visible tile (~400 base + ~200 accent at typical zoom). Canvas 2D handles this without issue.
- **Preload time:** 128 small PNGs load in < 200ms.

## Not in scope

- Ground cover, foliage, flowers, debris rendering (future specs, same pattern)
- Soil reaction state art (wet, frozen, scorched — data exists but art is future work)
- Animated soil (no animation defined for soil in the micro layer system)
- LOD/distance culling (add later if needed)

## Test plan

1. **Style-match test:** Generate soil base with player's current wang tile as background_image
2. **Alpha blend test:** Render base tiles at ~75% alpha over wang, verify wang bleeds through naturally
3. **Clustering test:** Walk through forest, verify moisture/fertility-driven variant clustering creates natural zones
4. **Accent test:** Verify scattered accent patches add organic variation without grid pattern
5. **Performance test:** Check fps/draw time before and after

## File inventory

**Files to modify:**
- `src/render/micro-layer-painter.js` — Replace `paintSoil()` with sprite-based dual-layer version
- Asset preload/manifest (wherever wang tile preloading is configured)

**Files to create:**
- `assets/pixelab/landscape_v2/micro/soil/loam_base/` — 60+ full-coverage base tiles
- `assets/pixelab/landscape_v2/micro/soil/loam/` — 60+ irregular accent sprites

**Files unchanged:**
- `src/world/tile-micro-layers.js` — Already computes soil material/coverage correctly
- `src/world/biome-definitions.js` — No changes needed
