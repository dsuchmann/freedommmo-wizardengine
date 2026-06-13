#!/usr/bin/env python3
"""body_parts_meta.py - 8-direction avatar part install + pivot meta + probe.

Extends the L2b pilot pipeline (body_pilot_probe.py) to all directions:
 1. quantize raw PixelLab PNGs (scripts/.bursts/avatar8dir/raw/<part>_<dir>.png)
    to the shared 64-color palette derived from the south pilot set
 2. install to assets/pixelab/body_parts/human/average/adult/<part>/<dir>.png
    - east set: one gen per part, l/r pairs share the file
    - n/se/ne: new head+torso, limbs copied from south (cylinders read fine)
    - w/sw/nw: horizontal mirrors of e/se/ne (real flipped files, pilot convention)
 3. measure bboxes -> pivot meta src/life/rigs/humanoid-parts-<dir>.json
    (ppu = bbox_height / bone_length; pivot: bbox bottom for head/torso,
     bbox top for limbs; x = bbox center — pilot convention)
 4. assembly probe per direction (seam coverage >= 0.35, palette union <= 96)

Exit 0 = all requested directions PASS, 1 = FAIL, 2 = inputs missing.
Usage: python scripts/body_parts_meta.py [e n se ne w sw nw]
"""
import json, os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RIG = json.load(open(os.path.join(ROOT, 'src/life/rigs/humanoid.json')))
BASE = os.path.join(ROOT, 'assets/pixelab/body_parts/human/average/adult')
RAW = os.path.join(ROOT, 'scripts/.bursts/avatar8dir/raw')
RIGS_DIR = os.path.join(ROOT, 'src/life/rigs')
PROBE_DIR = os.path.join(ROOT, 'assets/pixelab/body_parts/_probe')

PARTS = ['head', 'torso', 'arm_upper_l', 'arm_upper_r', 'arm_fore_l', 'arm_fore_r',
         'hand_l', 'hand_r', 'thigh_l', 'thigh_r', 'shin_l', 'shin_r', 'foot_l', 'foot_r']
PART_BONE = {'head': 'head', 'torso': 'spine', 'arm_upper_l': 'arm_u_l', 'arm_upper_r': 'arm_u_r',
             'arm_fore_l': 'arm_f_l', 'arm_fore_r': 'arm_f_r', 'hand_l': 'hand_l', 'hand_r': 'hand_r',
             'thigh_l': 'thigh_l', 'thigh_r': 'thigh_r', 'shin_l': 'shin_l', 'shin_r': 'shin_r',
             'foot_l': 'foot_l', 'foot_r': 'foot_r'}
# raw gen name per part (l/r share one east gen)
RAW_NAME = {'head': 'head', 'torso': 'torso', 'arm_upper_l': 'arm_upper', 'arm_upper_r': 'arm_upper',
            'arm_fore_l': 'arm_fore', 'arm_fore_r': 'arm_fore', 'hand_l': 'hand', 'hand_r': 'hand',
            'thigh_l': 'thigh', 'thigh_r': 'thigh', 'shin_l': 'shin', 'shin_r': 'shin',
            'foot_l': 'foot', 'foot_r': 'foot'}
HEAD_TORSO = {'head', 'torso'}
# direction -> (new-part set, mirror-source dir or None)
NEW_PARTS = {'e': set(PARTS), 'n': HEAD_TORSO, 'se': HEAD_TORSO, 'ne': HEAD_TORSO}
MIRROR_OF = {'w': 'e', 'sw': 'se', 'nw': 'ne'}
SEAMS = [('arm_u_l', 'arm_f_l'), ('arm_f_l', 'hand_l'), ('arm_u_r', 'arm_f_r'), ('arm_f_r', 'hand_r'),
         ('thigh_l', 'shin_l'), ('shin_l', 'foot_l'), ('thigh_r', 'shin_r'), ('shin_r', 'foot_r')]


def south_palette():
    cols = set()
    for part in PARTS:
        p = os.path.join(BASE, part, 's.png')
        if os.path.isfile(p):
            im = Image.open(p).convert('RGBA')
            cols |= {px[:3] for px in im.getdata() if px[3] > 128}
    return list(cols)


