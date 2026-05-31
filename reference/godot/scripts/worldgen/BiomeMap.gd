class_name BiomeMap
extends RefCounted

var table:Dictionary
var h_sea: float
var h_beach: float
var lapse_rate: float

func _init(biome_json:Dictionary) -> void:
    print("[HB] BiomeMap ready")
    table = biome_json
    h_sea = float(biome_json["sea_level"])
    h_beach = float(biome_json["sea_level"]) + float(biome_json["beach_band"])
    lapse_rate = float(biome_json["lapse_rate"])

func classify_fields(H:PackedFloat32Array, M:PackedFloat32Array, T:PackedFloat32Array, W:int, Hh:int) -> PackedStringArray:
    var out := PackedStringArray(); out.resize(W*Hh)
    var entries = table["entries"]
    for i in range(W*Hh):
        var h = H[i]; var m = M[i]; var t = T[i]
        if h < h_sea: out[i] = "ocean"
        elif h < h_beach: out[i] = "beach"
        else:
            var chosen := "grass"
            for b in entries:
                if h>=b["h"][0] and h<=b["h"][1] and m>=b["m"][0] and m<=b["m"][1] and t>=b["t"][0] and t<=b["t"][1]:
                    chosen = b["id"]; break
            out[i] = chosen
    return out


