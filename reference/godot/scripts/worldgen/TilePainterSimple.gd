class_name TilePainterSimple
extends RefCounted

const COLORS := {
    "ocean": Color8( 30, 80,160),
    "beach": Color8(240,220,120),
    "desert":Color8(220,200,120),
    "grass": Color8( 80,160, 80),
    "forest":Color8( 40,110, 50),
    "rock":  Color8(140,140,140),
    "tundra":Color8(200,220,230),
    "river": Color8( 30,110,190),
    "road":  Color8(120, 90, 60)
}

func paint_png(chunk_xy:Vector2i, biome:PackedStringArray, rivers:PackedByteArray, roads:PackedByteArray, W:int, H:int, out_png_path:String) -> void:
    var img := Image.create(W, H, false, Image.FORMAT_RGBA8)
    img.lock()
    for i in range(W*H):
        var c: Color = COLORS.get(biome[i], Color.DARK_MAGENTA)
        img.set_pixel(i % W, i / W, c)
    # rivers overlay
    for i in range(W*H):
        if rivers[i] == 1:
            img.set_pixel(i % W, i / W, COLORS["river"])
    # roads overlay (0/1 for now)
    for i in range(W*H):
        if roads[i] == 1:
            img.set_pixel(i % W, i / W, COLORS["road"])

    img.flip_y() # make Y-up visually
    img.unlock()
    var err := img.save_png(out_png_path)
    if err != OK:
        push_error("Failed to save PNG: %s" % out_png_path)

func build_chunk_scene(png_path:String, save_path:String, tile_size:int, chunk_size:int) -> void:
    var root := Node2D.new()
    var spr := Sprite2D.new()
    var loaded := Image.load_from_file(png_path)
    if loaded == null:
        push_error("Failed to load PNG: %s" % png_path)
        return
    var tex := ImageTexture.create_from_image(loaded)
    spr.texture = tex
    spr.centered = false
    spr.scale = Vector2(tile_size, tile_size) # 1 pixel = 1 tile; scale up to tile size
    root.add_child(spr)
    var ps := PackedScene.new()
    var ok := ps.pack(root)
    if ok != OK:
        push_error("Failed to pack scene: %s" % save_path)
        return
    var err := ResourceSaver.save(ps, save_path)
    if err != OK:
        push_error("Failed to save scene: %s" % save_path)


