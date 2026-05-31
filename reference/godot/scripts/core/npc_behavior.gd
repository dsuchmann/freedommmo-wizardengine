class_name NPCBehavior
extends RefCounted

var entity_spawner: EntitySpawner
var npc_schedules: NPCSchedule
var pathfinding: Pathfinding
var world: WorldGraph
var day_night: DayNightCycle
var goal_system: NPCGoalSystem

var _behavior_timer: float = 0.0
var _npc_paths: Dictionary = {}  # eid -> Array of Vector2i (remaining path)
var _npc_targets: Dictionary = {}  # eid -> target position

func _init(p_spawner: EntitySpawner = null, p_sched: NPCSchedule = null,
		p_path: Pathfinding = null, p_world: WorldGraph = null,
		p_day: DayNightCycle = null) -> void:
	entity_spawner = p_spawner
	npc_schedules = p_sched
	pathfinding = p_path
	world = p_world
	day_night = p_day

func cleanup_npc(eid: int) -> void:
	_npc_paths.erase(eid)
	_npc_targets.erase(eid)
	if goal_system:
		goal_system.cleanup_npc(eid)

func tick(delta: float) -> void:
	_behavior_timer += delta
	if _behavior_timer < 1.0:
		return
	_behavior_timer = 0.0

	if entity_spawner == null or npc_schedules == null:
		return

	# Let goal system evaluate priorities first
	if goal_system:
		goal_system.evaluate_all(1.0)

	for eid in entity_spawner._entities:
		var data: Dictionary = entity_spawner._entities[eid]
		var body: EntityBody = data["body"]
		# Follow existing path if one exists
		if _npc_paths.has(eid) and not _npc_paths[eid].is_empty():
			_follow_path(eid, data)
			continue
		# Use goal system if available, otherwise fall back to schedule
		if goal_system:
			var goal = goal_system.get_active_goal(eid)
			if goal:
				_execute_goal(eid, data, body, goal)
				continue
		var hour := 8.0
		if day_night:
			hour = day_night.get_hour()
		var activity = npc_schedules.get_current_activity(eid, hour)
		_execute_activity(eid, data, body, activity)

func _execute_goal(eid: int, data: Dictionary, body: EntityBody, goal: NPCGoalSystem.NPCGoal) -> void:
	match goal.type:
		NPCGoalSystem.GoalType.FLEE:
			if goal.target_x >= 0:
				var dist = abs(data["world_x"] - goal.target_x) + abs(data["world_y"] - goal.target_y)
				if dist > 40:
					goal.completed = true
					data["move_dir_x"] = 0
					data["move_dir_y"] = 0
				else:
					# Run directly away (faster than pathfinding)
					data["move_dir_x"] = sign(goal.target_x - data["world_x"])
					data["move_dir_y"] = sign(goal.target_y - data["world_y"])
			else:
				_wander_near_home(data, 20)
		NPCGoalSystem.GoalType.ATTACK:
			if goal.target_entity_id >= 0:
				var target_pos = entity_spawner.get_entity_position(goal.target_entity_id)
				if target_pos.x < 0:
					goal.completed = true
					return
				var dist = abs(data["world_x"] - target_pos.x) + abs(data["world_y"] - target_pos.y)
				if dist <= 2:
					data["move_dir_x"] = 0
					data["move_dir_y"] = 0
					# Combat handled by npc_interactions
				else:
					_pathfind_to(eid, data, target_pos.x, target_pos.y)
		NPCGoalSystem.GoalType.GO_HOME, NPCGoalSystem.GoalType.REST, NPCGoalSystem.GoalType.SEEK_HEALING:
			_pathfind_to_structure(eid, data, "home")
		NPCGoalSystem.GoalType.GO_TO_WORK:
			_pathfind_to_structure(eid, data, "work")
		NPCGoalSystem.GoalType.PATROL:
			_patrol_area(eid, data, 30)
		NPCGoalSystem.GoalType.SOCIALIZE:
			if goal.target_entity_id >= 0:
				var friend_pos = entity_spawner.get_entity_position(goal.target_entity_id)
				if friend_pos.x >= 0:
					var dist = abs(data["world_x"] - friend_pos.x) + abs(data["world_y"] - friend_pos.y)
					if dist <= 3:
						goal.completed = true
						data["move_dir_x"] = 0
						data["move_dir_y"] = 0
					else:
						_pathfind_to(eid, data, friend_pos.x, friend_pos.y)
				else:
					goal.completed = true
			else:
				_move_toward_nearest_npc(data)
		NPCGoalSystem.GoalType.INVESTIGATE, NPCGoalSystem.GoalType.FULFILL_COMMITMENT:
			if goal.target_x >= 0:
				var dist = abs(data["world_x"] - goal.target_x) + abs(data["world_y"] - goal.target_y)
				if dist <= 3:
					goal.completed = true
					data["move_dir_x"] = 0
					data["move_dir_y"] = 0
				else:
					_pathfind_to(eid, data, goal.target_x, goal.target_y)
			else:
				goal.completed = true
		NPCGoalSystem.GoalType.GUARD_AREA:
			_patrol_area(eid, data, 15)
		_:
			_wander_near_home(data, 10)

