# PixelLab Landscape Asset Generation Manifest

This document is intended to be handed directly to Claude/PixelLab as the asset-generation contract. It defines the terrain layer framework, directory structure, naming conventions, combinatorial generation space, metadata schema, and seeded prompt templates for large-scale landscape asset generation.

The goal is not to make random decorative sprites. The goal is to generate a coherent horizontal terrain assembly library: every asset belongs to a layer, every layer has a role, and every asset can be selected deterministically from tile state.

---

## 0. Core Philosophy

Each world tile is a slice of terrain with ecological/geological state:

- biome
- material
- surface
- terrain form
- plateau level
- elevation/slope
- micro layers
- fertility/vegetation/moisture/heat

Rendering should assemble the tile in coherent passes:

1. opaque base terrain / Wang tile
2. structural terrain form marks
3. surface overlays
4. micro-detail alpha decals
5. medium biome dressing alpha sprites
6. gameplay object sprites
7. lighting/atmosphere, applied at runtime

Do not vertically stack unrelated art. Every layer must be justified by tile state.

---

## 1. Global Art Requirements

### Style

- top-down / slightly orthographic 2D pixel art
- compatible with existing FreedomMMO terrain view
- readable at 16x16 displayed tile size
- source assets should generally be 32x32 unless otherwise specified
- no baked UI, no labels, no perspective shadows that imply a fixed sun direction
- transparent background for non-base layers
- opaque full tile background for base terrain tiles
- consistent color palette per biome family
- no black outlines unless explicitly requested for object sprites

### File formats

- PNG
- RGBA for alpha layers
- RGB/RGBA opaque for base layers
- no compression artifacts
- pixel-perfect nearest-neighbor compatible

### Naming

Use lowercase snake_case only.

Examples:

```txt
wet_mud__swamp__wang_07__v003.png
foliage_blades__savanna__micro__density_medium__v012.png
reed_cluster__swamp__medium__variant_041.png
```

---

## 2. Directory Root

All generated assets should go under:

```txt
assets/pixelab/landscape_v2/
```

Do not overwrite existing `assets/catalog` files unless explicitly instructed later.

---

## 3. Required Directory Structure

```txt
assets/pixelab/landscape_v2/
  manifest.json
  README.md

  base/
    <base_family>/
      tiles/
      wang/
      metadata.json

  surface_overlays/
    <overlay_family>/
      decals/
      sheets/
      metadata.json

  micro/
    <micro_family>/
      decals/
      sheets/
      metadata.json

  medium/
    <medium_family>/
      sprites/
      sheets/
      metadata.json

  objects/
    <object_family>/
      sprites/
      sheets/
      metadata.json

  transitions/
    <transition_family>/
      wang/
      overlays/
      metadata.json

  atlases/
    proposed/
    packed/

  prompts/
    generated_prompts.jsonl
    prompt_batches/
```

---

## 4. Terrain Layer Contract

### Layer 1: Opaque Base Terrain

Directory:

```txt
assets/pixelab/landscape_v2/base/<base_family>/tiles/
assets/pixelab/landscape_v2/base/<base_family>/wang/
```

Role:

- foundational full-tile art
- usually opaque
- selected from `tile.biome`, `tile.material`, `tile.surface`
- Wang variants handle adjacency between compatible base surfaces

Required file types:

```txt
base/<family>/tiles/<family>__tile__vNNN.png
base/<family>/wang/<family>__wang_00.png
...
base/<family>/wang/<family>__wang_15.png
```

Dimensions:

- 32x32 source
- tileable at 16x16 display
- Wang tiles must align on all edges

Alpha:

- base tile: opaque
- Wang tile: opaque unless specifically marked as overlay

### Layer 2: Structure / Terrain Form

Directory:

```txt
assets/pixelab/landscape_v2/surface_overlays/structure_<family>/decals/
```

Role:

- cliff edges
- step lips
- erosion marks
- slope streaks
- plateau edges

Usually alpha overlays.

Dimensions:

- 32x32 single-tile decals
- 32x64 or 64x32 allowed for cliff faces/long ledges

### Layer 3: Surface Overlays

Directory:

```txt
assets/pixelab/landscape_v2/surface_overlays/<overlay_family>/decals/
```

Role:

