class_name ObjectInstance
extends RefCounted

## Data class for a placed terrain object in the world.
## Holds both deterministic baseline data and mutable runtime state.

# --- Identity (deterministic from world_seed + position) ---
var object_id: String
var instance_seed: int
var position: Vector2i  # world tile coordinates
var variant: int
var category: String

# --- Lifecycle/durability state ---
var ontology: String  # "animate" or "inanimate"
var lifecycle_phase: String  # current phase id (animate only)
var phase_progress: float  # 0-1 progress through current phase
var current_hp: int  # durability HP (inanimate) or lifecycle health (animate)
var durability_stage: String  # current stage id (inanimate only)

# --- Individuality (derived from instance_seed) ---
var ind_scale: float
var ind_lean_angle: float
var ind_color_shift: float

# --- Runtime mutable state ---
var current_state: String  # "alive", "burning", "frozen", "chopped_stump", etc.
var active_effects: Array = []

# --- Rendering ---
var size: Vector2i  # tiles wide x tall
var blocking: bool
var anchor: String
var pixel_size: int

# --- Layer stack info (from biome_layers placement) ---
var layer_num: int = 0        # which layer this object belongs to (1-5)
var layer_z_offset: int = 0   # z-ordering offset from layer definition
var layer_scale: float = 1.0  # display scale override from layer definition


static func from_placement(obj_def: Dictionary, pos: Vector2i, seed_val: int,
		phase: String, var_idx: int) -> ObjectInstance:
	var inst = ObjectInstance.new()
	inst.object_id = obj_def.get("id", "")
	inst.instance_seed = seed_val
	inst.position = pos
	inst.variant = var_idx
	inst.category = obj_def.get("category", "")
	inst.ontology = obj_def.get("ontology", "inanimate")
	inst.lifecycle_phase = phase
	inst.phase_progress = 0.0
	inst.current_state = "alive"
	inst.active_effects = []

	# Size may vary by lifecycle phase
	var size_arr = obj_def.get("size", [1, 1])
	if inst.ontology == "animate" and phase != "":
		var lifecycle = obj_def.get("lifecycle", {})
		var phases = lifecycle.get("phases", [])
		for p in phases:
			var p_id = p.get("id", "")
			if p_id == phase:
				size_arr = p.get("size", size_arr)
				break
	inst.size = Vector2i(int(size_arr[0]), int(size_arr[1]))
	inst.blocking = obj_def.get("blocking", false)
	inst.anchor = obj_def.get("anchor", "bottom_center")
	inst.pixel_size = int(obj_def.get("pixel_size", 32))

	# Durability
	if inst.ontology == "inanimate":
		var dur = obj_def.get("durability")
		if dur != null and dur is Dictionary:
			inst.current_hp = int(dur.get("hp", 100))
			var stages = dur.get("stages", [])
			if stages.size() > 0:
				var first_stage = stages[0]
				inst.durability_stage = first_stage.get("id", "intact")
			else:
				inst.durability_stage = "intact"
		else:
			inst.current_hp = 100
			inst.durability_stage = "intact"
	else:
		inst.current_hp = 100
		inst.durability_stage = ""

	# Individuality from seed
	var rng = RandomNumberGenerator.new()
	rng.seed = seed_val
	var variance = obj_def.get("variance", {})
	inst.ind_scale = rng.randf_range(
		_var_lo(variance, "scale_variance", 0.75),
		_var_hi(variance, "scale_variance", 1.25))
	inst.ind_lean_angle = rng.randf_range(
		_var_lo(variance, "lean_angle", -3.0),
		_var_hi(variance, "lean_angle", 3.0))
	inst.ind_color_shift = rng.randf_range(
		_var_lo(variance, "color_shift", -0.08),
		_var_hi(variance, "color_shift", 0.08))

	return inst


static func _var_lo(variance: Dictionary, key: String, fallback: float) -> float:
	var entry = variance.get(key)
	if entry == null:
		return fallback
	if entry is Array and entry.size() >= 2:
		return float(entry[0])
	if entry is Dictionary:
		var r = entry.get("range", [fallback, fallback])
		if r is Array and r.size() >= 2:
			return float(r[0])
	return fallback


static func _var_hi(variance: Dictionary, key: String, fallback: float) -> float:
	var entry = variance.get(key)
	if entry == null:
		return fallback
	if entry is Array and entry.size() >= 2:
		return float(entry[1])
	if entry is Dictionary:
		var r = entry.get("range", [fallback, fallback])
		if r is Array and r.size() >= 2:
			return float(r[1])
	return fallback


func to_delta() -> Dictionary:
	return {
		"position": [position.x, position.y],
		"object_id": object_id,
		"current_state": current_state,
		"current_hp": current_hp,
		"lifecycle_phase": lifecycle_phase,
		"phase_progress": phase_progress,
		"durability_stage": durability_stage,
		"active_effects": active_effects,
	}
