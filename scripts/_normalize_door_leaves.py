#!/usr/bin/env python3
"""
_normalize_door_leaves.py — normalise generated door leaves to a canonical doorway rect.

A door leaf is generated as a standalone object somewhere in a 128² canvas. For the game to
place + hinge-swing it deterministically, we alpha-bbox-trim it and re-anchor it into a canonical
64×128 leaf canvas (matching the 2-tile-wide door piece): the door fills the centred doorway
rect — foot flush with the bottom (floor line), ~3 tiles tall, hinge on the LEFT jamb. The
renderer then scales this whole canvas to the door tile and swings it about the left edge.

Run: python scripts/_normalize_door_leaves.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
LEAF_DIR = ROOT / 'assets' / 'pixelab' / 'buildings' / 'doors'

# Canonical leaf canvas + doorway rect (in the 64×128 two-tile piece space):
CW, CH = 64, 128
DX0, DX1 = 11, 53     # door spans x[11,53] = 42px wide, centred (hinge at the left edge x=11)
DY0, DY1 = 26, 126    # door spans y[26,126] = 100px ≈ 3 tiles tall, foot at the floor line


def alpha_bbox(im):
    a = im.getchannel('A')
    return a.getbbox()  # (l,t,r,b) of non-zero alpha, or None


def normalize(src: Path):
    out = src.with_name(src.stem + '__norm.png')
    im = Image.open(src).convert('RGBA')
    bb = alpha_bbox(im)
    if not bb:
        print(f'  EMPTY {src.name}'); return
    door = im.crop(bb)
    # STRETCH to fill the doorway rect so a CLOSED door fully covers the opening (a real door
    # fills its frame; preserving aspect left a gap). Slight vertical stretch is acceptable.
    tw, th = DX1 - DX0, DY1 - DY0
    dw, dh = door.size
    door = door.resize((tw, th), Image.NEAREST)
    canvas = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
    canvas.alpha_composite(door, (DX0, DY0))
    canvas.save(out)
    print(f'  OK {out.name}  (door {dw}x{dh} -> {tw}x{th} at {DX0},{DY0})')


def main():
    leaves = sorted(p for p in LEAF_DIR.glob('*.png') if not p.stem.endswith('__norm'))
    if not leaves:
        print(f'no leaves in {LEAF_DIR} yet'); return
    for p in leaves:
        normalize(p)
    print('done.')


if __name__ == '__main__':
    main()
