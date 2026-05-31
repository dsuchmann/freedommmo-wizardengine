class_name SkillProgression
extends RefCounted

signal skill_leveled_up(entity_id: int, skill_name: String, new_level: int)
signal experience_gained(entity_id: int, skill_name: String, amount: float)

const SKILLS: Array = [
	"combat_melee", "combat_ranged", "combat_magic",
	"mining", "woodcutting", "farming", "fishing",
	"smithing", "alchemy", "enchanting", "cooking",
	"stealth", "persuasion", "trading", "survival",
	"herbalism", "construction", "leadership",
]

var _entity_skills: Dictionary = {}

func get_skill_level(entity_id: int, skill_name: String) -> int:
	var skills = _entity_skills.get(entity_id, {})
	var xp: float = skills.get(skill_name, 0.0)
	return _xp_to_level(xp)

func get_skill_xp(entity_id: int, skill_name: String) -> float:
	var skills = _entity_skills.get(entity_id, {})
	return skills.get(skill_name, 0.0)

func add_experience(entity_id: int, skill_name: String, amount: float) -> void:
	if not _entity_skills.has(entity_id):
		_entity_skills[entity_id] = {}
	var old_level := get_skill_level(entity_id, skill_name)
	_entity_skills[entity_id][skill_name] = _entity_skills[entity_id].get(skill_name, 0.0) + amount
	var new_level := get_skill_level(entity_id, skill_name)
	experience_gained.emit(entity_id, skill_name, amount)
	if new_level > old_level:
		skill_leveled_up.emit(entity_id, skill_name, new_level)

func get_all_skills(entity_id: int) -> Dictionary:
	var result := {}
	var skills = _entity_skills.get(entity_id, {})
	for skill_name in SKILLS:
		var xp: float = skills.get(skill_name, 0.0)
		result[skill_name] = {"xp": xp, "level": _xp_to_level(xp)}
	return result

func get_total_level(entity_id: int) -> int:
	var total := 0
	for skill in SKILLS:
		total += get_skill_level(entity_id, skill)
	return total

func get_xp_to_next_level(entity_id: int, skill_name: String) -> float:
	var current_xp := get_skill_xp(entity_id, skill_name)
	var current_level := _xp_to_level(current_xp)
	var next_level_xp := _level_to_xp(current_level + 1)
	return next_level_xp - current_xp

func grant_action_xp(entity_id: int, action: String) -> void:
	match action:
		"dig", "mine": add_experience(entity_id, "mining", 5.0)
		"chop": add_experience(entity_id, "woodcutting", 5.0)
		"attack_melee": add_experience(entity_id, "combat_melee", 3.0)
		"attack_ranged": add_experience(entity_id, "combat_ranged", 3.0)
		"attack_magic": add_experience(entity_id, "combat_magic", 4.0)
		"craft_weapon", "craft_armor": add_experience(entity_id, "smithing", 8.0)
		"craft_potion": add_experience(entity_id, "alchemy", 8.0)
		"cook": add_experience(entity_id, "cooking", 5.0)
		"trade": add_experience(entity_id, "trading", 3.0)
		"persuade": add_experience(entity_id, "persuasion", 4.0)
		"sneak": add_experience(entity_id, "stealth", 3.0)
		"build": add_experience(entity_id, "construction", 6.0)
		"forage": add_experience(entity_id, "herbalism", 4.0)

func _xp_to_level(xp: float) -> int:
	if xp <= 0:
		return 1
	return 1 + int(sqrt(xp / 50.0))

func _level_to_xp(level: int) -> float:
	return float((level - 1) * (level - 1)) * 50.0
