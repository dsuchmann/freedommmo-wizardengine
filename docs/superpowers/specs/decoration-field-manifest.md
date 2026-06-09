# Decoration Field Manifest

**Date:** 2026-06-08
**Status:** Active — Field 2 in progress, Fields 3-7 need work

## System Overview

8-layer decoration system rendered on top of Wang tilesets:
- **F0 Substrate** — Baked into chunk bitmap (worker), soil/rock textures
- **F1 Ground Cover** — Baked into chunk bitmap (worker), pebbles/shells/leaves
- **F2 Small Flora** — Baked static + main-thread animated overlay, 32px grass/flowers
- **F3 Small Scatter** — Not yet rendered, 32px rocks/sticks/bones
- **F4 Medium Flora** — Not yet rendered, 64px bushes/shrubs
- **F5 Medium Objects** — Not yet rendered, 96px boulders/stumps
- **F6 Large Objects** — DISABLED, 192px trees/structures (need regen at 192px)
- **F7 Canopy** — Not yet started, tree canopy overlay

## Field 0: Substrate
**Status:** DONE — baked into chunk bitmap
- Rendered in worker via `applySubstrateToChunk()`
- Uses soil blobs with ImageData blending

## Field 1: Ground Cover
**Status:** DONE — baked into chunk bitmap
- 17,552 PNGs across 20 biomes (including water biomes)
- Rendered in worker via `applyGroundCoverToChunk()`
- Occupancy grid prevents overlap

## Field 2: Small Flora (32px)
**Status:** IN PROGRESS — static rendering works, wind_sway partially animated

### Object Types (47 on disk, 44 in renderer config)

| Biome | Object | Variants | wind_sway | player_walk | Notes |
|-------|--------|----------|-----------|-------------|-------|
| arctic | frost_flower | 64 | v000 (9f) | — | |
| arctic | frozen_grass | 0 | v000 (9f) | — | No base variants on disk |
| arctic | ice_needle | 64 | v000 (9f) | — | |
| beach | beach_weed | 64 | v000 (9f) | — | |
| beach | dune_grass | 64 | v000 (9f) | v000 (9f) | |
| beach | sea_oat | 64 | v000 (9f) | — | |
| dense_forest | bracket_fungus | 64 | v000 (9f) | v000 (9f) | |
| dense_forest | dark_herb | 64 | v000 (9f) | v000 (9f) | |
| dense_forest | shade_fern | 64 | **MISSING** | — | Dominant! Queued, stuck at 95% |
| desert | desert_thorn | 64 | v000 (9f) | — | |
| desert | sand_grass | 64 | **MISSING** | — | Dominant! Queued, stuck at 95% |
| forest | clover_bloom | 64 | v000 (9f) | v000 (9f) | |
| forest | grass_blade_cluster | 64 | v000 (9f) | v000 (9f) | |
| forest | small_fern | 64 | v000 (9f) | v000 (9f) | |
| grassland | dandelion_stem | 64 | v000 (9f) | — | |
| grassland | tall_grass_blade | 64 | **MISSING** | — | Dominant! Queued, stuck at 95% |
| grassland | wild_herb | 64 | v000 (9f) | v000 (9f) | |
| hills | heather_sprig | 64 | v000 (9f) | — | |
| hills | hillside_grass | 64 | v000 (9f) | — | |
| hills | rock_flower_bud | 64 | v000 (9f) | — | |
| mountains | alpine_grass | 0 | v000 (9f) | — | No base variants; extra type on disk |
| mountains | alpine_tuft | 64 | v000 (9f) | — | |
| mountains | hardy_lichen | 64 | v000 (9f) | — | |
| mountains | mountain_lichen | 0 | v000 (9f) | — | No base variants; extra type on disk |
| mountains | rock_cress | 64 | v000 (9f) | — | |
| mystic | aether_fern | 64 | v000 (9f) | — | |
| mystic | crystal_sprout | 64 | **MISSING** | — | Queued, stuck at 95% |
| mystic | glow_grass_blade | 64 | **MISSING** | — | Dominant! Queued, stuck at 95% |
| savanna | acacia_seedling | 64 | v000 (9f) | — | |
| savanna | dry_grass_spike | 64 | v000 (9f) | — | |
| savanna | thorn_sprout | 64 | v000 (9f) | — | |
| steppe | dry_tuft | 64 | v000 (9f) | — | |
| steppe | dry_weed | 0 | v000 (9f) | — | No base variants; extra type on disk |
| steppe | grass_wisp | 0 | v000 (9f) | — | No base variants; extra type on disk |
| steppe | sparse_weed | 64 | v000 (9f) | — | |
| steppe | wind_grass | 64 | **MISSING** | — | Dominant! Queued, stuck at 95% |
| swamp | bog_grass | 64 | **MISSING** | — | Dominant! Queued, stuck at 95% |
| swamp | cattail_base | 64 | v000 (9f) | — | |
| swamp | swamp_herb | 64 | v000 (9f) | — | |
| taiga | cold_moss_tuft | 64 | v000 (9f) | — | |
| taiga | frost_grass | 64 | v000 (9f) | v000 (9f) | |
| taiga | low_juniper | 64 | v000 (9f) | v000 (9f) | |
| tropical_forest | broad_fern | 64 | v000 (9f) | v000 (9f) | |
| tropical_forest | orchid_sprout | 64 | v000 (9f) | v000 (9f) | |
| tropical_forest | vine_tendril | 64 | v000 (9f) | v000 (9f) | |
| tundra | arctic_berry | 0 | v000 (9f) | — | No base variants; extra type on disk |
| tundra | ice_moss | 64 | v000 (9f) | — | |
| tundra | low_berry_bush | 64 | **MISSING** | — | Queued, stuck at 95% |
| tundra | tundra_grass | 64 | v000 (9f) | — | |
| volcanic | ash_grass | 64 | v000 (9f) | — | |
| volcanic | heat_sprout | 64 | v000 (9f) | — | |
| volcanic | lava_fern | 0 | v000 (9f) | — | No base variants; extra type on disk |

