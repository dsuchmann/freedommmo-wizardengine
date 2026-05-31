# Elevation Hypergraph Terrain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat biome-based tile selection with elevation-driven surface gradients and Wang transitions, so terrain naturally flows from beaches to grasslands to mountains to snow based on actual elevation data.

**Architecture:** A new `ElevationGradientTable` holds static biome-to-surface gradient data. A new `HypergraphTileResolver` samples 4 corner elevations per tile, maps them through the gradient to surface IDs, and returns the correct tileset + Wang index. The existing `LayeredTilesetLoader` and `LayeredChunkRenderer` are modified to use surface-based lookups instead of biome-based ones.

**Tech Stack:** Godot 4.4 / GDScript. No external dependencies. Assets are 32x32 Wang tiles (16 per set) loaded as Images.

**Spec:** `docs/superpowers/specs/2026-05-27-elevation-hypergraph-terrain-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `scripts/core/world_compiler/elevation_gradient_table.gd` | Static data: biome gradient definitions, surface-to-path mappings |
| Create | `scripts/core/world_compiler/hypergraph_tile_resolver.gd` | Given (biome, 4 corner elevations) → (tileset_key, wang_index) |
| Create | `assets/catalog/terrain_v3/gradients.json` | JSON source of truth for all 18 biome gradients |
| Create | `tools/reorganize_terrain_assets.py` | One-shot script to copy L1 tilesets → surfaces/, transitions → transitions/ |
| Modify | `scripts/core/world_compiler/layered_tileset_loader.gd` | Load by surface_id instead of biome/layer |
| Modify | `scripts/core/world_compiler/layered_chunk_renderer.gd` | Use HypergraphTileResolver instead of flat biome lookup |
| Modify | `scripts/core/world_compiler/layers/biome_layer.gd` | Add MYSTIC=17 to enum |

---

### Task 1: Add MYSTIC to BiomeLayer Enum

The BiomeLayer enum has 17 values (OCEAN=0 through RIVER=16) but the terrain system uses 18 biomes — MYSTIC is missing. The C++ compiler and renderer both reference biome_id 17 but the enum doesn't define it.

**Files:**
- Modify: `scripts/core/world_compiler/layers/biome_layer.gd`

- [ ] **Step 1: Add MYSTIC to the enum**

In `scripts/core/world_compiler/layers/biome_layer.gd`, add `MYSTIC = 17` after the RIVER entry in the `Biome` enum. The enum currently ends at `RIVER`. Add:

```gdscript
MYSTIC = 17
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/world_compiler/layers/biome_layer.gd
git commit -m "fix: add MYSTIC=17 to BiomeLayer enum"
```

---

### Task 2: Reorganize Terrain Assets into terrain_v3 Structure

Copy L1 base tilesets from `terrain_v2/{biome}/L1_base/` into `terrain_v3/surfaces/{surface_id}/` and existing transitions into `terrain_v3/transitions/{lower}__{upper}/`. This is a file copy — the originals stay in terrain_v2.

The mapping from biome L1 directories to surface IDs (from spec):

| Source biome L1 | Surface ID |
|----------------|------------|
| ocean | ocean_water |
| beach | golden_sand |
| grassland | lush_grass |
| steppe | dry_grass |
| forest | forest_floor |
| dense_forest | dark_humus |
| swamp | swamp_mud |
| mountains | grey_rock |
| volcanic | volcanic_rock |
| tundra | frozen_earth |
| arctic | glacial_ice |
| mystic | mystic_crystal |

Note: `snow` has no dedicated L1 source — use mountains L1 as placeholder (will need PixelLab generation later). `desert` maps to `golden_sand` (same as beach). `savanna`, `taiga`, `tropical_forest`, `lake`, `river` don't produce unique surfaces — they reuse surfaces already covered.

Existing transition mapping:

| Source path | Target path |
|------------|------------|
| ocean/transitions/ocean_to_beach | transitions/ocean_water__golden_sand |
| beach/transitions/beach_to_grassland | transitions/golden_sand__lush_grass |
| grassland/transitions/grassland_to_forest | transitions/lush_grass__forest_floor |
| grassland/transitions/grassland_to_steppe | transitions/lush_grass__dry_grass |
| forest/transitions/forest_to_dense_forest | transitions/forest_floor__dark_humus |
| desert/transitions/desert_to_savanna | transitions/golden_sand__dry_grass |
| steppe/transitions/steppe_to_mountains | transitions/dry_grass__grey_rock |
| tundra/transitions/tundra_to_taiga | transitions/frozen_earth__forest_floor |

Note: `grassland_to_desert` duplicates `golden_sand__lush_grass` (already covered by beach_to_grassland). `mountains_to_arctic` maps to `grey_rock__glacial_ice`. `savanna_to_tropical_forest` maps to `dry_grass__forest_floor`.

**Files:**
- Create: `tools/reorganize_terrain_assets.py`
- Create: `assets/catalog/terrain_v3/` directory tree

- [ ] **Step 1: Write the reorganization script**

Create `tools/reorganize_terrain_assets.py`:

```python
#!/usr/bin/env python3
"""Copy terrain_v2 L1 tilesets into terrain_v3 surface-based structure."""

import shutil
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
V2 = REPO / "assets" / "catalog" / "terrain_v2"
V3 = REPO / "assets" / "catalog" / "terrain_v3"

