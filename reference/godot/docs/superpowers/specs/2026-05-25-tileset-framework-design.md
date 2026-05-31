# Universal Tileset Framework — Wang Autotile Pipeline for All Visual Domains

**Date**: 2026-05-25
**Status**: Active — supersedes color-algebra-tiles-design.md
**Depends on**: World Compiler, TileObjectStack, GrainStack (L0), PixelLab MCP

## Problem

The game needs seamless, layered, interactable visuals across multiple domains: natural terrain, man-made pathways, building interiors (floors, walls, roofs), lighting, and decorative objects. Each domain has its own palette of materials that transition into each other. Generating and managing these transitions manually is unsustainable.

## Solution

A universal framework where every visual domain follows the same pipeline:

1. **Define a palette chain** — ordered list of materials that transition into each other
2. **Generate Wang tilesets** — one per adjacent pair, chained via base_tile_id
3. **Store with manifests** — JSON metadata per tileset in `assets/catalog/<domain>/`
4. **Render by adjacency** — renderer checks neighbor tiles and picks the right Wang tile
5. **Layer domains** — terrain under pathways under floors under walls under roofs under lighting

PixelLab's `create_topdown_tileset` generates 16-23 autotiles per call with corner-based seamless transitions. Chaining via `base_tile_id` ensures visual consistency across the full palette.

## The Framework

### Step 1: Define Domain Palette Chain

Each domain is an ordered list of materials. Adjacent materials in the list get transition tilesets.

```
TERRAIN:   ocean → beach → grass → forest → stone → snow → lava → mystic
PATHWAYS:  grass → dirt_trail → dirt_path → cobblestone → brick_road → marble_road
FLOORS:    dirt → wood_plank → stone_slab → marble → carpet → ornate_tile
WALLS:     exterior → wood_wall → stone_wall → brick_wall → marble_wall → ornate_wall
ROOFS:     sky → thatch → wood_shingle → slate → clay_tile → copper
LIGHTING:  darkness → torchlight → daylight → bright_sun → magical_glow
```

Each chain produces N-1 tilesets for N materials. Total per domain: ~5-8 tilesets.

### Step 2: Generate Chained Wang Tilesets

For each adjacent pair in a chain:

```
tileset_1 = create_topdown_tileset(
    lower_description="ocean water",
    upper_description="sandy beach",
    tile_size={"width": 32, "height": 32},
    transition_size=0.25
)
# Wait for completion, get base_tile_id

tileset_2 = create_topdown_tileset(
    lower_description="sandy beach",
    upper_description="green grass",
    lower_base_tile_id=tileset_1.upper_base_tile_id,
    tile_size={"width": 32, "height": 32},
    transition_size=0.25
)
# Chain continues...
```

Each tileset produces 16 tiles (or 23 at transition_size=1.0) with all corner combinations handled automatically.

### Step 3: Store with Manifests

```
assets/catalog/
  terrain/
    ocean_to_beach/          # 16-23 tile PNGs
      manifest.json          # {lower: "ocean", upper: "beach", tiles: [...], base_tile_ids: {...}}
    beach_to_grass/
      manifest.json
    grass_to_forest/
      manifest.json
    ...
  pathways/
    grass_to_dirt_trail/
      manifest.json
    dirt_trail_to_cobblestone/
      manifest.json
    ...
  floors/
    dirt_to_wood_plank/
      manifest.json
    ...
  walls/
    wood_wall_N/manifest.json    # Each wall direction is its own tileset
    wood_wall_S/manifest.json
    stone_wall_N/manifest.json
    ...
  roofs/
    thatch/manifest.json
    ...
```

### Step 4: Render by Adjacency (Wang Tile Selection)

For each tile position, the renderer:

1. Sample the material at this tile and its 4 corner neighbors
2. Encode corners as a 4-bit index (each corner = material A or material B)
3. Look up the Wang tile for that index from the tileset
4. Paint onto the appropriate z-layer image

```gdscript
# Pseudocode for Wang tile selection
func get_wang_tile_index(chunk, x, y, material_a, material_b) -> int:
    # Sample 4 corners (top-left, top-right, bottom-left, bottom-right)
    var tl = 1 if get_material(x-1, y-1) == material_b else 0
    var tr = 1 if get_material(x, y-1) == material_b else 0
    var bl = 1 if get_material(x-1, y) == material_b else 0
    var br = 1 if get_material(x, y) == material_b else 0
    return tl * 8 + tr * 4 + bl * 2 + br
```

