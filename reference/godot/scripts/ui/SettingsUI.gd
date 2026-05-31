extends Control

signal settings_changed(setting: String, value: float)

var _panel: Panel
var _master_slider: HSlider
var _sfx_slider: HSlider
var _music_slider: HSlider
var _master_label: Label
var _sfx_label: Label
var _music_label: Label

func _ready() -> void:
	visible = false
	_build_ui()

func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed:
		if event.keycode == KEY_F10:
			visible = !visible

func _build_ui() -> void:
	_panel = Panel.new()
	_panel.size = Vector2(350, 400)
	_panel.position = Vector2(785, 340)
	add_child(_panel)

	var title := Label.new()
	title.text = "Settings"
	title.position = Vector2(130, 10)
	title.add_theme_font_size_override("font_size", 18)
	_panel.add_child(title)

	_add_slider("Master Volume", 50, func(val): _on_volume_changed("master", val))
	_add_slider("SFX Volume", 100, func(val): _on_volume_changed("sfx", val))
	_add_slider("Music Volume", 150, func(val): _on_volume_changed("music", val))

	var keybinds_title := Label.new()
	keybinds_title.text = "Controls"
	keybinds_title.position = Vector2(10, 210)
	keybinds_title.add_theme_font_size_override("font_size", 13)
	_panel.add_child(keybinds_title)

	var keys := [
		"WASD - Move", "Q - Attack", "E - Talk", "T - Trade",
		"R - Inspect", "G - Grab", "SPC - Dig", "F - Burn",
		"I - Inventory", "C - Equipment", "K - Craft", "P - Pause",
		"Enter - Command", "1-4 - Abilities", "ESC - Menu",
	]
	for i in range(keys.size()):
		var label := Label.new()
		label.text = keys[i]
		label.position = Vector2(10 + (i % 2) * 170, 235 + (i / 2) * 18)
		label.add_theme_font_size_override("font_size", 9)
		label.modulate = Color(0.8, 0.8, 0.8)
		_panel.add_child(label)

	var close_btn := Button.new()
	close_btn.text = "Close"
	close_btn.position = Vector2(130, 365)
	close_btn.size = Vector2(90, 28)
	close_btn.pressed.connect(func(): visible = false)
	_panel.add_child(close_btn)

func _add_slider(label_text: String, y: int, callback: Callable) -> void:
	var label := Label.new()
	label.text = label_text
	label.position = Vector2(10, y)
	label.add_theme_font_size_override("font_size", 11)
	_panel.add_child(label)

	var slider := HSlider.new()
	slider.position = Vector2(130, y)
	slider.size = Vector2(150, 20)
	slider.min_value = 0
	slider.max_value = 100
	slider.value = 80
	slider.value_changed.connect(callback)
	_panel.add_child(slider)

	var val_label := Label.new()
	val_label.text = "80%"
	val_label.position = Vector2(290, y)
	val_label.add_theme_font_size_override("font_size", 10)
	_panel.add_child(val_label)

func _on_volume_changed(channel: String, value: float) -> void:
	settings_changed.emit(channel, value / 100.0)