# biome L1 directory -> surface_id
SURFACE_MAP = {
    "ocean":        "ocean_water",
    "beach":        "golden_sand",
    "grassland":    "lush_grass",
    "steppe":       "dry_grass",
    "forest":       "forest_floor",
    "dense_forest": "dark_humus",
    "swamp":        "swamp_mud",
    "mountains":    "grey_rock",
    "volcanic":     "volcanic_rock",
    "tundra":       "frozen_earth",
    "arctic":       "glacial_ice",
    "mystic":       "mystic_crystal",
}

# For snow, use mountains L1 as placeholder (visually close enough to iterate)
SNOW_SOURCE = "mountains"

# source_path (relative to V2) -> target dirname under transitions/
TRANSITION_MAP = {
    "ocean/transitions/ocean_to_beach":              "ocean_water__golden_sand",
    "beach/transitions/beach_to_grassland":          "golden_sand__lush_grass",
    "grassland/transitions/grassland_to_forest":     "lush_grass__forest_floor",
    "grassland/transitions/grassland_to_steppe":     "lush_grass__dry_grass",
    "forest/transitions/forest_to_dense_forest":     "forest_floor__dark_humus",
    "desert/transitions/desert_to_savanna":          "golden_sand__dry_grass",
    "steppe/transitions/steppe_to_mountains":        "dry_grass__grey_rock",
    "tundra/transitions/tundra_to_taiga":            "frozen_earth__forest_floor",
    "mountains/transitions/mountains_to_arctic":     "grey_rock__glacial_ice",
    "savanna/transitions/savanna_to_tropical_forest": "dry_grass__forest_floor",
}


def copy_wang_tiles(src_dir: Path, dst_dir: Path) -> int:
    """Copy wang_*.png files. Returns count."""
    dst_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    for i in range(16):
        src = src_dir / f"wang_{i}.png"
        if src.exists():
            shutil.copy2(src, dst_dir / f"wang_{i}.png")
            count += 1
    # Copy tileset.png if present
    tileset = src_dir / "tileset.png"
    if tileset.exists():
        shutil.copy2(tileset, dst_dir / "tileset.png")
    return count


def main():
    # Clean slate
    if V3.exists():
        shutil.rmtree(V3)

    surfaces_dir = V3 / "surfaces"
    transitions_dir = V3 / "transitions"
    total = 0

    # Copy surface self-tilesets
    for biome, surface_id in SURFACE_MAP.items():
        src = V2 / biome / "L1_base"
        if not src.exists():
            print(f"  SKIP {biome}/L1_base — not found")
            continue
        dst = surfaces_dir / surface_id
        n = copy_wang_tiles(src, dst)
        print(f"  {surface_id}: {n} tiles from {biome}/L1_base")
        total += n

    # Snow placeholder from mountains
    src = V2 / SNOW_SOURCE / "L1_base"
    dst = surfaces_dir / "snow"
    n = copy_wang_tiles(src, dst)
    print(f"  snow: {n} tiles from {SNOW_SOURCE}/L1_base (PLACEHOLDER)")
    total += n

    # Copy transitions
    for rel_path, target_name in TRANSITION_MAP.items():
        src = V2 / rel_path
        if not src.exists():
            print(f"  SKIP transition {rel_path} — not found")
            continue
        dst = transitions_dir / target_name
        # Avoid overwriting if already copied (e.g., duplicate mappings)
        if dst.exists():
            print(f"  SKIP transition {target_name} — already exists")
            continue
        n = copy_wang_tiles(src, dst)
        print(f"  transition {target_name}: {n} tiles")
        total += n

    print(f"\nTotal: {total} tiles in terrain_v3/")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the script**

```bash
python tools/reorganize_terrain_assets.py
```

Expected output: ~13 surfaces (208 tiles) + ~9 transitions (144 tiles) = ~352 tiles. Some transitions may be skipped as duplicates.

- [ ] **Step 3: Verify the structure**

```bash
ls assets/catalog/terrain_v3/surfaces/
ls assets/catalog/terrain_v3/transitions/
```

Expected: 13 surface directories, 8-10 transition directories, each with `wang_0.png` through `wang_15.png`.

- [ ] **Step 4: Commit**

```bash
git add tools/reorganize_terrain_assets.py assets/catalog/terrain_v3/
git commit -m "feat: reorganize terrain assets into terrain_v3 surface-based structure"
```

---

### Task 3: Create gradients.json

The static data file that defines all 18 biome elevation gradients. This is the single source of truth — `ElevationGradientTable` will load this at runtime.

**Files:**
- Create: `assets/catalog/terrain_v3/gradients.json`

- [ ] **Step 1: Write gradients.json**

Create `assets/catalog/terrain_v3/gradients.json` with all 18 biome gradients from the spec. Each gradient is an array of `[max_elevation, surface_id]` pairs, ordered by ascending elevation:

