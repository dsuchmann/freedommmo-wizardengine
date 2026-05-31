#!/usr/bin/env python3
"""Download all tagged terrain objects from PixelLab and organize into asset catalog."""

import json
import os
import subprocess
import sys

# Base path for assets
ASSETS_BASE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "catalog", "terrain_objects")

# Tag -> (category_path, object_id) mapping
TAGGED_OBJECTS = {
    "terrain_boulder": {
        "category_path": "mineral/rock/boulder/mossy_boulder_batch",
        "object_ids": [
            "27f2f3ce-66ae-48f6-aefe-2b59a9b8d649",
            "4165db7b-7754-4cad-8972-ec08bb93c7f0",
            "699ce5b5-8c82-4396-917e-693ea009ed5f",
            "1c3e8668-9c9b-4b68-8fc9-11655a478f2c",
        ],
        "size": "64x64",
    },
    "terrain_oak": {
        "category_path": "vegetation/tree/deciduous/oak_tree_batch",
        "object_ids": [
            "9efb85a5-5518-4864-bf0c-82cdd33cc8c6",
            "cc506505-f77e-4e60-962b-d63f567a90ce",
            "e84435fa-3501-4c89-b27e-27d9a27f3374",
            "e50a2387-18f5-44af-bc89-11fc461b5c2e",
        ],
        "size": "64x64",
    },
    "terrain_pine": {
        "category_path": "vegetation/tree/conifer/pine_tree_batch",
        "object_ids": [
            "3db4b74e-2665-4a38-90b0-2add77007c42",
            "e7e3b842-67ce-41fc-bf15-57a9d10dcb60",
            "acd3b30c-9e47-4c4d-a8d9-052c069d08ec",
            "b94a257c-4ec9-437f-8b36-6faa950ea0fd",
        ],
        "size": "64x64",
    },
    "terrain_mushroom": {
        "category_path": "vegetation/flower/mushroom/toadstool_batch",
        "object_ids": [
            "edb2fb06-b7ef-4867-ab2f-97ddc012454f",
            "d0ba4a03-88fe-4af2-b1e6-6dd789439cae",
            "36f5ca6c-ae2e-4a59-97c6-b5307e448064",
            "0783a98c-4600-4be9-a697-d2a7b4443589",
            "c23380e4-2efc-4513-9fb5-356f925eed8a",
            "abdcf213-5658-4613-bce4-180e7623ba37",
            "6c4dc36f-e3a4-418e-93db-6fc46a9b1383",
            "ecbb4b28-0a4e-45b0-9cec-32ed8d6ab85d",
        ],
        "size": "32x32",
    },
    "terrain_snow": {
        "category_path": "ground_cover/snow_drift/fresh_snow_batch",
        "object_ids": [
            "d539b5bc-bec4-48a7-a997-63242dd43bae",
            "5ac0635a-0898-4f39-ab5e-1c3e09b07792",
            "b0953dad-b89f-4619-82a6-782d9e673fed",
            "ed65770f-7784-451d-8fc2-3e7f4506b938",
        ],
        "size": "32x32",
    },
    "terrain_bush": {
        "category_path": "vegetation/bush/green_bush_batch",
        "object_ids": [
            "b4805c27-980f-4203-a3c3-f17dea15eb31",
            "f150c401-cfb6-4b93-8a1e-0b1e007cc05e",
            "b9754735-f761-4e75-917d-7973d2a8b493",
            "b0108fdf-12ba-4519-8782-3d657ebd9019",
            "854610bf-f9ee-4929-8ae3-ac7346318716",
            "1b67ec54-2c03-42b8-bc99-8fca6476ad5c",
            "569a8fb8-908c-4ebe-9753-e5d7343047f1",
            "4f806c52-7220-4c14-b1eb-64afe93f5fc6",
        ],
        "size": "32x32",
    },
    "terrain_fern": {
        "category_path": "vegetation/fern/forest_fern_batch",
        "object_ids": [
            "673f0c84-9a58-46f3-841b-2189145da573",
            "b49e4676-4926-4faa-8402-fec46fee7f72",
            "b2de07c2-619b-498d-af12-c6f089382baf",
            "fa0f2779-402b-4c4e-9895-aa9ed0a8765d",
            "36eb617e-8428-4b6c-9b4a-829da630252f",
            "02fe510d-c494-4255-b71f-392f723b64b6",
            "a882b40a-6ec1-449b-966f-942854d7f5e2",
            "f9d3032b-fe7d-4595-a2a7-62438b08c750",
        ],
        "size": "32x32",
    },
    "terrain_pebble": {
        "category_path": "mineral/rock/pebble/pebble_batch",
        "object_ids": [
            "e5091e8e-68a4-41a0-ae4c-c221cd2e31e8",
            "5ee02fb0-4b7a-4b61-a9ad-685042a1f035",
            "4cbadc77-655e-45fa-83a8-831690145a06",
            "5a5279bf-ce41-42a0-bb97-a00b816c3f02",
            "dcfa6d73-1616-438c-9b44-7a3aec4559bb",
            "a945fc78-13da-4adb-a60a-475e4d2893ae",
            "a33fe699-685a-4f09-a400-30d6156a85e4",
            "473b0c32-df66-4f77-bf9b-81e465387a76",
        ],
        "size": "32x32",
    },
    "terrain_grass": {
        "category_path": "vegetation/grass/tall/grass_tuft_batch",
        "object_ids": [
            "bb1cd8cf-0b89-4da5-b181-afb2c7c358fc",
            "5160579e-4967-41cd-99c3-e6cbcdca2abf",
            "0c9e124f-36bd-4ad6-b796-1266b2f71d6e",
            "630816ea-4ea1-4f21-a157-6e931316d48d",
            "b8972b3b-0888-46f8-909b-36f20ed283e1",
            "7c893b0b-4ba9-4139-88ca-6089f15dc068",
            "4ecda8d9-0c93-4566-851b-5e230e22c7bd",
            "7d076d57-c5dd-4c72-8f25-633465a7531e",
        ],
        "size": "32x32",
    },
    "terrain_wildflower": {
        "category_path": "vegetation/flower/wildflower/wildflower_batch",
        "object_ids": [
            "1db99a42-1855-4b41-8e6f-979948fc6c81",
            "fff92abe-567b-4975-b634-c8546e63631b",
            "0b3eebfa-66a5-4f51-8bf7-a044ceb5be2f",
            "b6fbd171-1ea6-4331-936f-c7c3c9795a00",
            "4e54c5a2-cf31-47bf-9d71-a9e200b4f299",
            "6c0014b6-ded0-4cde-a047-d7b7102a1ae6",
            "0169da98-ad5d-467e-80b0-b31c132559b9",
            "82c7833a-4889-45e5-8df4-659665dbf89d",
            "dde05780-6f15-444c-9b41-38f4cda2e0e7",
            "771c2163-d747-4328-9f3e-af508daf5f30",
            "79d9a27e-e583-40ef-828b-2e663f6145d0",
        ],
        "size": "32x32",
    },
}

