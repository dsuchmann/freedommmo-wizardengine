#!/usr/bin/env python3
"""body_pilot_probe.py - L2b assembly probe (registry gate: seams/palette/joint
alignment vs the rig). Reads the rig + pivot meta + 14 pilot PNGs, composites the
rest pose, measures palette and joint-seam coverage. Exit 0 = PASS, 1 = FAIL,
2 = assets missing. Writes _probe/composite_s.png and _probe/report.json."""
import json, os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RIG = json.load(open(os.path.join(ROOT, 'src/life/rigs/humanoid.json')))
META_PATH = os.path.join(ROOT, 'src/life/rigs/humanoid-parts-south.json')
BASE = os.path.join(ROOT, 'assets/pixelab/body_parts/human/average/adult')
PROBE_DIR = os.path.join(ROOT, 'assets/pixelab/body_parts/_probe')

# painter order = body.js south order (keep in sync; node probe asserts the set)
SOUTH = ['arm_upper_l','arm_fore_l','hand_l','thigh_l','shin_l','foot_l',
         'thigh_r','shin_r','foot_r','torso','arm_upper_r','arm_fore_r','hand_r','head']
PART_BONE = {'head':'head','torso':'spine','arm_upper_l':'arm_u_l','arm_upper_r':'arm_u_r',
  'arm_fore_l':'arm_f_l','arm_fore_r':'arm_f_r','hand_l':'hand_l','hand_r':'hand_r',
  'thigh_l':'thigh_l','thigh_r':'thigh_r','shin_l':'shin_l','shin_r':'shin_r',
  'foot_l':'foot_l','foot_r':'foot_r'}


def rest_origin(bone):
    x = y = 0.0
    cur = bone
    while cur is not None:
        b = RIG['bones'][cur]; x += b['pivot'][0]; y += b['pivot'][1]; cur = b['parent']
    return x, y

# joint positions (rest): child bone origins for seam checks
SEAMS = [('arm_u_l','arm_f_l'),('arm_f_l','hand_l'),('arm_u_r','arm_f_r'),('arm_f_r','hand_r'),
         ('thigh_l','shin_l'),('shin_l','foot_l'),('thigh_r','shin_r'),('shin_r','foot_r')]

S = 6  # composite px per rig unit
CW, CH = 64 * S // 4 * 4, 72 * S  # canvas; ground line near bottom
GROUND_Y = CH - 4 * S
CX = CW // 2


def to_canvas(rx, ry):
    return CX + rx * S, GROUND_Y - ry * S


def main():
    if not os.path.isdir(BASE):
        print('SKIP: pilot assets missing'); return 2
    META = json.load(open(META_PATH))
    report = {'parts': {}, 'palette': {}, 'seams': {}, 'verdict': 'PASS'}
    fails = []
    imgs = {}
    palette_union = set()
    per_part_colors = {}
    for part in SOUTH:
        path = os.path.join(BASE, part, 's.png')
        if not os.path.isfile(path):
            fails.append(f'{part}: missing png'); continue
        im = Image.open(path).convert('RGBA')
        bbox = im.getbbox()
        if bbox is None:
            fails.append(f'{part}: empty alpha'); continue
        imgs[part] = im
        cols = {p[:3] for p in im.getdata() if p[3] > 128}
        per_part_colors[part] = cols
        palette_union |= cols
        report['parts'][part] = {'bbox': bbox, 'colors': len(cols)}
    # palette: union bounded; skin shared between head and at least one arm part
    report['palette']['union'] = len(palette_union)
    if len(palette_union) > 96:
        fails.append(f'palette union too large: {len(palette_union)}')
    if 'head' in per_part_colors:
        arm = set().union(*(per_part_colors.get(p, set()) for p in
              ('arm_fore_l', 'arm_fore_r', 'hand_l', 'hand_r')))
        shared = per_part_colors['head'] & arm
        report['palette']['skin_shared'] = len(shared)
        if not shared:
            fails.append('no shared skin colors between head and arm parts')
    # composite at rest pose
    canvas = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
    for part in SOUTH:
        if part not in imgs:
            continue
        m = META['parts'][part]
        bone = PART_BONE[part]
        ox, oy = rest_origin(bone)
        k = S / m['ppu']
        im = imgs[part]
        w, h = round(im.width * k), round(im.height * k)
        scaled = im.resize((max(1, w), max(1, h)), Image.NEAREST)
        cxp, cyp = to_canvas(ox, oy)
        canvas.alpha_composite(scaled, (round(cxp - m['pivot'][0] * k), round(cyp - m['pivot'][1] * k)))
    os.makedirs(PROBE_DIR, exist_ok=True)
    canvas.save(os.path.join(PROBE_DIR, 'composite_s.png'))
    # seam coverage: alpha presence in a 1.5-rig-unit disc around each joint
    a = canvas.getchannel('A').load()
    for parent, child in SEAMS:
        jx, jy = rest_origin(child)
        cxp, cyp = to_canvas(jx, jy)
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
        report['seams'][f'{parent}->{child}'] = round(cov, 3)
        if cov < 0.35:
            fails.append(f'seam gap at {parent}->{child}: coverage {cov:.2f}')
    if fails:
        report['verdict'] = 'FAIL'; report['fails'] = fails
    json.dump(report, open(os.path.join(PROBE_DIR, 'report.json'), 'w'), indent=1)
    print(json.dumps(report, indent=1))
    return 0 if not fails else 1


if __name__ == '__main__':
    sys.exit(main())