```json
{
  "version": "1.0",
  "surfaces": [
    "ocean_water", "golden_sand", "lush_grass", "dry_grass",
    "forest_floor", "dark_humus", "swamp_mud", "grey_rock",
    "volcanic_rock", "frozen_earth", "glacial_ice", "snow",
    "mystic_crystal"
  ],
  "gradients": {
    "grassland": [
      [0.38, "ocean_water"],
      [0.42, "golden_sand"],
      [0.55, "lush_grass"],
      [0.70, "dry_grass"],
      [0.82, "grey_rock"],
      [1.00, "snow"]
    ],
    "desert": [
      [0.38, "ocean_water"],
      [0.42, "golden_sand"],
      [0.60, "golden_sand"],
      [0.75, "dry_grass"],
      [0.85, "grey_rock"],
      [1.00, "snow"]
    ],
    "forest": [
      [0.38, "ocean_water"],
      [0.42, "golden_sand"],
      [0.48, "lush_grass"],
      [0.65, "forest_floor"],
      [0.80, "grey_rock"],
      [1.00, "snow"]
    ],
    "dense_forest": [
      [0.38, "ocean_water"],
      [0.42, "golden_sand"],
      [0.46, "lush_grass"],
      [0.55, "forest_floor"],
      [0.70, "dark_humus"],
      [0.82, "grey_rock"],
      [1.00, "snow"]
    ],
    "tundra": [
      [0.38, "ocean_water"],
      [0.42, "frozen_earth"],
      [0.65, "frozen_earth"],
      [0.80, "snow"],
      [1.00, "glacial_ice"]
    ],
    "arctic": [
      [0.38, "ocean_water"],
      [0.42, "frozen_earth"],
      [0.55, "snow"],
      [0.75, "glacial_ice"],
      [1.00, "glacial_ice"]
    ],
    "taiga": [
      [0.38, "ocean_water"],
      [0.42, "frozen_earth"],
      [0.50, "forest_floor"],
      [0.70, "frozen_earth"],
      [0.85, "snow"],
      [1.00, "glacial_ice"]
    ],
    "mountains": [
      [0.38, "ocean_water"],
      [0.42, "golden_sand"],
      [0.50, "dry_grass"],
      [0.65, "grey_rock"],
      [0.85, "snow"],
      [1.00, "glacial_ice"]
    ],
    "steppe": [
      [0.38, "ocean_water"],
      [0.42, "golden_sand"],
      [0.55, "dry_grass"],
      [0.72, "grey_rock"],
      [0.88, "snow"],
      [1.00, "snow"]
    ],
    "savanna": [
      [0.38, "ocean_water"],
      [0.42, "golden_sand"],
      [0.55, "dry_grass"],
      [0.70, "golden_sand"],
      [0.82, "grey_rock"],
      [1.00, "snow"]
    ],
    "tropical_forest": [
      [0.38, "ocean_water"],
      [0.42, "golden_sand"],
      [0.48, "lush_grass"],
      [0.60, "forest_floor"],
      [0.72, "dark_humus"],
      [0.85, "grey_rock"],
      [1.00, "snow"]
    ],
    "swamp": [
      [0.38, "ocean_water"],
      [0.42, "swamp_mud"],
      [0.55, "swamp_mud"],
      [0.65, "forest_floor"],
      [0.80, "grey_rock"],
      [1.00, "snow"]
    ],
    "volcanic": [
      [0.38, "ocean_water"],
      [0.42, "golden_sand"],
      [0.55, "volcanic_rock"],
      [0.75, "grey_rock"],
      [0.88, "snow"],
      [1.00, "snow"]
    ],
    "mystic": [
      [0.38, "ocean_water"],
      [0.42, "mystic_crystal"],
      [0.60, "mystic_crystal"],
      [0.75, "grey_rock"],
      [0.90, "snow"],
      [1.00, "glacial_ice"]
    ],
    "ocean": [
      [1.00, "ocean_water"]
    ],
    "beach": [
      [0.38, "ocean_water"],
      [0.44, "golden_sand"],
      [1.00, "golden_sand"]
    ],
    "lake": [
      [1.00, "ocean_water"]
    ],
    "river": [
      [1.00, "ocean_water"]
    ]
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add assets/catalog/terrain_v3/gradients.json
git commit -m "feat: add gradients.json — 18 biome elevation gradient definitions"
```

---

### Task 4: Implement ElevationGradientTable

Pure data class that loads `gradients.json` and provides lookups: given a biome name and an elevation value, return the surface_id.

**Files:**
- Create: `scripts/core/world_compiler/elevation_gradient_table.gd`

- [ ] **Step 1: Write ElevationGradientTable**

Create `scripts/core/world_compiler/elevation_gradient_table.gd`:

