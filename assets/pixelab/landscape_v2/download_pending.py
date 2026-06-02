"""
Sweep-download all pending PixelLab jobs.
Run this to check status and download anything that completed.
Usage: python3 assets/pixelab/landscape_v2/download_pending.py
"""
import json, os, urllib.request, sys

ROOT = "assets/pixelab/landscape_v2"
JOBS_FILE = f"{ROOT}/prompts/pending_jobs.json"

def load_jobs():
    with open(JOBS_FILE) as f:
        return json.load(f)

def save_jobs(data):
    with open(JOBS_FILE, 'w') as f:
        json.dump(data, f, indent=2)

def download(url, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    urllib.request.urlretrieve(url, path)
    size = os.path.getsize(path)
    print(f"  OK {path} ({size} bytes)")
    return True

def main():
    data = load_jobs()
    downloaded_count = 0
    still_pending = 0

    # tiles_pro jobs
    mapping = data["download_mapping"]["tiles_pro_tile_index_to_family"]
    for job in data["tiles_pro_jobs"]:
        if job["downloaded"]:
            continue
        job_id = job["id"]
        # Try to download the tile sheet
        base_url = f"https://backblaze.pixellab.ai/file/pixellab-tiles"
        # We need the account ID - try the download endpoint first
        try:
            # Check via API
            check_url = f"https://api.pixellab.ai/mcp/tiles-pro/{job_id}/download"
            resp = urllib.request.urlopen(check_url)
            # If we get here, it's ready - download individual tiles
            for i in range(job["tiles"]):
                tile_key = f"tile_{i}"
                if tile_key not in mapping:
                    continue
                m = mapping[tile_key]
                family = m["family"]
                layer = m["layer"]
                subdir = m["subdir"]
                # Count existing variants to get next variant number
                dest_dir = f"{ROOT}/{layer}/{family}/{subdir}"
                existing = len([f for f in os.listdir(dest_dir) if f.endswith('.png')]) if os.path.exists(dest_dir) else 0
                dest = f"{dest_dir}/{family}__overlay__v{existing:03d}.png"
                # Download from storage URL pattern
                # Note: we need the actual storage URLs from the API response
                print(f"  tiles_pro {job_id} tile_{i} -> needs API fetch for URL")
            print(f"  tiles_pro {job_id}: READY but needs MCP API to get storage URLs")
            still_pending += 1
        except Exception as e:
            print(f"  tiles_pro {job_id}: not ready yet ({e})")
            still_pending += 1

    # map_object jobs
    obj_lookup = data["download_mapping"]["map_object_layer_lookup"]
    for job in data["map_object_jobs"]:
        if job["downloaded"]:
            continue
        job_id = job["id"]
        family = job["family"]
        variant = job["variant"]
        info = obj_lookup[family]
        dest = f"{ROOT}/{info['layer']}/{family}/{info['subdir']}/{family}__{info['type']}__v{variant:03d}.png"
        url = f"https://api.pixellab.ai/mcp/map-objects/{job_id}/download"
        try:
            download(url, dest)
            job["downloaded"] = True
            downloaded_count += 1
        except Exception as e:
            print(f"  map_object {job_id} ({family}): not ready ({e})")
            still_pending += 1

    save_jobs(data)
    print(f"\nDownloaded: {downloaded_count}, Still pending: {still_pending}")

if __name__ == "__main__":
    main()
