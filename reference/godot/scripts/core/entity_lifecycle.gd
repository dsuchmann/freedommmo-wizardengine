class_name EntityLifecycle
extends RefCounted

signal stage_changed(entity_id: int, old_stage: String, new_stage: String)
signal entity_matured(entity_id: int)
signal entity_elderly(entity_id: int)

var time_system: TimeSystem

func _init(p_time: TimeSystem = null) -> void:
	time_system = p_time

func get_life_stage_name(entity: EntityBody) -> String:
	if entity.age < 0.75: return "fetus"
	if entity.age < 2: return "infant"
	if entity.age < 4: return "toddler"
	if entity.age < 12: return "child"
	if entity.age < 18: return "adolescent"
	if entity.age < 30: return "young_adult"
	if entity.age < 50: return "adult"
	if entity.age < 65: return "middle_aged"
	if entity.age < 80: return "senior"
	return "elderly"

func get_life_percentage(entity: EntityBody) -> float:
	var max_age := 100.0
	match entity.species:
		EntityBody.Species.ELF: max_age = 500.0
		EntityBody.Species.DWARF: max_age = 200.0
		EntityBody.Species.ORC: max_age = 60.0
		EntityBody.Species.GOBLIN: max_age = 40.0
		EntityBody.Species.DRAGON: max_age = 1000.0
		EntityBody.Species.GOD: max_age = 99999.0
	return clampf(entity.age / max_age, 0.0, 1.0)

func can_reproduce(entity: EntityBody) -> bool:
	var stage := get_life_stage_name(entity)
	return stage in ["young_adult", "adult", "middle_aged"]

func can_work(entity: EntityBody) -> bool:
	var stage := get_life_stage_name(entity)
	return stage in ["adolescent", "young_adult", "adult", "middle_aged", "senior"]

func can_fight(entity: EntityBody) -> bool:
	var stage := get_life_stage_name(entity)
	return stage in ["adolescent", "young_adult", "adult", "middle_aged"]

func get_stat_modifier(entity: EntityBody) -> Dictionary:
	var stage := get_life_stage_name(entity)
	match stage:
		"child": return {"strength": 0.5, "speed": 0.7, "intelligence": 0.6}
		"adolescent": return {"strength": 0.8, "speed": 1.0, "intelligence": 0.9}
		"young_adult": return {"strength": 1.1, "speed": 1.1, "intelligence": 1.0}
		"adult": return {"strength": 1.0, "speed": 1.0, "intelligence": 1.1}
		"middle_aged": return {"strength": 0.9, "speed": 0.85, "intelligence": 1.2, "wisdom": 1.3}
		"senior": return {"strength": 0.6, "speed": 0.6, "intelligence": 1.0, "wisdom": 1.5}
		"elderly": return {"strength": 0.4, "speed": 0.4, "wisdom": 1.5}
		_: return {}

func get_needs(entity: EntityBody) -> Array:
	var stage := get_life_stage_name(entity)
	var needs: Array = ["food", "water", "shelter"]
	match stage:
		"infant", "toddler": needs.append("caretaker")
		"child": needs.append_array(["play", "education"])
		"adolescent": needs.append_array(["education", "social"])
		"young_adult": needs.append_array(["social", "purpose", "romance"])
		"adult": needs.append_array(["purpose", "family", "achievement"])
		"middle_aged": needs.append_array(["legacy", "health"])
		"senior", "elderly": needs.append_array(["comfort", "company", "peace"])
	return needs
