#!/usr/bin/env python3
"""Deterministic re-crop of the grassland south_doorway facades to 64x128 AND
conversion of the door VOID from dark paint to a TRUE alpha cut-out.

The diegetic walk-in interior (feedback_building_interior_diegetic) requires the
doorway to be a real HOLE: the player walks through it and sees the in-world floor
behind. The PixelLab facades ship the opening as near-black PAINT (alpha=255), not
a cut-out -- verified by _recrop_strips analysis. This helper:

  1. Crops a 64-wide window centred on the door void (clamped to the facade).
  2. Flood-fills the void from the bottom-centre over dark/transparent pixels and
     sets those pixels fully transparent (the true hole).
  3. Emits the hole bbox per material to doorway_holes.json (fractions of the 64x128
     output) -- the COORDINATION patch for the registry's doorwayHole(shape) + the
     door-leaf fit.

  python assets/pixelab/buildings/walls/grassland/manifest/_recrop_doorways.py
"""
import os
import json
import numpy as np
from PIL import Image
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
GRASS = os.path.dirname(HERE)
SRC = os.path.join(GRASS, "_src128")

OUT_W, OUT_H = 64, 128
WEARS = ["normal"]   # only __normal doorway sources exist

# Door-void column centre per material (from the mid-door luma profile). fieldstone's
# void sits hard right; the 64-window clamps so the void lands inside the crop.
VOID_CX = {"cob": 64, "fieldstone": 116, "wattle_daub": 63, "timber_frame": 63}

DARK = 42        # luma below this (or alpha<16) is "void candidate" (door interior
                 # measures luma 5-33; frame timber is 50-90 so this separates them)
MAX_SPREAD = 24  # the flood may not wander more than this many px from the seed
                 # centre column, so it can't bleed along the dark cap/foundation


def load(p):
    return np.array(Image.open(p).convert("RGBA"))


def luma(rgb):
    return 0.3 * rgb[:, :, 0] + 0.59 * rgb[:, :, 1] + 0.11 * rgb[:, :, 2]


def flood_void(crop, seed_cx):
    """Flood-fill the door void from seeds along the bottom-centre, walking over
    dark-or-transparent pixels but constrained horizontally to +/-MAX_SPREAD of the
    seed centre so it cannot bleed into the dark cap or foundation course."""
    h, w, _ = crop.shape
    rgb = crop[:, :, :3].astype(int)
    a = crop[:, :, 3]
    cand = (luma(rgb) < DARK) | (a < 16)
    xlo, xhi = max(0, seed_cx - MAX_SPREAD), min(w, seed_cx + MAX_SPREAD)
    seen = np.zeros((h, w), dtype=bool)
    q = deque()
    for y in range(h - 1, h - 12, -1):
        for x in range(max(xlo, seed_cx - 8), min(xhi, seed_cx + 8)):
            if 0 <= y < h and cand[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if (0 <= ny < h and xlo <= nx < xhi and not seen[ny, nx]
                    and cand[ny, nx]):
                seen[ny, nx] = True
                q.append((ny, nx))
    return seen


def process(mat):
    src = os.path.join(SRC, mat, "south_doorway__normal.png")
    if not os.path.exists(src):
        print(f"  [skip] {mat}: no doorway source")
        return None
    a = load(src)
    h, w, _ = a.shape
    cx = VOID_CX[mat]
    x0 = max(0, min(cx - OUT_W // 2, w - OUT_W))
    crop = a[:, x0:x0 + OUT_W, :].copy()   # 64 x 128

    seed_cx = cx - x0                       # door-void centre in crop coords
    void = flood_void(crop, seed_cx)
    # carve the hole: void pixels become fully transparent
    crop[void] = [0, 0, 0, 0]

    ys, xs = np.where(void)
    if len(ys) == 0:
        print(f"  [{mat}] WARNING: no void found after crop x0={x0}")
        return None
    hx0, hx1, hy0, hy1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    hw, hh = hx1 - hx0 + 1, hy1 - hy0 + 1

    out = os.path.join(GRASS, mat, "south_doorway__normal.png")
    Image.fromarray(crop, "RGBA").save(out)

    meta = {
        "cropX0_in128": x0,
        "holePx": {"x0": hx0, "y0": hy0, "w": hw, "h": hh},
        "holeFrac": {
            "x0": round(hx0 / OUT_W, 4), "y0": round(hy0 / OUT_H, 4),
            "w": round(hw / OUT_W, 4), "h": round(hh / OUT_H, 4),
        },
        "canvas": {"w": OUT_W, "h": OUT_H},
    }
    print(f"  [{mat}] 64x128, hole px x[{hx0}..{hx1}] y[{hy0}..{hy1}] "
          f"({hw}x{hh})  frac x0={meta['holeFrac']['x0']} y0={meta['holeFrac']['y0']} "
          f"w={meta['holeFrac']['w']} h={meta['holeFrac']['h']}")
    return meta


def main():
    holes = {}
    print(f"Re-cropping doorways in {GRASS}")
    for mat in ("cob", "fieldstone", "wattle_daub", "timber_frame"):
        m = process(mat)
        if m:
            holes[mat] = m
    # one shape per material for now (default doorway). The registry keys by
    # door SHAPE; all grassland doorway facades use the same opening, so a single
    # 'default' entry per material is correct until per-shape doorways exist.
    # fieldstone's source authors the door hard against the RIGHT edge of the 128
    # facade, so the 64-crop clamps it to the canvas right edge (a ~19px clipped
    # opening) -- usable as a fallback but an ESCALATION candidate for a re-centred
    # doorway regen. The other three materials carve a clean centred opening.
    if "fieldstone" in holes:
        holes["fieldstone"]["escalate"] = ("door void sits hard-right in the source; "
            "crop clamps it to the canvas right edge -> narrow/clipped opening. "
            "Candidate for a re-centred doorway regen.")
    payload = {"_note": "Doorway alpha-hole bbox (true alpha cut-out) in the 64x128 "
                        "south_doorway crop. Door VOID was dark PAINT in the source "
                        "(not a cut-out) -> carved to transparent here. Fractions are "
                        "of the 64-wide x 128-tall canvas. Use for registry "
                        "doorwayHole(shape) + door-leaf fit.",
               "materials": holes}
    jpath = os.path.join(HERE, "doorway_holes.json")
    with open(jpath, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {jpath}")


if __name__ == "__main__":
    main()
