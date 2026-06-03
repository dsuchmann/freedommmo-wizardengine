# Biome Interior Tiles — Sourced from Transition Tilesets

## Problem
The standalone base tiles in `base/` don't visually match the transition tilesets.
Each transition tileset generates its own style for both biomes.

## Solution
Source each biome's interior tile from a transition tileset where that biome appears.
- **wang_6** = all biome B (the "to" biome) — use for interior of the "to" biome
- **wang_12** = all biome A (the "from" biome) — use for interior of the "from" biome

## Canonical Interior Tile Sources

For each biome, pick ONE transition tileset and use its wang_6 or wang_12.

| Biome | Source Tileset | Wang Index | File Path |
|-------|---------------|------------|-----------|
| arctic/snow | tundra_to_snow | wang_6 (to) | `transitions/tundra_to_snow/wang/tundra_to_snow__wang_6__v000.png` |
| beach | beach_to_river | wang_12 (from) | `transitions/beach_to_river/wang/beach_to_river__wang_12__v000.png` |
| deep_ocean | deep_ocean_to_ocean | wang_12 (from) | `transitions/deep_ocean_to_ocean/wang/deep_ocean_to_ocean__wang_12__v000.png` |
| dense_forest | forest_to_dense_forest | wang_6 (to) | `transitions/forest_to_dense_forest/wang/forest_to_dense_forest__wang_6__v000.png` |
| desert | beach_to_desert | wang_6 (to) | `transitions/beach_to_desert/wang/beach_to_desert__wang_6__v000.png` |
| forest | grassland_to_forest | wang_6 (to) | `transitions/grassland_to_forest/wang/grassland_to_forest__wang_6__v000.png` |
| grassland | grassland_to_forest | wang_12 (from) | `transitions/grassland_to_forest/wang/grassland_to_forest__wang_12__v000.png` |
| hills | grassland_to_hills | wang_6 (to) | `transitions/grassland_to_hills/wang/grassland_to_hills__wang_6__v000.png` |
| lake | lake_to_river | wang_12 (from) | `transitions/lake_to_river/wang/lake_to_river__wang_12__v000.png` |
| mountains | hills_to_mountains | wang_6 (to) | `transitions/hills_to_mountains/wang/hills_to_mountains__wang_6__v000.png` |
| mystic | grassland_to_mystic | wang_6 (to) | `transitions/grassland_to_mystic/wang/grassland_to_mystic__wang_6__v000.png` |
| ocean | deep_ocean_to_ocean | wang_6 (to) | `transitions/deep_ocean_to_ocean/wang/deep_ocean_to_ocean__wang_6__v000.png` |
| river | beach_to_river | wang_6 (to) | `transitions/beach_to_river/wang/beach_to_river__wang_6__v000.png` |
| savanna | grassland_to_savanna | wang_6 (to) | `transitions/grassland_to_savanna/wang/grassland_to_savanna__wang_6__v000.png` |
| shallow_water | ocean_to_shallow_water | wang_6 (to) | `transitions/ocean_to_shallow_water/wang/ocean_to_shallow_water__wang_6__v000.png` |
| steppe | grassland_to_steppe | wang_6 (to) | `transitions/grassland_to_steppe/wang/grassland_to_steppe__wang_6__v000.png` |
| swamp | swamp_to_forest | wang_12 (from) | `transitions/swamp_to_forest/wang/swamp_to_forest__wang_12__v000.png` |
| taiga | forest_to_taiga | wang_6 (to) | `transitions/forest_to_taiga/wang/forest_to_taiga__wang_6__v000.png` |
| tropical | forest_to_tropical_forest | wang_6 (to) | `transitions/forest_to_tropical_forest/wang/forest_to_tropical_forest__wang_6__v000.png` |
| tundra | tundra_to_snow | wang_12 (from) | `transitions/tundra_to_snow/wang/tundra_to_snow__wang_12__v000.png` |
| volcanic | desert_to_volcanic | wang_6 (to) | `transitions/desert_to_volcanic/wang/desert_to_volcanic__wang_6__v000.png` |

## JavaScript Lookup

```javascript
const BIOME_INTERIOR_TILE = {
  arctic:         "transitions/tundra_to_snow/wang/tundra_to_snow__wang_6__v000.png",
  beach:          "transitions/beach_to_river/wang/beach_to_river__wang_12__v000.png",
  deep_ocean:     "transitions/deep_ocean_to_ocean/wang/deep_ocean_to_ocean__wang_12__v000.png",
  dense_forest:   "transitions/forest_to_dense_forest/wang/forest_to_dense_forest__wang_6__v000.png",
  desert:         "transitions/beach_to_desert/wang/beach_to_desert__wang_6__v000.png",
  forest:         "transitions/grassland_to_forest/wang/grassland_to_forest__wang_6__v000.png",
  grassland:      "transitions/grassland_to_forest/wang/grassland_to_forest__wang_12__v000.png",
  hills:          "transitions/grassland_to_hills/wang/grassland_to_hills__wang_6__v000.png",
  lake:           "transitions/lake_to_river/wang/lake_to_river__wang_12__v000.png",
  mountains:      "transitions/hills_to_mountains/wang/hills_to_mountains__wang_6__v000.png",
  mystic:         "transitions/grassland_to_mystic/wang/grassland_to_mystic__wang_6__v000.png",
  ocean:          "transitions/deep_ocean_to_ocean/wang/deep_ocean_to_ocean__wang_6__v000.png",
  river:          "transitions/beach_to_river/wang/beach_to_river__wang_6__v000.png",
  savanna:        "transitions/grassland_to_savanna/wang/grassland_to_savanna__wang_6__v000.png",
  shallow_water:  "transitions/ocean_to_shallow_water/wang/ocean_to_shallow_water__wang_6__v000.png",
  steppe:         "transitions/grassland_to_steppe/wang/grassland_to_steppe__wang_6__v000.png",
  swamp:          "transitions/swamp_to_forest/wang/swamp_to_forest__wang_12__v000.png",
  taiga:          "transitions/forest_to_taiga/wang/forest_to_taiga__wang_6__v000.png",
  tropical:       "transitions/forest_to_tropical_forest/wang/forest_to_tropical_forest__wang_6__v000.png",
  tundra:         "transitions/tundra_to_snow/wang/tundra_to_snow__wang_12__v000.png",
  volcanic:       "transitions/desert_to_volcanic/wang/desert_to_volcanic__wang_6__v000.png",
};
```

## Important Notes

1. **No regeneration needed** — the interior tiles already exist within the transition tilesets
2. **Style consistency** — each interior tile matches its transition tiles because they came from the same generation
3. **Cross-transition consistency caveat** — beach in `beach_to_river` may look slightly different from beach in `beach_to_desert`. For maximum consistency, always source a biome's interior tile from the same transition tileset you're rendering transitions from.
4. **The `base/` folder** can be kept as reference/backup but shouldn't be used for rendering if visual consistency with transitions is required.
