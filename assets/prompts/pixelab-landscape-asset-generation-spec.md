# PixelLab Landscape Asset Generation Spec

This file is the contract for generating the terrain/landscape art library. The goal is not random decoration. The goal is a coherent horizontal landscape system where every tile is a terrain stack built from compatible layers.

## Core Rendering Model

Each world tile is a terrain slice with this conceptual stack:

1. **Data / identity**: biome, material, surface, terrain form, plateau, climate, micro layers.
2. **Opaque base Wang tile**: the foundational top surface. One opaque Wang tile per top-surface stack.
3. **Structural edges**: cliff/step/waterline/plateau side faces when terrain form requires it.
4. **Alpha surface overlays**: wetness, mud pools, snow drift, leaf litter, dust, foam, algae.
5. **Alpha micro decals**: soil flecks, ground cover, foliage blades, flowers, debris, stone scatter.
6. **Medium dressing sprites**: reeds, shrubs, moss clumps, roots, rock clusters, underbrush.
7. **Gameplay objects**: bushes, trees, forage nodes, mineable stones, reed harvests. These are separate from baked terrain.

Important rules:

- Do not vertically stack multiple opaque base tiles on the same top surface.
- Wang tiles are opaque foundational Lego blocks.
- Surface/micro/medium layers must have alpha transparency.
- Terrain transitions must be horizontal and coherent across adjacent tiles.
- Pixel art must align to a 32x32 source tile, but details should not be centered by default.
- All transparent PNGs must have clean alpha, no black matte, no background box.
- Avoid UI icons, outlines, labels, text, perspective mismatch, drop shadows, and non-pixel-art rendering.

## Required Output Root

Claude/PixelLab should place generated assets under:

```txt
assets/generated/pixelab_landscape_v2/
```

Directory tree:

```txt
assets/generated/pixelab_landscape_v2/
  base_wang/
    <family>/
      wang_0.png ... wang_15.png
      tileset.png
      metadata.json
  plateau_edges/
    <family>/
      edge_n.png edge_e.png edge_s.png edge_w.png
      corner_ne.png corner_nw.png corner_se.png corner_sw.png
      face_0.png face_1.png face_2.png face_3.png
      metadata.json
  surface_overlays/
    <overlay_kind>/
      variants_32.png
      variants_16.png
      metadata.json
  micro_decals/
    <micro_kind>/
      variants_16.png
      variants_8.png
      metadata.json
  medium_dressing/
    <dressing_kind>/
      variants_32.png
      variants_48.png
      metadata.json
  objects_interactive/
    <object_kind>/
      variants_32.png
      variants_48.png
      metadata.json
  transition_reference/
    <family_a>_to_<family_b>/
      notes.md
      sample_contact_sheet.png
```

## Technical Asset Requirements

### Base Wang Tiles

- Size: 32x32 PNG.
- Opaque RGB/RGBA allowed, but alpha should be fully opaque for base tile pixels.
- File names: `wang_0.png` through `wang_15.png`.
- Mask bit semantics:
  - 8 = NW corner belongs to this terrain family.
  - 4 = NE corner belongs to this terrain family.
  - 2 = SW corner belongs to this terrain family.
  - 1 = SE corner belongs to this terrain family.
- `wang_15` is full interior tile.
- `wang_0` is mostly non-family/transition contact tile.
- Wang masks must make seamless edges when arranged in a grid.
- No visible grid lines.
- No centered object motifs.
- Must tile seamlessly at 32x32 boundaries.

### Surface Overlays

- Transparent PNG sprite sheets.
- Prefer 16x16 and 32x32 cells.
- Alpha only: must not cover the whole tile unless specifically a transparent wash.
- Used for wet shine, mud pools, snow drift, dust, foam, algae, leaf litter.

### Micro Decals

- Transparent PNG sprite sheets.
- Prefer 8x8 and 16x16 cells.
- Very small low-contrast marks.
- Must be usable frequently without looking stamped.
- No center-biased composition.

### Medium Dressing

- Transparent PNG sprite sheets.
- Prefer 32x32 and 48x48 cells.
- Used sparsely.
- Can exceed a tile slightly, but must have clean alpha.

### Interactive Objects

- Transparent PNG sprite sheets.
- Must be readable as gameplay objects.
- Should have variants for inspect/forage/chop/mine/harvest where applicable.

## Biome Families

The world currently uses these biomes:

```txt
deep_ocean, ocean, shallow_water, beach, river, lake,
grassland, forest, dense_forest, tropical_forest, taiga,
savanna, steppe, desert, swamp, tundra, arctic,
hills, mountains, volcanic, mystic
```

## Base Wang Families To Generate

Generate all 16 masks for each family below.

```txt
water/deep_ocean
water/ocean
water/shallow_water
water/river
water/lake
beach/dry_sand
beach/wet_sand
ground/grassland
dry/savanna
dry/steppe
dry/desert
forest/forest
forest/dense_forest
forest/tropical_forest
forest/taiga
swamp/wet_mud
swamp/swamp_ground
cold/tundra_ground
cold/snow_ice
rock/hills
rock/mountains
rock/volcanic
mystic/aether_moss
mystic/crystal_ground
```

