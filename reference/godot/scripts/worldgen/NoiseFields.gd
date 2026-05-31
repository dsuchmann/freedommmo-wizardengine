class_name NoiseFields
extends RefCounted

var n_height_base := FastNoiseLite.new()
var n_height_hi   := FastNoiseLite.new()
var n_moist       := FastNoiseLite.new()
var n_warp        := FastNoiseLite.new()

var cfg: Dictionary = {}
var world_seed: int

func _init(_cfg:Dictionary, _seed:int) -> void:
    print("[HB] NoiseFields ready")
    cfg = _cfg
    world_seed = _seed
    n_height_base.seed = world_seed
    n_height_hi.seed   = world_seed ^ 0x9E3779B9
    n_moist.seed       = world_seed ^ 0x85EBCA6B
    n_warp.seed        = world_seed ^ 0xC2B2AE35

    n_height_base.noise_type = FastNoiseLite.TYPE_PERLIN
    n_height_hi.noise_type   = FastNoiseLite.TYPE_PERLIN
    n_moist.noise_type       = FastNoiseLite.TYPE_PERLIN
    n_warp.noise_type        = FastNoiseLite.TYPE_PERLIN

func _warp(p:Vector2) -> Vector2:
    var f: float = cfg["noise"]["warp"]["freq"]
    var a: float = cfg["noise"]["warp"]["amp"]
    return p + Vector2(
        n_warp.get_noise_2d(p.x*f, p.y*f)*a,
        n_warp.get_noise_2d((p.x+123.4)*f, (p.y-567.8)*f)*a
    )

static func _ridge(x:float) -> float:
    var r: float = 1.0 - absf(x) # x in [-1,1]
    return r*r

func sample_fields(rect:Rect2i, scale:float) -> Dictionary:
    var W: int = rect.size.x
    var Hh: int = rect.size.y
    var height := PackedFloat32Array(); height.resize(W*Hh)
    var moist  := PackedFloat32Array(); moist.resize(W*Hh)
    var temp   := PackedFloat32Array(); temp.resize(W*Hh)

    var height_layers = cfg["noise"]["height"]
    var moisture_layers = cfg["noise"]["moisture"]
    var lapse: float = 0.35
    if cfg.has("lapse_rate"):
        lapse = float(cfg["lapse_rate"])

    for y in range(Hh):
        for x in range(W):
            var wp := _warp(Vector2((rect.position.x+x)*scale, (rect.position.y+y)*scale))
            
            # Sum multiple height noise layers
            var h: float = 0.0
            for i in range(height_layers.size()):
                var freq: float = height_layers[i]["freq"]
                var amp: float = height_layers[i]["amp"]
                var noise_val: float = n_height_base.get_noise_2d(wp.x*freq, wp.y*freq)
                h += (noise_val * 0.5 + 0.5) * amp
            h = clampf(h, 0.0, 1.0)
            
            # Sum multiple moisture noise layers
            var m: float = 0.0
            for i in range(moisture_layers.size()):
                var freq: float = moisture_layers[i]["freq"]
                var amp: float = moisture_layers[i]["amp"]
                var noise_val: float = n_moist.get_noise_2d(wp.x*freq, wp.y*freq)
                m += (noise_val * 0.5 + 0.5) * amp
            m = clampf(m, 0.0, 1.0)
            
            # simple altitude lapse for temp; latitude hook later
            var t := clampf(1.0 - lapse*h, 0.0, 1.0)

            var idx: int = y*W + x
            height[idx] = h; moist[idx] = m; temp[idx] = t

    return {"H":height, "M":moist, "T":temp, "w":W, "h":Hh}


