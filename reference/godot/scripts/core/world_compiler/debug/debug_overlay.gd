class_name DebugOverlay
extends Node

## F1-F12 key toggles for debug layer visualization.

var _visualizer: LayerVisualizer = null
var _compiler: WorldCompiler = null
var _label: Label = null
var _current_chunk: Vector2i = Vector2i.ZERO

func setup(compiler: WorldCompiler, parent: Node2D) -> void:
	_compiler = compiler
	_visualizer = LayerVisualizer.new()
	_visualizer.setup(compiler)
	parent.add_child(_visualizer)

	_label = Label.new()
	_label.position = Vector2(10, 10)
	_label.z_index = 200
	_label.add_theme_color_override("font_color", Color.WHITE)
	_label.add_theme_font_size_override("font_size", 16)
	_label.visible = false
	parent.add_child(_label)

func set_chunk(cx: int, cy: int) -> void:
	_current_chunk = Vector2i(cx, cy)
	if _visualizer and _visualizer.is_active():
		_visualizer.show_layer(_visualizer._current_layer, cx, cy)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		var key = event.keycode
		var layer_index = -1
		match key:
			KEY_F1: layer_index = 0
			KEY_F2: layer_index = 1
			KEY_F3: layer_index = 2
			KEY_F4: layer_index = 3
			KEY_F5: layer_index = 4
			KEY_F6: layer_index = 5
			KEY_F7: layer_index = 6
			KEY_F8: layer_index = 7
			KEY_F9: layer_index = 8
			KEY_F10: layer_index = 9
			KEY_F11: layer_index = 10
			KEY_F12: layer_index = 11

		if layer_index < 0:
			return

		if _compiler == null:
			return

		var layer_names = _compiler.get_layer_names()
		if layer_index >= layer_names.size():
			return

		if _visualizer._current_layer == layer_index:
			_visualizer.hide_overlay()
			_label.visible = false
		else:
			_visualizer.show_layer(layer_index, _current_chunk.x, _current_chunk.y)
			_label.text = "DEBUG: %s (F%d to toggle)" % [layer_names[layer_index], layer_index + 1]
			_label.visible = true