- mud pools
- water shine
- wet sand shine
- snow drift
- leaf litter
- stone scatter
- dry dust
- algae film

Alpha:

- transparent background
- designed to sit over opaque base terrain

### Layer 4: Micro Details

Directory:

```txt
assets/pixelab/landscape_v2/micro/<micro_family>/decals/
```

Role:

- soil flecks
- ground cover
- grass blades
- reed blades
- flowers
- moss
- debris
- tiny stones

These should be subtle and numerous. They are placed with deterministic offsets inside each tile.

Dimensions:

- 8x8
- 12x12
- 16x16
- 24x24
- 32x32 sheets allowed

### Layer 5: Medium Dressing

Directory:

```txt
assets/pixelab/landscape_v2/medium/<medium_family>/sprites/
```

Role:

- reed clusters
- dry shrubs
- underbrush
- moss clumps
- root clusters
- rock clumps
- small bushes

Alpha sprites.

Dimensions:

- 32x32 preferred
- 48x48 allowed
- 64x64 allowed for larger clumps

### Layer 6: Gameplay Objects

Directory:

```txt
assets/pixelab/landscape_v2/objects/<object_family>/sprites/
```

Role:

- interactive trees
- forage bushes
- mineable stones
- reeds harvest nodes
- climbable trees
- inspectable ruins/roots/stumps

These are not ground decals. They are world objects.

Dimensions:

- 32x32 small object
- 64x64 bush/tree cluster
- 96x96 large tree/canopy allowed

---

## 5. Base Families To Generate

Generate each of these base families.

```txt
water/deep_ocean
water/ocean
water/shallow_water
water/river
water/lake

beach/wet_sand
beach/dry_sand
beach/shell_sand
beach/pebble_sand

ground/grassland
ground/savanna
ground/steppe
ground/desert
ground/swamp_ground
ground/mystic_ground

swamp/wet_mud
swamp/mud_pool
swamp/algae_mud
swamp/root_mud

forest/forest_floor
forest/dense_forest_floor
forest/tropical_forest_floor
forest/taiga_floor
forest/leaf_litter
forest/needle_duff

cold/tundra_ground
cold/snow_drift
cold/snow_ice
cold/frozen_earth
cold/arctic_ice

rock/hills
rock/mountains
rock/volcanic
rock/grey_rock
rock/basalt
rock/stone_scatter
```

For every base family, generate:

- 32 base tile variants
- 16 Wang masks
- 8 subtle noise variants
- 8 high-detail variants

Minimum per family:

```txt
32 + 16 + 8 + 8 = 64 files
```

Approximate base family count: 42

Approximate base asset count: 2,688

---

## 6. Wang Mask Definition

Use 4-bit corner Wang masks:

```txt
bit 8 = northwest corner belongs to this terrain
bit 4 = northeast corner belongs to this terrain
bit 2 = southwest corner belongs to this terrain
bit 1 = southeast corner belongs to this terrain
```

Files:

```txt
<family>__wang_00.png
<family>__wang_01.png
...
<family>__wang_15.png
```

Interpretation:

```txt
wang_15 = full tile of this terrain
wang_00 = no corners of this terrain / should usually be transition-negative or transparent-like only if overlay system says so
wang_12 = north half/corners this terrain
wang_03 = south half/corners this terrain
wang_10 = west diagonal-ish pair depending mask composition
wang_05 = opposite diagonal-ish pair depending mask composition
```

Important:

- These are foundational opaque base tiles unless placed under `transitions/<family>/overlays`.
- They must tile seamlessly with other masks of the same family.
- Avoid obvious perfect triangles unless the terrain type naturally forms hard geometry.
- Prefer noisy organic borders inside the tile.

---

## 7. Transition Families To Generate

Transitions are separate from base families. They exist to polish edges between two different foundations.

Directory:

```txt
assets/pixelab/landscape_v2/transitions/<from>__to__<to>/wang/
assets/pixelab/landscape_v2/transitions/<from>__to__<to>/overlays/
```

Generate 16 Wang masks and 16 alpha overlays for each transition pair.

### Required high-priority transition pairs

Water/shore:

