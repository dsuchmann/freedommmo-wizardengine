# Tile Object Stack + Atomic Asset System

**Date**: 2026-05-25
**Status**: Active
**Depends on**: World Compiler (2026-05-24), BuildingCompiler

## Problem

The world compiler places buildings as single-type tiles (one wall OR one floor per position). Real buildings need stacked objects per tile — a floor with a rug on it, a table on the rug, a plate on the table, a spoon on the plate. Each object has properties (walkable, pickable, interactable). The current system can't represent this.

Additionally, PixelLab generates whole buildings as single images. We need it to generate **atomic pieces** — thousands of walls, doors, floors, furniture — that assemble into unique buildings programmatically.

## Architecture Overview

Three subsystems:

1. **TileObjectStack** — each world tile holds an ordered stack of objects with properties
2. **AssetCatalog** — JSON manifests describing every PixelLab-generated atomic tile
3. **RoomAssembler** — templates that compose rooms from catalog assets with placement rules

## 1. TileObjectStack

Replaces `ChunkData.building_tiles` (Dictionary of single entries) with a stacked object model.

### Data Model

```gdscript
# One object on a tile
class TileObject:
    var asset_id: String       # e.g. "wood_plank_03"
    var category: String       # "floor", "furniture", "item", "wall", etc.
    var z_layer: int           # render order (0=ground, 1=floor, 2=furniture, 3=items)
    var walkable: bool         # can the player walk on/through this?
    var blocking: bool         # does this block movement?
    var pickable: bool         # can the player pick this up?
    var interactable: bool     # can the player use this (open, craft, sit)?
    var provides: Array        # ["cooking", "sleeping", "storage"] — what this enables
    var value: int             # trade/loot value
    var properties: Dictionary # extensible: {locked: true, hp: 50, fuel: 10}

# Stack of objects at one tile position
class TileStack:
    var objects: Array = []    # ordered bottom-to-top [floor, rug, table, plate, spoon]
    
    func add(obj: TileObject) -> void
    func remove(obj: TileObject) -> void
    func top() -> TileObject               # topmost object
    func is_walkable() -> bool             # true if no blocking object in stack
    func get_interactables() -> Array      # all objects with interactable=true
    func get_pickables() -> Array          # all objects with pickable=true
    func get_by_category(cat: String) -> Array
```

### Integration with ChunkData

Replace:
```
var building_tiles: Dictionary = {}  # Vector2i → {type, material, z_index}
```

With:
```
var tile_stacks: Dictionary = {}     # Vector2i → TileStack
```

BuildingCompiler stamps TileObjects instead of flat dictionaries. Walkability derived from stack contents (any blocking object = impassable).

### Interaction Model

When player presses E at a tile:
1. Get TileStack at player's facing tile
2. Scan top-to-bottom for first interactable/pickable object
3. If pickable → add to inventory, remove from stack
4. If interactable → trigger interaction (open chest, use forge, sit in chair)
5. If nothing → "Nothing to interact with"

### Rendering

DeferredRenderer paints tile stacks bottom-to-top onto layered images:
- Z0 image: floors (wood_plank, stone_slab, dirt)
- Z1 image: floor decorations (rugs, bloodstains, cracks)
- Z2 image: furniture (tables, chairs, beds, forges)
- Z3 image: items on surfaces (plates, books, tools)
- Z4 image: walls (rendered at wall height)
- Z5 image: roofs (alpha-fades on entry)

Each z-layer is one Image sprite per chunk (6 sprites instead of current 6). Performance identical to current system.

## 2. AssetCatalog

JSON manifests for every PixelLab-generated asset, organized by category.

### Directory Structure

