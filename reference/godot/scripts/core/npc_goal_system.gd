class_name NPCGoalSystem
extends RefCounted

## Goal-driven NPC decision-making system.
## Each NPC maintains a priority queue of goals. Goals are generated from:
## - Survival needs (health, hunger, time remaining)
## - Schedule obligations (sleep, work, patrol)
## - Social drives (relationships, grudges, loneliness)
## - Dialogue commitments (promises made in conversation)
## - Environmental stimuli (witnessed events, threats, opportunities)
##
## Goals have: type, priority (0-100), target position, expiry time,
## completion condition, and can be interrupted by higher-priority goals.

enum GoalType {
	IDLE,
	GO_HOME,
	GO_TO_WORK,
	PATROL,
	FLEE,
	ATTACK,
	SOCIALIZE,
	TRADE,
	FORAGE,
	REST,
	SEEK_HEALING,
	INVESTIGATE,
	FULFILL_COMMITMENT,
	GUARD_AREA,
	GATHER_RESOURCE,
	REPORT_EVENT,
}

class NPCGoal:
	var type: int = GoalType.IDLE
	var priority: float = 0.0
	var target_x: int = -1
	var target_y: int = -1
	var target_entity_id: int = -1
	var expires_at: float = -1.0  # game time when goal expires
	var created_at: float = 0.0
	var metadata: Dictionary = {}  # arbitrary data (commitment text, item needed, etc.)
	var completed: bool = false

	func is_expired(current_time: float) -> bool:
		return expires_at > 0 and current_time > expires_at

var _goals: Dictionary = {}  # eid → Array[NPCGoal]
var _active_goal: Dictionary = {}  # eid → NPCGoal (current top goal)
var _eval_timer: float = 0.0

var entity_spawner: EntitySpawner
var npc_schedules: NPCSchedule
var day_night: DayNightCycle
var structures: StructureSystem
var relationships: RelationshipSystem

func _init(p_spawner: EntitySpawner = null, p_sched: NPCSchedule = null,
		p_day: DayNightCycle = null, p_structures: StructureSystem = null,
		p_relationships: RelationshipSystem = null) -> void:
	entity_spawner = p_spawner
	npc_schedules = p_sched
	day_night = p_day
	structures = p_structures
	relationships = p_relationships

func cleanup_npc(eid: int) -> void:
	_goals.erase(eid)
	_active_goal.erase(eid)

func add_goal(eid: int, goal: NPCGoal) -> void:
	if not _goals.has(eid):
		_goals[eid] = []
	# Don't add duplicate goal types unless it's a higher priority
	var goals: Array = _goals[eid]
	for i in range(goals.size()):
		if goals[i].type == goal.type and goals[i].target_entity_id == goal.target_entity_id:
			if goal.priority > goals[i].priority:
				goals[i] = goal
			return
	goals.append(goal)

func get_active_goal(eid: int) -> NPCGoal:
	return _active_goal.get(eid)

func evaluate_all(delta: float) -> void:
	_eval_timer += delta
	if _eval_timer < 0.5:
		return
	_eval_timer = 0.0

	if entity_spawner == null:
		return

	var current_time = 0.0
	if day_night:
		current_time = day_night.get_total_time()
	var hour = 8.0
	if day_night:
		hour = day_night.get_hour()

	for eid in entity_spawner._entities:
		var data: Dictionary = entity_spawner._entities[eid]
		var body: EntityBody = data["body"]
		_generate_needs_goals(eid, data, body, hour, current_time)
		_prune_expired(eid, current_time)
		_select_top_goal(eid)

