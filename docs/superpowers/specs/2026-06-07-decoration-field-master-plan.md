# Decoration Field Master Plan

**Date:** 2026-06-07
**Status:** In progress
**Scope:** Complete 8-field decoration system across all 21 biomes

## System Overview

Every tile (32x32px) has a decoration field stack of 8 layers. Each field places objects on a sub-tile grid at a given density. Fields are resolved top-down (large objects claim space first) and rendered bottom-up (substrate drawn first).

### Rendering approach by field

| Field | Technique | When computed |
|---|---|---|
| 0 | Per-pixel blending into chunk ImageData | Chunk compilation (worker) |
| 1 | Per-pixel blending (same as field 0) | Chunk compilation (worker) |
| 2 | Per-pixel or small sprite placement | Chunk compilation (worker) |
| 3 | Small sprite placement on 8x8 grid | Chunk compilation (worker) |
| 4 | Sprite placement on 6x6 grid | Chunk compilation (worker) |
| 5 | Sprite placement on 4x4 grid | Chunk compilation (worker) |
| 6 | Large sprite, y-sorted with player | Main thread draw loop |
| 7 | Large sprite, rendered above player | Main thread draw loop |

### Transition tile handling

Fields 0-2 use bilinear corner interpolation to determine per-pixel biome ownership. Substrate fades out near the transition boundary (distance < 0.08 = no fill, 0.08-0.30 = fade in, > 0.30 = full). Fields 3+ skip transition tiles entirely (objects don't straddle biome boundaries).

---

## Field 0: Substrate
**Status: DONE (rendered, all 21 biomes, transition tiles supported)**

| Property | Value |
|---|---|
| Grid | 1x1 (per-pixel) |
| Density | 93-98% |
| Alpha | 0.60-0.80 (moisture-driven) |
| Sprite size | 32x32 (pixel-sampled, not drawn as sprite) |
| Variants per material | 64 |
| Transition support | Yes, bilinear fade |
| Asset path | `assets/pixelab/landscape_v2/micro/soil/{material}/` |

### Materials by biome

| Biome | Material | Sprites |
|---|---|---|
| forest | loam | 64 |
| dense_forest | dark_humus | 64 |
| tropical_forest | tropical_humus | 64 |
| taiga | needle_duff | 64 |
| grassland | dry_loam | 64 |
| savanna | sun_baked_earth | 64 |
| steppe | dusty_earth | 64 |
| desert | hot_sand | 64 |
| beach | wet_sand | 64 |
| swamp | peat_mud | 64 |
| hills | rocky_soil | 64 |
| mountains | grey_gravel | 64 |
| volcanic | basalt_ash | 64 |
| tundra | frozen_earth | 64 |
| arctic | glacial_crust | 64 |
| mystic | aether_loam | 64 |
| ocean | ocean_surface | 64 |
| deep_ocean | deep_water | 64 |
| shallow_water | shallow_water | 64 |
| river | flowing_water | 64 |
| lake | still_water | 64 |

**Total: 1,344 sprites**

---

## Field 1: Ground Cover
**Status: ASSETS READY, renderer not yet wired**

| Property | Value |
|---|---|
| Grid | 8x8 (64 cells) or per-pixel |
| Density | 60-85% |
| Alpha | 0.50-0.70 |
| Sprite size | 32x32 (pixel-sampled like field 0) |
| Variants per object | 64 |
| Transition support | Yes, bilinear fade (same as field 0) |
| Asset path | `assets/pixelab/landscape_v2/micro/ground_cover/{biome}/{object}/` |
| File naming | `gc__{biome}__{object}__v{NNN}.png` |

### Objects by biome

| Biome | Object A | Object B | Object C |
|---|---|---|---|
| forest | fallen_leaves | moss_patch | pine_needles |
| dense_forest | dark_leaf_mat | dark_wet_moss | fungal_film |
| tropical_forest | tropical_leaves | bright_green_moss | fern_fronds |
| taiga | frost_pine_needles | frost_lichen | bark_chips |
| grassland | grass_mat | clover_patch | golden_thatch |
| savanna | golden_grass_tuft | cracked_earth | seed_husks |
| steppe | pale_grass_wisps | dust_patch | dried_stems |
| desert | sand_ripple | dust_drift | cracked_clay |
| beach | wet_sand | sea_foam | tide_line |
| swamp | algae_film | sphagnum_moss | waterlogged_leaf |
| hills | hillside_grass | flat_stone | brown_moss |
| mountains | lichen_crust | frost_crystals | gravel_scatter |
| volcanic | ash_film | char_crust | pumice_dust |
| tundra | frozen_moss | ice_crust | dead_lichen |
| arctic | snow_crust | ice_crystals | frost_pattern |
| mystic | glowing_moss | aether_tendril | crystal_dust |

**Total: 3,072 sprites (48 objects × 64 variants)**

---

## Field 2: Small Flora / Ground Detail
**Status: BASE SPRITES COMPLETE (all 16 biomes, 6,246 sprites). Animations in progress.**

| Property | Value |
|---|---|
| Grid | 8x8 (64 cells) |
| Density | 20-50% |
| Sprite size | 32x32 (pixel-sampled) |
| Variants per object | 64 |
| Transition support | Optional (bilinear fade) |
| Asset path | `assets/pixelab/landscape_v2/micro/small_flora/{biome}/{object}/` |
| File naming | `sf__{biome}__{object}__v{NNN}.png` |

### Objects by biome

| Biome | Object A | Object B | Object C |
|---|---|---|---|
| forest | grass_blade_cluster | small_fern | clover_bloom |
| dense_forest | shade_fern | bracket_fungus | dark_herb |
| tropical_forest | broad_fern | orchid_sprout | vine_tendril |
| taiga | frost_grass | low_juniper | cold_moss_tuft |
| grassland | tall_grass_blade | dandelion_stem | wild_herb |
| savanna | dry_grass_spike | thorn_sprout | acacia_seedling |
| steppe | wind_grass | sparse_weed | dry_tuft |
| desert | sand_grass | desert_thorn | — |
| beach | dune_grass | sea_oat | beach_weed |
| swamp | cattail_base | bog_grass | swamp_herb |
| hills | hillside_grass | rock_flower_bud | heather_sprig |
| mountains | alpine_tuft | rock_cress | hardy_lichen |
| volcanic | heat_sprout | ash_grass | — |
| tundra | tundra_grass | low_berry_bush | ice_moss |
| arctic | frost_flower | ice_needle | — |
| mystic | glow_grass_blade | aether_fern | crystal_sprout |

**Target: ~2,880 sprites (45 objects × 64 variants)**

### Generation prompt template
```
top-down high fantasy pixel art [object], hyper-detailed, rich colors,
alpha-transparent background, small ground flora sprite, pixel art style
```

---

## Field 3: Small Scatter / Debris
**Status: NEEDS GENERATION**

| Property | Value |
|---|---|
| Grid | 8x8 (64 cells) |
| Density | 5-15% |
| Sprite size | 32x32 |
| Variants per object | 64 |
| Transition support | No (skip transition tiles) |
| Asset path | `assets/pixelab/landscape_v2/micro/small_scatter/{biome}/{object}/` |
| File naming | `ss__{biome}__{object}__v{NNN}.png` |

### Objects by biome

| Biome | Object A | Object B | Object C | Object D |
|---|---|---|---|---|
| forest | twig_bundle | acorn_cluster | bark_shard | small_stone |
| dense_forest | rotting_branch | mushroom_cluster | fallen_pinecone | moss_stone |
| tropical_forest | seed_pod | beetle_shell | palm_nut | vine_cutting |
| taiga | pine_cone | frozen_twig | resin_drop | ice_pebble |
| grassland | field_stone | dried_flower | seed_head | snail_shell |
| savanna | dry_bone | cracked_pod | bleached_stick | termite_chip |
| steppe | wind_pebble | grass_ball | small_skull | dust_clod |
| desert | bleached_bone | polished_stone | scorpion_shell | dried_seed |
| beach | seashell | sea_glass | driftwood_chip | coral_fragment |
| swamp | rotting_stick | frog_eggs | leech | bog_iron |
| hills | limestone_chip | quartz_pebble | slate_fragment | iron_nugget |
| mountains | rock_shard | ice_chunk | crystal_fragment | ore_glint |
| volcanic | obsidian_shard | sulfur_crystal | charred_bone | lava_pebble |
| tundra | frozen_pebble | ice_shard | lichen_rock | fossil_fragment |
| arctic | snow_clump | ice_crystal_cluster | frozen_shell | frost_stone |
| mystic | aether_crystal | rune_shard | glowing_pebble | stardust_cluster |

**Target: ~3,840 sprites (64 objects × 60 variants)**

### Generation prompt template
```
top-down high fantasy pixel art [object], hyper-detailed, rich colors,
alpha-transparent background, small debris sprite, detailed shading
```

---

## Field 4: Medium Flora / Flowers
**Status: PARTIAL (4 biomes)**

| Property | Value |
|---|---|
| Grid | 6x6 (36 cells) |
| Density | 3-12% |
| Sprite size | 64x64 (PixelLab size=64, 16 candidates/call) |
| Variants per object | 60 |
| Transition support | No |
| Asset path | `assets/pixelab/landscape_v2/micro/medium_flora/{biome}/{object}/` |
| File naming | `mf__{biome}__{object}__v{NNN}.png` |

### Objects by biome

| Biome | Object A | Object B | Object C |
|---|---|---|---|
| forest | wildflower_cluster | forest_mushroom | wood_sorrel |
| dense_forest | ghost_orchid | giant_mushroom | shelf_fungus |
| tropical_forest | bird_of_paradise | passion_flower | heliconia |
| taiga | fireweed | arctic_poppy | wintergreen |
| grassland | daisy_cluster | cornflower | wild_lavender |
| savanna | flame_lily | desert_rose | aloe_rosette |
| steppe | sage_brush | thistle | yarrow |
| desert | prickly_pear_bloom | desert_marigold | sand_verbena |
| beach | sea_holly | beach_morning_glory | dune_daisy |
| swamp | water_lily | swamp_iris | pitcher_plant |
| hills | mountain_bluebell | rock_rose | thyme_bush |
| mountains | edelweiss | alpine_gentian | snow_flower |
| volcanic | fire_flower | ash_bloom | sulfur_rose |
| tundra | arctic_poppy | moss_campion | tundra_rose |
| arctic | ice_flower | frost_bloom | crystal_rose |
| mystic | aether_bloom | starlight_orchid | moonpetal |

**Target: ~2,880 sprites (48 objects × 60 variants)**

### Generation prompt template
```
top-down high fantasy pixel art [object], jaw-dropping beauty, hyper-detailed,
rich saturated colors, Final Fantasy aesthetic, alpha-transparent background,
detailed shading, medium flora sprite
```

---

## Field 5: Medium Objects
**Status: PARTIAL (19 biomes from sorting)**

| Property | Value |
|---|---|
| Grid | 4x4 (16 cells) |
| Density | 1-5% |
| Sprite size | 96x96 (PixelLab size=96, 16 candidates/call) |
| Variants per object | 60 |
| Footprint | 8-16px, claims cells in lower fields |
| Transition support | No |
| Asset path | `assets/pixelab/landscape_v2/micro/medium_objects/{biome}/{object}/` |
| File naming | `mo__{biome}__{object}__v{NNN}.png` |

### Objects by biome

| Biome | Object A | Object B | Object C |
|---|---|---|---|
| forest | mossy_boulder | tree_stump | fallen_log |
| dense_forest | hollow_stump | rotting_log | root_mound |
| tropical_forest | jungle_rock | buttress_root | vine_log |
| taiga | snow_rock | frost_stump | ice_log |
| grassland | field_boulder | hay_bale | fence_post |
| savanna | termite_mound | bone_pile | dry_well |
| steppe | wind_rock | stone_cairn | buried_post |
| desert | sandstone_formation | bleached_skull | clay_pot_shard |
| beach | tide_pool_rock | beached_log | anchor_relic |
| swamp | bog_log | mud_mound | rotting_dock |
| hills | granite_outcrop | stone_pile | old_milestone |
| mountains | ice_boulder | frozen_cairn | cliff_fragment |
| volcanic | obsidian_pillar | lava_rock | basalt_column |
| tundra | permafrost_mound | ice_boulder | frozen_bones |
| arctic | ice_formation | snow_drift_mound | frozen_ruin |
| mystic | rune_stone | crystal_cluster | ancient_altar |

**Target: ~2,880 sprites (48 objects × 60 variants)**

### Generation prompt template
```
top-down high fantasy pixel art [object], jaw-dropping beauty, hyper-detailed,
rich saturated colors, Final Fantasy aesthetic, alpha-transparent background,
detailed shading, medium terrain object
```
Use size=96 for `create_1_direction_object` (gives 16 candidates per call, need 4 calls per object).

### PixelLab generation size guide (UPDATED 2026-06-07)
| Field | Object type | PixelLab size | Candidates/call | Rationale |
|-------|------------|---------------|-----------------|-----------|
| 2 | Small flora | 32 | 64 | Half-tile objects, 32px is plenty |
| 3 | Small scatter | 32 | 64 | Pebbles/twigs, same as Field 2 |
| 4 | Medium flora | 64 | 16 | 1-1.5 tile objects, need detail for flowers |
| 5 | Medium objects | 96 | 16 | 1.5-2 tile objects, boulders/stumps need texture |
| 6 | Large objects | 192 | 4 | 4-5 tile objects, trees need bark/leaf detail |
| 7 | Canopy | 192 | 4 | Same as Field 6, overhead layer |

---

## Field 6: Large Objects
**Status: ASSETS EXIST but need regeneration at higher resolution. Rendering disabled pending quality review.**

| Property | Value |
|---|---|
| Grid | 2x2 (4 cells) or 1x1 |
| Density | 1-4% |
| Sprite size | 192x192 (PixelLab size=192, 4 candidates/call) — REGENERATE at this size |
| Variants per object | ~60 |
| Footprint | 20-40px, can span tile boundaries |
| Y-sorted | Yes, sorted with player |
| Transition support | No |
| Asset path | `assets/pixelab/landscape_v2/micro/large_objects/{biome}/{object}/` |
| File naming | `lg__{biome}__{object}__v{NNN}.png` |

### Objects by biome

| Biome | Object A | Object B | Object C |
|---|---|---|---|
| forest | oak | birch | maple |
| dense_forest | ancient_oak | gnarled_elm | strangler_fig |
| tropical_forest | coconut_palm | jungle_tree | banyan |
| taiga | spruce | snow_pine | frost_cedar |
| grassland | meadow_oak | cherry_blossom | apple_tree |
| savanna | acacia | baobab | thorny_acacia |
| steppe | twisted_shrub | dead_tree | stone_monolith |
| desert | date_palm | saguaro | sandstone_arch |
| beach | beach_palm | coastal_pine | driftwood |
| swamp | cypress | dead_willow | mangrove |
| hills | scots_pine | rowan | standing_stone |
| mountains | cliff_pine | mountain_ash | rock_spire |
| volcanic | charred_tree | obsidian_spike | magma_vent |
| tundra | frost_willow | ice_pillar | stunted_pine |
| arctic | ice_crystal_spire | frozen_tree | crystal_ice_tower |
| mystic | spirit_tree | crystal_tree | aether_pillar |

**Total: 2,947 sprites**

### Generation prompt template (already used)
```
top-down high fantasy pixel art [object], jaw-dropping beauty, hyper-detailed,
rich saturated colors, Final Fantasy aesthetic, alpha-transparent background,
detailed shading
```

---

## Field 7: Canopy / Overhead
**Status: NEEDS GENERATION**

| Property | Value |
|---|---|
| Grid | 1x1 |
| Density | Follows field 6 (tree present → canopy) |
| Sprite size | 64x64 or 96x96 |
| Variants per object | 40 |
| Render order | Above player (z=6) |
| Alpha | Fades when player enters building/canopy |
| Asset path | `assets/pixelab/landscape_v2/micro/canopy/{biome}/{object}/` |
| File naming | `cn__{biome}__{object}__v{NNN}.png` |

### Objects by biome (only biomes with trees)

| Biome | Object A | Object B |
|---|---|---|
| forest | broad_leaf_canopy | oak_crown |
| dense_forest | thick_canopy | vine_curtain |
| tropical_forest | jungle_canopy | hanging_orchid_veil |
| taiga | pine_canopy | frost_overhang |
| grassland | meadow_tree_crown | blossom_canopy |
| savanna | acacia_flat_canopy | baobab_crown |
| swamp | moss_curtain | dead_branch_canopy |
| mystic | aether_canopy | crystal_light_veil |

**Target: ~640 sprites (16 objects × 40 variants)**

### Generation prompt template
```
top-down high fantasy pixel art [object] seen from above, jaw-dropping beauty,
hyper-detailed, rich saturated colors, Final Fantasy aesthetic,
alpha-transparent background, tree canopy overhead view
```
Use size=64 or size=96 for `create_1_direction_object`.

---

## Summary

| Field | Name | Objects | Variants | Total Sprites | Status |
|---|---|---|---|---|---|
| 0 | Substrate | 21 | 64 | 1,344 | DONE |
| 1 | Ground Cover | 48 | 64 | 3,072 | ASSETS READY |
| 2 | Small Flora | 45 | 64 | 2,880 | NEEDS GEN |
| 3 | Small Scatter | 64 | 60 | 3,840 | NEEDS GEN |
| 4 | Medium Flora | 48 | 60 | 2,880 | NEEDS GEN |
| 5 | Medium Objects | 48 | 60 | 2,880 | NEEDS GEN |
| 6 | Large Objects | 48 | ~60 | 2,947 | ASSETS READY |
| 7 | Canopy | 16 | 40 | 640 | NEEDS GEN |
| **Total** | | **338** | | **~20,483** | |

## Execution order

1. Wire Field 1 renderer (assets ready)
2. Generate + wire Field 2 (small flora)
3. Generate + wire Field 3 (small scatter)
4. Generate + wire Field 4 (medium flora)
5. Generate + wire Field 5 (medium objects)
6. Wire Field 6 renderer (assets ready)
7. Generate + wire Field 7 (canopy)

Fields 2-5 can be generated in parallel while rendering code is developed for Field 1.

## Art direction

All prompts include: "top-down high fantasy pixel art, jaw-dropping beauty, hyper-detailed, rich saturated colors, Final Fantasy aesthetic, alpha-transparent background, detailed shading"

As objects get larger (fields 4+), art quality matters more. Larger objects should feel like hand-painted game assets with personality and visual weight.

## Draw order

```
Field 0: Substrate     → baked into chunk bitmap (worker)
Field 1: Ground Cover  → baked into chunk bitmap (worker)
Field 2: Small Flora   → baked into chunk bitmap (worker)
Field 3: Small Scatter → baked into chunk bitmap (worker)
Field 4: Medium Flora  → baked into chunk bitmap (worker) or sprite overlay
Field 5: Medium Objects → sprite overlay, y-sorted within chunk
Field 6: Large Objects  → sprite overlay, y-sorted with player across chunks
Field 7: Canopy        → rendered last, above player, alpha-fades on proximity
```
