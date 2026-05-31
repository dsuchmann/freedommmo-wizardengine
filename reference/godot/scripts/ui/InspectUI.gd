extends Control

var _panel: Panel
var _info_text: RichTextLabel
var _visible_timer: float = 0.0

func _ready() -> void:
	visible = false
	_build_ui()

func _process(delta: float) -> void:
	if visible:
		_visible_timer -= delta
		if _visible_timer <= 0:
			visible = false

func show_entity_info(entity: EntityBody, screen_pos: Vector2) -> void:
	var stats = entity.get_computed_stats()
	var text := "[b]%s[/b]\n" % entity.name
	text += "Species: %s | Age: %.0f\n" % [_species_name(entity.species), entity.age]
	text += "HP: %.0f/%.0f | Time: %.0f\n" % [stats.get("health", 0), stats.get("max_health", 100), entity.time_pool]
	text += "ATK: %.0f DEF: %.0f SPD: %.1f\n" % [stats.get("attack", 0), stats.get("defense", 0), stats.get("speed", 0)]

	var emotion = entity.mind.get_dominant_emotion()
	if emotion:
		text += "Mood: %s (%.0f%%)\n" % [_emotion_name(emotion.info_type), emotion.intensity * 100]

	var motivation = entity.mind.get_strongest_motivation()
	if motivation:
		text += "Drive: %s\n" % _motivation_name(motivation.info_type)

	# Show what this NPC is currently doing (goal-driven activity)
	if WorldManager.npc_goal_system:
		var activity = WorldManager.npc_goal_system.get_activity_description(entity.entity_id)
		if activity != "":
			text += "Activity: [color=cyan]%s[/color]\n" % activity

	_info_text.clear()
	_info_text.append_text(text)
	_panel.position = screen_pos + Vector2(10, 10)
	visible = true
	_visible_timer = 5.0

func show_terrain_info(grain_stack_info: Dictionary, screen_pos: Vector2) -> void:
	var text := "[b]Terrain[/b]\n"
	text += "Depth: %d layers\n" % grain_stack_info.get("depth", 0)
	var layers = grain_stack_info.get("layers", [])
	for i in range(mini(layers.size(), 4)):
		var l: Dictionary = layers[i]
		text += "  [%d] type=%d h=%.2f\n" % [i, l.get("type", -1), l.get("hardness", 0)]
	var emergent: Dictionary = grain_stack_info.get("emergent", {})
	if emergent.has("slippery"):
		text += "[color=cyan]Slippery![/color]\n"
	if emergent.has("heat_damage"):
		text += "[color=red]HOT! Taking damage[/color]\n"
	if emergent.has("contains_ore"):
		text += "[color=yellow]Ore detected below![/color]\n"

	_info_text.clear()
	_info_text.append_text(text)
	_panel.position = screen_pos + Vector2(10, 10)
	visible = true
	_visible_timer = 3.0

func _build_ui() -> void:
	_panel = Panel.new()
	_panel.size = Vector2(220, 160)
	add_child(_panel)

	_info_text = RichTextLabel.new()
	_info_text.position = Vector2(8, 4)
	_info_text.size = Vector2(204, 152)
	_info_text.bbcode_enabled = true
	_info_text.add_theme_font_size_override("normal_font_size", 10)
	_panel.add_child(_info_text)

func _species_name(s: int) -> String:
	match s:
		EntityBody.Species.HUMAN: return "Human"
		EntityBody.Species.ELF: return "Elf"
		EntityBody.Species.DWARF: return "Dwarf"
		EntityBody.Species.ORC: return "Orc"
		EntityBody.Species.GOBLIN: return "Goblin"
		EntityBody.Species.DRAGON: return "Dragon"
		EntityBody.Species.GOD: return "God"
		_: return "Unknown"

func _emotion_name(t: int) -> String:
	match t:
		0: return "Joyful"
		1: return "Sad"
		2: return "Angry"
		3: return "Afraid"
		8: return "In Love"
		11: return "Proud"
		15: return "Content"
		_: return "Complex"

func _motivation_name(t: int) -> String:
	match t:
		0: return "Desire"
		1: return "Need"
		2: return "Goal"
		9: return "Vengeance"
		13: return "Survival"
		11: return "Greed"
		_: return "Unknown"
