class_name CommandInterpreter
extends RefCounted

## Natural Language Command System
## Decomposes player text into sequences of primitive game actions.
## Dual approach: bottom-up (primitives compose into sequences) +
## top-down (pre-defined templates for common patterns).

signal command_started(action_queue: Array)
signal action_completed(action: Dictionary)
signal command_completed(results: Array)
signal command_failed(reason: String)

enum ActionType {
	MOVE_TO, ATTACK, INTERACT, USE_ITEM, CRAFT, EQUIP, UNEQUIP,
	TRADE, TALK, PICKUP, DROP, DIG, BURN, INSPECT, WAIT,
	FOLLOW, FLEE, GIVE, STEAL, SEARCH, OPEN, CLOSE, CONSUME,
	STRIP, EMBRACE, SEDUCE
}

const ACTION_NAMES: Dictionary = {
	ActionType.MOVE_TO: "move_to",
	ActionType.ATTACK: "attack",
	ActionType.INTERACT: "interact",
	ActionType.USE_ITEM: "use_item",
	ActionType.CRAFT: "craft",
	ActionType.EQUIP: "equip",
	ActionType.UNEQUIP: "unequip",
	ActionType.TRADE: "trade",
	ActionType.TALK: "talk",
	ActionType.PICKUP: "pickup",
	ActionType.DROP: "drop",
	ActionType.DIG: "dig",
	ActionType.BURN: "burn",
	ActionType.INSPECT: "inspect",
	ActionType.WAIT: "wait",
	ActionType.FOLLOW: "follow",
	ActionType.FLEE: "flee",
	ActionType.GIVE: "give",
	ActionType.STEAL: "steal",
	ActionType.SEARCH: "search",
	ActionType.OPEN: "open",
	ActionType.CLOSE: "close",
	ActionType.CONSUME: "consume",
	ActionType.STRIP: "strip",
	ActionType.EMBRACE: "embrace",
	ActionType.SEDUCE: "seduce",
}

