# World Biome System Design

**Date:** 2026-05-26  
**Status:** Approved  
**Scope:** Overmap macro feature placement + chunk-level biome-contextual terrain + 18-biome enum alignment

## Problem

The current world generation produces biomes from 4 independent noise fields (elevation, ridge, temperature, moisture) with weak coupling. This causes:

1. **Arctic never appears** — temperature penalty from elevation is only `h * 0.15`, so t < 0.15 is practically impossible
2. **Volcanic never appears** — defined in enum but zero code assigns it
3. **Mystic doesn't exist** — not in codebase at all
4. **Lake/River never appear** — in enum but no assignment logic
5. **No geographic structure** — the world has no intentional relationships between biomes. No mountain range, no volcanic region, no mystic domains. Just random noise soup.
6. **Movement breaks** on certain terrain after teleport (ocean, extreme slopes)

## Approach: Procedural Macro Features + Noise Micro Detail

**Macro layer (overmap):** Procedural feature placement that guarantees geographic structure. Features are derived from noise (not hardcoded), so every seed produces a different but always-coherent world.

**Micro layer (chunk):** Noise-driven detail with biome-contextual variance — cliffs in mountains, dunes in desert, caldera in volcanic, crystalline ridges in mystic, etc.

## The 18 Biomes

```
OCEAN=0, BEACH=1, GRASSLAND=2, FOREST=3, DENSE_FOREST=4, DESERT=5,
SAVANNA=6, STEPPE=7, TUNDRA=8, TAIGA=9, MOUNTAINS=10, SWAMP=11,
TROPICAL_FOREST=12, VOLCANIC=13, ARCTIC=14, LAKE=15, RIVER=16, MYSTIC=17
```

All 18 must be assignable by both the C++ chunk compiler and the GDScript overmap generator. One classification function, two callers.

## Macro Feature Placement

At world generation time, scan the base noise fields to derive macro features. These are stored as modifier fields (640x640 float arrays) alongside the overmap image.

### Feature Anchors

| Feature | Derivation Method | Approximate Size |
|---------|-------------------|------------------|
| **Mountain Spine** | Connected ridge of highest `ridge_noise` values cutting across the map | Large — bisects the world |
| **Arctic Zones** | Peaks of the mountain spine where elevation > 0.85 | Moderate — several clusters along spine |
| **Volcanic Hotspot** | Single point where `ridge_noise` is highest AND base temperature is warmest | Small-moderate, radiating outward (radius ~15-20 overmap pixels) |
| **Mystic Domains** | 3-4 locations where new `magic_noise` exceeds threshold (> 0.8) | Moderate, self-contained (radius ~8-12 overmap pixels each) |
| **Tropical Forest** | Largest contiguous region where temperature > 0.65 AND moisture > 0.55 | One massive zone |
| **Savanna** | Adjacent to tropical forest, drier side (moisture 0.2-0.5) | One major zone |
| **Swamp** | Low elevation + high moisture, moisture boost applied near volcanic region | Wraps around volcanic border |
| **Lakes** | 5-8 local elevation minima in land areas | Radius 3-5 overmap pixels each |
| **Rivers** | Downhill gradient trace from each lake toward ocean or another lake | Width 1 overmap pixel, expands to 3-5 tiles at chunk level |

### Biome Adjacency Graph

```
Ocean → Beach → Grassland ──→ Forest → Dense Forest → Swamp ──→ Volcanic
                    │                                              ↑
                    ├──→ Desert → Savanna → Steppe ────→ Mountains ┤
                    │                  │                     │
                    │                  └→ Tropical Forest    └→ Arctic (peaks)
                    │
                    └──→ Tundra → Taiga

Lakes: scattered throughout all land biomes
Rivers: flow downhill from lakes
Mystic: 3-4 independent pockets, any land context
```

### Modifier Field Computation