```gdscript
class_name ElevationGradientTable

## Static data: biome elevation gradients and surface metadata.
## Loaded once from gradients.json. Given (biome, elevation) -> surface_id.

const GRADIENTS_PATH = "res://assets/catalog/terrain_v3/gradients.json"
const SURFACES_DIR = "res://assets/catalog/terrain_v3/surfaces"
const TRANSITIONS_DIR = "res://assets/catalog/terrain_v3/transitions"

# biome_name -> Array of [max_elevation: float, surface_id: String]
static var _gradients: Dictionary = {}
# Set of surface_id strings that have a directory in surfaces/
static var _available_surfaces: Dictionary = {}
# Set of "lower__upper" keys that have a directory in transitions/
static var _available_transitions: Dictionary = {}
static var _loaded: bool = false

# Biome ID -> biome name (matches BiomeLayer enum order + MYSTIC)
const BIOME_NAMES: Array[String] = [
	"ocean", "beach", "grassland", "forest", "dense_forest", "desert",
	"savanna", "steppe", "tundra", "taiga", "mountains", "swamp",
	"tropical_forest", "volcanic", "arctic", "lake", "river", "mystic"
]


static func load() -> void:
	if _loaded:
		return
	_gradients.clear()
	_available_surfaces.clear()
	_available_transitions.clear()

	# Load gradient definitions
	if not FileAccess.file_exists(GRADIENTS_PATH):
		push_error("[ElevationGradientTable] Missing %s" % GRADIENTS_PATH)
		return

	var f = FileAccess.open(GRADIENTS_PATH, FileAccess.READ)
	var data = JSON.parse_string(f.get_as_text())
	f.close()
	if data == null or not data.has("gradients"):
		push_error("[ElevationGradientTable] Failed to parse gradients.json")
		return

	var grads = data["gradients"]
	for biome_name in grads:
		var entries = grads[biome_name]
		var parsed: Array = []
		for entry in entries:
			parsed.append([float(entry[0]), String(entry[1])])
		_gradients[biome_name] = parsed

	# Scan surfaces/ directory for available tilesets
	var surfaces_da = DirAccess.open(SURFACES_DIR)
	if surfaces_da != null:
		surfaces_da.list_dir_begin()
		var dir_name = surfaces_da.get_next()
		while dir_name != "":
			if surfaces_da.current_is_dir():
				_available_surfaces[dir_name] = true
			dir_name = surfaces_da.get_next()

	# Scan transitions/ directory
	var trans_da = DirAccess.open(TRANSITIONS_DIR)
	if trans_da != null:
		trans_da.list_dir_begin()
		var dir_name = trans_da.get_next()
		while dir_name != "":
			if trans_da.current_is_dir():
				_available_transitions[dir_name] = true
			dir_name = trans_da.get_next()

	_loaded = true
	print("[ElevationGradientTable] Loaded %d biome gradients, %d surfaces, %d transitions" % [
		_gradients.size(), _available_surfaces.size(), _available_transitions.size()
	])


static func biome_name_from_id(biome_id: int) -> String:
	if biome_id < 0 or biome_id >= BIOME_NAMES.size():
		return "grassland"
	return BIOME_NAMES[biome_id]


static func surface_at(biome_name: String, elevation: float) -> String:
	## Return the surface_id for a given biome and elevation.
	var grad = _gradients.get(biome_name, null)
	if grad == null:
		return "lush_grass"
	for entry in grad:
		if elevation <= entry[0]:
			return entry[1]
	# Above all thresholds — return last surface
	return grad[grad.size() - 1][1]


static func has_surface(surface_id: String) -> bool:
	return _available_surfaces.has(surface_id)


static func has_transition(lower: String, upper: String) -> bool:
	return _available_transitions.has(lower + "__" + upper)


static func transition_key(lower: String, upper: String) -> String:
	return lower + "__" + upper
```

- [ ] **Step 2: Verify it loads in Godot**

Run the game (F6). Check the output log for:
```
[ElevationGradientTable] Loaded 18 biome gradients, 13 surfaces, N transitions
```

If you see errors about missing files, verify `assets/catalog/terrain_v3/` was created by Task 2.

- [ ] **Step 3: Commit**

```bash
git add scripts/core/world_compiler/elevation_gradient_table.gd
git commit -m "feat: ElevationGradientTable — biome gradient definitions + surface lookup"
```

---

### Task 5: Implement HypergraphTileResolver

The core logic: given a tile's biome and 4 corner elevations, determine which surface(s) appear and compute the Wang index.

**Files:**
- Create: `scripts/core/world_compiler/hypergraph_tile_resolver.gd`

- [ ] **Step 1: Write HypergraphTileResolver**

Create `scripts/core/world_compiler/hypergraph_tile_resolver.gd`:

