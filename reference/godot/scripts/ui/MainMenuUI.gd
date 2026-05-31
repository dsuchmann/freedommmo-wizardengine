extends Control

signal new_game_requested
signal continue_game_requested
signal quit_requested

var _panel: Panel

func _ready() -> void:
	_build_ui()

func _build_ui() -> void:
	# Background
	var bg := ColorRect.new()
	bg.size = Vector2(1920, 1080)
	bg.color = Color(0.05, 0.08, 0.12)
	add_child(bg)

	_panel = Panel.new()
	_panel.size = Vector2(400, 500)
	_panel.position = Vector2(760, 290)
	add_child(_panel)

	var title := Label.new()
	title.text = "FreedomMMO"
	title.position = Vector2(80, 30)
	title.add_theme_font_size_override("font_size", 32)
	_panel.add_child(title)

	var subtitle := Label.new()
	subtitle.text = "Time is the only resource that matters"
	subtitle.position = Vector2(40, 80)
	subtitle.add_theme_font_size_override("font_size", 11)
	subtitle.modulate = Color(0.7, 0.7, 0.7)
	_panel.add_child(subtitle)

	var new_btn := Button.new()
	new_btn.text = "New Game"
	new_btn.position = Vector2(100, 150)
	new_btn.size = Vector2(200, 45)
	new_btn.pressed.connect(func(): new_game_requested.emit())
	_panel.add_child(new_btn)

	var continue_btn := Button.new()
	continue_btn.text = "Continue"
	continue_btn.position = Vector2(100, 210)
	continue_btn.size = Vector2(200, 45)
	continue_btn.pressed.connect(func(): continue_game_requested.emit())
	_panel.add_child(continue_btn)

	var quit_btn := Button.new()
	quit_btn.text = "Quit"
	quit_btn.position = Vector2(100, 310)
	quit_btn.size = Vector2(200, 45)
	quit_btn.pressed.connect(func(): quit_requested.emit())
	_panel.add_child(quit_btn)

	var version := Label.new()
	version.text = "v0.1.0-alpha | Grain Engine"
	version.position = Vector2(100, 440)
	version.add_theme_font_size_override("font_size", 10)
	version.modulate = Color(0.5, 0.5, 0.5)
	_panel.add_child(version)

	var credits := Label.new()
	credits.text = "Built with Godot 4.4 + PixelLab + DevBox"
	credits.position = Vector2(70, 460)
	credits.add_theme_font_size_override("font_size", 9)
	credits.modulate = Color(0.4, 0.4, 0.4)
	_panel.add_child(credits)
