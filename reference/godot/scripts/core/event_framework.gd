class_name EventFramework
extends RefCounted

signal event_started(instance_id: int, template_name: String)
signal phase_entered(instance_id: int, phase_id: String)
signal event_completed(instance_id: int, outcome: String)

var _templates: Dictionary = {}
var _active_instances: Dictionary = {}
var _instance_counter: int = 0

func register_template(name: String, template: EventTemplate) -> void:
	_templates[name] = template

func start_event(template_name: String, participants: Array, context: Dictionary = {}) -> int:
	if not _templates.has(template_name):
		return -1
	_instance_counter += 1
	var instance := EventInstance.new()
	instance.id = _instance_counter
	instance.template = _templates[template_name]
	instance.participants = participants
	instance.context = context
	instance.current_phase = instance.template.initial_phase
	_active_instances[instance.id] = instance
	event_started.emit(instance.id, template_name)
	phase_entered.emit(instance.id, instance.current_phase)
	return instance.id

func tick(delta: float, world_state: Dictionary = {}) -> void:
	var completed: Array = []
	for id in _active_instances:
		var instance: EventInstance = _active_instances[id]
		instance.elapsed += delta
		instance.phase_elapsed += delta
		var phase := instance.get_current_phase_data()
		if phase == null:
			completed.append(id)
			continue
		if _check_phase_transitions(instance, phase, world_state):
			if instance.current_phase == "":
				completed.append(id)
	for id in completed:
		var instance: EventInstance = _active_instances[id]
		event_completed.emit(id, instance.outcome)
		_active_instances.erase(id)

func get_active_events_for(entity_id: int) -> Array:
	var result: Array = []
	for id in _active_instances:
		var instance: EventInstance = _active_instances[id]
		if entity_id in instance.participants:
			result.append(instance)
	return result

func active_count() -> int:
	return _active_instances.size()

func _check_phase_transitions(instance: EventInstance, phase: Dictionary, world_state: Dictionary) -> bool:
	var transitions: Array = phase.get("transitions", [])
	for t in transitions:
		if _evaluate_condition(t.get("condition", {}), instance, world_state):
			var next_phase: String = t.get("next_phase", "")
			_execute_actions(t.get("actions", []), instance)
			if next_phase.is_empty() or not instance.template.phases.has(next_phase):
				instance.current_phase = ""
				instance.outcome = t.get("outcome", "completed")
				return true
			instance.current_phase = next_phase
			instance.phase_elapsed = 0.0
			phase_entered.emit(instance.id, next_phase)
			return true
	return false

func _evaluate_condition(condition: Dictionary, instance: EventInstance, world_state: Dictionary) -> bool:
	if condition.is_empty():
		return true
	if condition.has("elapsed_min"):
		if instance.phase_elapsed < condition["elapsed_min"]:
			return false
	if condition.has("entity_state"):
		var required_state: Dictionary = condition["entity_state"]
		for key in required_state:
			if instance.context.get(key) != required_state[key]:
				return false
	if condition.has("random_chance"):
		if randf() > condition["random_chance"]:
			return false
	if condition.has("intensity_above"):
		var check: Dictionary = condition["intensity_above"]
		var entity_id: int = check.get("entity", instance.participants[0] if not instance.participants.is_empty() else -1)
		var threshold: float = check.get("threshold", 0.5)
		var current: float = instance.context.get("intensity_%d" % entity_id, 0.0)
		if current < threshold:
			return false
	return true

func _execute_actions(actions: Array, instance: EventInstance) -> void:
	for action in actions:
		match action.get("type", ""):
			"set_context":
				for key in action.get("values", {}):
					instance.context[key] = action["values"][key]
			"modify_info_grain":
				instance.pending_mind_changes.append(action)
			"spawn_item":
				instance.pending_spawns.append(action)
			"trigger_animation":
				instance.pending_animations.append(action)
			"record_causal":
				instance.pending_causal_events.append(action)


class EventTemplate:
	extends RefCounted
	var name: String = ""
	var phases: Dictionary = {}
	var initial_phase: String = ""
	var tags: Array = []

	func add_phase(phase_id: String, data: Dictionary) -> void:
		phases[phase_id] = data
		if initial_phase.is_empty():
			initial_phase = phase_id


class EventInstance:
	extends RefCounted
	var id: int = 0
	var template: EventTemplate
	var participants: Array = []
	var context: Dictionary = {}
	var current_phase: String = ""
	var outcome: String = ""
	var elapsed: float = 0.0
	var phase_elapsed: float = 0.0
	var pending_mind_changes: Array = []
	var pending_spawns: Array = []
	var pending_animations: Array = []
	var pending_causal_events: Array = []

	func get_current_phase_data() -> Dictionary:
		if template == null or current_phase.is_empty():
			return {}
		return template.phases.get(current_phase, {})
