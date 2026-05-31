#!/usr/bin/env python3
"""
Reorganize terrain assets from terrain_v2 biome-based structure into
terrain_v3 surface-based structure.

terrain_v2/{biome}/L1_base/  ->  terrain_v3/surfaces/{surface_id}/
terrain_v2/{biome}/transitions/{name}/  ->  terrain_v3/transitions/{lower}__{upper}/
"""

import shutil
import os
from pathlib import Path

BASE = Path(__file__).parent.parent / "assets" / "catalog"
V2 = BASE / "terrain_v2"
V3 = BASE / "terrain_v3"

# Biome L1 -> surface ID mapping
SURFACE_MAP = [
    ("ocean",           "ocean_water"),
    ("beach",           "golden_sand"),
    ("grassland",       "lush_grass"),
    ("steppe",          "dry_grass"),
    ("forest",          "forest_floor"),
    ("dense_forest",    "dark_humus"),
    ("swamp",           "swamp_mud"),
    ("mountains",       "grey_rock"),
    ("volcanic",        "volcanic_rock"),
    ("tundra",          "frozen_earth"),
    ("arctic",          "glacial_ice"),
    ("mystic",          "mystic_crystal"),
    # snow: use mountains L1 as placeholder
    ("mountains",       "snow_cover"),
]

# Transition source -> target mapping: (biome, transition_dir_name, lower_surface, upper_surface)
TRANSITION_MAP = [
    ("ocean",          "ocean_to_beach",              "ocean_water",   "golden_sand"),
    ("beach",          "beach_to_grassland",           "golden_sand",   "lush_grass"),
    ("grassland",      "grassland_to_forest",          "lush_grass",    "forest_floor"),
    ("grassland",      "grassland_to_steppe",          "lush_grass",    "dry_grass"),
    ("forest",         "forest_to_dense_forest",       "forest_floor",  "dark_humus"),
    ("desert",         "desert_to_savanna",            "golden_sand",   "dry_grass"),
    ("steppe",         "steppe_to_mountains",          "dry_grass",     "grey_rock"),
    ("tundra",         "tundra_to_taiga",              "frozen_earth",  "forest_floor"),
    ("mountains",      "mountains_to_arctic",          "grey_rock",     "glacial_ice"),
    ("savanna",        "savanna_to_tropical_forest",   "dry_grass",     "forest_floor"),
]


def copy_wang_tiles(src: Path, dst: Path, label: str):
    """Copy wang_0.png through wang_15.png and tileset.png from src to dst."""
    if not src.exists():
        print(f"  SKIP {label}: source not found: {src}")
        return False

    dst.mkdir(parents=True, exist_ok=True)
    copied = 0

    # Copy wang tiles
    for i in range(16):
        fname = f"wang_{i}.png"
        src_file = src / fname
        if src_file.exists():
            shutil.copy2(src_file, dst / fname)
            copied += 1
        else:
            print(f"  WARN {label}: missing {fname}")

    # Copy tileset.png if present
    tileset = src / "tileset.png"
    if tileset.exists():
        shutil.copy2(tileset, dst / "tileset.png")
        copied += 1

    print(f"  COPY {label}: {copied} files -> {dst.relative_to(BASE)}")
    return True


def main():
    # Clean slate
    if V3.exists():
        print(f"Removing existing {V3.relative_to(BASE)} ...")
        shutil.rmtree(V3)

    print(f"\n=== Building terrain_v3 surfaces ===")
    seen_surfaces = set()
    for biome, surface_id in SURFACE_MAP:
        if surface_id in seen_surfaces:
            print(f"  SKIP {surface_id}: already populated")
            continue
        seen_surfaces.add(surface_id)
        src = V2 / biome / "L1_base"
        dst = V3 / "surfaces" / surface_id
        copy_wang_tiles(src, dst, f"surface/{surface_id} <- {biome}/L1_base")

    print(f"\n=== Building terrain_v3 transitions ===")
    seen_transitions = set()
    for biome, trans_name, lower, upper in TRANSITION_MAP:
        key = f"{lower}__{upper}"
        if key in seen_transitions:
            print(f"  SKIP {key}: already populated (first source wins)")
            continue
        seen_transitions.add(key)
        src = V2 / biome / "transitions" / trans_name
        dst = V3 / "transitions" / key
        copy_wang_tiles(src, dst, f"transition/{key} <- {biome}/transitions/{trans_name}")

    print(f"\n=== Summary ===")
    surfaces = list((V3 / "surfaces").iterdir()) if (V3 / "surfaces").exists() else []
    transitions = list((V3 / "transitions").iterdir()) if (V3 / "transitions").exists() else []
    print(f"  Surfaces:    {len(surfaces)} directories")
    print(f"  Transitions: {len(transitions)} directories")
    for d in sorted(surfaces):
        print(f"    surfaces/{d.name}")
    for d in sorted(transitions):
        print(f"    transitions/{d.name}")


if __name__ == "__main__":
    main()