This is the standard Wang/corner autotile algorithm. Each index maps to one of the 16 tiles in the tileset.

### Step 5: Layer Domains (Z-Order)

| Z | Domain | Content | Driven By |
|---|--------|---------|-----------|
| -2 | Terrain | ocean, beach, grass, stone, snow | BiomeLayer (L6) |
| -1 | Pathways | dirt paths, cobblestone roads | RoadsLayer (L10) + road_type |
| 0 | Floors | wood plank, stone slab (inside buildings) | BuildingCompiler floor material |
| 1 | Texture patterns | grass blades, pebbles, moss (transparent overlays) | VegetationLayer (L8) density |
| 2 | Detail objects | flowers, leaves, small stones (non-interactive) | Biome + density rules |
| 3 | Walls | wood, stone, brick (blocking) | BuildingCompiler wall material |
| 4 | Interactable items | branches, herbs, loose stones (pickable) | Sparse RNG placement |
| 5 | Large objects | trees, boulders, furniture | TileObjectStack blocking objects |
| 6 | Roofs | thatch, shingle, slate (alpha-fades on entry) | BuildingCompiler roof material |
| 7 | Lighting | darkness, torchlight, daylight overlays | DayNightCycle + light sources |

## Visual Domains — Detailed

### Domain 1: Terrain (First Implementation)

**Palette chain:** ocean → beach → grass → forest_floor → stone → snow → lava → mystic_purple

**Tileset count:** 7 chained tilesets (ocean→beach, beach→grass, grass→forest, forest→stone, stone→snow, snow→lava... skip improbable pairs, only generate biome pairs that actually occur in the world)

**Practical optimization:** Not every pair needs a tileset. Only generate transitions for biome pairs that are actually adjacent in the compiled world:
- ocean↔beach (always)
- beach↔grass (always)
- grass↔forest (always)
- grass↔stone (mountains next to grassland)
- stone↔snow (high elevation)
- grass↔sand (savanna/desert edge)
- water↔swamp (wetlands)

~8 terrain tilesets × 16-23 tiles = ~130-180 tiles, ~8 PixelLab calls.

### Domain 2: Pathways

**Palette chain:** natural_ground → dirt_trail → cobblestone → brick_road

**Tileset count:** 3 chained tilesets

Roads in the compiled world have a `road_type` value (1=trail, 2=road). The renderer uses the appropriate pathway tileset based on road_type and the surrounding terrain.

### Domain 3: Building Floors

**Palette chain:** dirt → wood_plank → stone_slab → marble → carpet

**Tileset count:** 4 chained tilesets

Interior floors transition between room types — a kitchen (stone_slab) meeting a bedroom (wood_plank) gets a smooth transition tileset.

### Domain 4: Walls

Walls are different from terrain — they're vertical surfaces rendered at an angle. Use `create_tiles_pro` with `low top-down` view for wall tiles that show height.

**Types:** wood_wall, stone_wall, brick_wall, each with N/S/E/W facing variants.

Wall tiles include: solid wall, wall with window, wall with door frame, corner piece, end piece.

### Domain 5: Roofs

Roof tiles rendered at `low top-down` view showing the roof surface.

**Types:** thatch, wood_shingle, slate, clay_tile

Each roof type gets edge tiles (ridge, eave, corner) for natural-looking roof shapes.

### Domain 6: Lighting

Transparent overlay tiles that modify the brightness/color of everything below.

**Types:** full_darkness, dim_shadow, ambient_light, bright_light, warm_torchlight, cool_moonlight, magical_glow

Applied as a top-layer image that modulates based on time of day, light sources (torches, windows, campfires), and interior/exterior status.

## Grain Stack Binding (Digging)

The terrain tileset layer is bound to the GrainStack:
- Top grain determines which terrain material is displayed
- Digging pops the top grain → material changes → tileset re-renders
- Exposed material = next grain in the stack (grass → soil/earth → stone → bedrock)

The renderer watches for grain stack changes and re-renders affected tiles.

## Animation

Every tileset and object gets animated variants via PixelLab's animation tools:
- Water tiles: flowing/ripple animation (animate_object or frame variants)
- Grass texture patterns: wind sway
- Lava tiles: flowing/bubbling
- Torch/fire lighting: flicker
- Door objects: open/close states (create_object_state)