Each family directory:

```txt
assets/generated/pixelab_landscape_v2/base_wang/<family>/wang_0.png ... wang_15.png
assets/generated/pixelab_landscape_v2/base_wang/<family>/tileset.png
assets/generated/pixelab_landscape_v2/base_wang/<family>/metadata.json
```

Metadata schema:

```json
{
  "family": "swamp/wet_mud",
  "layer": "base_wang",
  "tileSize": 32,
  "opaque": true,
  "maskBits": { "NW": 8, "NE": 4, "SW": 2, "SE": 1 },
  "compatibleBiomes": ["swamp"],
  "compatibleMaterials": ["wet_mud"],
  "compatibleSurfaces": ["mud_pools", "ground_cover"],
  "promptSeed": "..."
}
```

## Surface Overlay Kinds

Generate transparent overlay sheets for:

```txt
wet_mud_shine
mud_pool_glints
water_surface_noise
shallow_water_ripples
river_flow_lines
lake_soft_ripples
ocean_foam
algae_film
snow_drift
ice_sheen
leaf_litter
needle_duff
dry_dust
sand_grain_noise
stone_scatter_overlay
ash_dust
crystal_sparkle_motes
aether_bloom_overlay
```

Paths:

```txt
assets/generated/pixelab_landscape_v2/surface_overlays/<kind>/variants_32.png
assets/generated/pixelab_landscape_v2/surface_overlays/<kind>/variants_16.png
assets/generated/pixelab_landscape_v2/surface_overlays/<kind>/metadata.json
```

## Micro Decal Kinds

Generate transparent 8x8 and 16x16 sheets for:

```txt
soil_flecks_dark
soil_flecks_warm
soil_flecks_cold
mud_specks
moss_ground_cover
algae_specks
ground_cover_green
ground_cover_dry
ground_cover_snow_peek
dry_grass_blades
lush_grass_blades
reeds_grass_blades
steppe_blades
savanna_blades
tundra_tufts
arctic_crystals
sparse_flowers_warm
flowers_meadow
flowers_swamp
leaf_debris
needle_debris
stone_pebbles
volcanic_embers
mystic_motes
```

Paths:

```txt
assets/generated/pixelab_landscape_v2/micro_decals/<kind>/variants_16.png
assets/generated/pixelab_landscape_v2/micro_decals/<kind>/variants_8.png
assets/generated/pixelab_landscape_v2/micro_decals/<kind>/metadata.json
```

## Medium Dressing Kinds

Generate transparent 32x32 and 48x48 sheets for:

```txt
reeds
cattails
root_cluster
moss_clump
swamp_bush
dry_shrub
savanna_bush
steppe_scrub
desert_scrub
forest_underbrush
taiga_underbrush
tropical_fern_cluster
tundra_scrub
snow_buried_stones
rock_scatter
mountain_rocks
volcanic_rocks
crystal_cluster_small
aether_moss_clump
beach_driftwood
beach_grass_clump
riverbank_reeds
```

Paths:

```txt
assets/generated/pixelab_landscape_v2/medium_dressing/<kind>/variants_32.png
assets/generated/pixelab_landscape_v2/medium_dressing/<kind>/variants_48.png
assets/generated/pixelab_landscape_v2/medium_dressing/<kind>/metadata.json
```

## Interactive Object Kinds

Generate transparent 32x32 and 48x48 sheets for:

```txt
bush_forage_grassland
bush_forage_savanna
bush_forage_swamp
bush_forage_tundra
reed_harvest
cattail_harvest
tree_forest
tree_taiga
tree_tropical
tree_swamp
tree_savanna_acacia
stone_mine_hills
stone_mine_mountains
volcanic_ore
crystal_node_mystic
driftwood_inspect
shell_cluster_inspect
```

Paths:

```txt
assets/generated/pixelab_landscape_v2/objects_interactive/<kind>/variants_32.png
assets/generated/pixelab_landscape_v2/objects_interactive/<kind>/variants_48.png
assets/generated/pixelab_landscape_v2/objects_interactive/<kind>/metadata.json
```

## Plateau / Edge Families

Generate structural edge assets for these families:

```txt
soil_bank
mud_bank
sand_bank
snow_bank
grass_ledge
forest_ledge
rock_cliff
mountain_cliff
volcanic_cliff
crystal_cliff
waterline_mud
waterline_sand
waterline_grass
waterline_snow
```

Paths:

