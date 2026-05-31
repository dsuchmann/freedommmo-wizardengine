class_name SeedHasher

## Derives deterministic sub-seeds for each layer from a world seed + chunk coords.
## Uses avalanche-quality hashing because Godot's RandomNumberGenerator lacks avalanche effect.

static func hash_seed(world_seed: int, chunk_x: int, chunk_y: int, layer_id: int) -> int:
	var h = world_seed
	h = _mix(h, chunk_x)
	h = _mix(h, chunk_y)
	h = _mix(h, layer_id)
	return h & 0x7FFFFFFF

static func _mix(h: int, val: int) -> int:
	h = h ^ (val * 0x9E3779B9)
	h = (h ^ (h >> 16)) * 0x85EBCA6B
	h = (h ^ (h >> 13)) * 0xC2B2AE35
	h = h ^ (h >> 16)
	return h