func _execute_activity(eid: int, data: Dictionary, body: EntityBody, activity: Dictionary) -> void:
	var action: String = activity.get("activity", "idle")

	# Check NPC memory for grudges — flee from enemies
	var grudges = body.mind.get_by_type(InfoGrainTypes.Category.RELATIONAL, InfoGrainTypes.Relational.GRUDGE)
	for grudge in grudges:
		if grudge.intensity > 0.7 and grudge.target_entity_id >= 0:
			var enemy_pos = entity_spawner.get_entity_position(grudge.target_entity_id)
			if enemy_pos.x >= 0:
				var dist = abs(data["world_x"] - enemy_pos.x) + abs(data["world_y"] - enemy_pos.y)
				if dist < 15:
					# Flee from enemy
					data["move_dir_x"] = sign(data["world_x"] - enemy_pos.x)
					data["move_dir_y"] = sign(data["world_y"] - enemy_pos.y)
					return

	match action:
		"sleep":
			# Go home and stop
			_pathfind_to_structure(eid, data, "home")
		"farm", "work", "trade", "study", "research":
			# Go to workplace
			_pathfind_to_structure(eid, data, "work")
		"patrol", "track", "hunt":
			_patrol_area(eid, data, 30)
		"eat", "rest", "wake_up", "chores":
			# Go home
			_pathfind_to_structure(eid, data, "home")
		"socialize":
			_move_toward_nearest_npc(data)
		_:
			_wander_near_home(data, 10)

func _wander_near_home(data: Dictionary, radius: int) -> void:
	if not data.has("home_x"):
		data["home_x"] = data["world_x"]
		data["home_y"] = data["world_y"]

	var dx = data["world_x"] - data["home_x"]
	var dy = data["world_y"] - data["home_y"]
	var dist = abs(dx) + abs(dy)

	if dist > radius:
		data["move_dir_x"] = -sign(dx)
		data["move_dir_y"] = -sign(dy)
	else:
		if randf() > 0.7:
			data["move_dir_x"] = randi_range(-1, 1)
			data["move_dir_y"] = randi_range(-1, 1)

func _follow_path(eid: int, data: Dictionary) -> void:
	var path: Array = _npc_paths[eid]
	if path.is_empty():
		_npc_paths.erase(eid)
		data["move_dir_x"] = 0
		data["move_dir_y"] = 0
		return
	var next: Vector2i = path[0]
	var dx = next.x - data["world_x"]
	var dy = next.y - data["world_y"]
	if abs(dx) <= 1 and abs(dy) <= 1:
		path.remove_at(0)
		if path.is_empty():
			_npc_paths.erase(eid)
	data["move_dir_x"] = sign(dx)
	data["move_dir_y"] = sign(dy)

