class_name GodSystem
extends RefCounted

signal entity_ascended(entity_id: int, domain: String)
signal divine_ability_used(god_id: int, ability: String)
signal faith_changed(god_id: int, worshipper_id: int, faith: float)

enum DivineDomain {
	WAR,
	HEALING,
	WISDOM,
	CREATION,
	NATURE,
	DEATH,
	TIME,
	CHAOS,
	ORDER,
}

const ASCENSION_TIME_COST: float = 50000.0
signal ascension_available(entity_id: int)
const FAITH_POWER_MULTIPLIER: float = 0.01

var _gods: Dictionary = {}
var _worshippers: Dictionary = {}
var _faith_pools: Dictionary = {}

func can_ascend(entity: EntityBody) -> bool:
	return entity.time_pool >= ASCENSION_TIME_COST and entity.age >= 100.0

func ascend(entity: EntityBody, domain: int) -> bool:
	if not can_ascend(entity):
		return false
	entity.time_pool -= ASCENSION_TIME_COST
	entity.species = EntityBody.Species.GOD
	_gods[entity.entity_id] = {
		"domain": domain,
		"divine_power": 1,
		"worshipper_count": 0,
		"faith_total": 0.0,
		"created_entities": [],
	}
	_faith_pools[entity.entity_id] = 0.0

	var pride := InfoGrain.new(InfoGrainTypes.Category.EMOTIONAL, InfoGrainTypes.Emotional.PRIDE)
	pride.intensity = 1.0
	pride.salience = 1.0
	entity.mind.add(pride)

	entity_ascended.emit(entity.entity_id, _domain_name(domain))
	return true

func worship(worshipper: EntityBody, god_id: int, faith_amount: float = 1.0) -> void:
	if not _gods.has(god_id):
		return
	if not _worshippers.has(god_id):
		_worshippers[god_id] = []
	if worshipper.entity_id not in _worshippers[god_id]:
		_worshippers[god_id].append(worshipper.entity_id)
		_gods[god_id]["worshipper_count"] += 1

	_faith_pools[god_id] = _faith_pools.get(god_id, 0.0) + faith_amount
	_gods[god_id]["faith_total"] += faith_amount

	var devotion := InfoGrain.new(InfoGrainTypes.Category.RELATIONAL, InfoGrainTypes.Relational.LOYALTY)
	devotion.intensity = 0.3
	devotion.target_entity_id = god_id
	worshipper.mind.add(devotion)

	faith_changed.emit(god_id, worshipper.entity_id, _faith_pools[god_id])

func use_divine_ability(god_entity: EntityBody, ability: String, target = null) -> Dictionary:
	if not _gods.has(god_entity.entity_id):
		return {"success": false, "reason": "not_a_god"}

	var god_data: Dictionary = _gods[god_entity.entity_id]
	var faith: float = _faith_pools.get(god_entity.entity_id, 0.0)

	match ability:
		"bless":
			if faith < 10.0:
				return {"success": false, "reason": "insufficient_faith"}
			_faith_pools[god_entity.entity_id] -= 10.0
			if target and target is EntityBody:
				target.time_pool += 500.0
			return {"success": true, "effect": "blessed_with_time", "amount": 500.0}
		"smite":
			if faith < 25.0:
				return {"success": false, "reason": "insufficient_faith"}
			_faith_pools[god_entity.entity_id] -= 25.0
			if target and target is EntityBody:
				target.base_stats["health"] -= 50.0
			return {"success": true, "effect": "divine_smite", "damage": 50.0}
		"create_entity":
			if faith < 100.0:
				return {"success": false, "reason": "insufficient_faith"}
			_faith_pools[god_entity.entity_id] -= 100.0
			god_data["created_entities"].append(Time.get_unix_time_from_system())
			return {"success": true, "effect": "entity_created"}
		"prophecy":
			if faith < 5.0:
				return {"success": false, "reason": "insufficient_faith"}
			_faith_pools[god_entity.entity_id] -= 5.0
			return {"success": true, "effect": "prophecy_given", "message": _generate_prophecy(god_data["domain"])}
		_:
			return {"success": false, "reason": "unknown_ability"}

func get_god_info(entity_id: int) -> Dictionary:
	return _gods.get(entity_id, {})

func get_faith(god_id: int) -> float:
	return _faith_pools.get(god_id, 0.0)

func is_god(entity_id: int) -> bool:
	return _gods.has(entity_id)

func _domain_name(domain: int) -> String:
	match domain:
		DivineDomain.WAR: return "War"
		DivineDomain.HEALING: return "Healing"
		DivineDomain.WISDOM: return "Wisdom"
		DivineDomain.CREATION: return "Creation"
		DivineDomain.NATURE: return "Nature"
		DivineDomain.DEATH: return "Death"
		DivineDomain.TIME: return "Time"
		DivineDomain.CHAOS: return "Chaos"
		DivineDomain.ORDER: return "Order"
		_: return "Unknown"

func _generate_prophecy(domain: int) -> String:
	var prophecies := {
		DivineDomain.WAR: ["A great battle approaches.", "Blood will be shed before the moon rises.", "Your enemies gather strength."],
		DivineDomain.HEALING: ["A plague will test the faithful.", "Seek the healing springs to the north.", "One among you carries a hidden wound."],
		DivineDomain.WISDOM: ["Knowledge lies beneath the ancient stones.", "The answers you seek are within.", "A scholar's discovery will change everything."],
		DivineDomain.TIME: ["Time grows short for the old ones.", "A child born today will reshape the world.", "The past echoes in the present."],
		DivineDomain.NATURE: ["The forest remembers what mortals forget.", "A great tree is dying. Save it.", "Nature will reclaim what was taken."],
		DivineDomain.DEATH: ["Death comes for the proud.", "The dead do not rest easy here.", "A soul seeks passage to the beyond."],
	}
	var options: Array = prophecies.get(domain, ["The future is uncertain."])
	return options[randi() % options.size()]
