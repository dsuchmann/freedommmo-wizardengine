# TownLayout System — Claude-Generated Coherent Towns

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace random village scatter with Claude-designed town layouts that produce coherent, intentional settlements — buildings placed with purpose, roads connecting doors, NPCs assigned to buildings.

**Architecture:** Claude generates a TownLayout JSON describing building positions, road paths, zones, decorations, and NPC assignments on a 64x64 grid. A new TownLayoutCompiler reads this JSON and calls the existing BuildingCompiler + road rasterizer to expand it into tiles. The world compiler's SettlementsLayer calls TownLayoutCompiler instead of VillageGenerator.

**Tech Stack:** GDScript, JSON, existing BuildingCompiler + ChunkData

---

### File Structure

| File | Responsibility |
|------|---------------|
| `data/town_layouts/fishing_village.json` | Example TownLayout JSON |
| `data/town_layouts/mountain_outpost.json` | Second example layout |
| `scripts/core/world_compiler/town_layout_compiler.gd` | Parses TownLayout JSON → calls BuildingCompiler + road rasterizer |
| `scripts/core/world_compiler/layers/settlements_layer.gd` | Modified: calls TownLayoutCompiler instead of hardcoded placement |
| `scripts/GrainWorldDemo.gd` | Modified: passes TownLayoutCompiler to NPC spawning |

---

### Task 1: Create the TownLayout JSON Schema + Example

**Files:**
- Create: `data/town_layouts/fishing_village.json`

- [ ] **Step 1: Write the fishing village layout**

```json
{
  "town_id": "fishing_village_01",
  "name": "Millhaven",
  "theme": "fishing_village",
  "size": [48, 48],
  "zones": [
    {"id": "square", "type": "plaza", "rect": [20, 20, 8, 8], "ground": "cobblestone"},
    {"id": "docks", "type": "waterfront", "rect": [0, 16, 8, 16], "ground": "wood_plank"}
  ],
  "buildings": [
    {"template": "house", "pos": [10, 14], "facing": "south", "label": "fisher_cottage_1"},
    {"template": "house", "pos": [10, 22], "facing": "south", "label": "fisher_cottage_2"},
    {"template": "tavern", "pos": [18, 14], "facing": "south", "label": "the_salty_anchor"},
    {"template": "market_stall", "pos": [22, 22], "facing": "south", "label": "fish_market"},
    {"template": "forge", "pos": [30, 14], "facing": "south", "label": "blacksmith"},
    {"template": "house", "pos": [30, 26], "facing": "east", "label": "elder_house"},
    {"template": "well", "pos": [23, 23], "facing": "south", "label": "village_well"},
    {"template": "watchtower", "pos": [24, 4], "facing": "south", "label": "north_gate"}
  ],
  "roads": [
    {"type": "cobblestone", "width": 2, "path": [[4, 24], [18, 24], [24, 24], [24, 8]]},
    {"type": "cobblestone", "width": 2, "path": [[18, 24], [18, 18]]},
    {"type": "dirt", "width": 1, "path": [[24, 24], [34, 24]]}
  ],
  "decorations": [
    {"type": "signpost", "pos": [24, 28]},
    {"type": "flower_pot", "pos": [19, 14]},
    {"type": "barrel", "pos": [4, 18]},
    {"type": "barrel", "pos": [4, 20]},
    {"type": "bench", "pos": [22, 20]},
    {"type": "fence", "segments": [[8, 10], [8, 32]]}
  ],
  "npcs": [
    {"role": "fisherman", "home": "fisher_cottage_1", "workplace": "docks"},
    {"role": "fisherman", "home": "fisher_cottage_2", "workplace": "docks"},
    {"role": "innkeeper", "home": "the_salty_anchor", "workplace": "the_salty_anchor"},
    {"role": "merchant", "workplace": "fish_market"},
    {"role": "blacksmith", "home": "blacksmith", "workplace": "blacksmith"},
    {"role": "elder", "home": "elder_house", "workplace": "square"},
    {"role": "guard", "workplace": "north_gate", "patrol": ["north_gate", "square"]}
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add data/town_layouts/fishing_village.json
git commit -m "feat: fishing village TownLayout JSON"
```

