class_name WorldHistory
extends RefCounted

## Top-down world context hypergraph.
## Stores world events tagged by dimensions (political, economic, cultural, etc).
## NPCs query relevant dimensions to build contextual knowledge for dialogue.

enum Dimension {
	POLITICAL, ECONOMIC, CULTURAL, MILITARY, SPIRITUAL,
	NATURAL, SOCIAL, TECHNOLOGICAL, CRIMINAL, ROMANTIC,
}

var _events: Array = []
var _max_events: int = 500
var _bootstrapped: bool = false

func bootstrap_world_history() -> void:
	if _bootstrapped:
		return
	_bootstrapped = true

	# Seed world with foundational history
	record(["The Five Races formed the Alliance of Time three centuries ago."], [Dimension.POLITICAL, Dimension.CULTURAL])
	record(["The Great Time Famine of 50 years ago killed half the goblin population."], [Dimension.POLITICAL, Dimension.SOCIAL])
	record(["The Dwarven Forgemasters discovered mithril deposits in the northern mountains."], [Dimension.ECONOMIC, Dimension.TECHNOLOGICAL])
	record(["The Elven Seers predicted a convergence of time streams within the next decade."], [Dimension.SPIRITUAL, Dimension.CULTURAL])
	record(["Orc warbands have been raiding trade routes along the eastern frontier."], [Dimension.MILITARY, Dimension.CRIMINAL])
	record(["The human kingdom raised taxes on time transfers, sparking protests."], [Dimension.POLITICAL, Dimension.ECONOMIC])
	record(["A mysterious plague has been draining time from livestock in rural areas."], [Dimension.NATURAL, Dimension.ECONOMIC])
	record(["The Temple of Eternity offers blessings that extend life by decades."], [Dimension.SPIRITUAL, Dimension.SOCIAL])
	record(["An underground market for stolen time has emerged in the port cities."], [Dimension.CRIMINAL, Dimension.ECONOMIC])
	record(["The annual Festival of Sharing approaches, where communities pool time."], [Dimension.CULTURAL, Dimension.SOCIAL])
	record(["Dragon sightings have increased near the volcanic regions."], [Dimension.MILITARY, Dimension.NATURAL])
	record(["The Merchant Guild has established a new trade route through the forest."], [Dimension.ECONOMIC, Dimension.SOCIAL])
	record(["Border tensions between elf and dwarf territories have escalated."], [Dimension.POLITICAL, Dimension.MILITARY])
	record(["A legendary blacksmith has forged a time-capturing blade."], [Dimension.TECHNOLOGICAL, Dimension.CULTURAL])
	record(["Rumors of a mortal ascending to godhood have spread among the faithful."], [Dimension.SPIRITUAL, Dimension.POLITICAL])

func record(descriptions: Array, dimensions: Array, location: String = "", involved_species: Array = []) -> void:
	var event := {
		"descriptions": descriptions,
		"dimensions": dimensions,
		"location": location,
		"involved_species": involved_species,
		"timestamp": Time.get_unix_time_from_system(),
		"age": 0.0,
	}
	_events.append(event)
	if _events.size() > _max_events:
		_events.remove_at(0)

func record_live_event(description: String, dimensions: Array, location: String = "") -> void:
	record([description], dimensions, location)

func query_for_entity(entity_species: int, occupation: String = "", max_results: int = 5) -> String:
	var relevant: Array = []
	var relevant_dims = _get_relevant_dimensions(entity_species, occupation)

	for event in _events:
		var score := 0.0
		for dim in event["dimensions"]:
			if dim in relevant_dims:
				score += 1.0
		# Species relevance bonus
		if not event["involved_species"].is_empty():
			if entity_species in event["involved_species"]:
				score += 2.0
		if score > 0:
			relevant.append({"event": event, "score": score})

	relevant.sort_custom(func(a, b): return a["score"] > b["score"])

	var lines: Array = []
	for i in range(mini(relevant.size(), max_results)):
		var ev = relevant[i]["event"]
		for desc in ev["descriptions"]:
			lines.append("- %s" % desc)

	if lines.is_empty():
		return ""
	return "World knowledge:\n" + "\n".join(lines)

func _get_relevant_dimensions(species: int, occupation: String) -> Array:
	var dims: Array = [Dimension.SOCIAL, Dimension.CULTURAL]

	match species:
		EntityBody.Species.HUMAN: dims.append_array([Dimension.POLITICAL, Dimension.ECONOMIC])
		EntityBody.Species.ELF: dims.append_array([Dimension.SPIRITUAL, Dimension.CULTURAL])
		EntityBody.Species.DWARF: dims.append_array([Dimension.ECONOMIC, Dimension.TECHNOLOGICAL])
		EntityBody.Species.ORC: dims.append_array([Dimension.MILITARY, Dimension.POLITICAL])
		EntityBody.Species.GOBLIN: dims.append_array([Dimension.CRIMINAL, Dimension.ECONOMIC])

	match occupation:
		"merchant", "trader": dims.append(Dimension.ECONOMIC)
		"guard", "soldier", "hunter": dims.append(Dimension.MILITARY)
		"scholar", "priest": dims.append(Dimension.SPIRITUAL)
		"blacksmith", "farmer": dims.append(Dimension.TECHNOLOGICAL)
		_: pass

	return dims

func tick_aging(delta: float) -> void:
	for event in _events:
		event["age"] += delta

func get_recent_events(count: int = 10) -> Array:
	var start = maxi(0, _events.size() - count)
	return _events.slice(start)

func event_count() -> int:
	return _events.size()
