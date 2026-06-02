# Layer Contract Report — Swamp Calibration

Generated: 2026-06-01

## Alignment Check: landscape-recipe.js vs Asset Manifest

### Layer 1: Base Terrain

| Recipe Output | Manifest Family | Status |
|---------------|----------------|--------|
| `swamp/wet_mud` (biome=swamp, surface has mud) | `base/swamp_wet_mud/` | Planned, 0 assets exist |
| `swamp/swamp_ground` (biome=swamp, no mud surface) | Not yet in manifest | Gap — add in next loop |

**Note:** `landscape-recipe.js:71` maps swamp to `swamp/wet_mud` when surface includes "mud", else `swamp/swamp_ground`. The manifest covers `wet_mud` but needs `swamp_ground` added.

### Layer 2: Structure

| Recipe Output | Manifest Coverage | Status |
|---------------|-------------------|--------|
| `structure.elevationMarks` for step/cliff forms | Not in swamp slice | Deferred — swamp is mostly plains/valley |
| `structure.valleyMarks` for valley/dry_riverbed | Not in swamp slice | Deferred — valley channels relevant later |
| `structure.soilRockMarks` for rocky/dry/low-veg | Covered via micro soil layer | OK |

### Layer 3: Surface Overlays

| Recipe Output | Manifest Family | Status |
|---------------|----------------|--------|
| `wet_mud_shine` (surface has mud/mud_pool) | `surface_overlays/wet_mud_shine/` | Planned |
| `water_surface` (surface has water or water biome) | Not in swamp slice | Gap — add for water biomes |
| `snow_drift` (cold biomes) | Not in swamp slice | Expected |

**landscape-recipe.js:83** pushes `wet_mud_shine` for swamp tiles with mud surface. Confirmed aligned.

### Layer 4: Micro Details

| Recipe Output | Manifest Family | Status |
|---------------|----------------|--------|
| `{ kind: 'soil', density: 0.45 }` (wet=true) | `micro/dark_mud_flecks/` | Planned |
| `{ kind: 'moss_ground_cover', density: 0.42 }` (wet=true) | `micro/moss_ground_cover/` | Planned |
| `{ kind: 'reeds_grass_blades', density: 0.48 }` (wet+foliage) | `micro/reeds_grass_blades/` | Planned |

**landscape-recipe.js:94-96** selects `moss_ground_cover` for wet tiles and `reeds_grass_blades` for wet foliage. Confirmed aligned.

### Layer 5: Medium Dressing

| Recipe Output | Manifest Family | Status |
|---------------|----------------|--------|
| `{ kind: 'reeds', density: 0.22 }` (water/swamp, veg>0.25) | `medium/reeds/` | Planned |
| `{ kind: 'root_cluster', density: 0.12 }` (swamp, veg>0.35) | `medium/root_cluster/` | Planned |

**landscape-recipe.js:107-108** confirms reeds + root_cluster for swamp. Cattails and moss_clump are manifest extras not yet in recipe — need recipe update or treat as density variants.

### Layer 6: Objects

Objects are placed by object placement system, not terrain canvas. Manifest includes:
- `forage_bush_swamp` — forage interaction
- `swamp_tree` — chop interaction
- `reed_harvest_node` — harvest interaction

These align with the recipe's `bush` and `canopy` thresholds but are formally separate from the landscape recipe.

### Transitions

| Manifest Pair | Existing Catalog | Status |
|---------------|-----------------|--------|
| `water_shallow__to__swamp_wet_mud` | None | Gap |
| `water_river__to__swamp_wet_mud` | None | Gap |
| `forest_floor__to__swamp_ground` | None | Gap |

No swamp transitions exist in `assets/catalog/terrain/`. All three need generation.

## Existing Catalog Audit (Swamp-relevant)

- `assets/catalog/terrain/` has no swamp-specific tiles
- No swamp Wang masks exist
- No swamp transition families exist
- Existing Wang sets: ocean_to_beach, beach_to_grass, grass_to_forest, grass_to_stone, grass_to_sand
- Wang terrain painter (`wang-terrain-painter.js:43`) is currently in placeholder mode — PNG Wang tiles act as optional overlays only

## Gaps Summary

1. **swamp/swamp_ground** base family missing from manifest (non-mud swamp surface)
2. **water_surface** overlay needed for water biome swamp edges
3. **cattails** and **moss_clump** in manifest but not in recipe's `mediumDressingFor()` — recipe may need update
4. No existing swamp assets to audit — all generation is net-new
5. Wang painter disabled — generated Wang tiles will need painter integration