---

### Task 2: Create TownLayoutCompiler

**Files:**
- Create: `scripts/core/world_compiler/town_layout_compiler.gd`

- [ ] **Step 1: Write the compiler class**

```gdscript
class_name TownLayoutCompiler
extends RefCounted

## Expands a TownLayout JSON into ChunkData tiles via BuildingCompiler.
## Handles: zone ground painting, building placement, road rasterization,
## decoration placement, NPC assignment.

var _building_compiler: BuildingCompiler
var _layouts: Dictionary = {}  # town_id -> layout data

func _init(building_compiler: BuildingCompiler) -> void:
    _building_compiler = building_compiler
    _load_layouts()

func _load_layouts() -> void:
    var dir_path = "res://data/town_layouts/"
    var dir = DirAccess.open(dir_path)
    if dir == null:
        return
    dir.list_dir_begin()
    var file = dir.get_next()
    while file != "":
        if file.ends_with(".json"):
            var json_text = FileAccess.get_file_as_string(dir_path + file)
            if json_text != "":
                var json = JSON.new()
                if json.parse(json_text) == OK:
                    var data = json.data
                    var tid = data.get("town_id", file.get_basename())
                    _layouts[tid] = data
        file = dir.get_next()
    dir.list_dir_end()
    print("[TownLayoutCompiler] Loaded %d town layouts" % _layouts.size())

func get_layout_ids() -> Array:
    return _layouts.keys()

func pick_layout_for_biome(biome_name: String, rng: RandomNumberGenerator) -> Dictionary:
    ## Pick a layout appropriate for the biome. Falls back to any layout.
    var candidates = []
    for tid in _layouts:
        candidates.append(_layouts[tid])
    if candidates.is_empty():
        return {}
    return candidates[rng.randi() % candidates.size()]

func compile_town(chunk: ChunkData, layout: Dictionary, origin_x: int, origin_y: int) -> Dictionary:
    ## Expand a TownLayout into chunk tiles. Returns town metadata.
    var town_name = layout.get("name", "Unknown Settlement")
    var structures = []
    var npc_assignments = []

    # 1) Paint zone ground tiles
    for zone in layout.get("zones", []):
        _paint_zone(chunk, zone, origin_x, origin_y)

    # 2) Place buildings via BuildingCompiler
    var building_positions = {}  # label -> {x, y}
    for bld in layout.get("buildings", []):
        var tmpl_id = bld.get("template", "house")
        var pos = bld.get("pos", [0, 0])
        var wx = origin_x + pos[0]
        var wy = origin_y + pos[1]
        var label = bld.get("label", tmpl_id)
        var result = _building_compiler.compile_building(chunk, tmpl_id, wx, wy)
        if not result.is_empty():
            structures.append(result)
            building_positions[label] = {"x": wx, "y": wy}

    # 3) Rasterize roads
    for road in layout.get("roads", []):
        _rasterize_road(chunk, road, origin_x, origin_y)

    # 4) Place decorations
    for deco in layout.get("decorations", []):
        _place_decoration(chunk, deco, origin_x, origin_y)

    # 5) Assign NPCs to buildings
    for npc_def in layout.get("npcs", []):
        var home_label = npc_def.get("home", "")
        var work_label = npc_def.get("workplace", "")
        var home_pos = building_positions.get(home_label, {})
        var work_pos = building_positions.get(work_label, {})
        npc_assignments.append({
            "role": npc_def.get("role", "villager"),
            "home_x": home_pos.get("x", origin_x),
            "home_y": home_pos.get("y", origin_y),
            "work_x": work_pos.get("x", origin_x),
            "work_y": work_pos.get("y", origin_y),
        })

    return {
        "name": town_name,
        "structures": structures,
        "npcs": npc_assignments,
        "origin_x": origin_x,
        "origin_y": origin_y,
    }

func _paint_zone(chunk: ChunkData, zone: Dictionary, ox: int, oy: int) -> void:
    var rect = zone.get("rect", [0, 0, 4, 4])
    var ground = zone.get("ground", "cobblestone")
    for y in range(rect[1], rect[1] + rect[3]):
        for x in range(rect[0], rect[0] + rect[2]):
            var wx = ox + x
            var wy = oy + y
            var lx = wx - chunk.chunk_x * ChunkData.SIZE
            var ly = wy - chunk.chunk_y * ChunkData.SIZE
            if lx >= 0 and lx < ChunkData.SIZE and ly >= 0 and ly < ChunkData.SIZE:
                if ground == "cobblestone":
                    chunk.road_cells[Vector2i(lx, ly)] = 1

func _rasterize_road(chunk: ChunkData, road: Dictionary, ox: int, oy: int) -> void:
    var path_points = road.get("path", [])
    var width = road.get("width", 1)
    for i in range(path_points.size() - 1):
        var from_pt = path_points[i]
        var to_pt = path_points[i + 1]
        var fx = ox + from_pt[0]
        var fy = ox + from_pt[1]
        var tx = ox + to_pt[0]
        var ty = oy + to_pt[1]
        _bresenham_road(chunk, fx, fy, tx, ty, width)

func _bresenham_road(chunk: ChunkData, x0: int, y0: int, x1: int, y1: int, width: int) -> void:
    var dx = abs(x1 - x0)
    var dy = abs(y1 - y0)
    var sx = 1 if x0 < x1 else -1
    var sy = 1 if y0 < y1 else -1
    var err = dx - dy
    var cx = x0
    var cy = y0
    while true:
        for wy in range(-width / 2, width / 2 + 1):
            for wx in range(-width / 2, width / 2 + 1):
                var lx = cx + wx - chunk.chunk_x * ChunkData.SIZE
                var ly = cy + wy - chunk.chunk_y * ChunkData.SIZE
                if lx >= 0 and lx < ChunkData.SIZE and ly >= 0 and ly < ChunkData.SIZE:
                    chunk.road_cells[Vector2i(lx, ly)] = 1
                    chunk.walkability[chunk.idx(lx, ly)] = 0.5
        if cx == x1 and cy == y1:
            break
        var e2 = 2 * err
        if e2 > -dy:
            err -= dy
            cx += sx
        if e2 < dx:
            err += dx
            cy += sy

func _place_decoration(chunk: ChunkData, deco: Dictionary, ox: int, oy: int) -> void:
    var pos = deco.get("pos", [0, 0])
    var lx = ox + pos[0] - chunk.chunk_x * ChunkData.SIZE
    var ly = oy + pos[1] - chunk.chunk_y * ChunkData.SIZE
    if lx >= 0 and lx < ChunkData.SIZE and ly >= 0 and ly < ChunkData.SIZE:
        # Store decoration in chunk for renderer to pick up
        if not chunk.has_meta("decorations"):
            chunk.set_meta("decorations", [])
        var decos = chunk.get_meta("decorations")
        decos.append({"type": deco.get("type", ""), "x": lx, "y": ly})
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/world_compiler/town_layout_compiler.gd
git commit -m "feat: TownLayoutCompiler expands JSON layouts into chunk tiles"
```