```
assets/catalog/
  terrain/
    grass_01.png ... grass_20.png
    water_01.png ... water_10.png
    sand_01.png ... sand_10.png
    stone_01.png ... stone_10.png
    path_dirt_01.png ... path_dirt_10.png
    snow_01.png ... snow_05.png
  walls/
    wood_wall_N_01.png ... wood_wall_N_10.png
    wood_wall_S_01.png ... wood_wall_E_01.png ... 
    stone_wall_N_01.png ... stone_wall_N_10.png
    brick_wall_N_01.png ...
  floors/
    wood_plank_01.png ... wood_plank_15.png
    stone_slab_01.png ... stone_slab_10.png
    carpet_red_01.png ... carpet_blue_01.png
    dirt_floor_01.png ...
  doors/
    wood_door_01.png ... wood_door_05.png
    iron_door_01.png ... ornate_door_01.png
  roofs/
    thatch_01.png ... thatch_05.png
    shingle_01.png ... slate_01.png
  furniture/
    table_oak_01.png ... table_oak_05.png
    chair_01.png ... chair_05.png
    bed_01.png ... bed_05.png
    shelf_01.png ... barrel_01.png ... crate_01.png
  fixtures/
    forge_01.png ... anvil_01.png ... well_01.png
    oven_01.png ... workbench_01.png
  items/
    plate_01.png ... spoon_01.png ... knife_01.png
    book_01.png ... candle_01.png ... potion_01.png
  nature/
    oak_tree_01.png ... pine_tree_01.png
    bush_01.png ... flower_01.png ... rock_01.png
```

### Manifest Format

Each category has a `manifest.json`:

```json
{
  "category": "furniture",
  "tile_size": 32,
  "assets": [
    {
      "id": "table_oak_01",
      "file": "table_oak_01.png",
      "size": [32, 32],
      "z_layer": 2,
      "walkable": false,
      "blocking": true,
      "pickable": false,
      "interactable": false,
      "surface": true,
      "tags": ["table", "wood", "medium"]
    },
    {
      "id": "chair_01",
      "file": "chair_01.png",
      "size": [32, 32],
      "z_layer": 2,
      "walkable": false,
      "blocking": true,
      "pickable": false,
      "interactable": true,
      "provides": ["sitting"],
      "tags": ["chair", "wood", "small"]
    }
  ]
}
```

### AssetCatalog Class

```gdscript
class AssetCatalog:
    var _assets: Dictionary = {}          # asset_id → manifest entry
    var _by_category: Dictionary = {}     # category → [asset_ids]
    var _by_tag: Dictionary = {}          # tag → [asset_ids]
    var _textures: Dictionary = {}        # asset_id → Texture2D (lazy-loaded)
    
    func load_manifests(base_path: String) -> void
    func get_asset(id: String) -> Dictionary
    func get_random_from_category(category: String, rng: RandomNumberGenerator) -> String
    func get_by_tags(tags: Array) -> Array  # assets matching ALL tags
    func get_texture(id: String) -> Texture2D  # lazy-loads from file
```

### PixelLab Generation Strategy

Generate assets in batches by category. Each batch:
1. Define palette + style constraints (medieval fantasy, 32x32, consistent lighting)
2. Generate 10-20 variants per sub-type
3. Download PNGs to `assets/catalog/<category>/`
4. Write manifest.json with properties
5. Verify visual consistency (size, palette, style)

Priority order for generation:
1. Terrain tiles (grass, water, sand, stone, paths) — highest visual impact
2. Wall tiles (wood N/S/E/W, stone N/S/E/W) — buildings need walls
3. Floor tiles (wood plank, stone slab) — building interiors
4. Door tiles — building entry points
5. Furniture (table, chair, bed, shelf, barrel) — interior life
6. Items (plate, book, candle, tool) — interactable objects
7. Nature (trees, bushes, flowers, rocks) — outdoor detail
8. Roof tiles — building canopy layer
9. Fixtures (forge, anvil, oven, well) — functional structures

## 3. RoomAssembler

Templates that compose rooms from catalog assets using placement rules.

### Room Template Format

```json
{
  "room_type": "kitchen",
  "min_size": [3, 3],
  "max_size": [5, 4],
  "floor": {"category": "floors", "tags": ["stone"]},
  "required": [
    {
      "category": "fixtures",
      "tags": ["oven"],
      "placement": "against_wall",
      "count": 1,
      "provides": ["cooking"]
    },
    {
      "category": "furniture",
      "tags": ["table"],
      "placement": "center",
      "count": 1
    }
  ],
  "optional": [
    {
      "category": "furniture",
      "tags": ["shelf"],
      "placement": "against_wall",
      "count": [0, 2]
    },
    {
      "category": "items",
      "tags": ["plate"],
      "placement": "on_surface",
      "count": [1, 4]
    },
    {
      "category": "items",
      "tags": ["pot"],
      "placement": "near",
      "near_target": "oven",
      "count": [0, 2]
    }
  ]
}
```

