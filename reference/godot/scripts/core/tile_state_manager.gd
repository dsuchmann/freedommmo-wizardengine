class_name TileStateManager

## Tracks per-tile state for event-driven animation.
## Phase 1: pristine state only. Full state machine wired but inactive.

enum TileState {
	PRISTINE = 0,
	DISTURBED = 1,
	TRAMPLED = 2,
	DUG = 3,
	BURNING = 4,
	BURNED = 5,
	FROZEN = 6,
	WET = 7,
	CURSED = 8,
	ENCHANTED = 9,
	DECAYING = 10,
	GROWING = 11,
	DRY = 12
}

signal tile_state_changed(tile_world_pos: Vector2i, old_state: int, new_state: int)

# Chunk-level state storage: Vector2i(chunk_x, chunk_y) -> PackedByteArray
var _chunk_states: Dictionary = {}


func get_state(chunk_x: int, chunk_y: int, local_x: int, local_y: int) -> int:
	var key = Vector2i(chunk_x, chunk_y)
	if not _chunk_states.has(key):
		return TileState.PRISTINE
	var states = _chunk_states[key]
	var idx = local_y * ChunkData.SIZE + local_x
	if idx < 0 or idx >= states.size():
		return TileState.PRISTINE
	return states[idx]


func set_state(chunk_x: int, chunk_y: int, local_x: int, local_y: int, new_state: int) -> void:
	var key = Vector2i(chunk_x, chunk_y)
	if not _chunk_states.has(key):
		var states = PackedByteArray()
		states.resize(ChunkData.SIZE * ChunkData.SIZE)
		states.fill(TileState.PRISTINE)
		_chunk_states[key] = states
	var idx = local_y * ChunkData.SIZE + local_x
	if idx < 0 or idx >= _chunk_states[key].size():
		return
	var old_state = _chunk_states[key][idx]
	if old_state == new_state:
		return
	_chunk_states[key][idx] = new_state
	var world_x = chunk_x * ChunkData.SIZE + local_x
	var world_y = chunk_y * ChunkData.SIZE + local_y
	tile_state_changed.emit(Vector2i(world_x, world_y), old_state, new_state)


func clear_chunk(chunk_x: int, chunk_y: int) -> void:
	_chunk_states.erase(Vector2i(chunk_x, chunk_y))
