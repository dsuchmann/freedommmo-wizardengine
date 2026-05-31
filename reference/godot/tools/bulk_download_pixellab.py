#!/usr/bin/env python3
"""Bulk download all PixelLab completed objects into the asset catalog.

Usage: python tools/bulk_download_pixellab.py <manifest.json>

The manifest is a JSON array of objects: [{"id": "...", "desc": "...", "size": "32x32"}, ...]

Downloads from Backblaze and organizes into:
  assets/catalog/terrain_objects/{category}/{object_name}/variants/v{N}/base.png
"""

import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ACCOUNT_ID = "0f1031f5-9eee-4df4-996f-0a4114148eba"
BASE_URL = f"https://backblaze.pixellab.ai/file/pixellab-characters/objects/{ACCOUNT_ID}"
ASSET_BASE = Path("assets/catalog/terrain_objects")

# Map description keywords to category/object_name paths
DESCRIPTION_MAP = [
    # Ground textures (layer 1)
    (r"dirt patch|brown dirt", "ground_cover/earth/dirt_patch"),
    (r"dark soil|dark earth", "ground_cover/earth/dark_earth"),
    (r"root.covered.*soil|root soil", "ground_cover/earth/root_soil"),
    (r"packed earth|compacted soil", "ground_cover/earth/packed_earth"),
    (r"frozen soil|frost.*soil", "ground_cover/earth/frozen_soil"),
    (r"wet.*leaves|fallen leaves", "ground_cover/leaf_litter/wet_leaves"),
    (r"pine needle", "ground_cover/earth/pine_needle_bed"),
    (r"bark debris|bark chip", "ground_cover/earth/bark_debris"),
    (r"ash layer|volcanic ash", "ground_cover/ash_layer/ash_layer"),
    (r"charred earth|burned", "ground_cover/earth/charred_earth"),
    (r"cooled lava|hardened lava", "ground_cover/earth/cooled_lava"),
    (r"permafrost|frozen ground", "ground_cover/earth/permafrost"),
    (r"frozen gravel|icy gravel", "ground_cover/gravel/frozen_gravel"),
    (r"packed snow|snow cover", "ground_cover/snow_drift/packed_snow"),
    (r"sand.*drift|wind.*sand", "ground_cover/sand_drift/sand_drift"),
    (r"desert sand", "ground_cover/sand_drift/desert_sand"),
    (r"cracked earth|dry earth", "ground_cover/earth/cracked_earth"),
    (r"mountain.*soil|rocky soil", "ground_cover/earth/mountain_soil"),
    (r"gravel", "ground_cover/gravel/gravel_patch"),
    (r"mud|muddy", "ground_cover/mud/mud_patch"),
    (r"peat", "ground_cover/peat/peat_patch"),
    (r"forest floor|leaf litter", "ground_cover/leaf_litter/forest_floor"),
    # Small debris (layer 2)
    (r"pebble|small stone", "mineral/rock/pebble"),
    (r"twig|small stick", "vegetation/debris/twig"),
    (r"pine cone", "vegetation/debris/pine_cone"),
    (r"ice crystal|frost crystal", "mineral/crystal/ice_crystal"),
    (r"ice shard", "mineral/crystal/ice_shard"),
    (r"obsidian shard", "mineral/crystal/obsidian_shard"),
    (r"pumice", "mineral/rock/pumice_stone"),
    (r"sulfur crystal", "mineral/crystal/sulfur_crystal"),
    (r"dry leaf|dead leaf|autumn leaf", "vegetation/debris/dry_leaf"),
    (r"frozen leaf", "vegetation/debris/frozen_leaf"),
    (r"acorn|nut", "vegetation/debris/acorn"),
    (r"seed pod|dried seed", "vegetation/debris/seed_pod"),
    (r"shell fragment|seashell", "mineral/shell/shell_fragment"),
    # Flora (layer 3)
    (r"algae|freshwater algae", "vegetation/moss/algae"),
    (r"ground moss|green moss", "vegetation/moss/ground_moss"),
    (r"hardy moss", "vegetation/moss/hardy_moss"),
    (r"lichen", "vegetation/moss/lichen"),
    (r"clover", "vegetation/grass/clover_patch"),
    (r"frozen grass|frost.*grass", "vegetation/grass/frozen_grass"),
    (r"meadow grass", "vegetation/grass/meadow_grass"),
    (r"short grass", "vegetation/grass/short_grass"),
    (r"tall grass", "vegetation/grass/tall_grass"),
    (r"dry grass|dead grass", "vegetation/grass/dry_grass"),
    (r"charred grass", "vegetation/grass/charred_grass"),
    (r"tropical grass|jungle grass", "vegetation/grass/tropical_grass"),
    (r"fern|forest fern", "vegetation/fern/forest_fern"),
    # Accent (layer 4)
    (r"toadstool|mushroom", "vegetation/mushroom/toadstool"),
    (r"morel", "vegetation/mushroom/morel"),
    (r"bracket fungus", "vegetation/mushroom/bracket_fungus"),
    (r"wildflower|wild flower", "vegetation/flower/wildflower"),
    (r"daisy", "vegetation/flower/daisy"),
    (r"dandelion", "vegetation/flower/dandelion"),
    (r"poppy", "vegetation/flower/poppy"),
    (r"arctic poppy", "vegetation/flower/arctic_poppy"),
    (r"orchid", "vegetation/flower/orchid"),
    (r"succulent", "vegetation/grass/succulent"),
    (r"cactus", "vegetation/grass/cactus"),
    (r"ember patch", "ground_cover/volcanic/ember_patch"),
    (r"sulfur vent", "ground_cover/volcanic/sulfur_vent"),
    # Large objects (layer 5)
    (r"pine tree", "vegetation/tree/conifer/pine_tree"),
    (r"spruce tree", "vegetation/tree/conifer/spruce_tree"),
    (r"fir tree", "vegetation/tree/conifer/fir_tree"),
    (r"cedar tree", "vegetation/tree/conifer/cedar_tree"),
    (r"oak tree", "vegetation/tree/deciduous/oak_tree"),
    (r"maple tree", "vegetation/tree/deciduous/maple_tree"),
    (r"birch tree", "vegetation/tree/deciduous/birch_tree"),
    (r"elm tree", "vegetation/tree/deciduous/elm_tree"),
    (r"beech tree", "vegetation/tree/deciduous/beech_tree"),
    (r"poplar tree", "vegetation/tree/deciduous/poplar_tree"),
    (r"willow", "vegetation/tree/deciduous/willow_tree"),
    (r"palm tree", "vegetation/tree/tropical/palm_tree"),
    (r"charred tree|dead tree|burnt tree", "vegetation/tree/dead/charred_tree"),
    (r"fallen log|dead log", "structure_natural/fallen_log"),
    (r"boulder|large rock", "mineral/boulder/granite_boulder"),
    (r"mossy boulder", "mineral/boulder/mossy_boulder"),
    (r"frozen boulder|ice.*boulder", "mineral/boulder/frozen_boulder"),
    (r"ice formation|ice pillar", "mineral/crystal/ice_formation"),
    (r"lava rock|volcanic rock", "mineral/rock/lava_rock"),
    (r"sandstone", "mineral/rock/sandstone_boulder"),
    (r"dead shrub|dry bush|dry shrub", "vegetation/bush/dead_shrub"),
    (r"bush|shrub|flowering bush", "vegetation/bush/flowering_bush"),
    (r"berry bush", "vegetation/bush/berry_bush"),
    (r"gem deposit|gem.*crystal", "mineral/crystal/gem_deposit"),
    (r"quartz", "mineral/crystal/quartz"),
    (r"coral", "water_feature/coral"),
    (r"kelp", "water_feature/kelp"),
    (r"spider web", "structure_natural/spider_web"),
    (r"bone pile|bones|skull", "structure_natural/bone_pile"),
    (r"bird nest|nest", "structure_natural/bird_nest"),
    (r"ant mound", "structure_natural/ant_mound"),
    (r"driftwood", "structure_natural/driftwood"),
    # Tag-based mappings (from PixelLab tags like "terrain_X" or just "X")
    (r"^terrain_termite_mound$|termite mound", "structure_natural/termite_mound"),
    (r"^terrain_bear_den$|bear den", "structure_natural/bear_den"),
    (r"^terrain_charred_tree$", "vegetation/tree/dead/charred_tree"),
    (r"^terrain_wildflower$", "vegetation/flower/wildflower"),
    (r"^short_grass$", "vegetation/grass/short_grass"),
    (r"^dry_leaf$", "vegetation/debris/dry_leaf"),
    (r"^pine_needle_bed$", "ground_cover/earth/pine_needle_bed"),
    (r"^autumn_leaves$", "ground_cover/leaf_litter/autumn_leaves"),
    (r"^forest_floor$", "ground_cover/leaf_litter/forest_floor"),
    (r"^desert_sand$", "ground_cover/sand_drift/desert_sand"),
    (r"^cracked_earth$", "ground_cover/earth/cracked_earth"),
    (r"^beach_sand$", "ground_cover/sand_drift/beach_sand"),
    (r"^tall_grass$", "vegetation/grass/tall_grass"),
    (r"^packed_snow$", "ground_cover/snow_drift/packed_snow"),
    (r"^swamp_mud$", "ground_cover/mud/swamp_mud"),
    (r"^skull$", "structure_natural/bone_pile"),
    (r"^gem_deposit$", "mineral/crystal/gem_deposit"),
    (r"^iron_ore$", "mineral/ore/iron_ore"),
    (r"^cave_entrance$", "structure_natural/cave_entrance"),
    (r"^palm_tree$", "vegetation/tree/tropical/palm_tree"),
    (r"^jungle_tree$", "vegetation/tree/tropical/jungle_tree"),
    (r"^morel$", "vegetation/mushroom/morel"),
    (r"^spirit_wisp$", "vegetation/mystic/spirit_wisp"),
    (r"^mountain_gravel$", "ground_cover/gravel/mountain_gravel"),
    (r"^savanna_grass$", "vegetation/grass/savanna_grass"),
    (r"^mystic_ground$", "ground_cover/mystic/mystic_ground"),
    (r"^jungle_floor$", "ground_cover/leaf_litter/jungle_floor"),
    (r"^arcane_flower$", "vegetation/flower/arcane_flower"),
    (r"furniture|armor|weapons|food|treasure|architecture", "_game_items"),
]