```txt
water_shallow__to__beach_wet_sand
water_shallow__to__swamp_wet_mud
water_shallow__to__grassland
water_river__to__grassland
water_river__to__savanna
water_river__to__forest_floor
water_river__to__swamp_wet_mud
water_lake__to__grassland
water_lake__to__forest_floor
water_ocean__to__shallow_water
water_deep_ocean__to__ocean
```

Sand/grass/dryland:

```txt
beach_dry_sand__to__grassland
beach_dry_sand__to__savanna
beach_wet_sand__to__dry_sand
grassland__to__savanna
grassland__to__steppe
savanna__to__steppe
steppe__to__desert
savanna__to__desert
```

Forest/grass:

```txt
grassland__to__forest_floor
forest_floor__to__dense_forest_floor
forest_floor__to__taiga_floor
forest_floor__to__swamp_ground
tropical_forest_floor__to__grassland
```

Cold/temperate:

```txt
grassland__to__tundra_ground
steppe__to__tundra_ground
taiga_floor__to__tundra_ground
tundra_ground__to__snow_drift
tundra_ground__to__arctic_ice
snow_drift__to__arctic_ice
```

Rock/elevation:

```txt
grassland__to__hills
savanna__to__hills
forest_floor__to__hills
hills__to__mountains
mountains__to__snow_drift
mountains__to__volcanic
hills__to__volcanic
```

Mystic/special:

```txt
grassland__to__mystic_ground
forest_floor__to__mystic_ground
mountains__to__mystic_ground
```

Approx transition families: 38

Per transition family:

- 16 opaque transition Wang tiles
- 16 alpha feather overlays
- 8 noisy edge decals

Approx transition count:

```txt
38 * 40 = 1,520 files
```

---

## 8. Surface Overlay Families

Directory:

```txt
assets/pixelab/landscape_v2/surface_overlays/<family>/decals/
```

Families:

```txt
wet_mud_shine
mud_pool
water_surface
water_ripple
foam_edge
wet_sand_shine
dry_dust
sand_grain_scatter
snow_drift
ice_shine
leaf_litter
needle_litter
stone_scatter
algae_film
moss_patch
ash_dust
crystal_sparkle
```

Generate per family:

- 64 decals at 32x32
- 32 small decals at 16x16
- 16 broad irregular overlays at 64x64

Approx count:

```txt
17 * 112 = 1,904 files
```

---

## 9. Micro Families

Directory:

```txt
assets/pixelab/landscape_v2/micro/<family>/decals/
```

Families:

```txt
soil_flecks
dark_mud_flecks
light_sand_flecks
dash_dust_flecks
pebbles_small
stone_chips
moss_ground_cover
algae_specks
ground_cover_green
ground_cover_dry
ground_cover_frozen
grass_blades_lush
grass_blades_dry
grass_blades_steppe
reeds_grass_blades
snow_specks
ice_crystals
flowers_lush
flowers_sparse
flowers_swamp
debris_leaf
debris_needle
debris_twigs
debris_bone_desert
mystic_motes
crystal_specks
volcanic_embers
```

Generate per family:

- 128 micro decals at 8x8/12x12/16x16 mixed
- 32 32x32 sparse sheets
- 16 32x32 dense sheets

Approx count:

```txt
27 * 176 = 4,752 files
```

---

## 10. Medium Dressing Families

Directory:

```txt
assets/pixelab/landscape_v2/medium/<family>/sprites/
```

Families:

```txt
reeds
cattails
root_cluster
moss_clump
algae_clump
dry_shrub
savanna_shrub
steppe_shrub
desert_scrub
underbrush_forest
underbrush_dense
underbrush_tropical
taiga_underbrush
swamp_underbrush
small_rocks
rock_scatter
mountain_scree
volcanic_rock
snow_clump
ice_chunk
crystal_cluster
mystic_growth
fallen_branch
stump_small
```

Generate per family:

- 96 sprites at 32x32
- 48 sprites at 48x48
- 24 sprites at 64x64

Approx count:

```txt
24 * 168 = 4,032 files
```

---

## 11. Gameplay Object Families

Directory:

```txt
assets/pixelab/landscape_v2/objects/<family>/sprites/
```

Families:

