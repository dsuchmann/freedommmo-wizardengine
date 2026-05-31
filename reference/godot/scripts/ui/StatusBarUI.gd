extends Control

var _health_bar: ProgressBar
var _health_label: Label
var _time_bar: ProgressBar
var _time_label: Label
var _stamina_bar: ProgressBar
var _name_label: Label
var _entity: EntityBody

func _ready() -> void:
	_build_ui()

func set_entity(entity: EntityBody) -> void:
	_entity = entity
	refresh()

func _process(_delta: float) -> void:
	if _entity and visible:
		refresh()

func refresh() -> void:
	if _entity == null or _health_label == null:
		return
	var stats = _entity.get_computed_stats()
	var hp: float = stats.get("health", 100)
	var max_hp: float = stats.get("max_health", 100)
	_health_bar.value = (hp / max_hp) * 100.0
	_health_bar.modulate = Color.GREEN if hp > max_hp * 0.5 else (Color.YELLOW if hp > max_hp * 0.25 else Color.RED)
	_health_label.text = "HP: %.0f/%.0f" % [hp, max_hp]

	var time_pct := clampf(_entity.time_pool / 36000.0, 0.0, 1.0) * 100.0
	_time_bar.value = time_pct
	_time_label.text = "Time: %.0f" % _entity.time_pool

	var stamina: float = stats.get("stamina", 100)
	_stamina_bar.value = stamina

	_name_label.text = _entity.name

func _build_ui() -> void:
	var panel := Panel.new()
	panel.size = Vector2(220, 90)
	panel.position = Vector2(20, 20)
	add_child(panel)

	_name_label = Label.new()
	_name_label.text = "Player"
	_name_label.position = Vector2(8, 2)
	_name_label.add_theme_font_size_override("font_size", 12)
	panel.add_child(_name_label)

	_health_bar = ProgressBar.new()
	_health_bar.position = Vector2(8, 22)
	_health_bar.size = Vector2(204, 16)
	_health_bar.value = 100
	_health_bar.show_percentage = false
	panel.add_child(_health_bar)

	_health_label = Label.new()
	_health_label.position = Vector2(12, 22)
	_health_label.add_theme_font_size_override("font_size", 10)
	_health_label.text = "HP: 100/100"
	panel.add_child(_health_label)

	_time_bar = ProgressBar.new()
	_time_bar.position = Vector2(8, 42)
	_time_bar.size = Vector2(204, 16)
	_time_bar.value = 100
	_time_bar.show_percentage = false
	_time_bar.modulate = Color(0.3, 0.6, 1.0)
	panel.add_child(_time_bar)

	_time_label = Label.new()
	_time_label.position = Vector2(12, 42)
	_time_label.add_theme_font_size_override("font_size", 10)
	_time_label.text = "Time: 36000"
	panel.add_child(_time_label)

	_stamina_bar = ProgressBar.new()
	_stamina_bar.position = Vector2(8, 62)
	_stamina_bar.size = Vector2(204, 16)
	_stamina_bar.value = 100
	_stamina_bar.show_percentage = false
	_stamina_bar.modulate = Color(0.8, 0.7, 0.2)
	panel.add_child(_stamina_bar)
