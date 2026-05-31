class_name LayerVisualizer
extends Node2D

## Renders debug images from WorldCompiler layers as screen overlays.

var _overlay_sprite: Sprite2D = null
var _current_layer: int = -1
var _compiler: WorldCompiler = null
var _chunk_x: int = 0
var _chunk_y: int = 0

func setup(compiler: WorldCompiler) -> void:
	_compiler = compiler
	_overlay_sprite = Sprite2D.new()
	_overlay_sprite.z_index = 100
	_overlay_sprite.modulate.a = 0.7
	_overlay_sprite.visible = false
	add_child(_overlay_sprite)

func show_layer(layer_index: int, cx: int, cy: int) -> void:
	if _compiler == null:
		return
	_current_layer = layer_index
	_chunk_x = cx
	_chunk_y = cy
	var img = _compiler.get_debug_image(cx, cy, layer_index)
	if img == null:
		return
	var tex = ImageTexture.create_from_image(img)
	_overlay_sprite.texture = tex
	var world_scale = 32
	_overlay_sprite.position = Vector2(cx * ChunkData.SIZE * world_scale, cy * ChunkData.SIZE * world_scale)
	_overlay_sprite.scale = Vector2(world_scale, world_scale)
	_overlay_sprite.visible = true

func hide_overlay() -> void:
	_current_layer = -1
	if _overlay_sprite:
		_overlay_sprite.visible = false

func is_active() -> bool:
	return _current_layer >= 0