# Variant counters per target path
_variant_counters = {}


def map_description(desc: str) -> str:
    """Map a PixelLab description to an asset catalog path."""
    desc_lower = desc.lower()
    for pattern, path in DESCRIPTION_MAP:
        if re.search(pattern, desc_lower):
            return path
    # Fallback: use cleaned description as path
    cleaned = re.sub(r'[^a-z0-9_]', '_', desc_lower[:40]).strip('_')
    cleaned = re.sub(r'_+', '_', cleaned)
    return f"_uncategorized/{cleaned}"


def next_variant(target_dir: str) -> int:
    """Get next variant number for a target directory."""
    if target_dir not in _variant_counters:
        variants_dir = ASSET_BASE / target_dir / "variants"
        existing = 0
        if variants_dir.exists():
            for d in variants_dir.iterdir():
                if d.is_dir() and d.name.startswith("v"):
                    try:
                        n = int(d.name[1:])
                        existing = max(existing, n)
                    except ValueError:
                        pass
        _variant_counters[target_dir] = existing
    _variant_counters[target_dir] += 1
    return _variant_counters[target_dir]


def download_one(obj_id: str, desc: str) -> str:
    """Download a single object and save to the right location."""
    target_dir = map_description(desc)
    variant_num = next_variant(target_dir)

    out_dir = ASSET_BASE / target_dir / "variants" / f"v{variant_num}"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "base.png"

    if out_file.exists():
        return f"SKIP {obj_id} -> {out_file} (exists)"

    url = f"{BASE_URL}/{obj_id}/rotations/unknown.png"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req) as resp:
            with open(str(out_file), "wb") as f:
                f.write(resp.read())
        return f"OK   {obj_id} -> {out_file}"
    except Exception as e:
        # Try alternate URL patterns
        try:
            alt_url = f"{BASE_URL}/{obj_id}/rotations/south.png"
            alt_req = urllib.request.Request(alt_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(alt_req) as resp:
                with open(str(out_file), "wb") as f:
                    f.write(resp.read())
            return f"OK   {obj_id} -> {out_file} (south)"
        except:
            return f"FAIL {obj_id}: {e}"


def main():
    if len(sys.argv) < 2:
        print("Usage: python tools/bulk_download_pixellab.py <manifest.json>")
        sys.exit(1)

    manifest_path = sys.argv[1]
    with open(manifest_path) as f:
        objects = json.load(f)

    print(f"Downloading {len(objects)} objects...")
    start = time.time()

    # Sequential for variant numbering consistency
    ok = 0
    fail = 0
    for i, obj in enumerate(objects):
        result = download_one(obj["id"], obj["desc"])
        if result.startswith("OK"):
            ok += 1
        elif result.startswith("FAIL"):
            fail += 1
            print(result)

        if (i + 1) % 100 == 0:
            elapsed = time.time() - start
            rate = (i + 1) / elapsed
            eta = (len(objects) - i - 1) / rate
            print(f"  [{i+1}/{len(objects)}] {ok} ok, {fail} fail, {rate:.1f}/s, ETA {eta:.0f}s")

    elapsed = time.time() - start
    print(f"\nDone: {ok} downloaded, {fail} failed in {elapsed:.0f}s")


if __name__ == "__main__":
    main()