Animations stored as frame sequences in the manifest. Renderer cycles frames based on a global animation timer.

## PixelLab Generation Workflow

### Phase 1: Terrain (first)
1. Generate ocean→beach tileset (chain start)
2. Chain: beach→grass
3. Chain: grass→forest_floor
4. Chain: grass→stone (for mountain edges)
5. Chain: stone→snow
6. Chain: grass→sand (for desert edges)
7. Chain: water→swamp
8. Download all, write manifests

### Phase 2: Pathways
9. Generate ground→dirt_trail
10. Chain: dirt_trail→cobblestone
11. Chain: cobblestone→brick_road

### Phase 3: Building Materials
12. Generate dirt→wood_plank floor tileset
13. Chain: wood_plank→stone_slab
14. Generate wall tiles (wood, stone, brick × 4 directions)
15. Generate roof tiles (thatch, shingle, slate)
16. Generate door/window tiles

### Phase 4: Texture Patterns + Details
17. Generate seamless grass_blades, pebble_scatter, leaf_litter, moss, sand_ripples
18. Generate detail objects (flowers, fallen leaves, mushrooms)
19. Generate interactable items (branches, herbs, loose stones)

### Phase 5: Animations
20. Animate water tilesets (ripple)
21. Animate lava tilesets (flow)
22. Animate grass patterns (sway)
23. Generate door open/close states
24. Generate torch/fire flicker

**Estimated total: ~24 PixelLab calls, ~400-500 tiles + animations**
**Estimated generation cost: ~2,000-3,000 generations (well within 8,987 remaining)**

## TilesetRenderer Class

Replaces current DeferredRenderer terrain painting. New class that:
1. Loads all domain manifests from `assets/catalog/`
2. For each chunk, determines which tilesets are needed (based on biome adjacencies)
3. Paints Wang tiles onto per-z-layer images using the 4-corner index algorithm
4. Layers all domain images bottom-to-top

```gdscript
class TilesetRenderer:
    var _catalog: AssetCatalog
    var _tilesets: Dictionary = {}  # "ocean_to_beach" → {tiles: [Image], ...}
    
    func render_terrain_layer(chunk: ChunkData, size: int) -> Image
    func render_pathway_layer(chunk: ChunkData, size: int) -> Image
    func render_floor_layer(chunk: ChunkData, size: int) -> Image
    func render_wall_layer(chunk: ChunkData, size: int) -> Image
    func render_roof_layer(chunk: ChunkData, size: int) -> Image
```

## File Structure

```
assets/catalog/
  terrain/                    # Wang tilesets for natural terrain
    ocean_to_beach/
    beach_to_grass/
    grass_to_forest/
    ...
  pathways/                   # Wang tilesets for man-made ground
    ground_to_dirt/
    dirt_to_cobblestone/
    ...
  floors/                     # Wang tilesets for building interiors
    dirt_to_wood/
    wood_to_stone/
    ...
  walls/                      # Directional wall tiles
    wood_wall/
    stone_wall/
    ...
  roofs/                      # Roof surface tiles
    thatch/
    shingle/
    ...
  patterns/                   # Seamless texture overlays
    grass_blades/
    pebbles/
    ...
  details/                    # Non-interactive detail sprites
    flowers/
    leaves/
    ...
  interactables/              # Pickable item sprites
    branches/
    herbs/
    ...
  lighting/                   # Light/shadow overlay tiles
    torchlight/
    moonlight/
    ...
data/
  domain_chains.json          # Palette chains per domain
  tileset_registry.json       # Maps material pairs → tileset paths
```

## Non-Goals (This Spec)

- Character sprites (separate domain, uses create_character)
- Weapon/armor equipment sprites (separate domain)
- UI elements
- Sound effects

## Success Criteria

1. Terrain transitions are seamless — no visible hard edges between biomes
2. Pathways blend smoothly into surrounding terrain
3. Building interiors have proper floor/wall/roof tiles
4. All tiles are PixelLab-generated with consistent art style
5. Wang autotile algorithm correctly selects tiles by corner adjacency
6. Digging updates visual layers by modifying grain stack
7. Framework reusable across all visual domains with same code
8. Performance: Image-based rendering, ~70 Sprite2D nodes for 9 chunks (7 layers × ~10)