func _generate_needs_goals(eid: int, data: Dictionary, body: EntityBody,
		hour: float, current_time: float) -> void:
	# 1. SURVIVAL — health critical
	var hp = body.base_stats.get("health", 100)
	var max_hp = body.base_stats.get("max_health", 100)
	if hp < max_hp * 0.3:
		var goal = NPCGoal.new()
		goal.type = GoalType.SEEK_HEALING
		goal.priority = 90.0
		goal.created_at = current_time
		# Head to well or home
		if data.has("home_x"):
			goal.target_x = data["home_x"]
			goal.target_y = data["home_y"]
		add_goal(eid, goal)

	# 2. SURVIVAL — time running low
	var time_pool = body.base_stats.get("time_pool", 1000)
	if time_pool < 200:
		var goal = NPCGoal.new()
		goal.type = GoalType.FLEE
		goal.priority = 85.0
		goal.created_at = current_time
		goal.metadata = {"reason": "low_time"}
		if data.has("home_x"):
			goal.target_x = data["home_x"]
			goal.target_y = data["home_y"]
		add_goal(eid, goal)

	# 3. FEAR — grudge-based fleeing
	var grudges = body.mind.get_by_type(
		InfoGrainTypes.Category.RELATIONAL, InfoGrainTypes.Relational.GRUDGE)
	for grudge in grudges:
		if grudge.intensity > 0.7 and grudge.target_entity_id >= 0:
			var enemy_pos = entity_spawner.get_entity_position(grudge.target_entity_id)
			if enemy_pos.x >= 0:
				var dist = abs(data["world_x"] - enemy_pos.x) + abs(data["world_y"] - enemy_pos.y)
				if dist < 20:
					var goal = NPCGoal.new()
					goal.type = GoalType.FLEE
					goal.priority = 80.0 + (20.0 - dist)  # closer = more urgent
					goal.target_entity_id = grudge.target_entity_id
					goal.created_at = current_time
					# Flee away from enemy
					goal.target_x = data["world_x"] + sign(data["world_x"] - enemy_pos.x) * 30
					goal.target_y = data["world_y"] + sign(data["world_y"] - enemy_pos.y) * 30
					add_goal(eid, goal)

	# 4. AGGRESSION — hostile entities nearby (guards attack raiders)
	var occupation = data.get("occupation", "")
	if occupation in ["guard", "soldier", "hunter"]:
		var nearby = entity_spawner.get_entities_near(data["world_x"], data["world_y"], 15)
		for other in nearby:
			if other.entity_id == eid:
				continue
			var other_data = entity_spawner._entities.get(other.entity_id)
			if other_data and other_data.get("is_hostile", false):
				var goal = NPCGoal.new()
				goal.type = GoalType.ATTACK
				goal.priority = 75.0
				goal.target_entity_id = other.entity_id
				goal.target_x = other_data["world_x"]
				goal.target_y = other_data["world_y"]
				goal.created_at = current_time
				add_goal(eid, goal)

	# 5. SCHEDULE — based on time of day
	if npc_schedules:
		var activity = npc_schedules.get_current_activity(eid, hour)
		var action: String = activity.get("activity", "idle")
		var sched_goal = NPCGoal.new()
		sched_goal.created_at = current_time

		match action:
			"sleep":
				sched_goal.type = GoalType.GO_HOME
				sched_goal.priority = 40.0
			"farm", "work", "trade", "study", "research":
				sched_goal.type = GoalType.GO_TO_WORK
				sched_goal.priority = 50.0
			"patrol", "track", "hunt":
				sched_goal.type = GoalType.PATROL
				sched_goal.priority = 55.0
			"eat", "rest", "wake_up", "chores":
				sched_goal.type = GoalType.REST
				sched_goal.priority = 35.0
			"socialize":
				sched_goal.type = GoalType.SOCIALIZE
				sched_goal.priority = 30.0
			_:
				sched_goal.type = GoalType.IDLE
				sched_goal.priority = 10.0

		# Set target based on goal type
		if sched_goal.type == GoalType.GO_TO_WORK and data.has("work_x"):
			sched_goal.target_x = data["work_x"]
			sched_goal.target_y = data["work_y"]
		elif sched_goal.type in [GoalType.GO_HOME, GoalType.REST] and data.has("home_x"):
			sched_goal.target_x = data["home_x"]
			sched_goal.target_y = data["home_y"]

		add_goal(eid, sched_goal)

	# 6. SOCIAL — lonely NPCs seek company
	if relationships:
		var bonds = body.mind.get_by_type(
			InfoGrainTypes.Category.RELATIONAL, InfoGrainTypes.Relational.BOND)
		if bonds.size() > 0 and randf() < 0.1:
			var bond = bonds[randi() % bonds.size()]
			if bond.target_entity_id >= 0:
				var friend_pos = entity_spawner.get_entity_position(bond.target_entity_id)
				if friend_pos.x >= 0:
					var goal = NPCGoal.new()
					goal.type = GoalType.SOCIALIZE
					goal.priority = 25.0 + bond.intensity * 10
					goal.target_entity_id = bond.target_entity_id
					goal.target_x = friend_pos.x
					goal.target_y = friend_pos.y
					goal.created_at = current_time
					add_goal(eid, goal)

	# 7. INVESTIGATE — if NPC witnessed something notable recently
	var observations = body.mind.get_by_type(
		InfoGrainTypes.Category.OBSERVATIONAL, InfoGrainTypes.Observational.WITNESSED)
	for obs in observations:
		if current_time - obs.created_at < 60 and obs.intensity > 0.5:
			var obs_x = obs.context.get("world_x", -1)
			var obs_y = obs.context.get("world_y", -1)
			if obs_x >= 0 and obs_y >= 0:
				var goal = NPCGoal.new()
				goal.type = GoalType.INVESTIGATE
				goal.priority = 45.0
				goal.target_x = obs_x
				goal.target_y = obs_y
				goal.expires_at = current_time + 120
				goal.created_at = current_time
				add_goal(eid, goal)
			break  # Only investigate one thing at a time