# Verb → ActionType mapping (bottom-up: verbs are primitives)
const VERB_MAP: Dictionary = {
	"go": ActionType.MOVE_TO, "walk": ActionType.MOVE_TO, "move": ActionType.MOVE_TO,
	"run": ActionType.MOVE_TO, "approach": ActionType.MOVE_TO, "head": ActionType.MOVE_TO,
	"attack": ActionType.ATTACK, "hit": ActionType.ATTACK, "strike": ActionType.ATTACK,
	"fight": ActionType.ATTACK, "kill": ActionType.ATTACK, "slash": ActionType.ATTACK,
	"punch": ActionType.ATTACK, "destroy": ActionType.ATTACK, "smash": ActionType.ATTACK,
	"talk": ActionType.TALK, "speak": ActionType.TALK, "say": ActionType.TALK,
	"chat": ActionType.TALK, "greet": ActionType.TALK, "ask": ActionType.TALK,
	"converse": ActionType.TALK, "tell": ActionType.TALK,
	"trade": ActionType.TRADE, "buy": ActionType.TRADE, "sell": ActionType.TRADE,
	"barter": ActionType.TRADE,
	"pickup": ActionType.PICKUP, "pick": ActionType.PICKUP, "grab": ActionType.PICKUP,
	"take": ActionType.PICKUP, "collect": ActionType.PICKUP, "loot": ActionType.PICKUP,
	"gather": ActionType.PICKUP,
	"drop": ActionType.DROP, "throw": ActionType.DROP, "discard": ActionType.DROP,
	"dig": ActionType.DIG, "mine": ActionType.DIG, "excavate": ActionType.DIG,
	"burn": ActionType.BURN, "ignite": ActionType.BURN, "light": ActionType.BURN,
	"set fire": ActionType.BURN,
	"inspect": ActionType.INSPECT, "examine": ActionType.INSPECT, "look": ActionType.INSPECT,
	"check": ActionType.INSPECT, "observe": ActionType.INSPECT, "study": ActionType.INSPECT,
	"equip": ActionType.EQUIP, "wear": ActionType.EQUIP, "put on": ActionType.EQUIP,
	"wield": ActionType.EQUIP,
	"unequip": ActionType.UNEQUIP, "remove": ActionType.UNEQUIP, "take off": ActionType.UNEQUIP,
	"craft": ActionType.CRAFT, "make": ActionType.CRAFT, "build": ActionType.CRAFT,
	"create": ActionType.CRAFT, "forge": ActionType.CRAFT,
	"use": ActionType.USE_ITEM, "activate": ActionType.USE_ITEM, "drink": ActionType.CONSUME,
	"eat": ActionType.CONSUME, "consume": ActionType.CONSUME,
	"wait": ActionType.WAIT, "rest": ActionType.WAIT, "sleep": ActionType.WAIT,
	"follow": ActionType.FOLLOW, "track": ActionType.FOLLOW, "tail": ActionType.FOLLOW,
	"flee": ActionType.FLEE, "escape": ActionType.FLEE, "retreat": ActionType.FLEE,
	"give": ActionType.GIVE, "hand": ActionType.GIVE, "offer": ActionType.GIVE,
	"share": ActionType.GIVE, "donate": ActionType.GIVE,
	"steal": ActionType.STEAL, "rob": ActionType.STEAL, "pickpocket": ActionType.STEAL,
	"search": ActionType.SEARCH, "investigate": ActionType.SEARCH, "rummage": ActionType.SEARCH,
	"open": ActionType.OPEN, "unlock": ActionType.OPEN,
	"close": ActionType.CLOSE, "shut": ActionType.CLOSE, "lock": ActionType.CLOSE,
	"strip": ActionType.STRIP, "undress": ActionType.STRIP,
	"embrace": ActionType.EMBRACE, "hug": ActionType.EMBRACE, "hold": ActionType.EMBRACE,
	"kiss": ActionType.EMBRACE,
	"seduce": ActionType.SEDUCE, "flirt": ActionType.SEDUCE, "charm": ActionType.SEDUCE,
	"suck": ActionType.INTERACT, "touch": ActionType.INTERACT, "feel": ActionType.INTERACT,
	"caress": ActionType.INTERACT, "massage": ActionType.INTERACT,
	"sex": ActionType.SEDUCE, "fuck": ActionType.SEDUCE, "mate": ActionType.SEDUCE,
	"have sex": ActionType.SEDUCE, "make love": ActionType.SEDUCE,
	"sleep with": ActionType.SEDUCE, "lay with": ActionType.SEDUCE,
	"lick": ActionType.INTERACT, "bite": ActionType.INTERACT, "grope": ActionType.INTERACT,
	"fondle": ActionType.INTERACT, "mount": ActionType.INTERACT,
	"propose": ActionType.SEDUCE, "court": ActionType.SEDUCE, "woo": ActionType.SEDUCE,
}

# Target type classifiers
const TARGET_ENTITY_WORDS: Array = [
	"woman", "man", "person", "npc", "villager", "merchant", "guard",
	"elf", "dwarf", "orc", "goblin", "dragon", "human",
	"her", "him", "them", "it", "that", "this",
	"nearest", "closest", "nearby",
]

const TARGET_OBJECT_WORDS: Array = [
	"chest", "door", "crate", "barrel", "box", "container",
	"rock", "stone", "tree", "bush", "plant",
	"ore", "crystal", "mushroom", "herb", "flower",
	"item", "weapon", "armor", "potion", "food",
	"ground", "floor", "wall", "building", "house",
]

const TARGET_BODY_PARTS: Array = [
	"shirt", "pants", "armor", "helmet", "boots", "gloves",
	"head", "face", "chest", "hand", "arm", "leg",
	"nipple", "nipples", "breast", "breasts", "lip", "lips",
	"neck", "shoulder", "back", "waist", "hair",
]

# Top-down: pre-defined command templates for common multi-step patterns
var _templates: Array = []

# Action queue for current command execution
var _action_queue: Array = []
var _current_action_idx: int = -1
var _executing: bool = false

# World reference for target resolution
var _world_manager = null
var _player_world_pos := Vector2i(64, 64)

func _init() -> void:
	_init_templates()

