#!/usr/bin/env python3
import subprocess, pathlib, sys, os

print('[HB] gen_maps.py ready')
BASE = pathlib.Path('assets/base')
OUT  = pathlib.Path('assets/pbr')
OUT.mkdir(parents=True, exist_ok=True)

# Example: set SPRITE_ILLUMINATOR env var to your CLI path or edit here
CLI = pathlib.Path(os.environ.get('SPRITE_ILLUMINATOR', 'SpriteIlluminator'))

if not BASE.exists():
    print('No assets/base directory, skipping.')
    sys.exit(0)

for png in BASE.rglob('*.png'):
    out_n = OUT / f"{png.stem}_n.png"
    out_s = OUT / f"{png.stem}_s.png"
    cmd = [str(CLI), '--input', str(png), '--normal', str(out_n), '--specular', str(out_s)]
    try:
        subprocess.run(cmd, check=True)
        print('[HB] maps:', png.name)
    except Exception as e:
        print('WARN: normal/spec generation failed for', png, e)


