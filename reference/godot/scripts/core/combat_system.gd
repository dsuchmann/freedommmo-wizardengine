class_name CombatSystem
extends RefCounted

signal combat_started(attacker_id: int, defender_id: int)
signal damage_dealt(attacker_id: int, defender_id: int, amount: float, type: String)
signal entity_defeated(entity_id: int, killer_id: int)
signal combat_ended(entity_a: int, entity_b: int, outcome: String)

var causal_tracker: CausalTracker
var time_system: TimeSystem
var status_effects: StatusEffects
var relationships: RelationshipSystem
var weather: WeatherSystem

func _init(p_causal: CausalTracker = null, p_time: TimeSystem = null,
		p_status: StatusEffects = null, p_rel: RelationshipSystem = null) -> void:
	causal_tracker = p_causal if p_causal else CausalTracker.new()
	time_system = p_time if p_time else TimeSystem.new()
	status_effects = p_status
	relationships = p_rel

func attack(attacker: EntityBody, defender: EntityBody, attack_type: String = "melee") -> Dictionary:
	var atk_stats = attacker.get_computed_stats()
	var def_stats = defender.get_computed_stats()

	# Magic costs mana
	if attack_type == "magic":
		var mana = attacker.base_stats.get("mana", 0.0)
		if mana < 10.0:
			return {"damage": 0, "type": attack_type, "defender_health": defender.base_stats.get("health", 0),
				"defeated": false, "dodged": false, "blocked": false, "reason": "not_enough_mana"}
		attacker.base_stats["mana"] = mana - 10.0

	# Check dodge
	var dodge_chance = calculate_dodge_chance(defender)
	if status_effects and status_effects.has_effect(defender.entity_id, "speed_buff"):
		dodge_chance += 0.1
	if status_effects and status_effects.has_effect(attacker.entity_id, "frozen"):
		dodge_chance += 0.15
	if randf() < dodge_chance:
		if causal_tracker:
			causal_tracker.record_event(attacker.entity_id, defender.entity_id, "attack_dodged", {"type": attack_type})
		return {"damage": 0, "type": attack_type, "defender_health": defender.base_stats.get("health", 0),
			"defeated": false, "dodged": true, "blocked": false}

	# Check block
	var block_chance = calculate_block_chance(defender)
	var was_blocked := false
	var block_reduction := 0.0
	if randf() < block_chance:
		was_blocked = true
		block_reduction = 0.5

	var base_damage: float = atk_stats.get("attack", 5.0)
	var defense: float = def_stats.get("defense", 0.0)

	match attack_type:
		"melee":
			base_damage *= 1.0 + atk_stats.get("strength", 10.0) * 0.05
		"ranged":
			base_damage *= 1.0 + atk_stats.get("dexterity", 10.0) * 0.05
		"magic":
			base_damage *= 1.0 + atk_stats.get("intelligence", 10.0) * 0.05
			defense *= 0.3  # Magic partially ignores physical defense

	# Apply status effect damage modifiers
	if status_effects:
		var atk_mods = status_effects.get_stat_modifiers(attacker.entity_id)
		base_damage += atk_mods.get("strength", 0.0) * 0.5
		var def_mods = status_effects.get_stat_modifiers(defender.entity_id)
		defense += def_mods.get("defense", 0.0)

	# Critical hit check — based on dexterity
	var crit_chance = atk_stats.get("dexterity", 10.0) * 0.015
	var is_critical = randf() < clampf(crit_chance, 0.02, 0.3)
	if is_critical:
		base_damage *= 1.8  # 80% bonus damage on crit

	# Elemental damage from weapon enchantments
	var elemental_damage = 0.0
	var element = ""
	var atk_weapon = attacker.equipment.get("main_hand")
	if atk_weapon and atk_weapon is Dictionary:
		element = atk_weapon.get("element", "")
		if element != "":
			elemental_damage = base_damage * 0.25

	# Randomize +-20%
	base_damage *= 0.8 + randf() * 0.4

	# Weather affects combat
	if weather:
		base_damage *= weather.get_combat_modifier()

	# Apply defense and block
	var actual_damage = maxf(1.0, base_damage - defense * 0.5) + elemental_damage
	if was_blocked:
		actual_damage *= (1.0 - block_reduction)

	# Apply damage
	defender.base_stats["health"] -= actual_damage

	# Record causal event
	if causal_tracker:
		causal_tracker.record_event(attacker.entity_id, defender.entity_id, "attacked", {
			"type": attack_type, "damage": actual_damage,
			"defender_health": defender.base_stats["health"],
			"blocked": was_blocked,
		})

	# Update relationship to hostile
	if relationships:
		relationships.record_interaction(attacker.entity_id, defender.entity_id, "attacked")

	damage_dealt.emit(attacker.entity_id, defender.entity_id, actual_damage, attack_type)

	# Update mind states
	_update_combat_minds(attacker, defender, actual_damage)

	# Apply on-hit status effects based on attack type
	if status_effects:
		if attack_type == "magic" and randf() < 0.2:
			status_effects.apply_effect(defender.entity_id, "burning", 5.0, 0.5)

	# Weapon durability degradation
	var weapon = attacker.equipment.get("main_hand")
	if weapon and weapon is Dictionary and weapon.has("durability"):
		weapon["durability"] = maxf(0, weapon["durability"] - 1.0)
		if weapon["durability"] <= 0:
			attacker.unequip("main_hand")

	# Armor durability degradation on defender
	var armor = defender.equipment.get("chest")
	if armor and armor is Dictionary and armor.has("durability"):
		armor["durability"] = maxf(0, armor["durability"] - 0.5)

	var result := {
		"damage": actual_damage,
		"type": attack_type,
		"defender_health": defender.base_stats["health"],
		"defeated": false,
		"dodged": false,
		"blocked": was_blocked,
		"critical": is_critical,
		"element": element,
	}

	# Check death
	if defender.base_stats["health"] <= 0:
		result["defeated"] = true
		result["time_gained"] = defender.time_pool * 0.3
		_on_defeat(attacker, defender)

	return result