func set_world_manager(wm) -> void:
	_world_manager = wm

func update_player_position(wx: int, wy: int) -> void:
	_player_world_pos = Vector2i(wx, wy)

func parse_command(text: String) -> Array:
	var cleaned = text.strip_edges().to_lower()
	if cleaned.is_empty():
		return []

	# Try template matching first (top-down)
	var template_result = _match_template(cleaned)
	if not template_result.is_empty():
		return template_result

	# Fall back to verb parsing (bottom-up)
	var verb_result = _parse_verbs(cleaned)
	if not verb_result.is_empty():
		return verb_result

	# Final fallback: treat as speech to nearest NPC
	return [{"type": ActionType.TALK, "target": "nearest", "target_type": "entity", "message": text}]

func execute_command(text: String) -> void:
	var actions = parse_command(text)
	if actions.is_empty():
		command_failed.emit("I don't understand: '%s'" % text)
		return

	_action_queue = actions
	_current_action_idx = 0
	_executing = true
	command_started.emit(actions)
	_execute_next()

func tick(delta: float) -> void:
	if not _executing:
		return
	if _current_action_idx >= _action_queue.size():
		_finish_command()
		return
	var current = _action_queue[_current_action_idx]
	var wait_time = current.get("wait_time", 0.0)
	if wait_time > 0:
		current["wait_time"] = wait_time - delta
		return
	# Action is ready to execute
	_execute_current_action()

func is_executing() -> bool:
	return _executing

func cancel() -> void:
	_executing = false
	_action_queue.clear()
	_current_action_idx = -1

func _execute_next() -> void:
	if _current_action_idx >= _action_queue.size():
		_finish_command()
		return
	_execute_current_action()

func _execute_current_action() -> void:
	if _current_action_idx >= _action_queue.size():
		_finish_command()
		return

	var action = _action_queue[_current_action_idx]
	var action_type = action.get("type", -1)
	var result = _dispatch_action(action_type, action)
	action["result"] = result
	action_completed.emit(action)
	_current_action_idx += 1

	if _current_action_idx < _action_queue.size():
		# Small delay between chained actions for readability
		_action_queue[_current_action_idx]["wait_time"] = 0.3

func _finish_command() -> void:
	var results: Array = []
	for a in _action_queue:
		results.append(a.get("result", {}))
	command_completed.emit(results)
	_executing = false
	_action_queue.clear()
	_current_action_idx = -1

func _dispatch_action(action_type: int, action: Dictionary) -> Dictionary:
	if _world_manager == null:
		return {"success": false, "reason": "no_world_manager"}

	var target = action.get("target", "")
	var target_type = action.get("target_type", "")

	match action_type:
		ActionType.MOVE_TO:
			return _do_move_to(target, target_type)
		ActionType.ATTACK:
			return _do_attack(target)
		ActionType.TALK:
			return _do_talk(target, action.get("message", ""))
		ActionType.INSPECT:
			return _do_inspect(target, target_type)
		ActionType.PICKUP:
			return _do_pickup()
		ActionType.DIG:
			return _do_dig()
		ActionType.BURN:
			return _do_burn()
		ActionType.TRADE:
			return _do_trade(target)
		ActionType.SEARCH:
			return _do_search(target)
		ActionType.INTERACT:
			return _do_interact(target, action.get("detail", ""))
		ActionType.EQUIP:
			return _do_equip(target)
		ActionType.UNEQUIP:
			return _do_unequip(target)
		ActionType.CONSUME:
			return _do_consume(target)
		ActionType.CRAFT:
			return _do_craft(target)
		ActionType.WAIT:
			return {"success": true, "message": "You wait..."}
		ActionType.FOLLOW:
			return _do_follow(target)
		ActionType.FLEE:
			return {"success": true, "message": "You try to flee!"}
		ActionType.GIVE:
			return _do_give(target, action.get("item", ""))
		ActionType.STEAL:
			return _do_steal(target)
		ActionType.OPEN:
			return _do_interact(target, "open")
		ActionType.CLOSE:
			return _do_interact(target, "close")
		ActionType.STRIP:
			return _do_interact(target, "strip")
		ActionType.EMBRACE:
			return _do_interact(target, "embrace")
		ActionType.SEDUCE:
			return _do_interact(target, "seduce")
		_:
			return {"success": false, "reason": "unknown_action"}