---

### Task 3: Wire TownLayoutCompiler into SettlementsLayer

**Files:**
- Modify: `scripts/core/world_compiler/layers/settlements_layer.gd`
- Modify: `scripts/autoload/WorldManager.gd`

- [ ] **Step 1: Read settlements_layer.gd to understand current flow**

Read the full file to find where structures are placed. The current flow calls `_building_compiler.compile_building()` for each structure in a hardcoded list. Replace this with `_town_layout_compiler.compile_town()`.

- [ ] **Step 2: Add TownLayoutCompiler to WorldManager**

In `scripts/autoload/WorldManager.gd`, add:

```gdscript
var town_layout_compiler: TownLayoutCompiler
```

Initialize it after building_compiler:

```gdscript
town_layout_compiler = TownLayoutCompiler.new(world_compiler.building_compiler)
```

- [ ] **Step 3: Update SettlementsLayer to use TownLayoutCompiler**

In the settlement placement function, instead of stamping individual buildings at hardcoded positions, call:

```gdscript
var layout = town_layout_compiler.pick_layout_for_biome(biome_name, rng)
if not layout.is_empty():
    var result = town_layout_compiler.compile_town(chunk, layout, site_x, site_y)
    for s in result.get("structures", []):
        chunk.structures.append(s)
```