```
1. Generate base noise fields (elevation, ridge, temp, moisture, magic)
2. Strengthen couplings:
   - Temperature penalty from elevation: t -= h * 0.45 (was 0.15)
   - This naturally makes mountain peaks arctic
3. Scan ridge noise to find mountain spine (connected high-ridge path)
4. Find volcanic hotspot (max ridge × max temp intersection)
5. Find 3-4 mystic domains (magic noise peaks > 0.8)
6. Find 5-8 lake basins (local elevation minima in land areas)
7. Trace rivers downhill from lakes
8. Compute modifier fields (all 640×640):
   - volcanic_influence: radial falloff from hotspot
   - mystic_influence: radial falloff from each domain center
   - swamp_pull: moisture boost near volcanic region
   - lake_mask: boolean lake coverage
   - river_mask: boolean river paths
9. Store modifiers as binary data alongside overmap PNG
10. Biome classification applies modifiers:
    - VOLCANIC where volcanic_influence > 0.5
    - MYSTIC where mystic_influence > 0.5
    - LAKE where lake_mask is true
    - RIVER where river_mask is true
    - swamp_pull boosts local moisture to create SWAMP adjacency near volcanic
    - Standard temp/moisture/elevation rules handle everything else
```

## Chunk-Level Micro Detail

Each 64x64 chunk gets biome-contextual terrain features. The detail noise is modulated per biome to create appropriate character.

### Elevation Variance by Biome

| Biome | Elevation Character | Detail Noise Behavior |
|-------|--------------------|-----------------------|
| **Ocean** | Flat, slight undulation | Minimal — deep water is calm |
| **Beach** | Gentle slope from water | Very smooth, occasional dune ridges |
| **Grassland** | Rolling hills, gentle valleys | Moderate FBM, soft features |
| **Forest** | Undulating, moderate hills | Medium variance, some clearings |
| **Dense Forest** | Rougher, ravines between hills | Higher variance, steep gullies |
| **Desert** | Dunes + flat pans + mesa edges | Ridged noise for dune formations, flat basins |
| **Savanna** | Wide open with scattered kopjes | Low variance with occasional sharp outcrops |
| **Steppe** | Windswept plateaus, eroded gullies | Medium-low, directional ridges |
| **Tundra** | Frozen flat expanses, frost heave bumps | Very low variance, subtle texture |
| **Taiga** | Dense valleys between ridges | Medium, elongated ridge patterns |
| **Mountains** | Dramatic peaks, cliffs, narrow passes | Maximum variance, very steep slopes, cliff faces |
| **Swamp** | Near-flat, waterlogged depressions | Very low with many sub-sea-level pockets (pools) |
| **Tropical Forest** | Dense canopy hills, river valleys | High variance but smooth — rounded hills |
| **Volcanic** | Caldera rim, lava channels, jagged rock | Extreme variance — sharp ridges, flat crater floor, flow channels |
| **Arctic** | Ice fields, crevasses, frozen peaks | High variance — glacial carving, sharp vs. smooth |
| **Lake** | Basin depression below surrounding terrain | Concave — lowest point of local area |
| **River** | Carved channel following downhill gradient | Linear depression cutting through terrain |
| **Mystic** | Otherworldly — floating islands feel | Warped noise — extreme warp amplitude, crystalline ridges, quantized elevation steps |

### Biome-Specific Noise Modulation

At chunk compile time, the dominant biome modulates detail noise parameters:

- **Mountains**: Ridge noise amplitude ×3. Cliff faces where slope > threshold. Saddle points create narrow passes.
- **Volcanic**: Radial elevation falloff from macro center (caldera shape). Channel noise cuts lava flow paths outward. Interior is flat crater floor.
- **Mystic**: Domain warp amplitude cranked to extreme. Elevation has sharp plateaus (quantized steps) creating alien staircase feel.
- **Swamp**: Elevation oscillates just above/below water level — maze of land and water patches.
- **Desert**: Directional ridged noise for dune fields. Flat hardpan between dunes.
- **Arctic**: Glacial carving — smooth U-shaped valleys with sharp arêtes between them.

### Pathways & Transitions

- Chunk-level paths follow noise-carved valleys (local elevation minima)
- Biome transitions within a chunk use existing Wang tileset blending
- Cave entrances appear in mountains/volcanic where slope exceeds threshold AND elevation dips locally
- Cliffs render where adjacent tiles have elevation delta > 0.15

## Overmap/Chunk Alignment Contract

1. **One classification function, two callers.** The overmap and C++ chunk compiler apply identical biome logic with identical thresholds.
2. **Macro features computed once at world init.** Stored as binary modifier fields. Both overmap renderer and chunk compiler read from the same data.
3. **The overmap pixel IS the chunk.** Pixel (px, py) on the overmap = chunk (px - 320, py - 320). The biome color must match the chunk's dominant biome.
4. **Modifier fields are the source of truth** for volcanic, mystic, lake, and river placement. Both systems sample the same fields.