func _prune_expired(eid: int, current_time: float) -> void:
	if not _goals.has(eid):
		return
	var goals: Array = _goals[eid]
	var i = goals.size() - 1
	while i >= 0:
		if goals[i].completed or goals[i].is_expired(current_time):
			goals.remove_at(i)
		i -= 1
	# Cap goal list to prevent unbounded growth
	if goals.size() > 10:
		goals.sort_custom(func(a, b): return a.priority > b.priority)
		_goals[eid] = goals.slice(0, 10)

func _select_top_goal(eid: int) -> void:
	if not _goals.has(eid) or _goals[eid].is_empty():
		_active_goal.erase(eid)
		return
	var goals: Array = _goals[eid]
	var best: NPCGoal = goals[0]
	for goal in goals:
		if goal.priority > best.priority:
			best = goal
	_active_goal[eid] = best

## Add a dialogue commitment goal (called when NPC makes a promise in conversation)
func add_commitment(eid: int, commitment_text: String, target_x: int, target_y: int,
		target_time: float) -> void:
	var goal = NPCGoal.new()
	goal.type = GoalType.FULFILL_COMMITMENT
	goal.priority = 60.0  # High but not survival-level
	goal.target_x = target_x
	goal.target_y = target_y
	goal.expires_at = target_time + 300  # 5 minute grace period
	goal.metadata = {"commitment": commitment_text}
	if day_night:
		goal.created_at = day_night.get_total_time()
	add_goal(eid, goal)

## Get a human-readable description of what an NPC is doing
func get_activity_description(eid: int) -> String:
	var goal = _active_goal.get(eid)
	if goal == null:
		return "standing around"
	match goal.type:
		GoalType.IDLE: return "idle"
		GoalType.GO_HOME: return "heading home"
		GoalType.GO_TO_WORK: return "going to work"
		GoalType.PATROL: return "on patrol"
		GoalType.FLEE: return "fleeing!"
		GoalType.ATTACK: return "attacking!"
		GoalType.SOCIALIZE: return "socializing"
		GoalType.TRADE: return "trading"
		GoalType.FORAGE: return "foraging"
		GoalType.REST: return "resting"
		GoalType.SEEK_HEALING: return "seeking healing"
		GoalType.INVESTIGATE: return "investigating"
		GoalType.FULFILL_COMMITMENT: return goal.metadata.get("commitment", "busy")
		GoalType.GUARD_AREA: return "guarding"
		GoalType.GATHER_RESOURCE: return "gathering"
		GoalType.REPORT_EVENT: return "reporting"
		_: return "busy"
