class_name PopulationSim
extends RefCounted

signal birth(parent_a_id: int, parent_b_id: int, child_id: int)
signal death(entity_id: int, cause: String)
signal migration(entity_id: int, from_x: int, from_y: int, to_x: int, to_y: int)

var entity_spawner: EntitySpawner
var relationships: RelationshipSystem
var time_sys: TimeSystem
var entity_lifecycle: EntityLifecycle
var loot_system: LootSystem
var causal_tracker: CausalTracker
var _sim_timer: float = 0.0

func _init(p_spawner: EntitySpawner = null, p_rel: RelationshipSystem = null, p_time: TimeSystem = null) -> void:
	entity_spawner = p_spawner
	relationships = p_rel
	time_sys = p_time

func tick(delta: float) -> void:
	_sim_timer += delta
	if _sim_timer < 5.0:
		return
	_sim_timer = 0.0

	if entity_spawner == null:
		return

	_process_aging()
	_process_reproduction()
	_process_natural_death()

func _process_aging() -> void:
	for eid in entity_spawner._entities:
		var data: Dictionary = entity_spawner._entities[eid]
		var body: EntityBody = data["body"]
		body.age += 0.01
		# Time consumption based on life stage
		if time_sys and entity_lifecycle:
			var life_pct = entity_lifecycle.get_life_percentage(body)
			var consumption_rate = 1.0 + life_pct * 0.5  # Elderly consume more time
			body.time_pool -= 0.1 * consumption_rate

func _process_reproduction() -> void:
	if entity_spawner.entity_count() >= 200:
		return
	if relationships == null:
		return

	for eid in entity_spawner._entities:
		var data: Dictionary = entity_spawner._entities[eid]
		var body: EntityBody = data["body"]

		if body.age < 18.0 or body.age > 50.0:
			continue
		if randf() > 0.001:
			continue

		var rels = relationships.get_all_relationships(eid)
		for rel in rels:
			if rel["type"] >= RelationshipSystem.RelType.ROMANTIC and rel["strength"] > 0.7:
				var partner = entity_spawner.get_entity(rel["entity_id"])
				if partner and partner.age >= 18.0 and partner.age <= 50.0:
					_create_child(body, partner, data["world_x"], data["world_y"])
					break

func _create_child(parent_a: EntityBody, parent_b: EntityBody, wx: int, wy: int) -> void:
	if entity_spawner == null:
		return
	var child_species: int = parent_a.species if randf() > 0.5 else parent_b.species
	var child_name := "Child of %s" % parent_a.name
	var child := entity_spawner.spawn_npc(child_species, child_name, wx + randi_range(-3, 3), wy + randi_range(-3, 3), 0.0)
	child.time_pool = 36000.0

	if relationships:
		relationships.register_family(parent_a.entity_id, parent_b.entity_id, child.entity_id)

	birth.emit(parent_a.entity_id, parent_b.entity_id, child.entity_id)

func _process_natural_death() -> void:
	var dead_ids: Array = []
	for eid in entity_spawner._entities:
		var data: Dictionary = entity_spawner._entities[eid]
		var body: EntityBody = data["body"]

		# Use species-specific max age from lifecycle
		var life_pct = 1.0
		if entity_lifecycle:
			life_pct = entity_lifecycle.get_life_percentage(body)

		# Death chance increases exponentially past 80% lifespan
		if life_pct > 0.8:
			var death_chance = 0.001 * (life_pct - 0.8) * 50.0
			if randf() < death_chance:
				dead_ids.append({"id": eid, "cause": "old_age"})
		# Out of time = death
		if body.time_pool <= 0:
			dead_ids.append({"id": eid, "cause": "time_depleted"})
		# Health depleted
		if body.base_stats.get("health", 100) <= 0:
			dead_ids.append({"id": eid, "cause": "injuries"})

	for entry in dead_ids:
		var eid = entry["id"]
		var cause = entry["cause"]
		# Generate loot drop
		if loot_system:
			var body = entity_spawner.get_entity(eid)
			if body:
				var loot = loot_system.generate_loot(body)
				var pos = entity_spawner.get_entity_position(eid)
				loot_system.drop_items_at(loot, pos.x, pos.y)
		# Record causal event
		if causal_tracker:
			causal_tracker.record_event(-1, eid, "natural_death", {"cause": cause})
		death.emit(eid, cause)

func get_population_stats() -> Dictionary:
	if entity_spawner == null:
		return {}
	var total := entity_spawner.entity_count()
	var by_species := {}
	var avg_age := 0.0
	for eid in entity_spawner._entities:
		var body: EntityBody = entity_spawner._entities[eid]["body"]
		var sp := body.species
		by_species[sp] = by_species.get(sp, 0) + 1
		avg_age += body.age
	if total > 0:
		avg_age /= total
	return {"total": total, "by_species": by_species, "avg_age": avg_age}