```gdscript
class_name HypergraphTileResolver

## Given (biome, 4 corner elevations), returns the tileset key and Wang index.
## Stateless — all inputs passed in, no side effects.

## Result struct returned by resolve()
## tileset_type: "surface" or "transition"
## tileset_key: surface_id (e.g. "lush_grass") or "lower__upper" (e.g. "lush_grass__dry_grass")
## wang_index: 0-15
## surface_a: the lower surface (or the only surface for self-tiles)
## surface_b: the upper surface (same as surface_a for self-tiles)


static func resolve(biome_name: String, elev_tl: float, elev_tr: float, elev_bl: float, elev_br: float, world_seed: int, wx: int, wy: int) -> Dictionary:
	## Main entry point. Returns {tileset_type, tileset_key, wang_index, surface_a, surface_b}.

	# Map each corner elevation to a surface via the biome gradient
	var s_tl = ElevationGradientTable.surface_at(biome_name, elev_tl)
	var s_tr = ElevationGradientTable.surface_at(biome_name, elev_tr)
	var s_bl = ElevationGradientTable.surface_at(biome_name, elev_bl)
	var s_br = ElevationGradientTable.surface_at(biome_name, elev_br)

	# Collect unique surfaces
	var corners = [s_tl, s_tr, s_bl, s_br]
	var unique = _unique_surfaces(corners)

	if unique.size() == 1:
		# All corners same surface — self-tile with spatial variety
		var surface = unique[0]
		var wang = _spatial_wang(wx, wy, world_seed)
		return {
			"tileset_type": "surface",
			"tileset_key": surface,
			"wang_index": wang,
			"surface_a": surface,
			"surface_b": surface,
		}

	# 2+ surfaces — find the dominant pair
	var pair = _dominant_pair(corners, unique)
	var lower = pair[0]
	var upper = pair[1]

	# Compute Wang index: bit per corner, 0=lower, 1=upper
	var wang = 0
	if s_tl == upper:
		wang |= 1
	if s_tr == upper:
		wang |= 2
	if s_bl == upper:
		wang |= 4
	if s_br == upper:
		wang |= 8

	# Check if transition tileset exists
	var trans_key = ElevationGradientTable.transition_key(lower, upper)
	if ElevationGradientTable.has_transition(lower, upper):
		return {
			"tileset_type": "transition",
			"tileset_key": trans_key,
			"wang_index": wang,
			"surface_a": lower,
			"surface_b": upper,
		}

	# No transition tileset — fall back to the more common surface as self-tile
	var count_lower = corners.count(lower)
	var fallback = lower if count_lower >= 2 else upper
	return {
		"tileset_type": "surface",
		"tileset_key": fallback,
		"wang_index": _spatial_wang(wx, wy, world_seed),
		"surface_a": fallback,
		"surface_b": fallback,
	}


static func _unique_surfaces(corners: Array) -> Array:
	var seen: Dictionary = {}
	var result: Array = []
	for s in corners:
		if not seen.has(s):
			seen[s] = true
			result.append(s)
	return result


static func _dominant_pair(corners: Array, unique: Array) -> Array:
	## Given corners with 2+ surfaces, return [lower, upper] as the most common pair.
	## "Lower" and "upper" are determined by which appears first/last in the gradient
	## (lower elevation surface = lower). For simplicity, count occurrences and pick
	## the two most common. If tied, keep both.

	if unique.size() == 2:
		# Easy case — exactly 2 surfaces
		# Determine order: the one that appears at lower elevation is "lower"
		# We use gradient order via a simple heuristic: the surface with more TL/TR
		# corners tends to be the upper one (since TL/TR bits are lower in wang index)
		# But actually we need gradient order. Use the surface_at progression.
		# Simpler: count which has more corners as bit-0 (lower variant).
		var a = unique[0]
		var b = unique[1]
		# The surface that has corner at lowest elevation is "lower"
		# We can check: whichever surface corresponds to lower elevation values
		# is the lower surface. But we don't have the raw elevations here.
		# Convention: maintain the order they appear in the biome's gradient.
		# For now, use alphabetical order as a stable sort (since we'll iterate
		# gradients in ElevationGradientTable for proper ordering later if needed).
		if a < b:
			return [a, b]
		else:
			return [b, a]

	# 3+ surfaces — find the two most common
	var counts: Dictionary = {}
	for s in corners:
		counts[s] = counts.get(s, 0) + 1

	# Sort by count descending
	var sorted_surfaces = unique.duplicate()
	sorted_surfaces.sort_custom(func(a, b): return counts[a] > counts[b])

	var a = sorted_surfaces[0]
	var b = sorted_surfaces[1]
	if a < b:
		return [a, b]
	else:
		return [b, a]


static func _spatial_wang(wx: int, wy: int, seed: int) -> int:
	## Deterministic spatial hash for self-tile variety. Returns 0-15.
	## Creates organic patches of ~40% variant coverage.
	var idx = 0
	if _corner_hash(wx, wy, seed):
		idx |= 1
	if _corner_hash(wx + 1, wy, seed):
		idx |= 2
	if _corner_hash(wx, wy + 1, seed):
		idx |= 4
	if _corner_hash(wx + 1, wy + 1, seed):
		idx |= 8
	return idx


static func _corner_hash(cx: int, cy: int, seed: int) -> bool:
	var h = ((cx * 73856093) ^ (cy * 19349663) ^ (seed * 83492791)) & 0x7FFFFFFF
	return (h % 5) < 2
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/world_compiler/hypergraph_tile_resolver.gd
git commit -m "feat: HypergraphTileResolver — elevation-driven surface + Wang index computation"
```

---

### Task 6: Rewrite LayeredTilesetLoader for Surface-Based Loading

Replace biome/layer directory structure with surface-based: `surfaces/{surface_id}/wang_*.png` and `transitions/{lower}__{upper}/wang_*.png`.

**Files:**
- Modify: `scripts/core/world_compiler/layered_tileset_loader.gd`

- [ ] **Step 1: Rewrite LayeredTilesetLoader**

Replace the entire contents of `scripts/core/world_compiler/layered_tileset_loader.gd` with:

```gdscript
class_name LayeredTilesetLoader

## Loads terrain tilesets from assets/catalog/terrain_v3/.
## Surfaces: surfaces/{surface_id}/wang_0..15.png
## Transitions: transitions/{lower}__{upper}/wang_0..15.png

const SURFACES_DIR = "res://assets/catalog/terrain_v3/surfaces"
const TRANSITIONS_DIR = "res://assets/catalog/terrain_v3/transitions"

# key -> wang_idx -> Image
# key is either a surface_id ("lush_grass") or transition key ("lush_grass__dry_grass")
static var _cache: Dictionary = {}
static var _loaded: bool = false


static func load_all() -> void:
	if _loaded:
		return
	_cache.clear()

	# Load ElevationGradientTable first (it scans the directories)
	ElevationGradientTable.load()

	var total = 0

	# Load surface self-tilesets
	var surfaces_da = DirAccess.open(SURFACES_DIR)
	if surfaces_da != null:
		surfaces_da.list_dir_begin()
		var dir_name = surfaces_da.get_next()
		while dir_name != "":
			if surfaces_da.current_is_dir():
				var n = _load_wang_set(SURFACES_DIR + "/" + dir_name, dir_name)
				total += n
			dir_name = surfaces_da.get_next()

	# Load transition tilesets
	var trans_da = DirAccess.open(TRANSITIONS_DIR)
	if trans_da != null:
		trans_da.list_dir_begin()
		var dir_name = trans_da.get_next()
		while dir_name != "":
			if trans_da.current_is_dir():
				var n = _load_wang_set(TRANSITIONS_DIR + "/" + dir_name, dir_name)
				total += n
			dir_name = trans_da.get_next()

	_loaded = true
	print("[LayeredTilesetLoader] Loaded %d tiles (%d tilesets)" % [total, _cache.size()])


static func _load_wang_set(dir_path: String, cache_key: String) -> int:
	var tiles: Dictionary = {}
	for wang_idx in range(16):
		var img_path = "%s/wang_%d.png" % [dir_path, wang_idx]
		if FileAccess.file_exists(img_path):
			var tex = load(img_path) as Texture2D
			if tex != null:
				var img = tex.get_image()
				if img.get_format() != Image.FORMAT_RGBA8:
					img.convert(Image.FORMAT_RGBA8)
				tiles[wang_idx] = img
	if tiles.size() > 0:
		_cache[cache_key] = tiles
	return tiles.size()


static func get_tile(tileset_key: String, wang_idx: int) -> Image:
	## Get a wang tile by tileset key (surface_id or transition key) and index.
	var tileset = _cache.get(tileset_key, null)
	if tileset == null:
		return null
	return tileset.get(wang_idx, null)


static func has_tileset(tileset_key: String) -> bool:
	return _cache.has(tileset_key)
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/world_compiler/layered_tileset_loader.gd
git commit -m "feat: rewrite LayeredTilesetLoader for surface-based terrain_v3 loading"
```

---

### Task 7: Rewrite LayeredChunkRenderer to Use HypergraphTileResolver

Replace the flat biome lookup with elevation-driven resolution. The renderer samples corner elevations, calls the resolver, and blits the resulting tile.

**Files:**
- Modify: `scripts/core/world_compiler/layered_chunk_renderer.gd`

- [ ] **Step 1: Rewrite LayeredChunkRenderer**

Replace the entire contents of `scripts/core/world_compiler/layered_chunk_renderer.gd` with:

```gdscript
class_name LayeredChunkRenderer

## Renders a chunk using elevation-driven surface gradients (hypergraph model).
## Each tile's 4 corner elevations determine which surface(s) appear and the Wang index.

var _parent: Node2D
var _tile_size: int = 32
# chunk_key (Vector2i) -> Sprite2D
var _chunk_sprites: Dictionary = {}
# Reference to chunk_streamer for cross-chunk elevation sampling
var _chunk_streamer = null


func setup(parent: Node2D, tile_size: int = 32, chunk_streamer = null) -> void:
	_parent = parent
	_tile_size = tile_size
	_chunk_streamer = chunk_streamer
	LayeredTilesetLoader.load_all()


func render_chunk_layers(chunk: ChunkData) -> void:
	var key = Vector2i(chunk.chunk_x, chunk.chunk_y)
	clear_chunk(chunk.chunk_x, chunk.chunk_y)

	var size = ChunkData.SIZE
	var px_size = size * _tile_size
	var origin_x = chunk.chunk_x * px_size
	var origin_y = chunk.chunk_y * px_size

	var img = Image.create(px_size, px_size, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 1))
	var has_any = false

	for y in range(size):
		for x in range(size):
			var idx = y * size + x
			var biome_id = chunk.biome_id[idx]
			var biome_name = ElevationGradientTable.biome_name_from_id(biome_id)

			# Sample elevation at 4 corners
			var elev_tl = _sample_elevation(chunk, x, y)
			var elev_tr = _sample_elevation(chunk, x + 1, y)
			var elev_bl = _sample_elevation(chunk, x, y + 1)
			var elev_br = _sample_elevation(chunk, x + 1, y + 1)

			# World coordinates for spatial hashing
			var wx = chunk.chunk_x * size + x
			var wy = chunk.chunk_y * size + y

			# Resolve surface + wang index
			var result = HypergraphTileResolver.resolve(
				biome_name, elev_tl, elev_tr, elev_bl, elev_br,
				chunk.world_seed, wx, wy
			)

			var tile_img = LayeredTilesetLoader.get_tile(
				result["tileset_key"], result["wang_index"]
			)
			if tile_img == null:
				# Fallback: try surface_a as self-tile with index 0
				tile_img = LayeredTilesetLoader.get_tile(result["surface_a"], 0)
			if tile_img == null:
				continue

			has_any = true
			var dest = Vector2i(x * _tile_size, y * _tile_size)
			img.blit_rect(tile_img, Rect2i(0, 0, _tile_size, _tile_size), dest)

	if not has_any:
		return

	var tex = ImageTexture.create_from_image(img)
	var sprite = Sprite2D.new()
	sprite.texture = tex
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	sprite.centered = false
	sprite.position = Vector2(origin_x, origin_y)
	sprite.z_index = -1
	_parent.add_child(sprite)
	_chunk_sprites[key] = sprite


func _sample_elevation(chunk: ChunkData, x: int, y: int) -> float:
	## Sample elevation at corner position (x, y).
	## Corners can be at the chunk boundary (x=SIZE or y=SIZE),
	## in which case we need to read from the adjacent chunk.
	var size = ChunkData.SIZE

	if x >= 0 and x < size and y >= 0 and y < size:
		return chunk.elevation[y * size + x]

	# Corner is outside this chunk — try adjacent chunk
	if _chunk_streamer == null:
		# No streamer available — clamp to edge
		var cx = clampi(x, 0, size - 1)
		var cy = clampi(y, 0, size - 1)
		return chunk.elevation[cy * size + cx]

	var adj_cx = chunk.chunk_x
	var adj_cy = chunk.chunk_y
	var local_x = x
	var local_y = y

	if x >= size:
		adj_cx += 1
		local_x = 0
	elif x < 0:
		adj_cx -= 1
		local_x = size - 1

	if y >= size:
		adj_cy += 1
		local_y = 0
	elif y < 0:
		adj_cy -= 1
		local_y = size - 1

	var adj_chunk = _chunk_streamer.get_chunk(adj_cx, adj_cy)
	if adj_chunk != null:
		return adj_chunk.elevation[local_y * size + local_x]

	# Adjacent chunk not loaded — clamp to this chunk's edge
	var cx = clampi(x, 0, size - 1)
	var cy = clampi(y, 0, size - 1)
	return chunk.elevation[cy * size + cx]


func clear_chunk(chunk_x: int, chunk_y: int) -> void:
	var key = Vector2i(chunk_x, chunk_y)
	if _chunk_sprites.has(key):
		var sprite = _chunk_sprites[key]
		if sprite != null and is_instance_valid(sprite):
			sprite.queue_free()
		_chunk_sprites.erase(key)


func clear_all() -> void:
	for key in _chunk_sprites:
		var sprite = _chunk_sprites[key]
		if sprite != null and is_instance_valid(sprite):
			sprite.queue_free()
	_chunk_sprites.clear()
```