### Placement Rules

| Rule | Meaning |
|------|---------|
| `against_wall` | Adjacent to a wall tile, not blocking door |
| `center` | Interior tile, not against wall |
| `near` | Within 2 tiles of `near_target` |
| `on_surface` | On a tile that has a `surface: true` object (table, counter) |
| `corner` | In a corner (two adjacent walls) |
| `doorside` | Adjacent to door tile |

### Building Template (Composed of Rooms)

```json
{
  "building_type": "house_medium",
  "rooms": [
    {"type": "bedroom", "size": [3, 3], "position": "back_left"},
    {"type": "kitchen", "size": [3, 3], "position": "back_right"},
    {"type": "main_hall", "size": [4, 3], "position": "front"},
    {"type": "storage", "size": [2, 2], "position": "back_center"}
  ],
  "walls": {"category": "walls", "tags": ["wood"]},
  "roof": {"category": "roofs", "tags": ["thatch"]},
  "door": {"category": "doors", "tags": ["wood"]},
  "npc_slots": [
    {"role": "resident", "sleep": "bedroom", "eat": "kitchen"}
  ]
}
```

### RoomAssembler Class

```gdscript
class RoomAssembler:
    var _catalog: AssetCatalog
    var _room_templates: Dictionary = {}   # room_type → template
    var _building_templates: Dictionary = {} # building_type → template
    
    func assemble_building(template_id: String, pos: Vector2i, chunk: ChunkData, rng: RandomNumberGenerator) -> Dictionary
    func assemble_room(template: Dictionary, bounds: Rect2i, chunk: ChunkData, rng: RandomNumberGenerator) -> void
    func place_object(asset_id: String, tile_pos: Vector2i, chunk: ChunkData) -> void
```

## Integration with World Compiler

SettlementsLayer currently calls `BuildingCompiler.compile_building()`. The new flow:

1. SettlementsLayer scores site, picks building type based on settlement tier
2. `RoomAssembler.assemble_building()` replaces `BuildingCompiler.compile_building()`
3. RoomAssembler stamps walls (from wall catalog), places door, lays floors
4. For each room in the building template, assembles furniture + items from catalog
5. All objects go into `ChunkData.tile_stacks[pos]` as TileObject instances
6. DeferredRenderer reads tile_stacks and paints z-layered images

## Rendering Changes

DeferredRenderer currently paints building_tiles as single-color pixels. New approach:

**Phase 1 (colored pixels — current):** Paint tile stacks as colored pixels by category. Walls = brown, floors = tan, furniture = dark brown, items = yellow. Same visual as now but data model supports stacking.

**Phase 2 (PixelLab tiles):** Load actual textures from AssetCatalog. Paint 32x32 tiles from catalog onto per-z-layer images. Each tile position gets its stack rendered bottom-to-top across z-layer images.

## File Structure

```
scripts/core/world_compiler/
  tile_object.gd              # TileObject + TileStack classes
  asset_catalog.gd            # Loads manifests, serves textures
  room_assembler.gd           # Composes rooms from templates + catalog
data/
  room_templates/
    bedroom.json
    kitchen.json
    main_hall.json
    storage.json
    forge_room.json
    tavern_hall.json
    guard_room.json
  building_templates/         # existing — evolve to reference rooms
assets/
  catalog/                    # PixelLab-generated atomic tiles
    terrain/manifest.json
    walls/manifest.json
    floors/manifest.json
    ...
```

## Non-Goals

- Multi-story buildings (future — requires Z-level system)
- Destructible walls (future — requires TileObject HP + damage system)
- NPC furniture interaction animations (future — behavior system integration)
- Procedural room layout generation (future — for now, templates define room positions)

## Success Criteria

1. A building tile can hold floor + rug + table + plate + spoon simultaneously
2. Player can pick up items from tile stacks
3. Walkability derived from stack contents (any blocking object = blocked)
4. Buildings assembled from room templates using catalog assets
5. Same or better rendering performance (Image-based, no extra nodes)
6. PixelLab assets organized by category with JSON manifests
