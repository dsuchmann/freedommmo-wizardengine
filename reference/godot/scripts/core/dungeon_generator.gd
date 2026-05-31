class_name DungeonGenerator
extends RefCounted

var grain_registry: GrainRegistry

func _init(p_registry: GrainRegistry = null) -> void:
	grain_registry = p_registry if p_registry else GrainRegistry.new()

func generate_dungeon(width: int, height: int, difficulty: float = 1.0) -> Dictionary:
	var tiles := []
	tiles.resize(width * height)

	# Fill with stone
	for i in range(width * height):
		tiles[i] = "stone"

	# Generate rooms
	var rooms: Array = []
	var room_count := 5 + int(difficulty * 3)
	for i in range(room_count):
		var rw := 4 + randi() % 6
		var rh := 4 + randi() % 6
		var rx := 2 + randi() % (width - rw - 4)
		var ry := 2 + randi() % (height - rh - 4)
		var room := Rect2i(rx, ry, rw, rh)

		var overlaps := false
		for existing in rooms:
			if room.intersects(existing.grow(1)):
				overlaps = true
				break
		if overlaps:
			continue

		rooms.append(room)
		for y in range(room.position.y, room.position.y + room.size.y):
			for x in range(room.position.x, room.position.x + room.size.x):
				tiles[y * width + x] = "floor"

	# Connect rooms with corridors
	for i in range(rooms.size() - 1):
		var a = rooms[i].get_center()
		var b = rooms[i + 1].get_center()
		_carve_corridor(tiles, width, a.x, a.y, b.x, b.y)

	# Place entrance
	if not rooms.is_empty():
		var entrance = rooms[0].get_center()
		tiles[entrance.y * width + entrance.x] = "entrance"

	# Place boss room
	if rooms.size() > 1:
		var boss_room = rooms[rooms.size() - 1]
		var boss_center = boss_room.get_center()
		tiles[boss_center.y * width + boss_center.x] = "boss"

	# Place treasures
	for room in rooms:
		if randf() > 0.5:
			var tx = room.position.x + randi() % room.size.x
			var ty = room.position.y + randi() % room.size.y
			if tiles[ty * width + tx] == "floor":
				tiles[ty * width + tx] = "treasure"

	# Place traps
	for room in rooms:
		if randf() > 0.7 and difficulty > 0.5:
			var tx = room.position.x + randi() % room.size.x
			var ty = room.position.y + randi() % room.size.y
			if tiles[ty * width + tx] == "floor":
				tiles[ty * width + tx] = "trap"

	return {
		"width": width, "height": height,
		"tiles": tiles, "rooms": rooms,
		"difficulty": difficulty,
		"room_count": rooms.size(),
	}

func dungeon_to_grain_stacks(dungeon: Dictionary) -> Array:
	var width: int = dungeon["width"]
	var height: int = dungeon["height"]
	var tiles: Array = dungeon["tiles"]
	var stacks: Array = []

	for y in range(height):
		for x in range(width):
			var tile: String = tiles[y * width + x]
			var stack := GrainStack.new()
			stack.world_x = x
			stack.world_y = y

			match tile:
				"stone":
					stack.push_bottom(_grain("bedrock"))
					stack.push(_grain("stone"))
					stack.push(_grain("stone"))
				"floor":
					stack.push_bottom(_grain("bedrock"))
					stack.push(_grain("stone"))
					stack.push(_grain("gravel"))
				"entrance":
					stack.push_bottom(_grain("bedrock"))
					stack.push(_grain("stone"))
					stack.push(_grain("gravel"))
				"boss":
					stack.push_bottom(_grain("bedrock"))
					stack.push(_grain("obsidian"))
					stack.push(_grain("lava"))
				"treasure":
					stack.push_bottom(_grain("bedrock"))
					stack.push(_grain("gold"))
					stack.push(_grain("gravel"))
				"trap":
					stack.push_bottom(_grain("bedrock"))
					stack.push(_grain("stone"))
					stack.push(_grain("gravel"))
				"corridor":
					stack.push_bottom(_grain("bedrock"))
					stack.push(_grain("stone"))
					stack.push(_grain("gravel"))

			stacks.append(stack)
	return stacks

func _carve_corridor(tiles: Array, width: int, x1: int, y1: int, x2: int, y2: int) -> void:
	var x := x1
	var y := y1
	while x != x2:
		if tiles[y * width + x] == "stone":
			tiles[y * width + x] = "corridor"
		x += 1 if x2 > x else -1
	while y != y2:
		if tiles[y * width + x] == "stone":
			tiles[y * width + x] = "corridor"
		y += 1 if y2 > y else -1

func _grain(template_id: String) -> Grain:
	if grain_registry:
		var g = grain_registry.create_grain(template_id)
		if g:
			return g
	return Grain.new(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.STONE)
