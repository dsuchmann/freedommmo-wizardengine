# L0: Grain Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the foundational grain data model that all world simulation and rendering builds upon.

**Architecture:** Grains are the atomic unit of matter. Each grain has a type (physical/magical/spiritual/technical), properties (hardness, flammability, purity, resonance), and environmental state. GrainStacks are depth-sorted lists of grains at a world position. GrainRegistry catalogs all grain templates. Everything in the game world - terrain, items, entities - is ultimately composed of grains.

**Tech Stack:** GDScript (Godot 4.4), JSON for grain template data, Python test runner

---

### Task 1: Grain Type Enums and Constants

**Files:**
- Create: `scripts/core/grain_types.gd`
- Test: `tests/test_grain_types.gd`

- [ ] **Step 1: Write the test**

```gdscript
extends SceneTree

func _init() -> void:
	var GrainTypes = preload("res://scripts/core/grain_types.gd")

	# Test grain categories exist
	_assert(GrainTypes.Category.PHYSICAL == 0, "PHYSICAL should be 0")
	_assert(GrainTypes.Category.MAGICAL == 1, "MAGICAL should be 1")
	_assert(GrainTypes.Category.SPIRITUAL == 2, "SPIRITUAL should be 2")
	_assert(GrainTypes.Category.TECHNICAL == 3, "TECHNICAL should be 3")

	# Test physical grain types exist
	_assert(GrainTypes.Physical.STONE != null, "STONE should exist")
	_assert(GrainTypes.Physical.SAND != null, "SAND should exist")
	_assert(GrainTypes.Physical.SOIL != null, "SOIL should exist")
	_assert(GrainTypes.Physical.WATER != null, "WATER should exist")
	_assert(GrainTypes.Physical.IRON != null, "IRON should exist")
	_assert(GrainTypes.Physical.WOOD != null, "WOOD should exist")
	_assert(GrainTypes.Physical.GRASS != null, "GRASS should exist")
	_assert(GrainTypes.Physical.BEDROCK != null, "BEDROCK should exist")

	print("All grain type tests passed.")
	quit()

func _assert(condition: bool, message: String) -> void:
	if not condition:
		push_error("ASSERTION FAILED: %s" % message)
		quit(1)
```

- [ ] **Step 2: Create grain_types.gd**

```gdscript
class_name GrainTypes
extends RefCounted

## Categories of grain matter
enum Category {
	PHYSICAL,
	MAGICAL,
	SPIRITUAL,
	TECHNICAL,
}

## Physical grain types - the building blocks of terrain and materials
enum Physical {
	BEDROCK,
	STONE,
	GRANITE,
	MARBLE,
	OBSIDIAN,
	IRON,
	COPPER,
	GOLD,
	SILVER,
	MITHRIL,
	ADAMANTINE,
	SAND,
	GRAVEL,
	CLAY,
	SOIL,
	MUD,
	PEAT,
	WATER,
	ICE,
	SNOW,
	LAVA,
	GLASS,
	CRYSTAL,
	WOOD,
	BARK,
	LEAF,
	GRASS,
	MOSS,
	VINE,
	FLOWER,
	MUSHROOM,
	BONE,
	HIDE,
	FLESH,
	CORAL,
	SHELL,
	ASH,
	CHARCOAL,
	COAL,
	OIL,
}

## Magical grain types
enum Magical {
	ARCANE_DUST,
	DIVINE_ESSENCE,
	SHADOW_MATTER,
	ELEMENTAL_FIRE,
	ELEMENTAL_WATER,
	ELEMENTAL_EARTH,
	ELEMENTAL_AIR,
	ETHER,
	VOID_FRAGMENT,
	MANA_CRYSTAL,
}

## Spiritual grain types
enum Spiritual {
	SOUL_FRAGMENT,
	ESSENCE,
	HARMONY,
	DISCORD,
	MEMORY,
	DREAM,
	FAITH,
	KARMA,
}

## Technical grain types
enum Technical {
	QUANTUM_PARTICLE,
	PLASMA,
	ANTIMATTER,
	NANITE,
	CIRCUIT,
	PHOTON,
	GRAVITON,
}
```

- [ ] **Step 3: Run test**

Run: `godot --headless --script tests/test_grain_types.gd` (or verify via Python test runner)

- [ ] **Step 4: Commit**

```bash
git add scripts/core/grain_types.gd tests/test_grain_types.gd
git commit -m "feat(L0): add grain type enums - physical, magical, spiritual, technical"
```

