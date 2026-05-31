#!/usr/bin/env python3
from PIL import Image
import json, pathlib

print('[HB] occluder_from_alpha.py ready')
INP = pathlib.Path('assets/base/prop.png')
OUT = pathlib.Path('generated/occluders/prop.json')
OUT.parent.mkdir(parents=True, exist_ok=True)

if not INP.exists():
    print('No assets/base/prop.png, skipping occluder example')
else:
    im = Image.open(INP).convert('RGBA')
    alpha = im.split()[-1]
    bbox = alpha.getbbox()  # (x0,y0,x1,y1)
    if bbox:
        x0,y0,x1,y1 = bbox
        poly = [[x0,y0],[x1,y0],[x1,y1],[x0,y1]]
        OUT.write_text(json.dumps(poly))
        print('[HB] occluder:', OUT)


