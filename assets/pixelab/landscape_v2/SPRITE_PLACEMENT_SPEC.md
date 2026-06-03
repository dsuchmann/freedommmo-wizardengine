# Sprite Placement Spec — Forest Biome (Template for All Biomes)

## Overview

Place transparent PNG object sprites over the Wang tile base to dress the environment.
These sprites have alpha transparency and are designed to composite over any background.

The existing `object-placement.js` + `drawWorldActors()` system in `canvas-renderer.js` is the right foundation.
It was commented out because it used placeholder graphics. Now we wire it to real PixelLab sprites.

## Architecture

### Image Loading
Sprites live in `assets/pixelab/landscape_v2/objects/{biome}_{family}/sprites/`.
Each sprite is a 32x32 PNG with alpha transparency.
Preload all sprites for visible biomes at startup into an image cache (same pattern as Wang tile preloading).

### Placement
Use noise-based placement (same `rand2` approach as existing `object-placement.js`).
Each tile gets 0-2 object sprites based on:
- Biome-specific rules (which families, what density)
- Noise threshold per family (controls frequency)
- Vegetation/fertility values from tile data
- Cliff edge suppression (no objects on cliff faces)

### Rendering
Draw sprites in `drawWorldActors()` (uncomment it).
Objects need depth sorting (by Y position) so southern objects render on top of northern ones.
The existing system already handles this.

## Forest Biome Sprite Matrix

### Tier: HEAVY (30-40% of tiles, core visual grain)

**Trees (place on ~15% of tiles, never adjacent):**
```
forest_ancient_oak__object__v001.png
forest_pine_tree__object__v000.png
forest_pine_tree__object__v001.png
forest_pine_tree__object__v005.png
forest_guardian_oak__object__v116.png
forest_wishing_tree__object__v062.png
```

**Ground Cover (place on ~25% of tiles, can clump):**
```
forest_ground_cover__object__v001.png    — fern/grass clump
forest_ground_cover__object__v002.png    — leafy bush
forest_shrub__object__v000.png           — berry shrub
forest_shrub__object__v001.png           — leafy shrub
forest_shrub__object__v004.png           — dense round bush
forest_fern__object__v000.png            — lush fern spread
forest_fern__object__v003.png            — compact fern clump
forest_deadwood__object__v000.png        — mossy fallen log
forest_deadwood__object__v003.png        — small mossy log
forest_deadwood__object__v001.png        — stump with roots
forest_deadwood__object__v004.png        — hollow log
```

**Small Detail (place on ~20% of tiles, scattered):**
```
forest_mushroom__object__v000.png        — orange cluster
forest_mushroom__object__v001.png        — red toadstools
forest_mushroom__object__v003.png        — low ground mushrooms
forest_mushroom__object__v004.png        — brown pair
forest_stone__object__v000.png           — mossy boulder
forest_flowers__object__v000.png         — white flowers
forest_flowers__object__v002.png         — purple lupine
```

### Tier: MODERATE (10-15% of tiles, variety)

**Structures/Interactive (place on ~3% of tiles):**
```
forest_axe_stump__object__v044.png       — axe in stump
forest_campfire__object__v084.png        — campfire
forest_signpost__object__v028.png        — signpost
forest_signpost__object__v094.png        — signpost variant
forest_log_cabin__object__v038.png       — log cabin
forest_treehouse__object__v025.png       — treehouse
forest_overgrown_well__object__v095.png  — mossy well
```

**Additional Ground/Flora:**
```
forest_ground_cover__object__v000.png    — twisted roots
forest_ground_cover__object__v003.png    — tree stump
forest_ground_cover__object__v004.png    — chopped wood pile
forest_ground_cover__object__v005.png    — dark berry bush
forest_shrub__object__v002.png           — small deciduous tree
forest_shrub__object__v003.png           — purple flowering shrub
forest_mushroom__object__v002.png        — single yellow mushroom
forest_deadwood__object__v002.png        — dead bare tree
forest_fern__object__v002.png            — single fern frond
forest_flowers__object__v003.png         — small yellow flower
forest_flowers__object__v004.png         — flower bed
```

**Stones:**
```
forest_stone__object__v001.png           — flat stone
forest_stone__object__v002.png           — tall rock outcrop
forest_stone__object__v003.png           — flat scattered rocks
forest_stone__object__v004.png           — flat stone slab
```

**Wildlife (very occasional):**
```
forest_hedgehog__object__v078.png
forest_owl__object__v015.png
forest_owl__object__v080.png
forest_wild_boar__object__v081.png
forest_badger_den__object__v012.png
```

### Tier: SPARSE (1-2% of tiles, landmarks/special)

```
forest_flora — glow_mushroom, mushroom_circle, mushroom_ring, root_system
forest_tree — hollow_oak, tree_face
forest_wildlife — enchanted_stag, fox_den, treant
forest_interactive — covered_bridge, enchanted_door, giant_acorn, living_armor,
                     rope_bridge, sword_in_stone, ancient_shrine, rune_well
forest_rocks — ruined_wall
forest_ground_cover — v006 (spiky rosette), spider_web
```

### SKIP (do not use — cut off or broken)

```
forest_ancient_oak__object__v000.png     — canopy cut off at top
forest_ancient_oak__object__v002.png     — trunk only, no canopy
forest_ancient_oak__object__v004.png     — canopy clipped
forest_deadwood__object__v005.png        — extends past edges
forest_flowers__object__v001.png         — unreadable noise
forest_interactive — treant_guardian v107, lantern_tree v111,
                     moonlight_clearing v113, rainbow_bridge v112,
                     wishing_tree v096, druid_circle v102, tree_swing v092
```

## Placement Rules

1. **Trees never adjacent** — minimum 2-tile gap between trees (check neighbor tiles)
2. **Ground cover can clump** — 2-4 adjacent tiles with ground cover looks natural
3. **Mushrooms in groups** — when placed, 60% chance to also place on 1-2 adjacent tiles
4. **Interactive objects very sparse** — max 1 per ~50 tiles, never clumped
5. **Wildlife ultra-sparse** — max 1 per ~100 tiles
6. **No objects on cliff edges** — check `tile._isCliffEdge`
7. **No objects on water tiles**
8. **Density scales with vegetation** — `tile.stack.microLayers.vegetationDensity` or biome fallback
9. **Depth sort by Y** — southern objects render on top (existing system handles this)

## How to Scale to Other Biomes

Repeat this audit for each biome's object directories. The pattern is identical:
1. List all `{biome}_*/sprites/` directories
2. View every sprite, classify as heavy/moderate/sparse/skip
3. Build the placement matrix
4. Add to the biome config in the placement system

There are ~2,360 sprites across 20 biomes. Each biome has 112+ sprites to audit.
