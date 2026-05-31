#!/usr/bin/env python3
import subprocess, pathlib

print('[HB] pack_atlas.py ready')
OUT = pathlib.Path('assets/atlas')
OUT.mkdir(parents=True, exist_ok=True)

# Example TexturePacker CLI command (requires TexturePacker in PATH)
cmd = [
  'TexturePacker',
  '--data', str(OUT/'atlas_map.json'),
  '--format', 'json',
  '--sheet', str(OUT/'atlas_base.png'),
  'assets/base'
]
try:
    subprocess.run(cmd, check=True)
    print('[HB] packed base atlas')
except Exception as e:
    print('WARN: TexturePacker failed or missing:', e)


