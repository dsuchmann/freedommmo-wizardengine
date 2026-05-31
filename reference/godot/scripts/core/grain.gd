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