# --- Action implementations ---

func _do_move_to(target: String, target_type: String) -> Dictionary:
	# Resolve target to world position
	if target_type == "entity":
		var npc = _find_npc_by_description(target)
		if npc:
			var pos = _world_manager.entity_spawner.get_entity_position(npc.entity_id)
			return {"success": true, "message": "Moving toward %s" % npc.name, "target_pos": pos}
	return {"success": true, "message": "Moving toward %s" % target}

func _do_attack(target: String) -> Dictionary:
	var npc = _find_npc_by_description(target)
	if npc == null:
		return {"success": false, "reason": "No target found matching '%s'" % target}
	var player = _world_manager.player_mgr.entity
	if player == null:
		return {"success": false, "reason": "No player entity"}
	var result = _world_manager.attack_entity(player, npc)
	return {"success": true, "message": "Attacked %s for %.0f damage" % [npc.name, result.get("damage", 0)], "combat_result": result}

func _do_talk(target: String, message: String) -> Dictionary:
	var npc = _find_npc_by_description(target)
	if npc == null:
		return {"success": false, "reason": "No one nearby to talk to"}
	var response = _world_manager.talk_to_npc(npc, message)
	return {"success": true, "message": response, "npc_name": npc.name}

func _do_inspect(target: String, target_type: String) -> Dictionary:
	if target_type == "entity":
		var npc = _find_npc_by_description(target)
		if npc:
			var stats = npc.get_computed_stats()
			return {"success": true, "message": "%s - HP:%.0f Age:%.0f" % [npc.name, stats.get("health", 0), npc.age], "entity": npc}
	# Inspect terrain
	var player = _world_manager.player_mgr.entity
	if player:
		var info = _world_manager.get_stack_info(0, 0)
		return {"success": true, "message": "Ground: %d layers" % info.get("depth", 0), "terrain": info}
	return {"success": false, "reason": "Nothing to inspect"}

func _do_pickup() -> Dictionary:
	return {"success": true, "message": "Picking up items...", "action": "pickup"}

func _do_dig() -> Dictionary:
	return {"success": true, "message": "Digging...", "action": "dig"}

func _do_burn() -> Dictionary:
	return {"success": true, "message": "Setting fire...", "action": "burn"}

func _do_trade(target: String) -> Dictionary:
	var npc = _find_npc_by_description(target)
	if npc == null:
		return {"success": false, "reason": "No merchant nearby"}
	return {"success": true, "message": "Opening trade with %s" % npc.name, "npc": npc, "action": "trade"}

func _do_search(target: String) -> Dictionary:
	return {"success": true, "message": "Searching %s..." % target, "action": "search"}

func _do_interact(target: String, detail: String) -> Dictionary:
	var npc = _find_npc_by_description(target)
	if npc == null:
		return {"success": false, "reason": "No one nearby to interact with"}
	# Route intimate/physical interactions through dialogue for LLM response
	var intimate_actions = ["seduce", "strip", "embrace", "kiss", "sex", "touch", "grope", "fondle", "mount"]
	if detail in intimate_actions:
		var action_message = "* You attempt to %s %s *" % [detail, npc.name]
		var brain = _world_manager.entity_spawner._npc_brains.get(npc.entity_id)
		if brain:
			var response = _world_manager.dialogue_engine.request_dialogue(npc, brain, action_message)
			return {"success": true, "message": response, "npc": npc, "detail": detail, "action": "dialogue"}
	# Record the interaction
	if _world_manager.causal:
		_world_manager.causal.record_event(0, npc.entity_id, "interact_%s" % detail, {})
	return {"success": true, "message": "You %s %s" % [detail, npc.name], "npc": npc, "detail": detail}

func _do_equip(item_name: String) -> Dictionary:
	return {"success": true, "message": "Equipping %s" % item_name, "action": "equip"}