---

### Task 2: Grain Properties

**Files:**
- Create: `scripts/core/grain_properties.gd`
- Test: `tests/test_grain_properties.gd`

- [ ] **Step 1: Write the test**

```gdscript
extends SceneTree

func _init() -> void:
	var GrainProperties = preload("res://scripts/core/grain_properties.gd")

	# Test creating properties with defaults
	var props = GrainProperties.new()
	_assert(props.hardness == 0.5, "default hardness should be 0.5")
	_assert(props.flammability == 0.0, "default flammability should be 0.0")
	_assert(props.purity == 1.0, "default purity should be 1.0")

	# Test creating from dictionary
	var props2 = GrainProperties.from_dict({"hardness": 0.9, "flammability": 0.1, "density": 2.5})
	_assert(props2.hardness == 0.9, "hardness from dict should be 0.9")
	_assert(props2.flammability == 0.1, "flammability from dict")
	_assert(props2.density == 2.5, "density from dict")

	# Test to_dict roundtrip
	var d = props2.to_dict()
	var props3 = GrainProperties.from_dict(d)
	_assert(props3.hardness == props2.hardness, "roundtrip hardness")
	_assert(props3.density == props2.density, "roundtrip density")

	print("All grain properties tests passed.")
	quit()

func _assert(condition: bool, message: String) -> void:
	if not condition:
		push_error("ASSERTION FAILED: %s" % message)
		quit(1)
```

- [ ] **Step 2: Create grain_properties.gd**

```gdscript
class_name GrainProperties
extends RefCounted

## Material properties
var hardness: float = 0.5        ## 0.0 (powder) to 1.0 (diamond)
var density: float = 1.0         ## g/cm3, affects weight
var flammability: float = 0.0    ## 0.0 (fireproof) to 1.0 (explosive)
var conductivity: float = 0.0    ## thermal/electrical
var opacity: float = 1.0         ## 0.0 (transparent) to 1.0 (opaque)
var solubility: float = 0.0      ## dissolves in water
var elasticity: float = 0.0      ## bounces vs shatters

## Magical/spiritual properties
var purity: float = 1.0          ## 0.0 (corrupted) to 1.0 (pure)
var resonance: float = 0.0       ## -1.0 to 1.0, magical attunement
var stability: float = 1.0       ## 0.0 (volatile) to 1.0 (inert)
var energy_level: float = 0.0    ## stored energy

## Environmental state (mutable)
var temperature: float = 20.0    ## celsius
var pressure: float = 1.0        ## atmospheres
var moisture: float = 0.0        ## 0.0 (bone dry) to 1.0 (saturated)
var magical_charge: float = 0.0  ## ambient magical energy

## Depth in stack (set by GrainStack)
var depth: float = 0.0           ## 0.0 = surface, increases downward

static func from_dict(d: Dictionary) -> GrainProperties:
	var p := GrainProperties.new()
	for key in d:
		if key in ["hardness", "density", "flammability", "conductivity",
				"opacity", "solubility", "elasticity", "purity", "resonance",
				"stability", "energy_level", "temperature", "pressure",
				"moisture", "magical_charge", "depth"]:
			p.set(key, float(d[key]))
	return p

func to_dict() -> Dictionary:
	return {
		"hardness": hardness, "density": density, "flammability": flammability,
		"conductivity": conductivity, "opacity": opacity, "solubility": solubility,
		"elasticity": elasticity, "purity": purity, "resonance": resonance,
		"stability": stability, "energy_level": energy_level, "temperature": temperature,
		"pressure": pressure, "moisture": moisture, "magical_charge": magical_charge,
		"depth": depth,
	}
```

- [ ] **Step 3: Run test, commit**

```bash
git add scripts/core/grain_properties.gd tests/test_grain_properties.gd
git commit -m "feat(L0): add grain properties with material and magical attributes"
```

---

### Task 3: Grain Class

**Files:**
- Create: `scripts/core/grain.gd`
- Test: `tests/test_grain.gd`

- [ ] **Step 1: Write the test**

