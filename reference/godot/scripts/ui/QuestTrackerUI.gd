extends Control

var _panel: Panel
var _title_label: Label
var _quest_list: RichTextLabel
var _active_objectives: Array = []

func _ready() -> void:
	_build_ui()
	visible = true  # Quest tracker visible by default — shows objectives
	# Bootstrap with starter objectives
	add_objective("Explore the World", "Walk around and discover the landscape", "explore")
	add_objective("Meet the Locals", "Talk to an NPC (press E nearby)", "social")
	add_objective("Survive", "Keep your time pool above zero", "survival")

func _process(_delta: float) -> void:
	if visible:
		_refresh()

func add_objective(title: String, description: String, category: String = "misc") -> void:
	_active_objectives.append({
		"title": title,
		"description": description,
		"category": category,
		"completed": false,
		"progress": 0.0,
	})

func complete_objective(title: String) -> void:
	for obj in _active_objectives:
		if obj["title"] == title:
			obj["completed"] = true
			break

func update_progress(title: String, progress: float) -> void:
	for obj in _active_objectives:
		if obj["title"] == title:
			obj["progress"] = clampf(progress, 0.0, 1.0)
			break

func _refresh() -> void:
	if _quest_list == null:
		return
	_quest_list.clear()
	for obj in _active_objectives:
		var icon := "[color=green]✓[/color]" if obj["completed"] else "[color=yellow]●[/color]"
		var title: String = obj["title"]
		if obj["completed"]:
			title = "[s]%s[/s]" % title
		_quest_list.append_text("%s [b]%s[/b]\n" % [icon, title])
		_quest_list.append_text("  [color=gray]%s[/color]\n" % obj["description"])
		if obj["progress"] > 0 and not obj["completed"]:
			_quest_list.append_text("  [color=cyan]%.0f%%[/color]\n" % (obj["progress"] * 100))

func _build_ui() -> void:
	_panel = Panel.new()
	_panel.size = Vector2(250, 200)
	_panel.position = Vector2(20, 130)
	_panel.modulate = Color(1, 1, 1, 0.85)
	add_child(_panel)

	_title_label = Label.new()
	_title_label.text = "Objectives"
	_title_label.position = Vector2(8, 4)
	_title_label.add_theme_font_size_override("font_size", 12)
	_panel.add_child(_title_label)

	_quest_list = RichTextLabel.new()
	_quest_list.position = Vector2(8, 24)
	_quest_list.size = Vector2(234, 168)
	_quest_list.bbcode_enabled = true
	_panel.add_child(_quest_list)