```txt
assets/generated/pixelab_landscape_v2/plateau_edges/<family>/edge_n.png
assets/generated/pixelab_landscape_v2/plateau_edges/<family>/edge_e.png
assets/generated/pixelab_landscape_v2/plateau_edges/<family>/edge_s.png
assets/generated/pixelab_landscape_v2/plateau_edges/<family>/edge_w.png
assets/generated/pixelab_landscape_v2/plateau_edges/<family>/corner_ne.png
assets/generated/pixelab_landscape_v2/plateau_edges/<family>/corner_nw.png
assets/generated/pixelab_landscape_v2/plateau_edges/<family>/corner_se.png
assets/generated/pixelab_landscape_v2/plateau_edges/<family>/corner_sw.png
assets/generated/pixelab_landscape_v2/plateau_edges/<family>/face_0.png
assets/generated/pixelab_landscape_v2/plateau_edges/<family>/face_1.png
assets/generated/pixelab_landscape_v2/plateau_edges/<family>/face_2.png
assets/generated/pixelab_landscape_v2/plateau_edges/<family>/face_3.png
assets/generated/pixelab_landscape_v2/plateau_edges/<family>/metadata.json
```

## Prompt Templates

### Base Wang Prompt Template

```txt
Generate a complete 16-mask Wang terrain tile set for FAMILY_NAME.
Style: top-down 2D pixel art, 32x32 tile, seamless, game terrain, no outline, no text, no icons, no UI, no perspective distortion.
Family: FAMILY_NAME.
Biome compatibility: BIOMES.
Material: MATERIAL.
Surface: SURFACE.
Visual goals: VISUAL_GOALS.
Output: individual transparent/opaque PNG files named wang_0.png through wang_15.png plus a tileset.png contact sheet.
Mask bits: NW=8, NE=4, SW=2, SE=1.
Important: wang_15 is full interior terrain. wang_0 is mostly opposing terrain/contact transition. All masks must stitch seamlessly with matching neighbors.
```

### Surface Overlay Prompt Template

```txt
Generate transparent alpha pixel-art surface overlays.
Overlay kind: OVERLAY_KIND.
Cell sizes: 32x32 and 16x16.
Style: top-down terrain decal, subtle, no hard square border, no black background, no text, clean alpha.
Use cases: USE_CASES.
Output sprite sheets: variants_32.png and variants_16.png with 8-16 variants each.
```

### Micro Decal Prompt Template

```txt
Generate tiny transparent pixel-art micro decals.
Micro kind: MICRO_KIND.
Cell sizes: 16x16 and 8x8.
Style: subtle terrain detail, usable repeatedly, non-centered composition, clean alpha, no black matte.
Use cases: USE_CASES.
Output sprite sheets: variants_16.png and variants_8.png with 16-32 variants each.
```

### Medium Dressing Prompt Template

```txt
Generate transparent pixel-art biome dressing sprites.
Dressing kind: DRESSING_KIND.
Cell sizes: 32x32 and 48x48.
Style: top-down/isometric-compatible terrain dressing, clean alpha, not UI, not icon, no labels.
Use cases: USE_CASES.
Output sprite sheets: variants_32.png and variants_48.png with 8-16 variants each.
```

### Interactive Object Prompt Template

```txt
Generate transparent pixel-art interactive world objects.
Object kind: OBJECT_KIND.
Cell sizes: 32x32 and 48x48.
Gameplay role: GAMEPLAY_ROLE.
Style: readable world object, top-down compatible, clean alpha, no text, no UI icon.
Output sprite sheets: variants_32.png and variants_48.png with idle/variant frames.
```

## Seeded Generation Batches

Use these seed groups to intentionally create a large combinatorial space.

```txt
base_wang seeds: 10000-19999
surface_overlay seeds: 20000-29999
micro_decal seeds: 30000-39999
medium_dressing seeds: 40000-49999
interactive_object seeds: 50000-59999
plateau_edge seeds: 60000-69999
transition_reference seeds: 70000-79999
```

For each asset kind, generate multiple variants by seed:

```txt
standard variants: 8
high-use micro variants: 32
base Wang variants per family: 1 complete 16-mask set minimum, 3 style variants preferred
medium dressing variants: 8-16
interactive object variants: 4-12
```

## Priority Order

Generate assets in this order:

1. Base Wang families for water, beach, swamp, grassland, savanna, tundra, forest.
2. Surface overlays for water, mud, snow, dry dust, leaf litter.
3. Micro decals for soil, ground cover, foliage blades, flowers, reeds.
4. Medium dressing for reeds, shrubs, underbrush, rocks.
5. Plateau/waterline edge families.
6. Interactive objects.
7. Mystic/volcanic specialty sets.

## Critical Missing Families Known Today

Current project is missing or weak in:

```txt
water/ocean Wang
water/shallow_water Wang
water/river Wang
water/lake Wang
water/deep_ocean Wang
swamp/wet_mud Wang
mud_pool overlays
waterline transitions
snow/grass transition polish
sand/grass transition polish
subtle micro decals with clean alpha
```

## Done Criteria

A generated family is usable only if:

- PNG files load in browser.
- Alpha is clean where required.
- Opaque Wang tiles have meaningful non-placeholder content.
- 16 Wang masks visibly differ and stitch correctly.
- Sprite sheets have consistent cell sizes.
- metadata.json exists and matches the directory.
- Assets do not contain text, UI, black boxes, or background matte.