### Animation Summary
- **wind_sway:** 36/44 types have v000 on disk. 8 missing (all dominant species, stuck at 95% on PixelLab). Currently only 1 variant animated per type — **need all 64 variants animated per type** (2,816 total jobs)
- **player_walk:** 12/44 types have v000 on disk. Need all 64 variants per type.
- **fire_flicker:** 0/44. Not started.
- **ice_shimmer:** 0/44. Not started.
- **enchanted_glow:** 0/44. Not started.
- **destroy:** 0/44. Not started.

### Renderer Status
- Static rendering: ENABLED (worker-chunk-renderer.js)
- Wind sway animation: ENABLED (field2-animator.js) — cross-fade, sine-wave sway, scale breathing
- Player walk animation: NOT WIRED
- State animations: NOT WIRED

## Field 3: Small Scatter (32px)
**Status:** BASE GENERATION 88% COMPLETE, STATE GENERATION STARTING

- 11,568 base PNGs on disk (prior generation) + 3,584 NEW base sprites (56 objects x 64 variants via PixelLab)
- 64 object types across 16 land biomes (master plan), 56/64 selected, 8 at 95% stall
- Pixel size: 32px (same as F2)
- No animations (these are static objects — rocks, bones, shells don't sway)
- 7+ state variants completed (forest biome), 295 total needed
- No renderer built yet

### State Matrix (static objects — NO wind/movement animations)

States applied selectively by object category:

| State | Organic | Mineral | Bone/Shell | Edit Description |
|-------|---------|---------|------------|-----------------|
| `destroyed` | YES | YES | YES | smashed into broken fragments and debris |
| `burned` | YES | — | YES | charred and blackened by fire, embers, ash |
| `frozen` | YES | YES | YES | covered in frost and ice crystals, icy blue |
| `enchanted` | YES | YES | YES | glowing magical purple-blue aura, runic shimmer |
| `decayed` | YES | — | — | rotting, decomposing, fungal growth |
| `cracked` | — | YES | YES | fractured with stress lines, chipping apart |

Categories: Organic=5 states, Mineral=4 states, Bone/Shell=5 states

### F3 Object Types & State Generation (16 land biomes)

#### Forest
| Object | Cat | Base ID | destroyed | burned | frozen | enchanted | decayed | cracked |
|--------|-----|---------|-----------|--------|--------|-----------|---------|---------|
| twig_bundle | org | b779f127 | — | — | — | — | — | n/a |
| acorn_cluster | org | 2ded2fa1 | — | — | — | — | — | n/a |
| bark_shard | org | c1234725 | — | — | — | — | — | n/a |
| small_stone | min | 88b115f5 | — | n/a | — | — | n/a | — |

#### Dense Forest
| Object | Cat | Base ID | destroyed | burned | frozen | enchanted | decayed | cracked |
|--------|-----|---------|-----------|--------|--------|-----------|---------|---------|
| rotting_branch | org | 59f02b25 | — | — | — | — | — | n/a |
| mushroom_cluster | org | 929ced0c | — | — | — | — | — | n/a |
| fallen_pinecone | org | f45dcb57 | — | — | — | — | — | n/a |
| moss_stone | min | 3dd611d7 | — | n/a | — | — | n/a | — |

#### Tropical Forest
| Object | Cat | Base ID | destroyed | burned | frozen | enchanted | decayed | cracked |
|--------|-----|---------|-----------|--------|--------|-----------|---------|---------|
| seed_pod | org | fa39c41e | — | — | — | — | — | n/a |
| beetle_shell | b/s | ba88b4ea | — | — | — | — | n/a | — |
| palm_nut | org | 5f5f9df8 | — | — | — | — | — | n/a |
| vine_cutting | org | 20c248cb | — | — | — | — | — | n/a |

#### Taiga
| Object | Cat | Base ID | destroyed | burned | frozen | enchanted | decayed | cracked |
|--------|-----|---------|-----------|--------|--------|-----------|---------|---------|
| pine_cone | org | 5325df1d | — | — | — | — | — | n/a |
| frozen_twig | org | 06f2167d | — | — | — | — | — | n/a |
| resin_drop | org | ed6b0460 | — | — | — | — | — | n/a |
| ice_pebble | min | 49f16b88 | — | n/a | — | — | n/a | — |

#### Grassland
| Object | Cat | Base ID | destroyed | burned | frozen | enchanted | decayed | cracked |
|--------|-----|---------|-----------|--------|--------|-----------|---------|---------|
| field_stone | min | 40f2374a | — | n/a | — | — | n/a | — |
| dried_flower | org | f60a7d85 | — | — | — | — | — | n/a |
| seed_head | org | — | — | — | — | — | — | n/a |
| snail_shell | b/s | — | — | — | — | — | n/a | — |

#### Savanna
| Object | Cat | Base ID | destroyed | burned | frozen | enchanted | decayed | cracked |
|--------|-----|---------|-----------|--------|--------|-----------|---------|---------|
| dry_bone | b/s | — | — | — | — | — | n/a | — |
| cracked_pod | org | — | — | — | — | — | — | n/a |
| bleached_stick | org | — | — | — | — | — | — | n/a |
| termite_chip | org | — | — | — | — | — | — | n/a |

#### Steppe
| Object | Cat | Base ID | destroyed | burned | frozen | enchanted | decayed | cracked |
|--------|-----|---------|-----------|--------|--------|-----------|---------|---------|
| wind_pebble | min | — | — | n/a | — | — | n/a | — |
| grass_ball | org | — | — | — | — | — | — | n/a |
| small_skull | b/s | — | — | — | — | — | n/a | — |
| dust_clod | min | — | — | n/a | — | — | n/a | — |

#### Desert
| Object | Cat | Base ID | destroyed | burned | frozen | enchanted | decayed | cracked |
|--------|-----|---------|-----------|--------|--------|-----------|---------|---------|
| bleached_bone | b/s | — | — | — | — | — | n/a | — |
| polished_stone | min | — | — | n/a | — | — | n/a | — |
| scorpion_shell | b/s | — | — | — | — | — | n/a | — |
| dried_seed | org | — | — | — | — | — | — | n/a |

#### Beach
| Object | Cat | Base ID | destroyed | burned | frozen | enchanted | decayed | cracked |
|--------|-----|---------|-----------|--------|--------|-----------|---------|---------|
| seashell | b/s | — | — | — | — | — | n/a | — |
| sea_glass | min | — | — | n/a | — | — | n/a | — |
| driftwood_chip | org | — | — | — | — | — | — | n/a |
| coral_fragment | b/s | — | — | — | — | — | n/a | — |

#### Swamp
| Object | Cat | Base ID | destroyed | burned | frozen | enchanted | decayed | cracked |
|--------|-----|---------|-----------|--------|--------|-----------|---------|---------|
| rotting_stick | org | — | — | — | — | — | — | n/a |
| frog_eggs | org | — | — | — | — | — | — | n/a |
| leech | org | — | — | — | — | — | — | n/a |
| bog_iron | min | — | — | n/a | — | — | n/a | — |

#### Hills
| Object | Cat | Base ID | destroyed | burned | frozen | enchanted | decayed | cracked |
|--------|-----|---------|-----------|--------|--------|-----------|---------|---------|
| limestone_chip | min | — | — | n/a | — | — | n/a | — |
| quartz_pebble | min | — | — | n/a | — | — | n/a | — |
| slate_fragment | min | — | — | n/a | — | — | n/a | — |
| iron_nugget | min | — | — | n/a | — | — | n/a | — |

#### Mountains
| Object | Cat | Base ID | destroyed | burned | frozen | enchanted | decayed | cracked |
|--------|-----|---------|-----------|--------|--------|-----------|---------|---------|
| rock_shard | min | — | — | n/a | — | — | n/a | — |
| ice_chunk | min | — | — | n/a | — | — | n/a | — |
| crystal_fragment | min | — | — | n/a | — | — | n/a | — |
| ore_glint | min | — | — | n/a | — | — | n/a | — |

#### Volcanic
| Object | Cat | Base ID | destroyed | burned | frozen | enchanted | decayed | cracked |
|--------|-----|---------|-----------|--------|--------|-----------|---------|---------|
| obsidian_shard | min | — | — | n/a | — | — | n/a | — |
| sulfur_crystal | min | — | — | n/a | — | — | n/a | — |
| charred_bone | b/s | — | — | — | — | — | n/a | — |
| lava_pebble | min | — | — | n/a | — | — | n/a | — |

#### Tundra
| Object | Cat | Base ID | destroyed | burned | frozen | enchanted | decayed | cracked |
|--------|-----|---------|-----------|--------|--------|-----------|---------|---------|
| frozen_pebble | min | — | — | n/a | — | — | n/a | — |
| ice_shard | min | — | — | n/a | — | — | n/a | — |
| lichen_rock | min | — | — | n/a | — | — | n/a | — |
| fossil_fragment | b/s | — | — | — | — | — | n/a | — |

#### Arctic
| Object | Cat | Base ID | destroyed | burned | frozen | enchanted | decayed | cracked |
|--------|-----|---------|-----------|--------|--------|-----------|---------|---------|
| snow_clump | min | — | — | n/a | — | — | n/a | — |
| ice_crystal_cluster | min | — | — | n/a | — | — | n/a | — |
| frozen_shell | b/s | — | — | — | — | — | n/a | — |
| frost_stone | min | — | — | n/a | — | — | n/a | — |

#### Mystic
| Object | Cat | Base ID | destroyed | burned | frozen | enchanted | decayed | cracked |
|--------|-----|---------|-----------|--------|--------|-----------|---------|---------|
| aether_crystal | min | — | — | n/a | — | — | n/a | — |
| rune_shard | min | — | — | n/a | — | — | n/a | — |
| glowing_pebble | min | — | — | n/a | — | — | n/a | — |
| stardust_cluster | min | — | — | n/a | — | — | n/a | — |

### F3 Generation Summary
| Metric | Count |
|--------|-------|
| Land biomes | 16 |
| Object types | 64 |
| Base calls (64 candidates each) | 64 |
| Organic objects (5 states each) | 30 → 150 state calls |
| Mineral objects (4 states each) | 25 → 100 state calls |
| Bone/Shell objects (5 states each) | 9 → 45 state calls |
| **Total state calls** | **295** |
| **Total PixelLab calls** | **359** |

### Existing base PNGs on disk (prior generation)
| Biome | Object Types | PNGs |
|-------|-------------|------|
| arctic | 9 | 704 |
| beach | 8 | 640 |
| deep_ocean | 7 | 832 |
| dense_forest | 6 | 384 |
| desert | 7 | 576 |
| forest | 14 | 960 |
| grassland | 5 | 320 |
| hills | 7 | 448 |
| lake | 4 | 1,024 |
| mountains | 6 | 384 |
| mystic | 8 | 768 |
| ocean | 8 | 640 |
| river | 6 | 768 |
| savanna | 4 | 256 |
| shallow_water | 6 | 768 |
| steppe | 5 | 320 |
| swamp | 4 | 256 |
| taiga | 5 | 304 |
| tropical_forest | 6 | 384 |
| tundra | 4 | 256 |
| volcanic | 9 | 576 |

## Field 4: Medium Flora (64px)
**Status:** PARTIALLY GENERATED, NOT RENDERED

- 1,344 PNGs across 4 biomes only (forest, mystic, tropical_forest, tundra)
- 12 biomes have NO assets
- Pixel size: 64px
- No renderer built

## Field 5: Medium Objects (96px)
**Status:** PARTIALLY GENERATED, NOT RENDERED

- 3,648 PNGs across 19 biomes
- Many biomes have 0 PNGs (directory exists but empty)
- Pixel size: 96px
- No renderer built

| Biome | Types | PNGs |
|-------|-------|------|
| arctic | 3 | 0 |
| beach | 3 | 0 |
| deep_ocean | 1 | 192 |
| dense_forest | 3 | 0 |
| desert | 3 | 0 |
| forest | 4 | 176 |
| grassland | 4 | 192 |
| hills | 4 | 192 |
| mountains | 6 | 576 |
| mystic | 3 | 192 |
| ocean | 2 | 384 |
| savanna | 3 | 192 |
| steppe | 3 | 0 |
| swamp | 4 | 192 |
| taiga | 3 | 0 |
| tropical_forest | 3 | 0 |
| tundra | 3 | 0 |
| volcanic | 4 | 960 |

## Field 6: Large Objects (192px)
**Status:** DISABLED — assets exist at 64px but need 192px regen

- 12,733 PNGs across 17 biomes (at 64px, too small)
- Renderer exists (large-object-renderer.js) but DISABLED
- Need to regenerate all at 192px
- Trees, boulders, structures, ruins

## Field 7: Canopy
**Status:** NOT STARTED

- No assets
- No renderer
- Treetop overlay for forested biomes

## Priority Queue

1. **Field 2 wind_sway all 64 variants** — 2,816 jobs (~9.4 hrs)
2. **Field 2 remaining 8 missing types** — stuck at 95%, waiting
3. **Field 3 renderer + integration** — assets exist, need renderer
4. **Field 4 asset generation** — only 4/16 biomes, need 12 more
5. **Field 5 asset generation** — many biomes empty
6. **Field 6 regeneration at 192px** — complete redo
7. **Field 7 design + generation** — from scratch

## PixelLab IDs (from _downloads folder)

Known animated object IDs (one per type):
```
swamp_herb:        0748aa90-d38a-4bd4-8e66-9761dbbf83e1
hardy_lichen:      08a8652f-6516-4d15-b95f-784358109e3f
rock_flower_bud:   0c637cb4-4c04-4aad-8a80-b66e2edd941c
heather_sprig:     0dbe8327-8e1c-460c-b9ea-0d1727c20fee
ash_grass:         0e826c20-991d-4158-b25d-7846a2c04d1c
thorn_sprout:      130c6bf5-bdef-4b1d-8b1c-dc5d3ca95987
rock_cress:        2239ff9c-cb66-49ad-b633-b5c46144685a
cold_moss_tuft:    258be4b5-efae-4905-a454-e95dbb83aefa
acacia_seedling:   26d00838-f262-4fb8-b75b-3dd7890e1b75
aether_fern:       3006778d-edbd-4229-88f9-fad31e06ad94
hillside_grass:    354a0fe3-aa36-4ee1-939a-6e0d64ece577
bracket_fungus:    36ec732d-2ed1-4285-b9ff-76c9ec9a5608
dark_herb:         3d354d0c-797c-4b3c-b875-5cf15f1420d1
frost_grass:       415ceffe-9d9f-411e-a4f5-07bc96442942
broad_fern:        4bb23513-dec5-44bf-9004-149094645fa9
sand_grass:        4f4b845d-23e9-4228-a54c-943154499807
dry_grass_spike:   50347cba-5514-4f85-b204-79a00fcafbcc
alpine_tuft:       52b98d54-9463-4061-820c-e597a65fe0bc
small_fern:        5837fd5f-8f7d-47be-84a1-33ba8a7bfa67
low_juniper:       63938c6f-96da-4dde-b622-55c595b3c60d
tundra_grass:      6585bcdb-a06e-4d88-806b-c05124751a86
sea_oat:           670b546d-1af1-4790-a5c2-a30fa4d8002f
low_berry_bush:    6b255518-6f73-41dc-86fc-5a64ebf2800f
bog_grass:         6bcc66ce-ce6b-4539-9f29-fcc1ba6e243c
vine_tendril:      70fe416f-7b29-4ef7-a1e2-77713fe7af39
ice_moss:          722b697c-ca52-4319-8cad-1e75d9c77d11
desert_thorn:      78d4c2ab-0a09-4792-b44b-e37e9bac1b03
crystal_sprout:    7ec50e6e-9bef-403a-b5ae-4919716a1a3f
dune_grass:        88dd85b4-0ebb-4c8a-be9f-99c8482f1442
grass_blade_cluster: 909809bb-c073-4e46-9f7e-6f50553c5b2a
ice_needle:        917c219e-245d-4040-b439-a4678f9b1e0f
heat_sprout:       a9f02ac9-4597-42c9-bb41-3af743c26794
wild_herb:         bc524bbc-fe0a-400a-9b3c-d49c040b9dc0
dandelion_stem:    bcfc1d87-f98d-45a5-800a-d8c5606d1d2a
sparse_weed:       c77da00f-5ec3-46be-8b33-dc8a0fd9d979
cattail_base:      c9530dca-1d2c-48d5-a257-ff17754cbbe7
glow_grass_blade:  e172e8fd-9e2c-44f4-90f4-87fb5274b19c
frost_flower:      eed9957b-7795-4a4e-ac45-b1bfe14fdc24
beach_weed:        f50bfaa6-6eb5-4c6a-ae9c-84eeb0f1a80b
clover_bloom:      fbb450bd-8cb7-4a0a-9801-592fd5c3de30
orchid_sprout:     ffb85ef3-7699-4154-a480-8f6455962ee0
```

New objects (created this session for missing types):
```
tall_grass_blade:  350ebd9e-8102-451d-b7ca-622275a5d28e (wind_sway stuck 95%)
wind_grass:        90c6b79c-34f0-46e4-9ee8-a8c15c2105e8 (wind_sway stuck 95%)
shade_fern:        105d0c73-29fc-43a0-9077-4d78d62afb45 (wind_sway stuck 95%)
```
