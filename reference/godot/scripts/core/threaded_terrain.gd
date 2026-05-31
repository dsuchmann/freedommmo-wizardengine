class_name ThreadedTerrain
extends Node

signal cell_ready(cell_x: int, cell_y: int, image: Image)

var _pending_requests: Array = []
var _completed: Array = []
var _generating: Dictionary = {}
var _mutex := Mutex.new()
var _max_concurrent: int = 2

var terrain_gen: TerrainGenerator
var feature_placer: FeaturePlacement
var world: WorldGraph
var tile_renderer: TileRenderer
var grain_registry: GrainRegistry

func _init() -> void:
	pass

func setup(p_terrain: TerrainGenerator, p_features: FeaturePlacement,
		p_world: WorldGraph, p_renderer: TileRenderer, p_registry: GrainRegistry) -> void:
	terrain_gen = p_terrain
	feature_placer = p_features
	world = p_world
	tile_renderer = p_renderer
	grain_registry = p_registry

func request_cell(cell_x: int, cell_y: int) -> void:
	var key = Vector2i(cell_x, cell_y)
	_mutex.lock()
	if _generating.has(key):
		_mutex.unlock()
		return
	_generating[key] = true
	_pending_requests.append(key)
	_mutex.unlock()

func _process(_delta: float) -> void:
	if _shutdown:
		return
	# Process one pending request per frame on main thread
	# (avoids WorkerThreadPool crash-on-exit)
	_mutex.lock()
	var to_generate: Array = []
	while not _pending_requests.is_empty() and to_generate.size() < 1:
		to_generate.append(_pending_requests.pop_front())
	_mutex.unlock()

	for key in to_generate:
		_generate_cell_sync(key.x, key.y)

	# Deliver completed cells
	_mutex.lock()
	var to_deliver = _completed.duplicate()
	_completed.clear()
	_mutex.unlock()

	for entry in to_deliver:
		cell_ready.emit(entry["cx"], entry["cy"], entry["image"])

func _generate_cell_sync(cx: int, cy: int) -> void:
	if _shutdown:
		return
	var cell = terrain_gen.generate_cell(cx, cy)
	feature_placer.place_features(cell)
	world.cells[world._cell_key(cx, cy)] = cell
	var img = tile_renderer.render_cell_to_image(cell, 32)
	_completed.append({"cx": cx, "cy": cy, "image": img})
	_generating.erase(Vector2i(cx, cy))
	_mutex.unlock()

var _shutdown: bool = false

func shutdown() -> void:
	_shutdown = true
	_mutex.lock()
	_pending_requests.clear()
	_mutex.unlock()

func has_pending() -> bool:
	_mutex.lock()
	var result = not _pending_requests.is_empty() or not _completed.is_empty()
	_mutex.unlock()
	return result

func get_pending_count() -> int:
	_mutex.lock()
	var count = _pending_requests.size() + _generating.size()
	_mutex.unlock()
	return count
