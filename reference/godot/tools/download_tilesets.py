"""Download 15 PixelLab tilesets and extract Wang tiles."""
from PIL import Image
import json, os, subprocess

REPO_ROOT = r"C:\Users\daves\OneDrive\Documents\freedommmo"
TERRAIN_DIR = os.path.join(REPO_ROOT, "assets", "catalog", "terrain")

TILESETS = [
    ("c66c5821-5f0f-4c46-b0ca-b9ad2aeb9233", "swamp", "swamp"),
    ("7ad82261-825c-4be1-8f4d-f2d0cfa41096", "tundra", "tundra"),
    ("e9dee808-0078-45a3-b91b-a4c9fc9091ee", "mountains", "mountains"),
    ("9501a5de-7d36-4788-860d-2edd0320083a", "ocean", "ocean"),
    ("ad90a767-17b1-42d3-96ac-add8867b3ab5", "desert", "desert"),
    ("70815aff-9183-4142-bf65-b71b9f958288", "forest", "forest"),
    ("ac280f19-cbc8-487c-9557-dbf840207134", "grassland", "grassland"),
    ("ffd17ea6-9cca-424f-b5d4-7629194108af", "wooden_floor", "interior"),
    ("6e5e4466-f8b4-41ed-9b91-6dc0238767eb", "dungeon_stone", "dungeon"),
    ("54dc133e-6c8d-491b-a543-60853b5f353c", "crystal_cave", "mystic"),
    ("81944792-c6db-4ba9-a526-ceb901463c59", "volcanic", "volcanic"),
    ("aad34ffe-5303-4d24-8fa3-05411d05767c", "cobblestone_road", "road"),
    ("8799930c-68aa-41c4-985f-633061003ee3", "fertile_soil", "farmland"),
    ("3334b072-4667-44c1-a455-98174265c72e", "wheat_field", "farm"),
    ("bef87c74-f767-40f3-b00f-bf7067d48712", "grassland_clovers", "grassland_variant"),
]

corner_map = {'upper': 1, 'lower': 0}

for tileset_id, dir_name, biome_label in TILESETS:
    out_dir = os.path.join(TERRAIN_DIR, dir_name)
    os.makedirs(out_dir, exist_ok=True)

    meta_path = os.path.join(out_dir, "metadata.json")
    image_path = os.path.join(out_dir, "tileset.png")

    print(f"Downloading {dir_name} ({tileset_id})...")

    subprocess.run([
        "curl", "-sL",
        f"https://api.pixellab.ai/mcp/tilesets/{tileset_id}/metadata",
        "-o", meta_path
    ], check=True)

    subprocess.run([
        "curl", "-sL",
        f"https://api.pixellab.ai/mcp/tilesets/{tileset_id}/image",
        "-o", image_path
    ], check=True)

    # Verify downloads
    if not os.path.exists(meta_path) or os.path.getsize(meta_path) < 10:
        print(f"  WARNING: metadata download failed for {dir_name}")
        continue
    if not os.path.exists(image_path) or os.path.getsize(image_path) < 100:
        print(f"  WARNING: image download failed for {dir_name}")
        continue

    try:
        with open(meta_path) as f:
            meta = json.load(f)
    except json.JSONDecodeError:
        print(f"  WARNING: metadata JSON invalid for {dir_name}")
        # Read and print first 200 chars to debug
        with open(meta_path) as f:
            print(f"  Content: {f.read(200)}")
        continue

    sheet = Image.open(image_path)

    manifest = {
        'biome': biome_label,
        'lower_biome': meta.get('lower_description', dir_name),
        'upper_biome': meta.get('upper_description', dir_name),
        'tile_size': 32,
        'tileset_id': tileset_id,
        'tiles': {}
    }

    tile_data = meta.get('tileset_data', {}).get('tiles', [])
    if not tile_data:
        print(f"  WARNING: no tile data in metadata for {dir_name}")
        # Still save manifest with what we have
        with open(os.path.join(out_dir, "manifest.json"), 'w') as f:
            json.dump(manifest, f, indent=2)
        continue

    for tile in tile_data:
        bb = tile['bounding_box']
        corners = tile['corners']
        tl = corner_map[corners['NW']]
        tr = corner_map[corners['NE']]
        bl = corner_map[corners['SW']]
        br = corner_map[corners['SE']]
        idx = tl * 8 + tr * 4 + bl * 2 + br
        fname = f'wang_{idx}.png'
        box = (bb['x'], bb['y'], bb['x'] + bb['width'], bb['y'] + bb['height'])
        sheet.crop(box).save(os.path.join(out_dir, fname))
        manifest['tiles'][str(idx)] = fname

    with open(os.path.join(out_dir, "manifest.json"), 'w') as f:
        json.dump(manifest, f, indent=2)

    print(f"  Extracted {len(manifest['tiles'])} Wang tiles to {dir_name}/")

print("\nDone! All tilesets processed.")