Note the changes from the old version:
- Single sprite per chunk (not array of layer sprites) — we only produce one terrain image now
- `_chunk_sprites` stores `Sprite2D` instead of `Array[Sprite2D]`
- `setup()` takes optional `chunk_streamer` for cross-chunk elevation sampling
- `_build_layer_image` replaced by inline loop in `render_chunk_layers`
- `_compute_wang_index` and `_corner_variant` removed — resolver handles this
- `BIOME_NAMES` and `LAYER_NAMES` constants removed — `ElevationGradientTable` owns these

- [ ] **Step 2: Commit**

```bash
git add scripts/core/world_compiler/layered_chunk_renderer.gd
git commit -m "feat: rewrite LayeredChunkRenderer to use HypergraphTileResolver"
```

---

### Task 8: Wire Up CleanWorld.gd

Update `CleanWorld.gd` to pass `_chunk_streamer` to the layered renderer's `setup()` call so it can do cross-chunk elevation sampling.

**Files:**
- Modify: `scripts/CleanWorld.gd`

- [ ] **Step 1: Find and update the setup call**

In `scripts/CleanWorld.gd`, find where `_layered_renderer.setup()` is called. It currently looks like:

```gdscript
_layered_renderer.setup(self, 32)
```

Change it to:

```gdscript
_layered_renderer.setup(self, 32, _chunk_streamer)
```

This passes the chunk streamer reference so the renderer can sample elevation from adjacent chunks at tile boundaries.

- [ ] **Step 2: Run the game (F6) and verify**

Check the Godot output log for:
1. `[ElevationGradientTable] Loaded 18 biome gradients, 13 surfaces, N transitions`
2. `[LayeredTilesetLoader] Loaded N tiles (N tilesets)`
3. No errors about missing files or null references

The terrain should now show elevation-driven surfaces: shorelines transition to sand, then grass, then rock at higher elevations, with Wang transitions where available.

- [ ] **Step 3: Commit**

```bash
git add scripts/CleanWorld.gd
git commit -m "feat: wire chunk_streamer into LayeredChunkRenderer for cross-chunk elevation"
```

---

### Task 9: Fix Transition Pair Ordering

