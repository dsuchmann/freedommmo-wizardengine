class_name NPCInteractions
extends RefCounted

var entity_spawner: EntitySpawner
var relationships: RelationshipSystem
var dialogue_engine: DialogueEngine
var combat_system: CombatSystem
var causal_tracker: CausalTracker
var faction_sys: FactionSystem

var _interaction_timer: float = 0.0

func _init(p_spawner: EntitySpawner = null, p_rel: RelationshipSystem = null,
		p_dialogue: DialogueEngine = null, p_combat: CombatSystem = null,
		p_causal: CausalTracker = null, p_faction: FactionSystem = null) -> void:
	entity_spawner = p_spawner
	relationships = p_rel
	dialogue_engine = p_dialogue
	combat_system = p_combat
	causal_tracker = p_causal
	faction_sys = p_faction

func tick(delta: float) -> Array:
	_interaction_timer += delta
	if _interaction_timer < 2.0:
		return []
	_interaction_timer = 0.0

	var events: Array = []
	if entity_spawner == null:
		return events

	# Check each NPC pair that's close together
	var entities := entity_spawner._entities
	var ids = entities.keys()

	for i in range(ids.size()):
		for j in range(i + 1, mini(ids.size(), i + 5)):
			var eid_a: int = ids[i]
			var eid_b: int = ids[j]
			var data_a: Dictionary = entities[eid_a]
			var data_b: Dictionary = entities[eid_b]

			var dist = abs(data_a["world_x"] - data_b["world_x"]) + abs(data_a["world_y"] - data_b["world_y"])
			if dist > 8:
				continue

			var event = _process_npc_pair(data_a["body"], data_b["body"], dist)
			if not event.is_empty():
				events.append(event)

	return events

func _process_npc_pair(npc_a: EntityBody, npc_b: EntityBody, distance: int) -> Dictionary:
	# Check if they're hostile
	if faction_sys and faction_sys.are_hostile(npc_a.entity_id, npc_b.entity_id):
		if distance <= 3 and randf() > 0.8:
			return _npc_fight(npc_a, npc_b)

	# Check if they have a grudge
	if npc_a.mind.has_grudge_against(npc_b.entity_id):
		if randf() > 0.9:
			return _npc_fight(npc_a, npc_b)

	# Friendly interactions — more frequent
	if distance <= 5 and randf() > 0.7:
		return _npc_chat(npc_a, npc_b)

	# Trade between merchants
	if distance <= 4 and randf() > 0.85:
		return _npc_trade(npc_a, npc_b)

	# Romance/bond check — happens when NPCs have existing bonds
	if npc_a.mind.has_bond_with(npc_b.entity_id) and randf() > 0.8:
		return _npc_bond_interaction(npc_a, npc_b)

	return {}

func _npc_chat(npc_a: EntityBody, npc_b: EntityBody) -> Dictionary:
	if relationships:
		relationships.record_interaction(npc_a.entity_id, npc_b.entity_id, "conversation")
	if causal_tracker:
		causal_tracker.record_event(npc_a.entity_id, npc_b.entity_id, "npc_conversation", {})
	# Chatting builds bonds over time
	var bond = InfoGrain.new(InfoGrainTypes.Category.RELATIONAL, InfoGrainTypes.Relational.BOND)
	bond.intensity = 0.1
	bond.target_entity_id = npc_b.entity_id
	bond.salience = 0.2
	bond.decay_rate = 0.01
	npc_a.mind.add(bond)
	# Store memory of conversation
	var memory = InfoGrain.new(InfoGrainTypes.Category.COGNITIVE, InfoGrainTypes.Cognitive.MEMORY)
	memory.intensity = 0.3
	memory.context = {"type": "chatted_with", "name": npc_b.name}
	memory.decay_rate = 0.01
	npc_a.mind.add(memory)
	return {"type": "chat", "a": npc_a.name, "b": npc_b.name, "a_id": npc_a.entity_id, "b_id": npc_b.entity_id}

func _npc_trade(npc_a: EntityBody, npc_b: EntityBody) -> Dictionary:
	if relationships:
		relationships.record_interaction(npc_a.entity_id, npc_b.entity_id, "trade")
	if causal_tracker:
		causal_tracker.record_event(npc_a.entity_id, npc_b.entity_id, "npc_trade", {})
	return {"type": "trade", "a": npc_a.name, "b": npc_b.name}

func _npc_fight(npc_a: EntityBody, npc_b: EntityBody) -> Dictionary:
	if combat_system == null:
		return {}
	var result = combat_system.attack(npc_a, npc_b)
	if relationships:
		relationships.record_interaction(npc_a.entity_id, npc_b.entity_id, "attacked")
	# Nearby NPCs witness the fight
	if entity_spawner:
		var fight_pos = entity_spawner.get_entity_position(npc_b.entity_id)
		if fight_pos.x >= 0:
			var witnesses = entity_spawner.get_entities_near(fight_pos.x, fight_pos.y, 15)
			for witness in witnesses:
				if witness.entity_id == npc_a.entity_id or witness.entity_id == npc_b.entity_id:
					continue
				var obs = InfoGrain.new(InfoGrainTypes.Category.OBSERVATIONAL, InfoGrainTypes.Observational.WITNESSED)
				obs.intensity = 0.6
				obs.salience = 0.7
				obs.context = {"type": "fight", "world_x": fight_pos.x, "world_y": fight_pos.y,
					"attacker": npc_a.name, "defender": npc_b.name}
				obs.decay_rate = 0.008
				witness.mind.add(obs)
				# Fear response to violence
				var fear = InfoGrain.new(InfoGrainTypes.Category.EMOTIONAL, InfoGrainTypes.Emotional.FEAR)
				fear.intensity = 0.3
				fear.target_entity_id = npc_a.entity_id
				fear.decay_rate = 0.02
				witness.mind.add(fear)
	return {"type": "fight", "attacker": npc_a.name, "defender": npc_b.name, "damage": result.get("damage", 0)}

func _npc_bond_interaction(npc_a: EntityBody, npc_b: EntityBody) -> Dictionary:
	if relationships:
		relationships.modify_strength(npc_a.entity_id, npc_b.entity_id, 0.05)
	return {"type": "bond", "a": npc_a.name, "b": npc_b.name}
