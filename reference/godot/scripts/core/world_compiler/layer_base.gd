class_name LayerBase

## Base class for all compiler layers.

var layer_name: String = "base"
var layer_id: int = 0

func compile(chunk: ChunkData, seed: int) -> void:
	push_error("LayerBase.compile() not overridden in " + layer_name)

func validate(chunk: ChunkData) -> Array:
	return []

func get_debug_image(chunk: ChunkData) -> Image:
	return Image.create(ChunkData.SIZE, ChunkData.SIZE, false, Image.FORMAT_RGB8)