The `_dominant_pair` function in `HypergraphTileResolver` uses alphabetical ordering to determine which surface is "lower" vs "upper." This is wrong — it should use gradient order (the surface that appears at lower elevation in the biome's gradient is the "lower" one). Without this, transition tileset lookups will fail for pairs where alphabetical order doesn't match gradient order.

**Files:**
- Modify: `scripts/core/world_compiler/elevation_gradient_table.gd`
- Modify: `scripts/core/world_compiler/hypergraph_tile_resolver.gd`

- [ ] **Step 1: Add gradient_rank to ElevationGradientTable**

Add a static function to `scripts/core/world_compiler/elevation_gradient_table.gd` that returns the position of a surface in a biome's gradient (lower number = appears at lower elevation):

```gdscript
static func gradient_rank(biome_name: String, surface_id: String) -> int:
	## Return the index of surface_id in the biome's gradient.
	## Lower rank = appears at lower elevation. Returns 999 if not found.
	var grad = _gradients.get(biome_name, null)
	if grad == null:
		return 999
	for i in range(grad.size()):
		if grad[i][1] == surface_id:
			return i
	return 999
```

- [ ] **Step 2: Update _dominant_pair in HypergraphTileResolver**

Replace the `_dominant_pair` function in `scripts/core/world_compiler/hypergraph_tile_resolver.gd` with:

```gdscript
static func _dominant_pair(corners: Array, unique: Array, biome_name: String) -> Array:
	## Given corners with 2+ surfaces, return [lower, upper] ordered by gradient position.
	## "Lower" = appears at lower elevation in the biome's gradient.

	var pair: Array
	if unique.size() == 2:
		pair = [unique[0], unique[1]]
	else:
		# 3+ surfaces — find the two most common
		var counts: Dictionary = {}
		for s in corners:
			counts[s] = counts.get(s, 0) + 1
		var sorted_surfaces = unique.duplicate()
		sorted_surfaces.sort_custom(func(a, b): return counts[a] > counts[b])
		pair = [sorted_surfaces[0], sorted_surfaces[1]]

	# Order by gradient rank (lower elevation = first)
	var rank_a = ElevationGradientTable.gradient_rank(biome_name, pair[0])
	var rank_b = ElevationGradientTable.gradient_rank(biome_name, pair[1])
	if rank_a <= rank_b:
		return [pair[0], pair[1]]
	else:
		return [pair[1], pair[0]]
```

Also update the `resolve()` function to pass `biome_name` to `_dominant_pair`. Change:

```gdscript
	var pair = _dominant_pair(corners, unique)
```

to:

```gdscript
	var pair = _dominant_pair(corners, unique, biome_name)
```

- [ ] **Step 3: Commit**

```bash
git add scripts/core/world_compiler/elevation_gradient_table.gd scripts/core/world_compiler/hypergraph_tile_resolver.gd
git commit -m "fix: order transition pairs by gradient rank, not alphabetical"
```

---

### Task 10: Visual QA and Debug Logging

Add temporary debug output to verify the hypergraph system is working. Then run the game and take a screenshot.

**Files:**
- Modify: `scripts/core/world_compiler/layered_chunk_renderer.gd` (temporary debug prints)

- [ ] **Step 1: Add debug stats to render_chunk_layers**

In `scripts/core/world_compiler/layered_chunk_renderer.gd`, add a debug counter after the tile loop. Insert this right after the `for y in range(size):` / `for x in range(size):` loop ends, before the `if not has_any:` check:

```gdscript
	# Debug: log first few chunks
	if _chunk_sprites.size() < 3:
		var self_count = 0
		var trans_count = 0
		var fallback_count = 0
		for dy in range(size):
			for dx in range(size):
				var didx = dy * size + dx
				var bid = chunk.biome_id[didx]
				var bn = ElevationGradientTable.biome_name_from_id(bid)
				var e_tl = _sample_elevation(chunk, dx, dy)
				var e_tr = _sample_elevation(chunk, dx + 1, dy)
				var e_bl = _sample_elevation(chunk, dx, dy + 1)
				var e_br = _sample_elevation(chunk, dx + 1, dy + 1)
				var r = HypergraphTileResolver.resolve(bn, e_tl, e_tr, e_bl, e_br, chunk.world_seed, chunk.chunk_x * size + dx, chunk.chunk_y * size + dy)
				if r["tileset_type"] == "surface":
					if r["surface_a"] == r["surface_b"]:
						self_count += 1
					else:
						fallback_count += 1
				else:
					trans_count += 1
		print("[Hypergraph] Chunk %d,%d: %d self, %d transition, %d fallback" % [chunk.chunk_x, chunk.chunk_y, self_count, trans_count, fallback_count])
```

- [ ] **Step 2: Run the game (F6) and screenshot**

Run CleanWorld.tscn. Verify:
1. Terrain renders without crashes
2. Debug log shows a mix of self-tiles, transitions, and fallbacks
3. Elevation boundaries show visible surface changes (sand at low areas, grass in middle, rock at peaks)
4. Take a screenshot via Godot MCP: `get_game_screenshot` or `get_editor_screenshot`

- [ ] **Step 3: Remove debug logging**

Remove the debug block added in Step 1 (keep only the `_chunk_sprites.size() < 3` print that was there before, or remove all debug prints).

- [ ] **Step 4: Commit**

```bash
git add scripts/core/world_compiler/layered_chunk_renderer.gd
git commit -m "feat: elevation hypergraph terrain — visual QA pass"
```

---

## Summary

| Task | Description | Files | Est. |
|------|------------|-------|------|
| 1 | Add MYSTIC to BiomeLayer enum | biome_layer.gd | 2 min |
| 2 | Reorganize assets into terrain_v3 | Python script + file copy | 5 min |
| 3 | Create gradients.json | JSON data file | 3 min |
| 4 | ElevationGradientTable | New GDScript class | 5 min |
| 5 | HypergraphTileResolver | New GDScript class | 5 min |
| 6 | Rewrite LayeredTilesetLoader | Modify existing | 3 min |
| 7 | Rewrite LayeredChunkRenderer | Modify existing | 5 min |
| 8 | Wire up CleanWorld.gd | One-line change | 2 min |
| 9 | Fix transition pair ordering | Add gradient_rank | 3 min |
| 10 | Visual QA | Debug + screenshot | 5 min |

**Not in this plan (deferred):**
- Generate ~14 missing transition tilesets via PixelLab (separate task after visual QA confirms the system works)
- Generate dedicated `snow` surface tileset (using mountains placeholder for now)
- Port to C++ (after all gradients visually approved)
