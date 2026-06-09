#!/usr/bin/env python3
"""Download same-biome elevation tilesets from PixelLab API."""
import requests, base64, os, sys, time

API = "https://api.pixellab.ai/v2"
KEY = "de8bc1ce-8264-4c56-aa9f-03c9097ee45e"
HDR = {"Authorization": f"Bearer {KEY}"}
BASE = "assets/pixelab/landscape_v2/transitions"

# Map of tileset_id -> (biome, variant_dir)
TILESETS = {
    # grassland
    "c3f8dc22-5b56-4dcc-968d-eed7f8fe2eea": ("grassland_to_grassland", "wang_25"),
    "4674a6a6-64ab-4116-9439-ec2d5cabb20a": ("grassland_to_grassland", "wang_50"),
    "ceef9efd-63b7-42d0-99ce-7b0dec72d99b": ("grassland_to_grassland", "wang_100"),
    # forest
    "abe253a6-e004-4883-a654-9e44ed91a047": ("forest_to_forest", "wang_25"),
    "61d0be86-7261-4649-b21d-7422dc9b013b": ("forest_to_forest", "wang_50"),
    "b1165e99-e403-426f-95ce-8e6029e9b354": ("forest_to_forest", "wang_100"),
    # beach
    "8d116a69-994b-471d-ade0-b1374b8ac942": ("beach_to_beach", "wang_25"),
    "c1a0773b-9168-4297-a30d-c2dfdc927721": ("beach_to_beach", "wang_50"),
    "3f5c3ac6-9878-498a-b07c-4daa42cf83de": ("beach_to_beach", "wang_100"),
    # arctic
    "c122b06f-4f95-4b79-960f-a3b61155ad5f": ("arctic_to_arctic", "wang_25"),
    "43ce2733-92a8-43d9-80ff-0bd1f9ce80db": ("arctic_to_arctic", "wang_50"),
    "a72351ef-b6d1-463f-8a6e-c63aaf849160": ("arctic_to_arctic", "wang_100"),
    # ocean
    "427ca8be-0e50-4719-9f4c-f21862c1af22": ("ocean_to_ocean", "wang_25"),
    "19851f85-e2b1-47ee-b586-5bb028d90b85": ("ocean_to_ocean", "wang_50"),
    "658f5750-7ab3-4e1e-bf09-9b87360cc07d": ("ocean_to_ocean", "wang_100"),
    # desert
    "573855da-6257-4f9b-99fc-333b4ca37acf": ("desert_to_desert", "wang_25"),
    "7b30dfa0-64d3-4631-a4c5-e3a18caea1cf": ("desert_to_desert", "wang_50"),
    "6ef39bfd-b3dd-4973-bbea-c30f1adf33a3": ("desert_to_desert", "wang_100"),
    # hills (only 0.25 so far)
    "55e51c9a-d12f-4c2d-97b2-6f2e4e96c11f": ("hills_to_hills", "wang_25"),
}

pending = dict(TILESETS)
completed = 0

while pending:
    done = []
    for tid, (biome_dir, variant) in list(pending.items()):
        try:
            r = requests.get(f"{API}/tilesets/{tid}", headers=HDR, timeout=30)
            if r.status_code != 200:
                continue
            data = r.json()
            if "tileset" not in data or "tiles" not in data.get("tileset", {}):
                continue
            tiles = data["tileset"]["tiles"]
            d = os.path.join(BASE, biome_dir, variant)
            os.makedirs(d, exist_ok=True)
            for t in tiles:
                idx = t["name"].replace("wang_", "")
                img = base64.b64decode(t["image"]["base64"])
                with open(os.path.join(d, f"{biome_dir}__wang_{idx}__v000.png"), "wb") as f:
                    f.write(img)
            done.append(tid)
            completed += 1
            print(f"[{completed}/{len(TILESETS)}] {biome_dir}/{variant}: {len(tiles)} tiles", flush=True)
        except Exception as e:
            print(f"  ERROR {biome_dir}/{variant}: {e}", flush=True)
    for tid in done:
        del pending[tid]
    if pending:
        print(f"  {len(pending)} remaining, polling in 15s...", flush=True)
        time.sleep(15)

print(f"=== DONE: {completed}/{len(TILESETS)} ===", flush=True)
