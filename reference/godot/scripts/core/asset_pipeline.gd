class_name AssetPipeline
extends RefCounted

signal asset_ready(asset_type: String, asset_id: String)
signal generation_queued(asset_type: String, asset_id: String)

var _cache: Dictionary = {}
var _generation_queue: Array = []
var _pending_jobs: Dictionary = {}
var _fallback_renderer: TileRenderer

func _init() -> void:
	_fallback_renderer = TileRenderer.new()

func get_tile_texture(grain_type: int) -> Texture2D:
	var key := "tile_%d" % grain_type
	if _cache.has(key):
		return _cache[key]
	return null

func get_entity_texture(entity_hash: String) -> Texture2D:
	var key := "entity_%s" % entity_hash
	if _cache.has(key):
		return _cache[key]
	return null

func get_fallback_color(grain_type: int) -> Color:
	return TileRenderer.GRAIN_COLORS.get(grain_type, Color.MAGENTA)

func queue_tileset_generation(biome: String, grain_types: Array) -> void:
	for gt in grain_types:
		var key := "tile_%d" % gt
		if not _cache.has(key) and not _is_queued(key):
			_generation_queue.append({
				"type": "tileset",
				"asset_id": key,
				"biome": biome,
				"grain_type": gt,
				"priority": 1.0,
			})
			generation_queued.emit("tileset", key)

func queue_character_generation(entity: EntityBody) -> void:
	var entity_hash := _compute_entity_hash(entity)
	var key := "entity_%s" % entity_hash
	if not _cache.has(key) and not _is_queued(key):
		_generation_queue.append({
			"type": "character",
			"asset_id": key,
			"entity_data": entity.to_dict(),
			"visual_layers": entity.get_visual_layers(),
			"priority": 2.0,
		})
		generation_queued.emit("character", key)

func queue_animation_generation(template_name: String, participants: Array) -> void:
	var key := "anim_%s_%d" % [template_name, hash(str(participants))]
	if not _cache.has(key) and not _is_queued(key):
		_generation_queue.append({
			"type": "animation",
			"asset_id": key,
			"template": template_name,
			"participants": participants,
			"priority": 3.0,
		})
		generation_queued.emit("animation", key)

func process_queue(max_per_tick: int = 3) -> Array:
	_generation_queue.sort_custom(func(a, b): return a["priority"] > b["priority"])
	var processed: Array = []
	var count := 0
	while not _generation_queue.is_empty() and count < max_per_tick:
		var request: Dictionary = _generation_queue.pop_front()
		_pending_jobs[request["asset_id"]] = request
		processed.append(request)
		count += 1
	return processed

func register_generated_asset(asset_id: String, texture: Texture2D) -> void:
	_cache[asset_id] = texture
	_pending_jobs.erase(asset_id)
	var asset_type := "unknown"
	if asset_id.begins_with("tile_"):
		asset_type = "tileset"
	elif asset_id.begins_with("entity_"):
		asset_type = "character"
	elif asset_id.begins_with("anim_"):
		asset_type = "animation"
	asset_ready.emit(asset_type, asset_id)

func predict_needed_assets(world: WorldGraph, player_cell_x: int, player_cell_y: int, radius: int = 1) -> void:
	var cells = world.get_cells_in_radius(player_cell_x, player_cell_y, radius)
	var grain_types_seen: Dictionary = {}
	for cell in cells:
		var grid = cell.get_top_grain_type_grid()
		for gt in grid:
			if gt >= 0:
				grain_types_seen[gt] = true
	for gt in grain_types_seen:
		if not _cache.has("tile_%d" % gt):
			queue_tileset_generation("auto", [gt])

func cache_size() -> int:
	return _cache.size()

func queue_size() -> int:
	return _generation_queue.size()

func pending_count() -> int:
	return _pending_jobs.size()

func _is_queued(key: String) -> bool:
	if _pending_jobs.has(key):
		return true
	for item in _generation_queue:
		if item["asset_id"] == key:
			return true
	return false

func _compute_entity_hash(entity: EntityBody) -> String:
	var hash_input := "%d_%d" % [entity.species, entity.entity_id]
	for slot in EntityBody.EQUIPMENT_SLOTS:
		var item = entity.get_equipped(slot)
		if item and item is Dictionary:
			hash_input += "_%s_%s" % [slot, str(item.get("id", ""))]
	return str(hash(hash_input))
