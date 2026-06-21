#!/usr/bin/env python3
"""Path A ($0) window OVERLAY objects: re-canvas the orphaned 64x64 transparent-
surround window art into 64x96 overlay objects and place a neutral set in each
grassland material dir.

Windows are material-agnostic (one neutral set reused across materials), so the
SAME four overlays are copied into cob/fieldstone/wattle_daub/timber_frame. The
RENDER window-overlay.js blits these over the wall bay (NO 2D top-pass) and swaps
closed<->shutters by proximity; placement uses the existing iv%3 rule.

Output per material dir (assets/pixelab/buildings/walls/grassland/{material}/):
  south_window_obj__arched__closed.png    (from window_arch    -- shutters drawn-to)
  south_window_obj__arched__shutters.png  (from window_shutters -- shutters open)
  south_window_obj__stone__closed.png     (from window_stone)
  south_window_obj__balcony__shutters.png (from window_balcony)

64x64 source is scaled to fit a 64-wide canvas and TOP-aligned in a 64x96 frame
(the window head sits high; the lower 32px is transparent sill space the wall shows
through). Transparent surround is preserved so only the window reads, never a block.

  python assets/pixelab/buildings/windows/_make_overlays.py
"""
import os
import shutil
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
# .../buildings/windows -> .../buildings/walls/grassland
GRASS = os.path.join(HERE, "..", "walls", "grassland")
MATERIALS = ["cob", "fieldstone", "wattle_daub", "timber_frame"]

OUT_W, OUT_H = 64, 96

# (source 64x64, output overlay name)
MAP = [
    ("window_arch.png",     "south_window_obj__arched__closed.png"),
    ("window_shutters.png", "south_window_obj__arched__shutters.png"),
    ("window_stone.png",    "south_window_obj__stone__closed.png"),
    ("window_balcony.png",  "south_window_obj__balcony__shutters.png"),
]


def make_overlay(src_path):
    img = Image.open(src_path).convert("RGBA")
    w, h = img.size
    # scale to fit the 64 width (these are already 64 wide, so this is a no-op or
    # mild fit if a source differs); keep aspect.
    s = OUT_W / w
    nw, nh = round(w * s), round(h * s)
    img = img.resize((nw, nh), Image.NEAREST)
    canvas = Image.new("RGBA", (OUT_W, OUT_H), (0, 0, 0, 0))
    # top-align (window head high in the bay), horizontally centred
    dx = (OUT_W - nw) // 2
    dy = 0
    canvas.paste(img, (dx, dy), img)
    return np.array(canvas)


def main():
    print("Building Path A window overlays (64x96) -> per grassland material")
    built = []
    for src_name, out_name in MAP:
        src = os.path.join(HERE, src_name)
        if not os.path.exists(src):
            print(f"  [skip] missing {src_name}")
            continue
        arr = make_overlay(src)
        built.append((out_name, arr))

    for mat in MATERIALS:
        mdir = os.path.join(GRASS, mat)
        if not os.path.isdir(mdir):
            print(f"  [skip] no material dir {mat}")
            continue
        for out_name, arr in built:
            Image.fromarray(arr, "RGBA").save(os.path.join(mdir, out_name))
        print(f"  [{mat}] wrote {len(built)} window overlays")
    print("done.")


if __name__ == "__main__":
    main()
