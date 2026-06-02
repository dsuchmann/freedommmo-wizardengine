"""Bulk download all completed PixelLab jobs from session 1."""
import urllib.request
import os
import json
import shutil
import ssl

# Disable SSL verification for backblaze URLs if needed
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

BASE = "C:/Users/daves/AppData/Roaming/wizardgenie/projects/default/assets/pixelab/landscape_v2"

# Tile mapping from pending_jobs.json
TILE_MAPPING = {
    0: ("surface_overlays", "mud_pool", "decals", "overlay"),
    1: ("surface_overlays", "mud_pool", "decals", "overlay"),
    2: ("surface_overlays", "wet_mud_shine", "decals", "overlay"),
    3: ("surface_overlays", "wet_mud_shine", "decals", "overlay"),
    4: ("surface_overlays", "algae_film", "decals", "overlay"),
    5: ("surface_overlays", "algae_film", "decals", "overlay"),
    6: ("surface_overlays", "algae_film", "decals", "overlay"),
    7: ("surface_overlays", "algae_film", "decals", "overlay"),
    8: ("micro", "dark_mud_flecks", "decals", "micro"),
    9: ("micro", "dark_mud_flecks", "decals", "micro"),
    10: ("micro", "dark_mud_flecks", "decals", "micro"),
    11: ("micro", "dark_mud_flecks", "decals", "micro"),
    12: ("micro", "moss_ground_cover", "decals", "micro"),
    13: ("micro", "moss_ground_cover", "decals", "micro"),
    14: ("micro", "reeds_grass_blades", "decals", "micro"),
    15: ("micro", "reeds_grass_blades", "decals", "micro"),
}

# Tiles pro job IDs and their backblaze base URLs
TILES_PRO_JOBS = [
    "b2d1d0a4-efe0-4666-a14a-f35c4f8912ff",
    "d5068763-3ccf-46e7-b57b-4110a3760394",
    "c70cf51b-e369-47ee-9df2-66b4b9ffd988",
    "2a0df441-080d-4d2e-96a1-71a52962b998",
    "a65141d3-98ec-4f11-bf65-235d7ab0d281",
    "2acf864a-4731-4004-b451-b5323fb60862",
]

BACKBLAZE_BASE = "https://backblaze.pixellab.ai/file/pixellab-tiles/0f1031f5-9eee-4df4-996f-0a4114148eba"

# Completed map objects with their download URLs
MAP_OBJECTS = [
    {"id": "db2220f5-9998-4402-ad27-7b4538423398", "family": "moss_clump", "layer": "medium", "subdir": "sprites", "type": "medium"},
    {"id": "56785be4-77c1-4f95-99e9-a8f2a452d15e", "family": "swamp_tree", "layer": "objects", "subdir": "sprites", "type": "object"},
    {"id": "d8ff4de8-aea1-4d18-9c73-0a75b9ef3562", "family": "reeds", "layer": "medium", "subdir": "sprites", "type": "medium"},
    {"id": "dc00fe97-51f1-417c-9cd1-692327a3f886", "family": "reeds", "layer": "medium", "subdir": "sprites", "type": "medium"},
    {"id": "dbc6bdb1-88a7-43a9-b031-33fbaae92c55", "family": "reeds", "layer": "medium", "subdir": "sprites", "type": "medium"},
    {"id": "ff554ab7-b345-4ed1-b717-d58420bcf9c8", "family": "reeds", "layer": "medium", "subdir": "sprites", "type": "medium"},
    {"id": "21278ee2-b762-4325-ab04-269483134fb5", "family": "cattails", "layer": "medium", "subdir": "sprites", "type": "medium"},
]

def count_existing(directory, family, file_type):
    """Count existing variant files in a directory."""
    target_dir = os.path.join(BASE, directory, family, "decals" if file_type in ("overlay", "micro") else "sprites")
    if not os.path.exists(target_dir):
        os.makedirs(target_dir, exist_ok=True)
        return 0
    prefix = f"{family}__{file_type}__v"
    count = len([f for f in os.listdir(target_dir) if f.startswith(prefix) and f.endswith('.png')])
    return count

def next_variant(directory, family, file_type):
    """Get next variant number."""
    return count_existing(directory, family, file_type)

def download_file(url, dest_path):
    """Download a file from URL to dest_path."""
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    try:
        urllib.request.urlretrieve(url, dest_path)
        size = os.path.getsize(dest_path)
        return True, size
    except Exception as e:
        return False, str(e)

# Track variant counters per family to avoid conflicts
variant_counters = {}

def get_next_variant(layer, family, file_type):
    key = (layer, family, file_type)
    if key not in variant_counters:
        variant_counters[key] = count_existing(layer, family, file_type)
    v = variant_counters[key]
    variant_counters[key] += 1
    return v

# ---- DOWNLOAD TILES PRO ----
print("=" * 60)
print("DOWNLOADING TILES PRO (6 batches × 16 tiles = 96 tiles)")
print("=" * 60)

tiles_downloaded = 0
tiles_failed = 0

for job_id in TILES_PRO_JOBS:
    print(f"\nBatch: {job_id[:8]}...")
    for tile_idx in range(16):
        layer, family, subdir, file_type = TILE_MAPPING[tile_idx]
        v = get_next_variant(layer, family, file_type)
        filename = f"{family}__{file_type}__v{v:03d}.png"
        dest = os.path.join(BASE, layer, family, subdir, filename)
        url = f"{BACKBLAZE_BASE}/{job_id}/tile_{tile_idx}.png"
        
        ok, result = download_file(url, dest)
        if ok:
            tiles_downloaded += 1
            print(f"  ✓ tile_{tile_idx} → {filename} ({result} bytes)")
        else:
            tiles_failed += 1
            print(f"  ✗ tile_{tile_idx} FAILED: {result}")

print(f"\nTiles Pro: {tiles_downloaded} downloaded, {tiles_failed} failed")

# ---- DOWNLOAD MAP OBJECTS ----
print("\n" + "=" * 60)
print("DOWNLOADING MAP OBJECTS (7 completed)")
print("=" * 60)

objects_downloaded = 0
objects_failed = 0

for obj in MAP_OBJECTS:
    v = get_next_variant(obj["layer"], obj["family"], obj["type"])
    filename = f"{obj['family']}__{obj['type']}__v{v:03d}.png"
    dest = os.path.join(BASE, obj["layer"], obj["family"], obj["subdir"], filename)
    url = f"https://api.pixellab.ai/mcp/map-objects/{obj['id']}/download"
    
    ok, result = download_file(url, dest)
    if ok:
        objects_downloaded += 1
        print(f"  ✓ {obj['family']} → {filename} ({result} bytes)")
    else:
        objects_failed += 1
        print(f"  ✗ {obj['family']} FAILED: {result}")

print(f"\nMap Objects: {objects_downloaded} downloaded, {objects_failed} failed")

# ---- SUMMARY ----
print("\n" + "=" * 60)
print("FINAL INVENTORY")
print("=" * 60)

total = 0
for layer in ["base", "surface_overlays", "micro", "medium", "objects", "transitions"]:
    layer_dir = os.path.join(BASE, layer)
    if not os.path.exists(layer_dir):
        continue
    count = 0
    for root, dirs, files in os.walk(layer_dir):
        count += len([f for f in files if f.endswith('.png')])
    print(f"  {layer}: {count} PNGs")
    total += count

print(f"\n  TOTAL: {total} PNGs on disk")
print(f"  New this run: {tiles_downloaded + objects_downloaded} files")