```txt
forage_bush_grassland
forage_bush_savanna
forage_bush_swamp
forage_bush_tundra
small_tree_grassland
acacia_tree_savanna
deciduous_tree_forest
dense_tree_forest
tropical_tree
pine_tree_taiga
swamp_tree
frozen_tree
mineable_stone_hills
mineable_stone_mountains
volcanic_stone
crystal_node
reed_harvest_node
cattail_harvest_node
driftwood
shell_pile
snow_rock
root_tangle
```

Generate per family:

- 64 base sprites
- 16 damaged/harvested states
- 16 highlighted/inspect variants if visually necessary

Approx count:

```txt
22 * 96 = 2,112 files
```

---

## 12. Structure / Plateau / Cliff Families

Directory:

```txt
assets/pixelab/landscape_v2/surface_overlays/structure_<family>/decals/
```

Families:

```txt
cliff_grassland
cliff_savanna
cliff_steppe
cliff_desert
cliff_forest
cliff_taiga
cliff_tundra
cliff_snow
cliff_mountains
cliff_volcanic
ledge_mud
ledge_sand
ledge_rock
slope_erosion_dry
slope_erosion_wet
slope_erosion_snow
```

Generate per family:

- 16 cardinal edge masks
- 16 corner masks
- 16 vertical face variants
- 16 shadow/ambient occlusion overlays

Approx count:

```txt
16 * 64 = 1,024 files
```

---

## 13. Total Initial Generation Target

Approximate first full generation target:

```txt
base:        2,688
transitions: 1,520
surface:     1,904
micro:       4,752
medium:      4,032
objects:     2,112
structure:   1,024
-------------------
total:      18,032 files
```

This is the practical first target.

The 50,000–100,000 target comes from:

- seasonal variants
- wet/dry variants
- damaged/harvested object states
- palette variants
- biome transition expansions
- animation frames
- alternate art direction batches
- density packs

---

## 14. Metadata Schema

Every directory must include `metadata.json`.

Example:

```json
{
  "family": "swamp/wet_mud",
  "layer": "base",
  "biomes": ["swamp"],
  "materials": ["wet_mud"],
  "surfaces": ["mud_pools", "ground_cover"],
  "terrainForms": ["plains", "valley", "water_basin"],
  "micro": ["soil", "ground_cover", "foliage_blades"],
  "dimensions": [32, 32],
  "alpha": false,
  "tileable": true,
  "wang": true,
  "variants": 64,
  "promptSeedBase": 420000
}
```

Per asset metadata optional sidecar:

```json
{
  "id": "wet_mud__swamp__wang_07__v003",
  "path": "assets/pixelab/landscape_v2/base/swamp_wet_mud/wang/wet_mud__swamp__wang_07__v003.png",
  "layer": "base",
  "family": "swamp/wet_mud",
  "mask": 7,
  "biomes": ["swamp"],
  "material": "wet_mud",
  "surface": "mud_pools",
  "alpha": false,
  "seed": 420007003,
  "prompt": "..."
}
```

---

## 15. Prompt Template Format

Every generated prompt should be recorded in:

```txt
assets/pixelab/landscape_v2/prompts/generated_prompts.jsonl
```

JSONL row format:

```json
{"id":"...","path":"...","seed":123,"prompt":"...","negativePrompt":"...","dimensions":[32,32],"layer":"micro","family":"grass_blades_dry"}
```

---

## 16. Base Tile Prompt Template

```txt
Generate a 32x32 top-down pixel art terrain tile for {family}. 
Biome: {biome}. Material: {material}. Surface: {surface}. 
It must be seamless/tileable on all four edges. 
Style: readable pixel art, natural organic texture, no text, no UI, no hard outline, no perspective horizon, no characters, no objects. 
Lighting: neutral diffuse, no strong cast shadow. 
Use an opaque full-tile background. 
Variant seed: {seed}. 
```

Negative prompt:

```txt
text, letters, numbers, UI, character, creature, building, weapon, hard black outline, isometric wall, perspective horizon, blurry, anti-aliased, photographic, centered object
```

---

## 17. Wang Tile Prompt Template

```txt
Generate a 32x32 top-down pixel art Wang terrain tile for {family}. 
Mask: {mask}. Corner occupancy: NW={nw}, NE={ne}, SW={sw}, SE={se}. 
The occupied corners should visually contain {family} terrain. 
Unoccupied corners should transition organically toward neighboring compatible terrain without becoming a distinct object. 
Edges must tile seamlessly with other Wang masks in the same family. 
Avoid perfect straight triangles; use natural irregular pixel boundaries. 
Opaque full tile. 
No text, no characters, no props. 
Variant seed: {seed}. 
```

