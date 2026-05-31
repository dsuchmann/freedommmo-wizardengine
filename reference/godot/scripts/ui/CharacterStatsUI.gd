extends Control

var _panel: Panel
var _stats_text: RichTextLabel
var _player_mgr: PlayerManager
var _skill_prog: SkillProgression
var _entity_lifecycle: EntityLifecycle

func _ready() -> void:
	visible = false
	_build_ui()

func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed:
		if event.keycode == KEY_TAB:
			visible = !visible
			if visible:
				refresh()

func set_systems(pm: PlayerManager, sp: SkillProgression, el: EntityLifecycle) -> void:
	_player_mgr = pm
	_skill_prog = sp
	_entity_lifecycle = el

func refresh() -> void:
	if _player_mgr == null or _player_mgr.entity == null:
		return
	_stats_text.clear()
	var ps = _player_mgr.get_stat_summary()
	var entity = _player_mgr.entity

	_stats_text.append_text("[b]%s[/b] — Level %d\n" % [ps.get("name", "???"), ps.get("level", 1)])
	_stats_text.append_text("Life Stage: [color=cyan]%s[/color]\n" % ps.get("life_stage", "unknown"))
	_stats_text.append_text("XP: %.0f / %.0f | Gold: %d\n\n" % [ps.get("xp", 0), ps.get("xp_next", 100), ps.get("gold", 0)])

	_stats_text.append_text("[b]Stats[/b]\n")
	var stats = entity.get_computed_stats()
	var stat_names := ["health", "max_health", "attack", "defense", "speed", "strength",
		"dexterity", "constitution", "intelligence", "wisdom", "charisma", "mana", "stamina"]
	for sn in stat_names:
		var val = stats.get(sn, entity.base_stats.get(sn, 0))
		if val > 0:
			_stats_text.append_text("  %s: [color=yellow]%.0f[/color]\n" % [sn.capitalize(), val])

	_stats_text.append_text("\n[b]Skills[/b]\n")
	if _skill_prog:
		var skills = _skill_prog.get_all_skills(entity.entity_id)
		for skill_name in skills:
			var data = skills[skill_name]
			var lvl = data.get("level", 1)
			var xp = data.get("xp", 0)
			_stats_text.append_text("  %s: Lv%d (%.0f xp)\n" % [skill_name.replace("_", " ").capitalize(), lvl, xp])

	_stats_text.append_text("\n[b]Time[/b]\n")
	_stats_text.append_text("  Pool: [color=cyan]%.0f[/color] units\n" % entity.time_pool)
	if _entity_lifecycle:
		var pct = _entity_lifecycle.get_life_percentage(entity)
		_stats_text.append_text("  Life: %.0f%%\n" % (pct * 100.0))

func _build_ui() -> void:
	_panel = Panel.new()
	_panel.size = Vector2(300, 500)
	_panel.position = Vector2(810, 290)
	add_child(_panel)

	var title := Label.new()
	title.text = "Character"
	title.position = Vector2(110, 8)
	title.add_theme_font_size_override("font_size", 16)
	_panel.add_child(title)

	_stats_text = RichTextLabel.new()
	_stats_text.position = Vector2(8, 32)
	_stats_text.size = Vector2(284, 450)
	_stats_text.bbcode_enabled = true
	_stats_text.add_theme_font_size_override("normal_font_size", 10)
	_panel.add_child(_stats_text)