```gdscript
extends SceneTree

func _init() -> void:
	var Grain = preload("res://scripts/core/grain.gd")
	var GrainTypes = preload("res://scripts/core/grain_types.gd")

	# Test creating a grain
	var stone = Grain.new(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.STONE)
	_assert(stone.category == GrainTypes.Category.PHYSICAL, "category should be PHYSICAL")
	_assert(stone.grain_type == GrainTypes.Physical.STONE, "type should be STONE")
	_assert(stone.properties != null, "should have properties")
	_assert(stone.quantity == 1.0, "default quantity should be 1.0")

	# Test serialization roundtrip
	var d = stone.to_dict()
	_assert(d.has("category"), "dict should have category")
	_assert(d.has("grain_type"), "dict should have grain_type")
	_assert(d.has("properties"), "dict should have properties")

	var stone2 = Grain.from_dict(d)
	_assert(stone2.category == stone.category, "roundtrip category")
	_assert(stone2.grain_type == stone.grain_type, "roundtrip type")

	print("All grain tests passed.")
	quit()

func _assert(condition: bool, message: String) -> void:
	if not condition:
		push_error("ASSERTION FAILED: %s" % message)
		quit(1)
```

- [ ] **Step 2: Create grain.gd**

```gdscript
class_name Grain
extends RefCounted

var category: int = 0          ## GrainTypes.Category
var grain_type: int = 0        ## specific type within category
var properties: GrainProperties
var quantity: float = 1.0      ## amount of this grain (0.0 to 1.0)
var id: int = 0                ## unique instance ID

static var _next_id: int = 0

func _init(p_category: int = 0, p_type: int = 0) -> void:
	category = p_category
	grain_type = p_type
	properties = GrainProperties.new()
	_next_id += 1
	id = _next_id

func to_dict() -> Dictionary:
	return {
		"id": id,
		"category": category,
		"grain_type": grain_type,
		"quantity": quantity,
		"properties": properties.to_dict(),
	}

static func from_dict(d: Dictionary) -> Grain:
	var g := Grain.new(int(d.get("category", 0)), int(d.get("grain_type", 0)))
	g.id = int(d.get("id", 0))
	g.quantity = float(d.get("quantity", 1.0))
	if d.has("properties"):
		g.properties = GrainProperties.from_dict(d["properties"])
	return g
```

- [ ] **Step 3: Run test, commit**

```bash
git add scripts/core/grain.gd tests/test_grain.gd
git commit -m "feat(L0): add Grain class with category, type, properties, serialization"
```

---

### Task 4: GrainStack

**Files:**
- Create: `scripts/core/grain_stack.gd`
- Test: `tests/test_grain_stack.gd`

- [ ] **Step 1: Write the test**

```gdscript
extends SceneTree

func _init() -> void:
	var GrainStack = preload("res://scripts/core/grain_stack.gd")
	var Grain = preload("res://scripts/core/grain.gd")
	var GrainTypes = preload("res://scripts/core/grain_types.gd")

	# Test empty stack
	var stack = GrainStack.new()
	_assert(stack.size() == 0, "empty stack size should be 0")
	_assert(stack.top() == null, "empty stack top should be null")

	# Test push grains (surface first, bedrock last)
	var grass = Grain.new(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.GRASS)
	var soil = Grain.new(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.SOIL)
	var stone = Grain.new(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.STONE)
	var bedrock = Grain.new(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.BEDROCK)

	stack.push(bedrock)
	stack.push(stone)
	stack.push(soil)
	stack.push(grass)

	_assert(stack.size() == 4, "stack size should be 4")
	_assert(stack.top().grain_type == GrainTypes.Physical.GRASS, "top should be grass")
	_assert(stack.bottom().grain_type == GrainTypes.Physical.BEDROCK, "bottom should be bedrock")

	# Test removing top layer (digging)
	var removed = stack.pop_top()
	_assert(removed.grain_type == GrainTypes.Physical.GRASS, "removed should be grass")
	_assert(stack.top().grain_type == GrainTypes.Physical.SOIL, "new top should be soil")
	_assert(stack.size() == 3, "stack size should be 3 after pop")

	# Test depth calculation
	_assert(stack.top().properties.depth == 0.0, "top depth should be 0")

	# Test visible grains (considering opacity)
	var visible = stack.get_visible_grains()
	_assert(visible.size() > 0, "should have visible grains")

	# Test serialization roundtrip
	var d = stack.to_dict()
	var stack2 = GrainStack.from_dict(d)
	_assert(stack2.size() == stack.size(), "roundtrip size")
	_assert(stack2.top().grain_type == stack.top().grain_type, "roundtrip top type")

	print("All grain stack tests passed.")
	quit()

func _assert(condition: bool, message: String) -> void:
	if not condition:
		push_error("ASSERTION FAILED: %s" % message)
		quit(1)
```