func can_attack(attacker: EntityBody, defender: EntityBody) -> bool:
	if attacker == null or defender == null:
		return false
	if not attacker.is_alive() or not defender.is_alive():
		return false
	if attacker.entity_id == defender.entity_id:
		return false
	return true

func calculate_dodge_chance(defender: EntityBody) -> float:
	var stats = defender.get_computed_stats()
	var dex: float = stats.get("dexterity", 10.0)
	return clampf(dex * 0.02, 0.0, 0.5)

func calculate_block_chance(defender: EntityBody) -> float:
	var stats = defender.get_computed_stats()
	var def_val: float = stats.get("defense", 0.0)
	var has_shield = defender.equipment.has("off_hand")
	var base_block = def_val * 0.015
	if has_shield:
		base_block += 0.15
	return clampf(base_block, 0.0, 0.6)

func ranged_attack(attacker: EntityBody, defender: EntityBody, distance: float) -> Dictionary:
	# Distance falloff: full damage at 0-10, linearly decreasing to 0 at 50
	var falloff = clampf(1.0 - (distance - 10.0) / 40.0, 0.2, 1.0)
	var result = attack(attacker, defender, "ranged")
	result["damage"] *= falloff
	result["distance"] = distance
	result["falloff"] = falloff
	return result

func magic_attack(attacker: EntityBody, defender: EntityBody, element: String = "fire") -> Dictionary:
	var result = attack(attacker, defender, "magic")
	result["element"] = element
	# Elemental effects
	if status_effects and result.get("damage", 0) > 0:
		match element:
			"fire":
				if randf() < 0.3:
					status_effects.apply_effect(defender.entity_id, "burning", 5.0, 0.5)
			"ice":
				if randf() < 0.3:
					status_effects.apply_effect(defender.entity_id, "frozen", 3.0, 0.5)
			"poison":
				if randf() < 0.4:
					status_effects.apply_effect(defender.entity_id, "poison", 8.0, 0.3)
			"holy":
				status_effects.apply_effect(attacker.entity_id, "blessed", 5.0, 0.3)
	return result

func _update_combat_minds(attacker: EntityBody, defender: EntityBody, damage: float) -> void:
	# Defender gains grudge against attacker
	var grudge := InfoGrain.new(InfoGrainTypes.Category.RELATIONAL, InfoGrainTypes.Relational.GRUDGE)
	grudge.intensity = minf(damage * 0.05, 1.0)
	grudge.target_entity_id = attacker.entity_id
	grudge.salience = 0.8
	grudge.decay_rate = 0.002
	defender.mind.add(grudge)

	# Defender feels fear or anger
	if defender.base_stats["health"] < defender.base_stats.get("max_health", 100.0) * 0.3:
		var fear := InfoGrain.new(InfoGrainTypes.Category.EMOTIONAL, InfoGrainTypes.Emotional.FEAR)
		fear.intensity = 0.8
		fear.salience = 0.9
		defender.mind.add(fear)
	else:
		var anger := InfoGrain.new(InfoGrainTypes.Category.EMOTIONAL, InfoGrainTypes.Emotional.ANGER)
		anger.intensity = 0.5
		anger.salience = 0.7
		defender.mind.add(anger)

	# Attacker might feel pride or guilt based on personality
	if attacker.mind.get_by_type(InfoGrainTypes.Category.EMOTIONAL, InfoGrainTypes.Emotional.JOY).size() > 0:
		var pride := InfoGrain.new(InfoGrainTypes.Category.EMOTIONAL, InfoGrainTypes.Emotional.PRIDE)
		pride.intensity = 0.3
		attacker.mind.add(pride)

func _on_defeat(attacker: EntityBody, defender: EntityBody) -> void:
	entity_defeated.emit(defender.entity_id, attacker.entity_id)

	# Time transfer: attacker gains some of defender's remaining time
	var time_gained = defender.time_pool * 0.3
	attacker.time_pool += time_gained
	defender.time_pool -= time_gained
	if time_system:
		time_system.time_transferred.emit(defender.entity_id, attacker.entity_id, time_gained, "consumption")

	if causal_tracker:
		causal_tracker.record_event(attacker.entity_id, defender.entity_id, "defeated", {
			"attacker_name": attacker.name,
			"defender_name": defender.name,
		})

	# Attacker gains vengeance satisfaction or guilt
	if attacker.mind.has_grudge_against(defender.entity_id):
		var satisfaction := InfoGrain.new(InfoGrainTypes.Category.EMOTIONAL, InfoGrainTypes.Emotional.CONTENTMENT)
		satisfaction.intensity = 0.6
		attacker.mind.add(satisfaction)

	combat_ended.emit(attacker.entity_id, defender.entity_id, "defeat")
