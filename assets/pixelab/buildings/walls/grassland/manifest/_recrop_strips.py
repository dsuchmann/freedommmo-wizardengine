#!/usr/bin/env python3
"""Deterministic re-crop of the GOOD 128x128 grassland facades into the
structured strip corpus the legacy `cropBox` render path expects.

Why: a 128-wide source trips `isPilot = base.naturalWidth>=96`
(`building-occluder.js`) into the 4-bay UV-clip hack. Re-cropping each facade to
a 32-wide STRUCTURED STRIP (cap+body+foundation baked in) flips isPilot false and
drops straight into the legacy per-32px cropBox path.

This is a DETERMINISTIC RE-CROP, NOT a PixelLab regen. Run it and the outputs are
reproducible byte-for-byte from the same sources.

  python assets/pixelab/buildings/walls/grassland/manifest/_recrop_strips.py

Per the corpus manifest (2026-06-21-grassland-corpus-manifest.md §7 steps 2-3):

  south_base__{wear}.png       32x128  STRUCTURED strip (cap+body+foundation)
                                       masonry: cleanest interior bay, left==right
                                       timber:  post-aligned bay (seams on a stud)
  south_base__rb{1,2,3}.png    32x128  np.roll the strip 8/16/24px (run-bond)
  south_corner_west__{wear}    32x128  left 32 cols of the 128 facade (real post/quoin)
  south_corner_east__{wear}    32x128  flipH(west) -- fixes the fieldstone dup
  north_back__{wear}.png       32x64   re-crop same bay
  edge_ew__{wear}.png          32x128  side-cap from the west quoin column
  interior_base__{wear}.png    32x128  re-crop (back fieldstone/timber opaque)

All SURFACE pieces are backed OPAQUE inside the body band (nearest-opaque fill) so
the wall plane is never see-through to terrain (fixes fieldstone mortar-gap specks
and the timber_frame see-through panels). The asset gate
(assets/pixelab/buildings/manifest/validate-wall-assets.mjs) enforces this.
"""
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
# .../walls/grassland/manifest -> .../walls/grassland
GRASS = os.path.dirname(HERE)
# Idempotent: read the pristine 128x128 facades from the _src128 snapshot, write
# the cropped strips into the live material dir. Re-running never crops an
# already-cropped strip.
SRC = os.path.join(GRASS, "_src128")

WEARS = ["normal", "weathered", "damaged", "mossy"]

# Chosen crop x-offset (left edge) for the cleanest / post-aligned 32px bay.
# cob/fieldstone (masonry): lowest internal-transparency interior bay.
# wattle_daub/timber_frame (timber): seam lands on a vertical stud cluster so
# abutting copies read as a continuous post-and-panel run.
CROP_X = {
    "cob": 57,
    "fieldstone": 24,
    "wattle_daub": 87,
    "timber_frame": 42,
}
MASONRY = {"cob", "fieldstone"}
STRIP_W = 32
FULL_H = 128
NORTH_H = 64

# Body band (rows) that MUST be opaque on a surface piece. Excludes the top sky
# band (cap silhouette is legitimately ragged) and keeps the foundation course.
BODY_Y0 = 8
BODY_Y1 = int(FULL_H * 0.94)   # keep foundation, exclude the very bottom feather


def load(p):
    return np.array(Image.open(p).convert("RGBA"))


def save(arr, p):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    Image.fromarray(arr.astype(np.uint8), "RGBA").save(p)


def back_opaque(strip, y0, y1):
    """Make the wall plane SOLID inside [y0,y1) without inventing new texture: it
    extends the daub/stone colour already present.

    Pass 1 (horizontal): fill each low-alpha pixel with the nearest opaque pixel on
    the same row. Fixes interior mortar/panel gaps.

    Pass 2 (vertical): any row still fully transparent inside the band (e.g. the
    fieldstone sky line sitting below y0, or a damaged-variant blown-out bay) is
    copied wholesale from the nearest opaque row (preferring BELOW = the wall course
    continues upward). This guarantees the gate's inner rect is opaque end to end."""
    out = strip.copy()
    h, w, _ = out.shape
    lo, hi = max(0, y0), min(h, y1)

    # Pass 1: horizontal nearest-opaque fill.
    for y in range(lo, hi):
        row_a = out[y, :, 3]
        opaque_x = np.where(row_a >= 16)[0]
        if opaque_x.size == 0:
            continue
        for x in range(w):
            if row_a[x] >= 16:
                continue
            j = opaque_x[np.argmin(np.abs(opaque_x - x))]
            out[y, x, :3] = out[y, j, :3]
            out[y, x, 3] = 255

    # Pass 2: vertical fill of fully-transparent rows from the nearest opaque row.
    def row_opaque(y):
        return (out[y, :, 3] >= 16).mean() > 0.5
    for y in range(lo, hi):
        if row_opaque(y):
            continue
        # search below first (wall continues upward), then above
        src = None
        for d in range(1, h):
            yb = y + d
            if yb < h and row_opaque(yb):
                src = yb
                break
            ya = y - d
            if ya >= 0 and row_opaque(ya):
                src = ya
                break
        if src is not None:
            out[y, :, :] = out[src, :, :]
    return out