## Noise Configuration

### Existing Noise Fields (parameters preserved)

| Noise | Seed Offset | Type | Fractal | Octaves | Frequency |
|-------|-------------|------|---------|---------|-----------|
| Continent | +0 | Perlin | FBM | 8 | 0.008 |
| Ridge | +1000 | Perlin | Ridged | 5 | 0.012 |
| Warp | +777 | Perlin | FBM | 4 | 0.005 |
| Temperature | +333 | Perlin | FBM | 6 | 0.007 |
| Moisture | +500 | Perlin | FBM | 6 | 0.009 |

### New Noise Field

| Noise | Seed Offset | Type | Fractal | Octaves | Frequency | Purpose |
|-------|-------------|------|---------|---------|-----------|---------|
| Magic | +888 | Perlin | FBM | 4 | 0.004 | Mystic domain detection — low frequency for large coherent pockets |

### Changed Couplings

- **Temperature elevation penalty**: `t -= h * 0.45` (was `h * 0.15`). At h=0.85 (mountain peak), penalty is 0.38, pushing base temp ~0.5 down to ~0.12 — arctic.
- **Chunk-level temperature**: `temp -= (h - base_h) * 0.5` (was `0.3`). Stronger local cooling on peaks within a chunk.

## Overmap Colors

| Biome | RGB | Visual |
|-------|-----|--------|
| Deep Ocean | (0.05, 0.12, 0.35) | Dark navy |
| Shallow Ocean | (0.1, 0.3, 0.6) | Medium blue |
| Coastal Water | (0.2, 0.5, 0.8) | Light blue |
| Beach | (0.9, 0.85, 0.6) | Sandy tan |
| Grassland | (0.4, 0.75, 0.3) | Green |
| Forest | (0.15, 0.5, 0.15) | Dark green |
| Dense Forest | (0.05, 0.35, 0.1) | Very dark green |
| Desert | (0.85, 0.75, 0.45) | Tan-gold |
| Savanna | (0.7, 0.65, 0.3) | Yellow-brown |
| Steppe | (0.6, 0.55, 0.35) | Dry brown |
| Tundra | (0.7, 0.75, 0.8) | Light gray |
| Taiga | (0.2, 0.4, 0.3) | Blue-green |
| Mountains | (0.55, 0.55, 0.55) | Gray |
| Swamp | (0.3, 0.4, 0.25) | Olive |
| Tropical Forest | (0.1, 0.6, 0.2) | Bright green |
| Volcanic | (0.6, 0.15, 0.05) | Deep red-orange |
| Arctic | (0.9, 0.93, 0.97) | White |
| Lake | (0.25, 0.55, 0.85) | Clear blue |
| River | (0.3, 0.6, 0.9) | Light river blue |
| Mystic | (0.45, 0.15, 0.6) | Deep purple |

## Movement Fix

**Problem:** After teleporting, player sometimes can't walk — stuck in ocean or extreme slopes.

**Fix:**
1. Teleport refuses to land in ocean — snaps to nearest land chunk
2. Minimum speed clamped to 60% (was 50%) on steep terrain
3. After teleport, use elevation 0.5 fallback gracefully during chunk loading — don't apply slope speed until center chunk is fully loaded

## Files Changed

### C++ (requires rebuild)
- `gdextension/src/native_chunk_compiler.h` — Add MYSTIC=17 to enum, expand array to 18
- `gdextension/src/native_chunk_compiler.cpp` — Add volcanic/mystic/lake/river rules to `_compile_biome`, add biome-contextual detail noise modulation, update biome name array to 18 entries
- `gdextension/src/noise_sampler.h` — Add magic noise field, increase temp elevation penalty to 0.45

### GDScript (overmap + movement)
- `scripts/core/overmap_generator.gd` — Add magic noise, modifier field computation (volcanic/mystic/lake/river placement), match temp penalty, add all new biome colors
- `scripts/CleanWorld.gd` — Teleport land-snap, movement speed floor fix, chunk-loading grace period

### New Files
- `user://world_modifiers_{seed}.bin` — Binary modifier fields (volcanic_influence, mystic_influence, swamp_pull, lake_mask, river_mask) generated at world init, loaded by both overmap and chunk compiler