BACKBLAZE_BASE = "https://backblaze.pixellab.ai/file/pixellab-characters/objects"
ACCOUNT_ID = "0f1031f5-9eee-4df4-996f-0a4114148eba"
API_DOWNLOAD = "https://api.pixellab.ai/mcp/objects"

def download_object(object_id, dest_path):
    """Download a single object sprite. Tries multiple URL patterns."""
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)

    if os.path.exists(dest_path) and os.path.getsize(dest_path) > 100:
        print(f"  SKIP (exists): {dest_path}")
        return True

    # URL patterns to try in order
    urls = [
        f"{BACKBLAZE_BASE}/{ACCOUNT_ID}/{object_id}/rotations/unknown.png",
        f"{BACKBLAZE_BASE}/{ACCOUNT_ID}/{object_id}/rotations/south.png",
        f"{BACKBLAZE_BASE}/{ACCOUNT_ID}/{object_id}/rotations/frame_0.png",
    ]

    for url in urls:
        try:
            result = subprocess.run(
                ["curl", "-sS", "-L", "-o", dest_path, "-w", "%{http_code}", url],
                capture_output=True, text=True, timeout=30
            )
            http_code = result.stdout.strip()
            if http_code == "200" and os.path.exists(dest_path) and os.path.getsize(dest_path) > 100:
                print(f"  OK: {os.path.basename(os.path.dirname(os.path.dirname(dest_path)))}/v{os.path.basename(os.path.dirname(dest_path))}")
                return True
        except Exception:
            pass

    # Clean up any partial downloads
    if os.path.exists(dest_path):
        os.remove(dest_path)
    print(f"  FAIL: {object_id}")
    return False


def write_manifest(category_path, tag, obj_ids, size):
    """Write a manifest.json for the batch."""
    manifest_dir = os.path.join(ASSETS_BASE, category_path)
    os.makedirs(manifest_dir, exist_ok=True)
    manifest_path = os.path.join(manifest_dir, "manifest.json")

    w, h = size.split("x")
    manifest = {
        "tag": tag,
        "source": "pixellab_batch_review",
        "pixel_size": [int(w), int(h)],
        "variant_count": len(obj_ids),
        "variants": [],
        "has_embedded_shadow": False,
        "perspective": "top-down",
        "art_style": "pixel_art_rpg",
    }

    for i, oid in enumerate(obj_ids):
        manifest["variants"].append({
            "variant_index": i + 1,
            "pixellab_object_id": oid,
            "file": f"variants/v{i+1}/base.png",
        })

    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"  Manifest: {manifest_path}")


def main():
    total = 0
    success = 0
    fail = 0

    for tag, info in TAGGED_OBJECTS.items():
        category_path = info["category_path"]
        obj_ids = info["object_ids"]
        size = info["size"]

        print(f"\n=== {tag} ({len(obj_ids)} objects) ===")

        for i, oid in enumerate(obj_ids):
            variant_num = i + 1
            dest = os.path.join(ASSETS_BASE, category_path, "variants", f"v{variant_num}", "base.png")
            total += 1
            if download_object(oid, dest):
                success += 1
            else:
                fail += 1

        write_manifest(category_path, tag, obj_ids, size)

    print(f"\n=== DONE: {success}/{total} downloaded, {fail} failed ===")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
