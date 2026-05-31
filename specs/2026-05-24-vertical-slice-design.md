# Vertical Slice Design — Make the World Real

**Date**: 2026-05-24
**Status**: Active
**Priority**: #1 — blocks everything else

## Problem Statement

FreedomMMO has 108 scripts and 42 systems but the game is "one atom deep." Terrain, structures, NPCs, and the player exist in disconnected layers:
- Terrain is a colored pixel grid with no spatial meaning
- Structures are brown ColorRect squares with no visual form
- NPCs wander randomly with no relationship to the world
- Player walks through everything — no collision

## Goal

One village that works deeply across all systems. A player should be able to:
1. See a coherent village (buildings, roads, landmarks)
2. Walk around with collision (can't walk through walls/water)
3. See NPCs going about purposeful lives (walking to work, going home at night)
4. Interact with NPCs at meaningful locations (talk to blacksmith at forge)
5. Complete one full interaction loop (arrive → explore → talk → task → do it → consequences)

## Phase 1: Walkability & Collision

### WalkabilityGrid (new class)
- Flat dictionary mapping `Vector2i(world_x, world_y) → float` movement cost
- `-1.0` = impassable, `1.0` = normal, `0.5` = path (fast), `5.0` = difficult
- Populated by terrain generation: water=-1, lava=-1, deep ocean=-1, mountain=3.0, sand=1.3, path=0.5, grass=1.0
- Structures stamp their footprint: walls=-1, floors=1.0, doors=0.8
- Queried by player movement AND NPC pathfinding

### Player Collision
- Before moving, check `WalkabilityGrid.can_move_to(target_pos)` 
- Slide along walls (try X-only, then Y-only if diagonal blocked)
- Movement speed multiplied by walkability cost

### Integration
- TerrainGenerator populates walkability during cell generation
- StructureSystem stamps walkability when structures placed
- Pathfinding._get_movement_cost() reads WalkabilityGrid instead of raw grain stacks

## Phase 2: Structure Visual Rendering

### StructureRenderer (new class)
Each structure type gets a visual definition:
```
house: 3x3 footprint
  ████  (wall tiles — brown/stone)
  █  █  (wall + door opening on south side)
  ████
  
forge: 2x2 footprint
  ██  (dark stone walls)
  █░  (wall + orange glow door)
  
market_stall: 2x1
  ██  (wooden frame)
  
well: 1x1
  ○   (stone circle)
  
watchtower: 2x2
  ██  (tall stone)
  ██
```

### Rendering Approach
- Draw structure tiles directly onto the cell Image during/after terrain rendering
- Structures at z_index above terrain, below NPCs
- Structure tiles are pixel colors drawn into the image (matching the 1px-per-tile approach)
- Later: replace with actual tileset sprites when PixelLab tilesets are integrated

### Building Interiors
- Door tile is walkable — NPCs/player can enter
- Interior floor tiles replace terrain underneath structure footprint
- Later: interior rooms with furniture as sub-structures

## Phase 3: Road/Path Network

### PathNetworkGenerator (new class or extension of VillageGenerator)
- After structures placed, connect them with paths
- Algorithm: from each structure, create path tiles toward village center (well)
- Path tiles: lower movement cost (0.5), visually distinct (lighter brown/cobblestone color)
- Inter-village roads: connect village centers with wider path

### Rendering
- Path tiles drawn into terrain image during generation
- Terrain generator already has `_has_path()` — extend this to include village-generated paths

## Phase 4: NPC Spatial Coherence

### Structure Assignment
- VillageGenerator assigns each NPC a `home_structure_id` and `work_structure_id`
- EntitySpawner data dict gets `home_structure_id`, `work_structure_id` fields
- Blacksmith → forge, merchant → market_stall, guard → watchtower, farmer → farm_plot, villager → house

### Schedule-Driven Movement
- NPCBehavior._execute_activity() changes:
  - "sleep" → pathfind to home_structure position
  - "work"/"farm"/"trade" → pathfind to work_structure position
  - "eat"/"rest" → pathfind to home_structure position
  - "socialize" → pathfind to village center (well) or nearest NPC's location
  - "patrol" → cycle through village perimeter points

### Path Preference
- Pathfinding cost for path tiles = 0.5 (NPCs prefer paths)
- NPCs walk on roads between structures instead of cutting through terrain

## Phase 5: Layered Character Rendering

### PixelLab Generation Pipeline
1. Generate **nude base bodies** per species × gender (8 base sprites minimum):
   - Human male, Human female, Elf male, Elf female, Dwarf male, Dwarf female, Orc male, Orc female
   - Full anatomical detail, diverse skin tones, species-specific traits
   - 48x48, 8 directions, low top-down view

2. Generate **equipment overlays** as separate transparent sprites:
   - Clothing layer: tunic, dress, robe, pants
   - Armor layer: leather, chainmail, plate
   - Weapon layer: sword, axe, bow, staff, pick
   - Head layer: helmet, hat, hood, crown

3. **ComposableRenderer** composites at runtime:
   - base_body + clothing + armor + weapon + head + effects → final texture
   - Equipment changes → re-composite
   - Stripping equipment → shows base body

### Technical Requirements
- All sprites: 48x48px, 8 directions, consistent palette
- Overlays: transparent background, aligned to base body skeleton
- Equipment state in EntityBody drives which overlays are composited

## Non-Negotiables

- **Never hardcode**: All village positions, NPC names, structure layouts, item stats generated from systems
- **GDScript safety**: Use `=` not `:=` for Dictionary.get() returns
- **Depth first**: Each phase must WORK before moving to the next — no more skeleton code
- **DevBox workflow**: Each phase = 1 DevBox run with PR