- [ ] **Step 2: Create grain_stack.gd**

```gdscript
class_name GrainStack
extends RefCounted

## Depth-sorted list of grains at a world position
## Index 0 = top (surface), last index = bottom (deepest)
var layers: Array[Grain] = []

## World position this stack occupies
var world_x: int = 0
var world_y: int = 0
var cell_id: int = 0

func size() -> int:
	return layers.size()

func top() -> Grain:
	if layers.is_empty():
		return null
	return layers[0]

func bottom() -> Grain:
	if layers.is_empty():
		return null
	return layers[layers.size() - 1]

func push(grain: Grain) -> void:
	## Add grain to top of stack (surface)
	layers.insert(0, grain)
	_recalculate_depths()

func push_bottom(grain: Grain) -> void:
	## Add grain to bottom of stack (deepest)
	layers.append(grain)
	_recalculate_depths()

func pop_top() -> Grain:
	## Remove and return top grain (digging)
	if layers.is_empty():
		return null
	var removed := layers[0]
	layers.remove_at(0)
	_recalculate_depths()
	return removed

func get_at_depth(depth_index: int) -> Grain:
	if depth_index < 0 or depth_index >= layers.size():
		return null
	return layers[depth_index]

func get_visible_grains() -> Array[Grain]:
	## Returns grains visible from above (stops at first fully opaque grain)
	var visible: Array[Grain] = []
	var accumulated_opacity := 0.0
	for grain in layers:
		visible.append(grain)
		accumulated_opacity += grain.properties.opacity * grain.quantity
		if accumulated_opacity >= 1.0:
			break
	return visible

func get_total_hardness() -> float:
	## Surface hardness for interaction calculations
	if layers.is_empty():
		return 0.0
	return top().properties.hardness

func has_grain_type(category: int, grain_type: int) -> bool:
	for grain in layers:
		if grain.category == category and grain.grain_type == grain_type:
			return true
	return false

func _recalculate_depths() -> void:
	var current_depth := 0.0
	for grain in layers:
		grain.properties.depth = current_depth
		current_depth += grain.quantity

func to_dict() -> Dictionary:
	var layer_dicts: Array[Dictionary] = []
	for grain in layers:
		layer_dicts.append(grain.to_dict())
	return {
		"world_x": world_x,
		"world_y": world_y,
		"cell_id": cell_id,
		"layers": layer_dicts,
	}

static func from_dict(d: Dictionary) -> GrainStack:
	var stack := GrainStack.new()
	stack.world_x = int(d.get("world_x", 0))
	stack.world_y = int(d.get("world_y", 0))
	stack.cell_id = int(d.get("cell_id", 0))
	for layer_dict in d.get("layers", []):
		stack.layers.append(Grain.from_dict(layer_dict))
	stack._recalculate_depths()
	return stack
```

- [ ] **Step 3: Run test, commit**

```bash
git add scripts/core/grain_stack.gd tests/test_grain_stack.gd
git commit -m "feat(L0): add GrainStack - depth-sorted grain layers with visibility and mutation"
```

---

### Task 5: GrainRegistry

**Files:**
- Create: `scripts/core/grain_registry.gd`
- Create: `data/grains/physical_grains.json`
- Test: `tests/test_grain_registry.gd`

- [ ] **Step 1: Create grain template data**

