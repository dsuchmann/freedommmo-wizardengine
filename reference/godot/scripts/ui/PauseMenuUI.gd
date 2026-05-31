extends Control

signal save_requested
signal load_requested
signal quit_requested
signal resume_requested

var _panel: Panel

func _ready() -> void:
	visible = false
	_build_ui()

func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and event.keycode == KEY_P:
		visible = !visible

func _build_ui() -> void:
	_panel = Panel.new()
	_panel.size = Vector2(250, 300)
	_panel.position = Vector2(835, 390)
	add_child(_panel)

	var title := Label.new()
	title.text = "FreedomMMO"
	title.position = Vector2(60, 10)
	title.add_theme_font_size_override("font_size", 18)
	_panel.add_child(title)

	var buttons := [
		{"text": "Resume", "signal": "resume", "y": 60},
		{"text": "Save World", "signal": "save", "y": 110},
		{"text": "Load World", "signal": "load", "y": 160},
		{"text": "Quit", "signal": "quit", "y": 230},
	]
	for b in buttons:
		var btn := Button.new()
		btn.text = b["text"]
		btn.position = Vector2(40, b["y"])
		btn.size = Vector2(170, 35)
		match b["signal"]:
			"resume": btn.pressed.connect(func(): visible = false; resume_requested.emit())
			"save": btn.pressed.connect(func(): save_requested.emit())
			"load": btn.pressed.connect(func(): load_requested.emit())
			"quit": btn.pressed.connect(func(): quit_requested.emit())
		_panel.add_child(btn)