func _do_unequip(item_name: String) -> Dictionary:
	return {"success": true, "message": "Unequipping %s" % item_name, "action": "unequip"}

func _do_consume(item_name: String) -> Dictionary:
	return {"success": true, "message": "Consuming %s" % item_name, "action": "consume"}

func _do_craft(item_name: String) -> Dictionary:
	return {"success": true, "message": "Crafting %s" % item_name, "action": "craft"}

func _do_follow(target: String) -> Dictionary:
	var npc = _find_npc_by_description(target)
	if npc:
		return {"success": true, "message": "Following %s" % npc.name, "npc": npc}
	return {"success": false, "reason": "No one to follow"}

func _do_give(target: String, item: String) -> Dictionary:
	var npc = _find_npc_by_description(target)
	if npc == null:
		return {"success": false, "reason": "No one to give to"}
	# Time sharing
	if item.find("time") >= 0 or item.find("share") >= 0:
		var amount = 100.0
		var player = _world_manager.player_mgr.entity
		if player and player.time_pool > amount:
			player.time_pool -= amount
			npc.time_pool += amount * 0.95  # 95% transfer efficiency
			_world_manager.relationships.record_interaction(0, npc.entity_id, "shared_time")
			_world_manager.morality.record_action(0, "charity", npc.entity_id)
			# Build strong bond
			var bond = InfoGrain.new(InfoGrainTypes.Category.RELATIONAL, InfoGrainTypes.Relational.BOND)
			bond.intensity = 0.5
			bond.target_entity_id = 0
			bond.salience = 0.8
			npc.mind.add(bond)
			return {"success": true, "message": "You shared 100 time with %s. They are grateful." % npc.name, "action": "shared_time"}
		return {"success": false, "reason": "Not enough time to share"}
	return {"success": true, "message": "Giving %s to %s" % [item, npc.name]}

func _do_steal(target: String) -> Dictionary:
	var npc = _find_npc_by_description(target)
	if npc:
		_world_manager.morality.record_action(0, "steal", npc.entity_id)
		return {"success": true, "message": "Attempting to steal from %s" % npc.name}
	return {"success": false, "reason": "No target to steal from"}

# --- Target resolution ---

func _find_npc_by_description(desc: String) -> EntityBody:
	if _world_manager == null:
		return null
	var player = _world_manager.player_mgr.entity
	if player == null:
		return null
	var nearby = _world_manager.entity_spawner.get_entities_near(_player_world_pos.x, _player_world_pos.y, 50)
	if nearby.is_empty():
		return null

	# Try matching by name or species
	var desc_lower = desc.to_lower()
	for npc in nearby:
		if npc.name.to_lower().find(desc_lower) >= 0:
			return npc

	# Try matching by species keyword
	for npc in nearby:
		var species_name = _species_to_string(npc.species).to_lower()
		if desc_lower.find(species_name) >= 0:
			return npc

	# Try gender-like descriptors
	if desc_lower.find("woman") >= 0 or desc_lower.find("her") >= 0 or desc_lower.find("female") >= 0:
		for npc in nearby:
			if npc.name.find("Female") >= 0 or npc.name.find("Woman") >= 0:
				return npc

	if desc_lower.find("man") >= 0 or desc_lower.find("him") >= 0 or desc_lower.find("male") >= 0:
		for npc in nearby:
			if npc.name.find("Male") >= 0 or npc.name.find("Man") >= 0:
				return npc

	# Default: nearest NPC
	if not nearby.is_empty():
		return nearby[0]
	return null

func _species_to_string(species: int) -> String:
	match species:
		EntityBody.Species.HUMAN: return "Human"
		EntityBody.Species.ELF: return "Elf"
		EntityBody.Species.DWARF: return "Dwarf"
		EntityBody.Species.ORC: return "Orc"
		EntityBody.Species.GOBLIN: return "Goblin"
		EntityBody.Species.DRAGON: return "Dragon"
		_: return "Unknown"

# --- Bottom-up verb parser ---