def quantize(im, palette):
    """Snap opaque pixels to the nearest shared-palette color."""
    out = im.copy()
    px = out.load()
    cache = {}
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a <= 16:
                px[x, y] = (0, 0, 0, 0)
                continue
            key = (r, g, b)
            best = cache.get(key)
            if best is None:
                best = min(palette, key=lambda c: (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2)
                cache[key] = best
            px[x, y] = (best[0], best[1], best[2], 255 if a > 128 else a)
    return out


def meta_for(im, part):
    bbox = im.getbbox()
    if bbox is None:
        return None
    x0, y0, x1, y1 = bbox  # x1/y1 exclusive
    h = y1 - y0
    length = RIG['bones'][PART_BONE[part]]['length']
    ppu = round(h / length, 3)
    px = round((x0 + x1 - 1) / 2, 1)
    py = (y1 - 1) if part in HEAD_TORSO else y0
    return {'pivot': [px, py], 'ppu': ppu}


def rest_origin(bone):
    x = y = 0.0
    cur = bone
    while cur is not None:
        b = RIG['bones'][cur]
        x += b['pivot'][0]; y += b['pivot'][1]; cur = b['parent']
    return x, y


def probe(d, meta, fails):
    """Composite the rest pose for direction d; check seams + palette union."""
    S = 6
    CW, CH = 96 * S, 72 * S
    GROUND_Y = CH - 4 * S
    CX = CW // 2
    canvas = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
    union = set()
    for part in PARTS:
        path = os.path.join(BASE, part, f'{d}.png')
        im = Image.open(path).convert('RGBA')
        union |= {p[:3] for p in im.getdata() if p[3] > 128}
        m = meta['parts'][part]
        ox, oy = rest_origin(PART_BONE[part])
        k = S / m['ppu']
        scaled = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.NEAREST)
        cxp, cyp = CX + ox * S, GROUND_Y - oy * S
        canvas.alpha_composite(scaled, (round(cxp - m['pivot'][0] * k), round(cyp - m['pivot'][1] * k)))
    os.makedirs(PROBE_DIR, exist_ok=True)
    canvas.save(os.path.join(PROBE_DIR, f'composite_{d}.png'))
    if len(union) > 96:
        fails.append(f'{d}: palette union {len(union)} > 96')
    a = canvas.getchannel('A').load()
    seams = {}
    for parent, child in SEAMS:
        jx, jy = rest_origin(child)
        cxp, cyp = CX + jx * S, GROUND_Y - jy * S
        r = round(1.5 * S); hit = total = 0
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy > r * r:
                    continue
                x, y = round(cxp) + dx, round(cyp) + dy
                if 0 <= x < CW and 0 <= y < CH:
                    total += 1
                    if a[x, y] > 20:
                        hit += 1
        cov = hit / total if total else 0
        seams[f'{parent}->{child}'] = round(cov, 3)
        if cov < 0.35:
            fails.append(f'{d}: seam gap {parent}->{child} coverage {cov:.2f}')
    return {'palette_union': len(union), 'seams': seams}


def build_dir(d, palette, fails):
    parts_meta = {}
    if d in MIRROR_OF:
        src_dir = MIRROR_OF[d]
        src_meta = json.load(open(os.path.join(RIGS_DIR, f'humanoid-parts-{src_dir}.json')))
        for part in PARTS:
            src = Image.open(os.path.join(BASE, part, f'{src_dir}.png')).convert('RGBA')
            im = src.transpose(Image.FLIP_LEFT_RIGHT)
            os.makedirs(os.path.join(BASE, part), exist_ok=True)
            im.save(os.path.join(BASE, part, f'{d}.png'))
            sm = src_meta['parts'][part]
            parts_meta[part] = {'pivot': [round(im.width - 1 - sm['pivot'][0], 1), sm['pivot'][1]],
                                'ppu': sm['ppu']}
    else:
        for part in PARTS:
            dst = os.path.join(BASE, part, f'{d}.png')
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if part in NEW_PARTS[d]:
                raw_path = os.path.join(RAW, f'{RAW_NAME[part]}_{d}.png')
                if not os.path.isfile(raw_path):
                    fails.append(f'{d}: raw missing {raw_path}')
                    return None
                im = quantize(Image.open(raw_path).convert('RGBA'), palette)
            else:
                im = Image.open(os.path.join(BASE, part, 's.png')).convert('RGBA')
            im.save(dst)
            m = meta_for(im, part)
            if m is None:
                fails.append(f'{d}/{part}: empty alpha')
                return None
            parts_meta[part] = m
    meta = {'direction': d, 'race': 'human', 'bodyType': 'average', 'ageBand': 'adult',
            'parts': parts_meta}
    json.dump(meta, open(os.path.join(RIGS_DIR, f'humanoid-parts-{d}.json'), 'w'), indent=1)
    return meta


def main():
    dirs = sys.argv[1:] or ['e', 'n', 'se', 'ne', 'w', 'sw', 'nw']
    # mirrors must come after their sources
    dirs.sort(key=lambda d: d in MIRROR_OF)
    if not os.path.isdir(BASE):
        print('SKIP: south pilot assets missing'); return 2
    palette = south_palette()
    if not palette:
        print('SKIP: south palette empty'); return 2
    fails = []
    report = {}
    for d in dirs:
        meta = build_dir(d, palette, fails)
        if meta is None:
            continue
        report[d] = probe(d, meta, fails)
    out = {'dirs': report, 'verdict': 'FAIL' if fails else 'PASS', 'fails': fails}
    json.dump(out, open(os.path.join(PROBE_DIR, 'report_8dir.json'), 'w'), indent=1)
    print(json.dumps(out, indent=1))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
