#!/usr/bin/env python3
"""Append PixelLab list_objects output to manifest.
Usage: echo "PAGE_TEXT" | python tools/append_manifest.py
"""
import json, sys

MANIFEST = "data/terrain_objects/generation/pixellab_manifest.json"

try:
    with open(MANIFEST) as f:
        objects = json.load(f)
except FileNotFoundError:
    objects = []

existing_ids = {o["id"] for o in objects}
added = 0

for line in sys.stdin:
    line = line.strip()
    if "|" not in line or "total" in line or "showing" in line or "next:" in line:
        continue
    parts = [p.strip() for p in line.split("|")]
    if len(parts) >= 3:
        oid = parts[0].strip()
        if len(oid) == 36 and oid not in existing_ids:  # UUID length
            desc = parts[1].strip().rstrip(".")
            size = parts[2].strip().split()[-1] if parts[2].strip() else "32x32"
            objects.append({"id": oid, "desc": desc, "size": size})
            existing_ids.add(oid)
            added += 1

with open(MANIFEST, "w") as f:
    json.dump(objects, f)
print(f"Added {added}, total {len(objects)}")