func _parse_verbs(text: String) -> Array:
	var actions: Array = []
	# Split on conjunctions to get sub-commands
	var clauses = _split_clauses(text)

	for clause in clauses:
		var action = _parse_single_clause(clause)
		if not action.is_empty():
			actions.append(action)

	# If text has implicit "go to" (e.g., just a target with no verb), prepend move
	if actions.size() > 0 and actions[0].get("type", -1) != ActionType.MOVE_TO:
		var first_target = actions[0].get("target", "")
		var first_target_type = actions[0].get("target_type", "")
		if first_target_type == "entity" and first_target != "":
			actions.insert(0, {"type": ActionType.MOVE_TO, "target": first_target, "target_type": "entity"})

	return actions

func _split_clauses(text: String) -> Array:
	var result: Array = []
	# Split on "and", "then", ",", "."
	var parts = text.replace(",", " and ").replace(".", " and ").replace(" then ", " and ").split(" and ")
	for p in parts:
		var trimmed = p.strip_edges()
		if not trimmed.is_empty():
			result.append(trimmed)
	return result

func _parse_single_clause(clause: String) -> Dictionary:
	var words = clause.split(" ", false)
	if words.is_empty():
		return {}

	var action_type: int = -1
	var target: String = ""
	var target_type: String = ""
	var detail: String = ""
	var verb_end: int = 0

	# Try multi-word verbs first ("take off", "put on", "set fire")
	for i in range(mini(words.size() - 1, 3)):
		var two_word = words[i] + " " + words[mini(i + 1, words.size() - 1)]
		if VERB_MAP.has(two_word):
			action_type = VERB_MAP[two_word]
			verb_end = i + 2
			break

	# Try single-word verbs
	if action_type == -1:
		for i in range(mini(words.size(), 4)):
			var word = words[i]
			if VERB_MAP.has(word):
				action_type = VERB_MAP[word]
				verb_end = i + 1
				break

	if action_type == -1:
		return {}

	# Extract target from remaining words
	var remaining = ""
	for i in range(verb_end, words.size()):
		remaining += words[i] + " "
	remaining = remaining.strip_edges()

	# Remove filler words
	remaining = _remove_fillers(remaining)

	# Classify target
	target = remaining
	target_type = _classify_target(remaining)

	# Extract body part detail if present
	for part in TARGET_BODY_PARTS:
		if remaining.find(part) >= 0:
			detail = part
			break

	return {
		"type": action_type,
		"target": target,
		"target_type": target_type,
		"detail": detail,
		"raw_clause": clause,
	}

func _remove_fillers(text: String) -> String:
	var fillers := ["the", "a", "an", "to", "at", "on", "up", "in", "with",
		"for", "from", "into", "onto", "of", "that", "this", "some"]
	var words = text.split(" ", false)
	var result: Array = []
	for w in words:
		if w not in fillers or result.is_empty():
			result.append(w)
	return " ".join(result)

func _classify_target(text: String) -> String:
	var lower = text.to_lower()
	for word in TARGET_ENTITY_WORDS:
		if lower.find(word) >= 0:
			return "entity"
	for word in TARGET_OBJECT_WORDS:
		if lower.find(word) >= 0:
			return "object"
	for word in TARGET_BODY_PARTS:
		if lower.find(word) >= 0:
			return "body_part"
	if not text.is_empty():
		return "unknown"
	return ""

# --- Top-down template matching ---

