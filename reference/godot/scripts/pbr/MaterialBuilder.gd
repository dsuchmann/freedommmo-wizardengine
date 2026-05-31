class_name MaterialBuilder
extends Node

@export var atlas_base: Texture2D
@export var atlas_norm: Texture2D
@export var atlas_spec: Texture2D
@export var map_json_path := "res://assets/atlas/atlas_map.json"

var map := {}

func _ready():
    print("[HB] MaterialBuilder ready")
    if FileAccess.file_exists(map_json_path):
        map = JSON.parse_string(FileAccess.get_file_as_string(map_json_path))
    else:
        push_warning("No atlas map found: " + map_json_path)

func make_material(entry:String) -> CanvasItemMaterial:
    var mat := CanvasItemMaterial.new()
    mat.light_mode = CanvasItemMaterial.LIGHT_MODE_NORMAL
    # In Godot 4, CanvasItemMaterial supports normal_map but no specular setting.
    # Base textures are set on the Sprite/Tile directly via Texture2D/AtlasTexture.
    if atlas_norm != null:
        mat.normal_map = atlas_norm
    return mat