```json
{
  "templates": [
    {"id": "bedrock", "category": 0, "type": 0, "properties": {"hardness": 1.0, "density": 3.0, "flammability": 0.0, "opacity": 1.0}},
    {"id": "stone", "category": 0, "type": 1, "properties": {"hardness": 0.8, "density": 2.5, "flammability": 0.0, "opacity": 1.0}},
    {"id": "sand", "category": 0, "type": 11, "properties": {"hardness": 0.1, "density": 1.5, "flammability": 0.0, "opacity": 1.0, "solubility": 0.05}},
    {"id": "soil", "category": 0, "type": 14, "properties": {"hardness": 0.2, "density": 1.3, "flammability": 0.0, "opacity": 1.0, "moisture": 0.3}},
    {"id": "water", "category": 0, "type": 17, "properties": {"hardness": 0.0, "density": 1.0, "flammability": 0.0, "opacity": 0.3, "solubility": 1.0}},
    {"id": "grass", "category": 0, "type": 26, "properties": {"hardness": 0.05, "density": 0.3, "flammability": 0.7, "opacity": 0.8}},
    {"id": "iron", "category": 0, "type": 5, "properties": {"hardness": 0.7, "density": 7.8, "conductivity": 0.8, "opacity": 1.0}},
    {"id": "wood", "category": 0, "type": 23, "properties": {"hardness": 0.4, "density": 0.6, "flammability": 0.8, "opacity": 1.0}},
    {"id": "gold", "category": 0, "type": 7, "properties": {"hardness": 0.3, "density": 19.3, "conductivity": 0.95, "opacity": 1.0}},
    {"id": "ice", "category": 0, "type": 18, "properties": {"hardness": 0.3, "density": 0.9, "flammability": 0.0, "opacity": 0.5, "temperature": -10.0}},
    {"id": "lava", "category": 0, "type": 20, "properties": {"hardness": 0.0, "density": 2.5, "flammability": 0.0, "opacity": 1.0, "temperature": 1200.0, "energy_level": 0.9}},
    {"id": "moss", "category": 0, "type": 27, "properties": {"hardness": 0.02, "density": 0.2, "flammability": 0.5, "opacity": 0.6, "moisture": 0.7}},
    {"id": "flower", "category": 0, "type": 29, "properties": {"hardness": 0.01, "density": 0.1, "flammability": 0.6, "opacity": 0.5}},
    {"id": "clay", "category": 0, "type": 13, "properties": {"hardness": 0.3, "density": 1.8, "flammability": 0.0, "opacity": 1.0, "moisture": 0.5}},
    {"id": "gravel", "category": 0, "type": 12, "properties": {"hardness": 0.5, "density": 1.8, "flammability": 0.0, "opacity": 1.0}}
  ]
}
```

- [ ] **Step 2: Write the test**

```gdscript
extends SceneTree

func _init() -> void:
	var GrainRegistry = preload("res://scripts/core/grain_registry.gd")
	var GrainTypes = preload("res://scripts/core/grain_types.gd")

	var registry = GrainRegistry.new()
	registry.load_templates("res://data/grains/physical_grains.json")

	# Test template lookup
	var stone = registry.create_grain("stone")
	_assert(stone != null, "stone grain should be created")
	_assert(stone.properties.hardness == 0.8, "stone hardness should be 0.8")

	var grass = registry.create_grain("grass")
	_assert(grass != null, "grass grain should be created")
	_assert(grass.properties.flammability == 0.7, "grass flammability should be 0.7")

	# Test creating a terrain stack template
	var grassland_stack = registry.create_terrain_stack("grassland")
	_assert(grassland_stack.size() >= 3, "grassland stack should have at least 3 layers")
	_assert(grassland_stack.top().grain_type == GrainTypes.Physical.GRASS, "grassland top should be grass")
	_assert(grassland_stack.bottom().grain_type == GrainTypes.Physical.BEDROCK, "grassland bottom should be bedrock")

	print("All grain registry tests passed.")
	quit()

func _assert(condition: bool, message: String) -> void:
	if not condition:
		push_error("ASSERTION FAILED: %s" % message)
		quit(1)
```

- [ ] **Step 3: Create grain_registry.gd**

```gdscript
class_name GrainRegistry
extends RefCounted

var _templates: Dictionary = {}  ## id -> template dict
var _terrain_stacks: Dictionary = {}  ## biome_name -> Array of grain IDs (top to bottom)

func _init() -> void:
	_init_terrain_stacks()

func load_templates(path: String) -> void:
	var json_text := FileAccess.get_file_as_string(path)
	var parsed = JSON.parse_string(json_text)
	if parsed and parsed.has("templates"):
		for t in parsed["templates"]:
			_templates[t["id"]] = t

func create_grain(template_id: String) -> Grain:
	if not _templates.has(template_id):
		push_warning("GrainRegistry: unknown template '%s'" % template_id)
		return null
	var t: Dictionary = _templates[template_id]
	var g := Grain.new(int(t.get("category", 0)), int(t.get("type", 0)))
	if t.has("properties"):
		g.properties = GrainProperties.from_dict(t["properties"])
	return g

func create_terrain_stack(biome: String) -> GrainStack:
	var stack := GrainStack.new()
	var grain_ids: Array = _terrain_stacks.get(biome, _terrain_stacks["grassland"])
	# Build bottom-up, then stack has correct order (index 0 = top)
	for i in range(grain_ids.size() - 1, -1, -1):
		var grain := create_grain(grain_ids[i])
		if grain:
			stack.push(grain)
	return stack

func _init_terrain_stacks() -> void:
	_terrain_stacks["grassland"] = ["grass", "soil", "stone", "bedrock"]
	_terrain_stacks["desert"] = ["sand", "sand", "gravel", "stone", "bedrock"]
	_terrain_stacks["forest"] = ["moss", "soil", "soil", "stone", "bedrock"]
	_terrain_stacks["hills"] = ["grass", "gravel", "stone", "stone", "bedrock"]
	_terrain_stacks["mountains"] = ["stone", "stone", "stone", "bedrock"]
	_terrain_stacks["beach"] = ["sand", "sand", "clay", "stone", "bedrock"]
	_terrain_stacks["ocean"] = ["water", "sand", "clay", "stone", "bedrock"]
	_terrain_stacks["shallow_water"] = ["water", "sand", "stone", "bedrock"]
	_terrain_stacks["tundra"] = ["ice", "soil", "stone", "bedrock"]
	_terrain_stacks["swamp"] = ["water", "mud", "clay", "stone", "bedrock"]

func get_template(template_id: String) -> Dictionary:
	return _templates.get(template_id, {})

func get_all_template_ids() -> Array:
	return _templates.keys()
```