- [ ] **Step 4: Commit**

```bash
git add scripts/core/world_compiler/layers/settlements_layer.gd scripts/autoload/WorldManager.gd
git commit -m "feat: wire TownLayoutCompiler into settlement generation"
```

---

### Task 4: Update NPC Spawning to Use Layout Assignments

**Files:**
- Modify: `scripts/GrainWorldDemo.gd`

- [ ] **Step 1: Update _spawn_compiler_npcs to use layout NPC data**

The TownLayoutCompiler returns NPC assignments with home/workplace positions and roles. Update `_spawn_compiler_npcs()` to use these instead of generic spawning:

```gdscript
func _spawn_compiler_npcs() -> void:
    if not _compiled_chunk:
        return
    var spawner = WorldManager.entity_spawner
    if spawner == null:
        return
    # Check if chunk has town layout NPC assignments
    var town_npcs = _compiled_chunk.get_meta("town_npcs") if _compiled_chunk.has_meta("town_npcs") else []
    if town_npcs.is_empty():
        # Fallback: spawn at structures as before
        _spawn_npcs_at_structures()
        return
    # Spawn NPCs from layout assignments
    var npc_count = 0
    for npc_def in town_npcs:
        var role = npc_def.get("role", "villager")
        var hx = npc_def.get("home_x", 0)
        var hy = npc_def.get("home_y", 0)
        spawner.spawn_npc(EntityBody.Species.HUMAN, "", hx, hy)
        npc_count += 1
    print("[TownLayout] Spawned %d NPCs from layout" % npc_count)
```

- [ ] **Step 2: Commit**

```bash
git add scripts/GrainWorldDemo.gd
git commit -m "feat: NPC spawning uses TownLayout assignments"
```

---

### Task 5: Create Second Layout + Test

**Files:**
- Create: `data/town_layouts/mountain_outpost.json`

- [ ] **Step 1: Write mountain outpost layout**

A smaller, defensive settlement in mountain terrain:

```json
{
  "town_id": "mountain_outpost_01",
  "name": "Ironpeak Watch",
  "theme": "mountain_outpost",
  "size": [32, 32],
  "zones": [
    {"id": "courtyard", "type": "plaza", "rect": [12, 12, 8, 8], "ground": "cobblestone"}
  ],
  "buildings": [
    {"template": "watchtower", "pos": [14, 4], "facing": "south", "label": "main_tower"},
    {"template": "forge", "pos": [8, 14], "facing": "south", "label": "armory"},
    {"template": "house", "pos": [20, 14], "facing": "south", "label": "barracks"},
    {"template": "house", "pos": [20, 22], "facing": "south", "label": "supply_house"},
    {"template": "well", "pos": [15, 15], "facing": "south", "label": "well"}
  ],
  "roads": [
    {"type": "cobblestone", "width": 2, "path": [[16, 28], [16, 16], [16, 6]]}
  ],
  "decorations": [
    {"type": "barrel", "pos": [9, 18]},
    {"type": "barrel", "pos": [10, 18]}
  ],
  "npcs": [
    {"role": "guard", "home": "barracks", "workplace": "main_tower"},
    {"role": "guard", "home": "barracks", "workplace": "main_tower"},
    {"role": "blacksmith", "home": "supply_house", "workplace": "armory"},
    {"role": "merchant", "workplace": "courtyard"}
  ]
}
```

- [ ] **Step 2: Run the game and screenshot to verify**

Launch the game, create a character, wait for compilation. Take a screenshot. The settlement should show buildings connected by roads with a central courtyard — NOT random scattered rectangles.

- [ ] **Step 3: Commit**

```bash
git add data/town_layouts/mountain_outpost.json
git commit -m "feat: mountain outpost TownLayout + verification"
```