func _pathfind_to(eid: int, data: Dictionary, target_x: int, target_y: int) -> void:
	if pathfinding == null or world == null:
		# Fallback: direct movement
		data["move_dir_x"] = sign(target_x - data["world_x"])
		data["move_dir_y"] = sign(target_y - data["world_y"])
		return
	var start = Vector2i(data["world_x"], data["world_y"])
	var end = Vector2i(target_x, target_y)
	var path = pathfinding.find_path(world, start, end, 50)
	if path.size() > 1:
		path.remove_at(0)  # Remove current position
		_npc_paths[eid] = path
	else:
		data["move_dir_x"] = sign(target_x - data["world_x"])
		data["move_dir_y"] = sign(target_y - data["world_y"])

func _pathfind_to_structure(eid: int, data: Dictionary, structure_type: String) -> void:
	var target_x: int
	var target_y: int
	if structure_type == "work" and data.has("work_x"):
		target_x = data["work_x"]
		target_y = data["work_y"]
	elif data.has("home_x"):
		target_x = data["home_x"]
		target_y = data["home_y"]
	else:
		data["move_dir_x"] = 0
		data["move_dir_y"] = 0
		return
	var dist = abs(data["world_x"] - target_x) + abs(data["world_y"] - target_y)
	if dist <= 2:
		# Arrived — stop, face structure center
		data["move_dir_x"] = 0
		data["move_dir_y"] = 0
		# Wander slightly near structure to look alive
		if randf() < 0.05:
			data["move_dir_x"] = randi_range(-1, 1)
			data["move_dir_y"] = randi_range(-1, 1)
	else:
		_pathfind_to(eid, data, target_x, target_y)

func _move_toward_home(eid: int, data: Dictionary) -> void:
	if not data.has("home_x"):
		data["home_x"] = data["world_x"]
		data["home_y"] = data["world_y"]
	var dx = data["world_x"] - data["home_x"]
	var dy = data["world_y"] - data["home_y"]
	if abs(dx) + abs(dy) > 3:
		_pathfind_to(eid, data, data["home_x"], data["home_y"])
	else:
		data["move_dir_x"] = 0
		data["move_dir_y"] = 0

func _patrol_area(eid: int, data: Dictionary, radius: int) -> void:
	if not data.has("home_x"):
		data["home_x"] = data["world_x"]
		data["home_y"] = data["world_y"]
	if not _npc_targets.has(eid) or randf() < 0.1:
		var tx = data["home_x"] + randi_range(-radius, radius)
		var ty = data["home_y"] + randi_range(-radius, radius)
		_npc_targets[eid] = Vector2i(tx, ty)
	var target = _npc_targets[eid]
	var dist = abs(data["world_x"] - target.x) + abs(data["world_y"] - target.y)
	if dist <= 2:
		_npc_targets.erase(eid)
		data["move_dir_x"] = 0
		data["move_dir_y"] = 0
	else:
		_pathfind_to(eid, data, target.x, target.y)

func _move_toward_nearest_npc(data: Dictionary) -> void:
	if entity_spawner == null:
		return
	var nearest_dist := 999
	var nearest_dir_x := 0
	var nearest_dir_y := 0

	for eid in entity_spawner._entities:
		if eid == data.get("body", EntityBody.new()).entity_id:
			continue
		var other: Dictionary = entity_spawner._entities[eid]
		var dx = other["world_x"] - data["world_x"]
		var dy = other["world_y"] - data["world_y"]
		var dist = abs(dx) + abs(dy)
		if dist < nearest_dist and dist > 2:
			nearest_dist = dist
			nearest_dir_x = sign(dx)
			nearest_dir_y = sign(dy)

	if nearest_dist < 30:
		data["move_dir_x"] = nearest_dir_x
		data["move_dir_y"] = nearest_dir_y
	else:
		data["move_dir_x"] = 0
		data["move_dir_y"] = 0
