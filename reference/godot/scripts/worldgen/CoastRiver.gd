class_name CoastRiver
extends RefCounted

func _idx(x:int,y:int,w:int)->int:
    return y*w+x

# 8-neighbor downslope
func _downslope(p:Vector2i, height:PackedFloat32Array, w:int, h:int) -> Vector2i:
    var best := p
    var best_h := height[_idx(p.x,p.y,w)]
    for dy in range(-1, 2):
        for dx in range(-1, 2):
            if dx==0 and dy==0:
                continue
            var q = Vector2i(p.x+dx, p.y+dy)
            if q.x<0 or q.y<0 or q.x>=w or q.y>=h:
                continue
            var hv = height[_idx(q.x,q.y,w)]
            if hv < best_h:
                best_h = hv
                best = q
    return best

func flow_accum(height:PackedFloat32Array, w:int, h:int) -> PackedInt32Array:
    print("[HB] CoastRiver ready")
    var idxs: Array[int] = []
    idxs.resize(w*h)
    for i in range(w*h):
        idxs[i] = i
    idxs.sort_custom(func(a, b): return height[a] > height[b]) # high → low

    var acc := PackedInt32Array()
    acc.resize(w*h)
    for id in idxs:
        var p = Vector2i(id % w, id / w)
        var q = _downslope(p, height, w, h)
        acc[id] += 1
        if q != p:
            var qid = _idx(q.x,q.y,w)
            acc[qid] += acc[id]
    return acc

func river_mask(height:PackedFloat32Array, w:int, h:int, flow_thresh:int, sea_level:float) -> PackedByteArray:
    var acc = flow_accum(height,w,h)
    var mask := PackedByteArray()
    mask.resize(w*h)
    for i in range(w*h):
        if height[i] > sea_level and acc[i] >= flow_thresh:
            mask[i] = 1
        else:
            mask[i] = 0
    return mask