def force_seam(strip):
    """Force the left column to equal the right column so abutting 32px copies hide
    the vertical seam. We overwrite BOTH edge columns with their per-channel average
    (RGBA) so neither side is privileged and the run is symmetric."""
    out = strip.copy()
    left = out[:, 0, :].astype(int)
    right = out[:, -1, :].astype(int)
    avg = ((left + right) // 2).astype(np.uint8)
    out[:, 0, :] = avg
    out[:, -1, :] = avg
    return out


def crop_strip(facade, x0, w=STRIP_W):
    x0 = max(0, min(x0, facade.shape[1] - w))
    return facade[:, x0:x0 + w, :].copy()


def content_top(facade):
    """First row that is >50% opaque (top of the wall content)."""
    alpha = facade[:, :, 3]
    rowop = (alpha >= 16).mean(axis=1)
    rows = np.where(rowop > 0.5)[0]
    return int(rows[0]) if rows.size else 0


def densest_window(facade, w=STRIP_W):
    """x0 of the 32px window with the MOST opaque pixels. north_back is a plain back
    wall with no posts to align, and damaged variants blow holes in random bays, so
    crop the most-intact bay rather than the fixed structural x0."""
    alpha = facade[:, :, 3] >= 16
    best_x, best = 0, -1
    for x0 in range(0, facade.shape[1] - w + 1):
        c = int(alpha[:, x0:x0 + w].sum())
        if c > best:
            best, best_x = c, x0
    return best_x


def process_material(mat):
    sdir = os.path.join(SRC, mat)      # pristine 128x128 sources
    mdir = os.path.join(GRASS, mat)    # live output dir
    if not os.path.isdir(sdir):
        print(f"  [skip] {mat}: no _src128 snapshot")
        return
    x0 = CROP_X[mat]
    written = []

    for wear in WEARS:
        # ---- south_base -> 32x128 structured strip --------------------------
        sb_src = os.path.join(sdir, f"south_base__{wear}.png")
        if os.path.exists(sb_src):
            facade = load(sb_src)
            strip = crop_strip(facade, x0)
            strip = back_opaque(strip, BODY_Y0, BODY_Y1)
            strip = force_seam(strip)
            sb_out = os.path.join(mdir, f"south_base__{wear}.png")
            save(strip, sb_out)
            written.append(f"south_base__{wear} 32x128")

            # ---- run-bond variants (only for the canonical 'normal' wear) ----
            # np.roll shifts which columns land on the edges, so re-force the seam
            # on the ROLLED strip (the pre-roll strip's forced edges move inward).
            if wear == "normal":
                for n, shift in ((1, 8), (2, 16), (3, 24)):
                    rolled = force_seam(np.roll(strip, shift, axis=1))
                    save(rolled, os.path.join(mdir, f"south_base__rb{n}.png"))
                    written.append(f"south_base__rb{n} (roll {shift}px)")

        # ---- south_corner_west -> left 32 cols of the facade ---------------
        cw_src = os.path.join(sdir, f"south_corner_west__{wear}.png")
        if os.path.exists(cw_src):
            wf = load(cw_src)
            west = crop_strip(wf, 0)              # leftmost 32 cols carry the post/quoin
            west = back_opaque(west, BODY_Y0, BODY_Y1)
            save(west, os.path.join(mdir, f"south_corner_west__{wear}.png"))
            written.append(f"south_corner_west__{wear} 32x128")

            # ---- south_corner_east = flipH(west) (TRUE east post) ----------
            east = west[:, ::-1, :].copy()
            save(east, os.path.join(mdir, f"south_corner_east__{wear}.png"))
            written.append(f"south_corner_east__{wear} = flipH(west)")

            # ---- edge_ew -> side-cap from the west quoin column ------------
            # Sample the outermost ~10px quoin band of the west corner and tile it
            # to a 32-wide upright side cap; force seam so it reads continuous when
            # the renderer samples its x=0..16 quoin rect.
            quoin = west[:, 0:10, :]
            reps = (STRIP_W + quoin.shape[1] - 1) // quoin.shape[1]
            ew = np.concatenate([quoin] * reps, axis=1)[:, :STRIP_W, :].copy()
            ew = back_opaque(ew, BODY_Y0, BODY_Y1)
            ew = force_seam(ew)
            save(ew, os.path.join(mdir, f"edge_ew__{wear}.png"))
            written.append(f"edge_ew__{wear} 32x128 (west quoin side-cap)")

        # ---- interior_base -> 32x128 re-crop, backed opaque ----------------
        ib_src = os.path.join(sdir, f"interior_base__{wear}.png")
        if os.path.exists(ib_src):
            ib = load(ib_src)
            strip = crop_strip(ib, x0)
            strip = back_opaque(strip, BODY_Y0, BODY_Y1)
            strip = force_seam(strip)
            save(strip, os.path.join(mdir, f"interior_base__{wear}.png"))
            written.append(f"interior_base__{wear} 32x128")

        # ---- north_back -> 32x64 re-crop (densest intact bay) --------------
        nb_src = os.path.join(sdir, f"north_back__{wear}.png")
        if os.path.exists(nb_src):
            nb = load(nb_src)
            nx0 = densest_window(nb)        # avoid damaged blown-out bays
            top = content_top(nb)
            y0 = max(0, min(top, nb.shape[0] - NORTH_H))
            col = crop_strip(nb, nx0)
            strip = col[y0:y0 + NORTH_H, :, :].copy()
            strip = back_opaque(strip, 2, NORTH_H - 2)
            strip = force_seam(strip)
            save(strip, os.path.join(mdir, f"north_back__{wear}.png"))
            written.append(f"north_back__{wear} 32x64 (x0={nx0})")

    print(f"  [{mat}] x0={x0}: {len(written)} pieces")
    for w in written:
        print(f"      {w}")


def main():
    print(f"Re-cropping grassland strips in {GRASS}")
    for mat in ("fieldstone", "cob", "wattle_daub", "timber_frame"):
        process_material(mat)
    print("done.")


if __name__ == "__main__":
    main()
