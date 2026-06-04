# Wang Tile Full Regeneration Plan

## Goal

Generate fresh canonical base tiles for ALL 21 biomes, then generate ALL needed transitions using those canonical IDs. Zero fragmentation. Every transition seamlessly connects.

## All 21 Biomes

Each gets a fresh canonical base tile generated via `create_topdown_tileset` as a self-referencing tileset (same terrain upper and lower) to establish the base tile ID.

| # | Biome | Ground Description (draft prompt) |
|---|-------|----------------------------------|
| 1 | ocean | deep blue ocean water with gentle wave ripples |
| 2 | deep_ocean | dark navy ocean water with deep subtle wave patterns |
| 3 | shallow_water | light turquoise water with visible sandy bottom |
| 4 | lake | calm still blue-green water with subtle reflections |
| 5 | river | flowing blue water with gentle current lines |
| 6 | beach | golden sandy beach with fine grain texture |
| 7 | desert | arid desert sand with subtle wind ripples |
| 8 | grassland | lush green grass meadow with individual blades |
| 9 | forest | dark forest floor with fallen leaves, moss, and exposed roots |
| 10 | dense_forest | very dark dense forest floor with thick leaf litter, mushrooms, and deep moss |
| 11 | tropical_forest | lush tropical forest floor with broad leaves, vines, and rich dark soil |
| 12 | taiga | cold taiga floor with pine needles, frost, and sparse lichen |
| 13 | savanna | dry golden savanna grass with scattered patches of red earth |
| 14 | steppe | short windswept dry brown-green grass with hard packed earth |
| 15 | swamp | wet brown swamp mud with murky water patches and peat |
| 16 | tundra | frozen grey-brown permafrost with sparse lichen and frost |
| 17 | arctic | white snow and ice with subtle blue shadows |
| 18 | hills | rocky hillside with scattered stones and sparse tough grass |
| 19 | mountains | grey mountain rock with snow patches and exposed stone |
| 20 | volcanic | dark charred volcanic rock with glowing orange lava cracks |
| 21 | mystic | glowing purple-pink enchanted ground with crystal fragments |

## Full Transition Matrix

Every biome pair that can realistically be adjacent in world generation.

### Water-to-water (4)
- deep_ocean <-> ocean
- ocean <-> shallow_water
- shallow_water <-> lake
- shallow_water <-> river

### Water-to-land (20)
- ocean <-> beach
- shallow_water <-> beach
- shallow_water <-> swamp
- river <-> beach
- river <-> forest
- river <-> dense_forest
- river <-> grassland
- river <-> hills
- river <-> swamp
- river <-> savanna
- river <-> steppe
- river <-> taiga
- river <-> tundra
- river <-> tropical_forest
- lake <-> forest
- lake <-> dense_forest
- lake <-> grassland
- lake <-> swamp
- lake <-> taiga
- lake <-> hills

### Coastal/beach (6)
- beach <-> grassland
- beach <-> forest
- beach <-> desert
- beach <-> hills
- beach <-> savanna
- beach <-> swamp

### Temperate transitions (10)
- grassland <-> forest
- grassland <-> desert
- grassland <-> savanna
- grassland <-> steppe
- grassland <-> hills
- grassland <-> mystic
- grassland <-> taiga
- grassland <-> swamp
- grassland <-> tropical_forest
- grassland <-> mountains

### Forest family (7)
- forest <-> dense_forest
- forest <-> tropical_forest
- forest <-> taiga
- forest <-> hills
- forest <-> mystic
- forest <-> savanna
- forest <-> swamp

### Dense forest (5)
- dense_forest <-> tropical_forest
- dense_forest <-> mystic
- dense_forest <-> swamp
- dense_forest <-> taiga
- dense_forest <-> hills

### Arid transitions (6)
- desert <-> savanna
- desert <-> hills
- desert <-> volcanic
- desert <-> steppe
- savanna <-> steppe
- savanna <-> hills

### Cold transitions (8)
- taiga <-> tundra
- taiga <-> hills
- taiga <-> mountains
- tundra <-> arctic
- tundra <-> hills
- tundra <-> mountains
- tundra <-> steppe
- arctic <-> mountains

### Elevation transitions (4)
- hills <-> mountains
- hills <-> volcanic
- mountains <-> volcanic
- mountains <-> arctic

### Tropical/special (3)
- tropical_forest <-> mystic
- tropical_forest <-> savanna
- swamp <-> taiga

### Cliff tilesets (13 — existing, keep as-is unless quality issues)
- beach_cliff, forest_cliff, grass_cliff, hills_cliff, mystic_cliff
- sand_cliff, savanna_cliff, snow_cliff, steppe_cliff, stone_cliff
- swamp_cliff, tundra_cliff, volcanic_cliff

---

## Counts

| Category | Count |
|----------|-------|
| Canonical base tiles to generate | 21 |
| Total transitions needed | 73 |
| Currently on disk | 61 |
| Existing that need regen (all of them — new canonical IDs) | 61 |
| New transitions to generate | 12 |
| Cliff tilesets (keep) | 13 |

### The 12 missing transitions
1. river <-> dense_forest
2. river <-> savanna
3. river <-> steppe
4. river <-> taiga
5. river <-> tundra
6. river <-> tropical_forest
7. lake <-> dense_forest
8. lake <-> taiga
9. lake <-> hills
10. grassland <-> tropical_forest
11. grassland <-> mountains
12. tropical_forest <-> savanna

---

## Generation Order

### Step 1: Generate 21 canonical base tiles (~35 min)
Each takes ~100s. Generate as self-referencing tilesets (same terrain upper/lower, transition_size=0) just to mint the base tile ID. Can run several in parallel.

### Step 2: Generate 73 transitions (~2 hours)
Each takes ~100s. Use canonical base tile IDs for both sides. Can run batches in parallel.

Order matters: start with dense_forest transitions (the vertical slice priority), then expand outward.

**Dense forest first (9 transitions):**
1. forest <-> dense_forest
2. dense_forest <-> mystic
3. dense_forest <-> tropical_forest
4. dense_forest <-> swamp
5. dense_forest <-> river
6. dense_forest <-> lake
7. dense_forest <-> hills
8. dense_forest <-> taiga
9. dense_forest <-> grassland (via clearing)

**Then forest transitions (7):**
- forest <-> grassland, hills, mystic, savanna, taiga, tropical_forest, swamp

**Then expand biome by biome.**

### Step 3: Download and replace on-disk assets
For each generated tileset:
1. Download the 16 wang tile PNGs
2. Place in `assets/pixelab/landscape_v2/transitions/{from}_to_{to}/wang/`
3. Update code mappings if new transitions

### Step 4: Update code
- Add new transitions to TRANSITION_PAIRS in worker-chunk-renderer.js
- Add new dirs to EXTRA_TRANSITION_DIRS in wang-image-list.js
- Verify BIOME_INTERIOR mappings use correct dirs

---

## Prompt Framework

All tiles generated with consistent settings:
- **tile_size**: { width: 32, height: 32 }
- **view**: "high top-down"
- **outline**: "lineless"
- **shading**: "medium detail"
- **detail**: "medium detail"

Ground descriptions follow a template:
```
{biome_adjective} {material} {surface_texture}, {color_description}, {small_detail_1}, {small_detail_2}
```

Transition descriptions:
```
natural transition from {lower_material} to {upper_material}, {blending_description}
```
