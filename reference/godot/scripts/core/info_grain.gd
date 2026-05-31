class_name InfoGrain
extends RefCounted

var category: int = 0
var info_type: int = 0
var intensity: float = 0.5
var salience: float = 0.5
var decay_rate: float = 0.01
var source_entity_id: int = -1
var target_entity_id: int = -1
var created_at: float = 0.0
var context: Dictionary = {}
var id: int = 0

static var _next_id: int = 0

func _init(p_category: int = 0, p_type: int = 0) -> void:
	category = p_category
	info_type = p_type
	_next_id += 1
	id = _next_id

func tick(delta: float) -> void:
	intensity = maxf(0.0, intensity - decay_rate * delta)
	salience = maxf(0.0, salience - (decay_rate * 0.5) * delta)

func is_expired() -> bool:
	return intensity <= 0.0

func to_dict() -> Dictionary:
	return {
		"id": id, "category": category, "info_type": info_type,
		"intensity": intensity, "salience": salience,
		"decay_rate": decay_rate,
		"source_entity_id": source_entity_id,
		"target_entity_id": target_entity_id,
		"created_at": created_at, "context": context,
	}

static func from_dict(d: Dictionary) -> InfoGrain:
	var g := InfoGrain.new(int(d.get("category", 0)), int(d.get("info_type", 0)))
	g.id = int(d.get("id", 0))
	g.intensity = float(d.get("intensity", 0.5))
	g.salience = float(d.get("salience", 0.5))
	g.decay_rate = float(d.get("decay_rate", 0.01))
	g.source_entity_id = int(d.get("source_entity_id", -1))
	g.target_entity_id = int(d.get("target_entity_id", -1))
	g.created_at = float(d.get("created_at", 0.0))
	g.context = d.get("context", {})
	return g