func _init_templates() -> void:
	_templates = [
		{
			"pattern": ["go", "to", "*", "and", "talk"],
			"keywords": ["go", "talk"],
			"actions": [
				{"type": ActionType.MOVE_TO, "target_slot": 0},
				{"type": ActionType.TALK, "target_slot": 0},
			]
		},
		{
			"pattern": ["go", "to", "*", "and", "attack"],
			"keywords": ["go", "attack"],
			"actions": [
				{"type": ActionType.MOVE_TO, "target_slot": 0},
				{"type": ActionType.ATTACK, "target_slot": 0},
			]
		},
		{
			"pattern": ["go", "to", "*", "and", "trade"],
			"keywords": ["go", "trade"],
			"actions": [
				{"type": ActionType.MOVE_TO, "target_slot": 0},
				{"type": ActionType.TRADE, "target_slot": 0},
			]
		},
		{
			"pattern": ["attack", "*", "and", "loot"],
			"keywords": ["attack", "loot"],
			"actions": [
				{"type": ActionType.MOVE_TO, "target_slot": 0},
				{"type": ActionType.ATTACK, "target_slot": 0},
				{"type": ActionType.PICKUP, "target_slot": -1},
			]
		},
		{
			"pattern": ["destroy", "*", "and", "search"],
			"keywords": ["destroy", "search"],
			"actions": [
				{"type": ActionType.MOVE_TO, "target_slot": 0},
				{"type": ActionType.ATTACK, "target_slot": 0},
				{"type": ActionType.SEARCH, "target_slot": 0},
			]
		},
		{
			"keywords": ["have", "sex"],
			"actions": [
				{"type": ActionType.MOVE_TO, "target_slot": 0},
				{"type": ActionType.SEDUCE, "target_slot": 0},
			]
		},
		{
			"keywords": ["kill", "loot"],
			"actions": [
				{"type": ActionType.MOVE_TO, "target_slot": 0},
				{"type": ActionType.ATTACK, "target_slot": 0},
				{"type": ActionType.PICKUP, "target_slot": -1},
			]
		},
		{
			"keywords": ["strip", "kiss"],
			"actions": [
				{"type": ActionType.MOVE_TO, "target_slot": 0},
				{"type": ActionType.STRIP, "target_slot": 0},
				{"type": ActionType.EMBRACE, "target_slot": 0},
			]
		},
		{
			"keywords": ["go", "inspect"],
			"actions": [
				{"type": ActionType.MOVE_TO, "target_slot": 0},
				{"type": ActionType.INSPECT, "target_slot": 0},
			]
		},
		{
			"keywords": ["go", "dig"],
			"actions": [
				{"type": ActionType.MOVE_TO, "target_slot": 0},
				{"type": ActionType.DIG, "target_slot": -1},
			]
		},
		{
			"keywords": ["steal", "from"],
			"actions": [
				{"type": ActionType.MOVE_TO, "target_slot": 0},
				{"type": ActionType.STEAL, "target_slot": 0},
			]
		},
		{
			"pattern": ["follow", "*"],
			"keywords": ["follow"],
			"actions": [
				{"type": ActionType.FOLLOW, "target_slot": 0},
			]
		},
	]

func _match_template(text: String) -> Array:
	var words = text.split(" ", false)

	for template in _templates:
		var keywords: Array = template["keywords"]
		var all_match := true
		for kw in keywords:
			if text.find(kw) < 0:
				all_match = false
				break

		if not all_match:
			continue

		# Extract target: words between first verb and conjunction/second verb
		var target = _extract_target_from_text(text, keywords)
		var target_type = _classify_target(target)

		var actions: Array = []
		var template_actions: Array = template["actions"]
		for ta in template_actions:
			var action = {
				"type": ta["type"],
				"target": target if ta.get("target_slot", -1) >= 0 else "",
				"target_type": target_type if ta.get("target_slot", -1) >= 0 else "",
			}
			actions.append(action)
		return actions

	return []

func _extract_target_from_text(text: String, keywords: Array) -> String:
	# Find text between first keyword and "and"/second keyword
	var first_kw = keywords[0]
	var start = text.find(first_kw)
	if start < 0:
		return ""
	start += first_kw.length()

	var end_markers := [" and ", " then "]
	if keywords.size() > 1:
		end_markers.append(" " + keywords[1])

	var end = text.length()
	for marker in end_markers:
		var pos = text.find(marker, start)
		if pos >= 0 and pos < end:
			end = pos

	var target = text.substr(start, end - start).strip_edges()
	return _remove_fillers(target)

# --- Debug / introspection ---

func get_action_name(action_type: int) -> String:
	return ACTION_NAMES.get(action_type, "unknown")

func describe_action_queue(queue: Array) -> String:
	var parts: Array = []
	for action in queue:
		var name = get_action_name(action.get("type", -1))
		var target = action.get("target", "")
		if target != "":
			parts.append("%s(%s)" % [name, target])
		else:
			parts.append(name)
	return " → ".join(parts)
