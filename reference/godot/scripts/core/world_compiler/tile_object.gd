class_name TileObject

var asset_id: String = ""
var category: String = ""
var z_layer: int = 0
var walkable: bool = true
var blocking: bool = false
var pickable: bool = false
var interactable: bool = false
var provides: Array = []
var value: int = 0
var properties: Dictionary = {}

func _init(p_asset_id: String = "", p_category: String = "", p_z_layer: int = 0):
	asset_id = p_asset_id
	category = p_category
	z_layer = p_z_layer

class TileStack:
	var objects: Array = []

	func add(obj: TileObject) -> void:
		objects.append(obj)
		objects.sort_custom(func(a, b): return a.z_layer < b.z_layer)

	func remove(obj: TileObject) -> void:
		objects.erase(obj)

	func top() -> TileObject:
		if objects.is_empty():
			return null
		return objects[objects.size() - 1]

	func is_walkable() -> bool:
		for obj in objects:
			if obj.blocking:
				return false
		return true

	func get_interactables() -> Array:
		var result = []
		for i in range(objects.size() - 1, -1, -1):
			if objects[i].interactable:
				result.append(objects[i])
		return result

	func get_pickables() -> Array:
		var result = []
		for i in range(objects.size() - 1, -1, -1):
			if objects[i].pickable:
				result.append(objects[i])
		return result

	func get_by_category(cat: String) -> Array:
		var result = []
		for obj in objects:
			if obj.category == cat:
				result.append(obj)
		return result

	func has_surface() -> bool:
		for obj in objects:
			if obj.properties.get("surface", false):
				return true
		return false