---

## 18. Transition Wang Prompt Template

```txt
Generate a 32x32 top-down pixel art terrain transition tile. 
Transition: {from_family} to {to_family}. 
Mask: {mask}. Corner occupancy refers to {from_family}: NW={nw}, NE={ne}, SW={sw}, SE={se}. 
Blend {from_family} and {to_family} naturally with organic edge shapes. 
Must tile seamlessly with all masks in this transition family. 
Do not make a hard geometric triangle unless the material naturally forms a sharp edge. 
Opaque full tile. 
Variant seed: {seed}. 
```

---

## 19. Surface Overlay Prompt Template

```txt
Generate a transparent PNG top-down pixel art decal for {overlay_family}. 
Layer: surface overlay. 
Biome compatibility: {biomes}. 
Material compatibility: {materials}. 
It should be an irregular natural mark that can sit on top of terrain. 
Transparent background. 
No full-tile opaque background. 
No character, no object silhouette, no UI. 
Dimensions: {width}x{height}. 
Variant seed: {seed}. 
```

---

## 20. Micro Detail Prompt Template

```txt
Generate a small transparent PNG top-down pixel art micro terrain decal. 
Family: {micro_family}. 
Examples: tiny flecks, blades, moss, small flowers, debris, ground-cover marks. 
Must be subtle and usable many times per screen without looking repetitive. 
Transparent background. 
Do not center a large object. 
No black outline. 
Dimensions: {width}x{height}. 
Variant seed: {seed}. 
```

---

## 21. Medium Dressing Prompt Template

```txt
Generate a transparent PNG top-down pixel art medium landscape dressing sprite. 
Family: {medium_family}. 
Biome compatibility: {biomes}. 
It should read as natural terrain dressing, not an interactive object unless specified. 
Transparent background. 
Soft natural silhouette. 
No UI, no text, no character. 
Dimensions: {width}x{height}. 
Variant seed: {seed}. 
```

---

## 22. Gameplay Object Prompt Template

```txt
Generate a transparent PNG top-down pixel art gameplay object sprite. 
Object family: {object_family}. 
Interaction type: {interaction}. 
Biome compatibility: {biomes}. 
The object should be readable as an interactable world object. 
Transparent background. 
Consistent scale with 32x32 terrain tiles. 
No UI, no labels, no text. 
Dimensions: {width}x{height}. 
Variant seed: {seed}. 
```

---

## 23. Seed Scheme

Use deterministic seeds.

```txt
base tiles:       100000000 + familyIndex * 100000 + variant
wang tiles:       200000000 + familyIndex * 100000 + mask * 1000 + variant
transitions:      300000000 + transitionIndex * 100000 + mask * 1000 + variant
surface overlays: 400000000 + familyIndex * 100000 + variant
micro:            500000000 + familyIndex * 100000 + variant
medium:           600000000 + familyIndex * 100000 + variant
objects:          700000000 + familyIndex * 100000 + variant
structure:        800000000 + familyIndex * 100000 + variant
```

---

## 24. Claude Execution Instructions

Claude should:

1. Create the full directory structure under `assets/pixelab/landscape_v2/`.
2. Generate `manifest.json` listing all planned assets before generating images.
3. Generate prompts into `prompts/generated_prompts.jsonl`.
4. Generate assets into the exact directories specified.
5. Create `metadata.json` per family.
6. Do not overwrite existing catalog assets.
7. Prefer completeness and consistency over novelty.
8. Validate every PNG path exists after generation.
9. Produce a final `generation_report.json` with counts per layer/family.

---

## 25. Implementation Notes For WizardGenie

Runtime should consume this library as:

```txt
base.family -> opaque tile / Wang base
surfaceOverlays[] -> alpha decals
micro[] -> small alpha decals placed deterministically in tile XY
medium[] -> sparse larger dressing sprites
objects[] -> gameplay placement, not terrain canvas by default
```

The renderer should never randomly stack everything available. It should ask `landscapeRecipe(tile)` what is allowed for that tile and choose a small number of compatible marks.