- [ ] **Step 4: Run test, commit**

```bash
git add scripts/core/grain_registry.gd data/grains/physical_grains.json tests/test_grain_registry.gd
git commit -m "feat(L0): add GrainRegistry with templates, terrain stack presets per biome"
```

---

### Task 6: Update Python test runner

**Files:**
- Modify: `tests/run_tests.py`

- [ ] **Step 1: Add grain system tests to the Python test runner**

Add test functions that verify the grain system files exist and have correct structure:

```python
def test_grain_system():
    """Test grain data model files."""
    print("  Testing Grain System...")

    assert Path("scripts/core/grain_types.gd").exists(), "grain_types.gd missing"
    assert Path("scripts/core/grain_properties.gd").exists(), "grain_properties.gd missing"
    assert Path("scripts/core/grain.gd").exists(), "grain.gd missing"
    assert Path("scripts/core/grain_stack.gd").exists(), "grain_stack.gd missing"
    assert Path("scripts/core/grain_registry.gd").exists(), "grain_registry.gd missing"
    assert Path("data/grains/physical_grains.json").exists(), "physical_grains.json missing"

    # Verify grain types has all categories
    types = Path("scripts/core/grain_types.gd").read_text()
    assert "enum Category" in types, "Category enum missing"
    assert "enum Physical" in types, "Physical enum missing"
    assert "enum Magical" in types, "Magical enum missing"
    assert "enum Spiritual" in types, "Spiritual enum missing"
    assert "enum Technical" in types, "Technical enum missing"
    assert "BEDROCK" in types, "BEDROCK type missing"
    assert "MITHRIL" in types, "MITHRIL type missing"

    # Verify grain properties
    props = Path("scripts/core/grain_properties.gd").read_text()
    assert "var hardness" in props, "hardness property missing"
    assert "var flammability" in props, "flammability property missing"
    assert "var purity" in props, "purity property missing"
    assert "var resonance" in props, "resonance property missing"
    assert "func to_dict" in props, "to_dict missing"
    assert "func from_dict" in props, "from_dict missing"

    # Verify grain stack
    stack = Path("scripts/core/grain_stack.gd").read_text()
    assert "func push" in stack, "push method missing"
    assert "func pop_top" in stack, "pop_top method missing"
    assert "func get_visible_grains" in stack, "get_visible_grains missing"
    assert "func to_dict" in stack, "to_dict missing"

    # Verify registry
    reg = Path("scripts/core/grain_registry.gd").read_text()
    assert "func create_grain" in reg, "create_grain missing"
    assert "func create_terrain_stack" in reg, "create_terrain_stack missing"
    assert "grassland" in reg, "grassland terrain stack missing"
    assert "desert" in reg, "desert terrain stack missing"

    # Verify JSON data
    import json
    grains = json.loads(Path("data/grains/physical_grains.json").read_text())
    assert "templates" in grains, "templates key missing"
    assert len(grains["templates"]) >= 10, "should have at least 10 grain templates"

    print("  Grain System: PASSED (20+ assertions)")
```

- [ ] **Step 2: Add to test list and run**

Run: `python tests/run_tests.py`
Expected: All tests pass including new grain system tests

- [ ] **Step 3: Commit**

```bash
git add tests/run_tests.py
git commit -m "test(L0): add grain system tests to CI test runner"
```
