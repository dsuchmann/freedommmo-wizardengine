extends SceneTree

func _init():
`    var args: PackedStringArray = OS.get_cmdline_args()
    if args.size() < 2:
        push_error("Usage: -- X Y [SEED]")
        quit(1)
        return

    var X: int = int(args[0])
    var Y: int = int(args[1])
    var SEED: int = 12345
    if args.size() >= 3:
        SEED = int(args[2])

    var cfg: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/worldgen/config.json"))
    var biome_table: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/biomes/table.json"))

    var tile_size: int = cfg["tile_size"]
    var CH: int = cfg["chunk_size"]
    var rect: Rect2i = Rect2i(Vector2i(X*CH, Y*CH), Vector2i(CH, CH))

    # Merge noise config with biome lapse rate so NoiseFields sees both
    var nf_cfg: Dictionary = cfg.duplicate(true)
    nf_cfg["lapse_rate"] = biome_table["lapse_rate"]
    var fields := NoiseFields.new(nf_cfg, SEED)
    var f: Dictionary = fields.sample_fields(rect, 1.0) # scale=1.0 world units per tile

    var bio := BiomeMap.new(biome_table)
    var biomes: PackedStringArray = bio.classify_fields(f["H"], f["M"], f["T"], f["w"], f["h"])

    var hydro := CoastRiver.new()
    var rivers: PackedByteArray = hydro.river_mask(f["H"], f["w"], f["h"], int(cfg["hydro"]["flow_threshold"]), float(biome_table["sea_level"]))

    # roads placeholder (all zero mask for now; you can extend with AStarGrid2D later)
    var roads := PackedByteArray(); roads.resize(CH*CH); roads.fill(0)

    var painter := TilePainterSimple.new()
    # Ensure output directories exist
    var da := DirAccess.open("res://")
    if da:
        da.make_dir_recursive("generated")
        da.make_dir_recursive("scenes/world")

    var out_png := "res://generated/Chunk_%d_%d.png" % [X, Y]
    painter.paint_png(Vector2i(X,Y), biomes, rivers, roads, CH, CH, out_png)
    var out_scene := "res://scenes/world/Chunk_%d_%d.tscn" % [X, Y]
    painter.build_chunk_scene(out_png, out_scene, tile_size, CH)

    print("[HB] GenHeadless wrote: ", out_scene)
    quit()


