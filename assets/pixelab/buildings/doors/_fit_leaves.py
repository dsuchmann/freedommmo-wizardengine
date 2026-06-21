#!/usr/bin/env python3
"""Deterministically recut the door LEAVES so their opaque bbox fits the measured
doorway-hole sub-rect of the 64x128 grassland doorway crop.

The leaves (plank/arched/ledged) are material-agnostic -- ONE set is reused across
all grassland materials -- so they fit a single CANONICAL doorway opening. We use
the cob doorway hole (the cleanest centred cottage door) as the canonical target;
the door-leaves.js renderer swings the leaf into the per-material doorwayHole(shape)
rect, so the leaf only needs to be authored to the standard centred opening.

Reads:  doors/{plank,arched,ledged}__norm.png  (64x128, leaf bbox x[11..52] y[26..125])
Writes: same files, leaf re-canvassed so opaque bbox == TARGET_HOLE (bottom-aligned,
        horizontally centred), preserving aspect by uniform scale + pad.

  python assets/pixelab/buildings/doors/_fit_leaves.py

Idempotent: reads the pristine leaf from a _src/ snapshot (created on first run).
"""
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "_src")

CANVAS_W, CANVAS_H = 64, 128
LEAVES = ["plank", "arched", "ledged"]

# Canonical doorway-hole sub-rect (from manifest/doorway_holes.json -> cob: the
# cleanest centred opening). Leaf opaque bbox is fit INTO this rect, bottom-aligned.
TARGET = {"x0": 12, "y0": 46, "w": 44, "h": 82}


def load(p):
    return np.array(Image.open(p).convert("RGBA"))


def snapshot(name):
    os.makedirs(SRC, exist_ok=True)
    src = os.path.join(SRC, f"{name}__norm.png")
    live = os.path.join(HERE, f"{name}__norm.png")
    if not os.path.exists(src):
        Image.open(live).convert("RGBA").save(src)
    return src


def fit_leaf(name):
    src = snapshot(name)
    a = load(src)
    alpha = a[:, :, 3]
    ys, xs = np.where(alpha >= 16)
    bx0, bx1, by0, by1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    bw, bh = bx1 - bx0 + 1, by1 - by0 + 1

    # crop the leaf to its opaque bbox
    leaf = a[by0:by1 + 1, bx0:bx1 + 1, :]

    # uniform scale so the leaf fits inside TARGET (contain), then bottom-align +
    # horizontally centre inside the target rect.
    s = min(TARGET["w"] / bw, TARGET["h"] / bh)
    nw, nh = max(1, round(bw * s)), max(1, round(bh * s))
    leaf_img = Image.fromarray(leaf, "RGBA").resize((nw, nh), Image.NEAREST)

    out = np.zeros((CANVAS_H, CANVAS_W, 4), dtype=np.uint8)
    dst_x = TARGET["x0"] + (TARGET["w"] - nw) // 2
    dst_y = TARGET["y0"] + (TARGET["h"] - nh)          # bottom-align in target
    out[dst_y:dst_y + nh, dst_x:dst_x + nw, :] = np.array(leaf_img)

    Image.fromarray(out, "RGBA").save(os.path.join(HERE, f"{name}__norm.png"))
    print(f"  [{name}] leaf {bw}x{bh} -> {nw}x{nh} at ({dst_x},{dst_y}) "
          f"in target x{TARGET['x0']} y{TARGET['y0']} {TARGET['w']}x{TARGET['h']}")


def main():
    print("Fitting door leaves to canonical doorway hole")
    for name in LEAVES:
        fit_leaf(name)
    print("done.")


if __name__ == "__main__":
    main()
