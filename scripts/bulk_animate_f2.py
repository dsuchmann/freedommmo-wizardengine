#!/usr/bin/env python3
"""
bulk_animate_f2.py — Bulk-generate per-variant wind_sway animations for Field 2 objects.

Reads each variant's base sprite from disk, uploads it as custom_start_frame to PixelLab,
polls for completion, downloads animation frames.

Usage:
  python scripts/bulk_animate_f2.py                  # Run full pipeline
  python scripts/bulk_animate_f2.py --type tall_grass_blade  # Single type only
  python scripts/bulk_animate_f2.py --status         # Show progress

Environment:
  PIXELLAB_API_KEY    Override API key (default: from .mcp.json)
"""

import argparse
import base64
import json
import logging
import os
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[1]
FLORA_DIR = REPO_ROOT / "assets" / "pixelab" / "landscape_v2" / "micro" / "small_flora"
MCP_JSON = REPO_ROOT / ".mcp.json"
STATE_FILE = FLORA_DIR / "_bulk_animate_state.json"

API_BASE = "https://api.pixellab.ai"
ACCOUNT_ID = "0f1031f5-9eee-4df4-996f-0a4114148eba"
BATCH_SIZE = 4          # concurrent jobs — conservative to share with other agents
POLL_INTERVAL = 30      # seconds between polls
FRAME_COUNT = 9         # frames per animation (v3 mode: 8 + 1 reference = 9)
MAX_RETRIES = 5
JOB_TIMEOUT = 1800      # 30 min before marking stuck

# Object IDs — one per type, used as the "host" object for all variant animations
OBJECT_IDS = {
    "frost_flower":       "eed9957b-7795-4a4e-ac45-b1bfe14fdc24",
    "beach_weed":         "f50bfaa6-6eb5-4c6a-ae9c-84eeb0f1a80b",
    "dune_grass":         "88dd85b4-0ebb-4c8a-be9f-99c8482f1442",
    "sea_oat":            "670b546d-1af1-4790-a5c2-a30fa4d8002f",
    "bracket_fungus":     "36ec732d-2ed1-4285-b9ff-76c9ec9a5608",
    "dark_herb":          "3d354d0c-797c-4b3c-b875-5cf15f1420d1",
    "desert_thorn":       "78d4c2ab-0a09-4792-b44b-e37e9bac1b03",
    "grass_blade_cluster":"909809bb-c073-4e46-9f7e-6f50553c5b2a",
    "small_fern":         "5837fd5f-8f7d-47be-84a1-33ba8a7bfa67",
    "clover_bloom":       "fbb450bd-8cb7-4a0a-9801-592fd5c3de30",
    "tall_grass_blade":   "aac1de35-2e56-40d3-8e79-c4c3a115e284",
    "dandelion_stem":     "bcfc1d87-f98d-45a5-800a-d8c5606d1d2a",
    "wild_herb":          "bc524bbc-fe0a-400a-9b3c-d49c040b9dc0",
    "hillside_grass":     "354a0fe3-aa36-4ee1-939a-6e0d64ece577",
    "rock_flower_bud":    "0c637cb4-4c04-4aad-8a80-b66e2edd941c",
    "heather_sprig":      "0dbe8327-8e1c-460c-b9ea-0d1727c20fee",
    "alpine_tuft":        "52b98d54-9463-4061-820c-e597a65fe0bc",
    "hardy_lichen":       "08a8652f-6516-4d15-b95f-784358109e3f",
    "rock_cress":         "2239ff9c-cb66-49ad-b633-b5c46144685a",
    "aether_fern":        "3006778d-edbd-4229-88f9-fad31e06ad94",
    "dry_grass_spike":    "50347cba-5514-4f85-b204-79a00fcafbcc",
    "thorn_sprout":       "130c6bf5-bdef-4b1d-8b1c-dc5d3ca95987",
    "acacia_seedling":    "26d00838-f262-4fb8-b75b-3dd7890e1b75",
    "sparse_weed":        "c77da00f-5ec3-46be-8b33-dc8a0fd9d979",
    "cattail_base":       "c9530dca-1d2c-48d5-a257-ff17754cbbe7",
    "swamp_herb":         "0748aa90-d38a-4bd4-8e66-9761dbbf83e1",
    "cold_moss_tuft":     "258be4b5-efae-4905-a454-e95dbb83aefa",
    "frost_grass":        "415ceffe-9d9f-411e-a4f5-07bc96442942",
    "low_juniper":        "63938c6f-96da-4dde-b622-55c595b3c60d",
    "broad_fern":         "4bb23513-dec5-44bf-9004-149094645fa9",
    "orchid_sprout":      "ffb85ef3-7699-4154-a480-8f6455962ee0",
    "vine_tendril":       "70fe416f-7b29-4ef7-a1e2-77713fe7af39",
    "tundra_grass":       "6585bcdb-a06e-4d88-806b-c05124751a86",
    "ice_moss":           "722b697c-ca52-4319-8cad-1e75d9c77d11",
    "ash_grass":          "0e826c20-991d-4158-b25d-7846a2c04d1c",
    "heat_sprout":        "a9f02ac9-4597-42c9-bb41-3af743c26794",
}

# Biome for each object type
BIOME_MAP = {
    "frost_flower": "arctic", "frozen_grass": "arctic", "ice_needle": "arctic",
    "beach_weed": "beach", "dune_grass": "beach", "sea_oat": "beach",
    "shade_fern": "dense_forest", "dark_herb": "dense_forest", "bracket_fungus": "dense_forest",
    "sand_grass": "desert", "desert_thorn": "desert",
    "grass_blade_cluster": "forest", "small_fern": "forest", "clover_bloom": "forest",
    "tall_grass_blade": "grassland", "dandelion_stem": "grassland", "wild_herb": "grassland",
    "hillside_grass": "hills", "rock_flower_bud": "hills", "heather_sprig": "hills",
    "alpine_tuft": "mountains", "rock_cress": "mountains", "hardy_lichen": "mountains",
    "glow_grass_blade": "mystic", "aether_fern": "mystic", "crystal_sprout": "mystic",
    "dry_grass_spike": "savanna", "thorn_sprout": "savanna", "acacia_seedling": "savanna",
    "wind_grass": "steppe", "sparse_weed": "steppe", "dry_tuft": "steppe",
    "bog_grass": "swamp", "cattail_base": "swamp", "swamp_herb": "swamp",
    "frost_grass": "taiga", "low_juniper": "taiga", "cold_moss_tuft": "taiga",
    "broad_fern": "tropical_forest", "orchid_sprout": "tropical_forest", "vine_tendril": "tropical_forest",
    "tundra_grass": "tundra", "low_berry_bush": "tundra", "ice_moss": "tundra",
    "ash_grass": "volcanic", "heat_sprout": "volcanic", "lava_fern": "volcanic",
}

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()]
)
log = logging.getLogger("bulk_animate")

# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def get_api_key() -> str:
    key = os.environ.get("PIXELLAB_API_KEY")
    if key:
        return key
    if MCP_JSON.exists():
        with open(MCP_JSON) as f:
            cfg = json.load(f)
        auth = cfg.get("mcpServers", {}).get("pixellab", {}).get("headers", {}).get("Authorization", "")
        if auth.startswith("Bearer "):
            return auth[7:]
    log.error("No API key found. Set PIXELLAB_API_KEY or check .mcp.json")
    sys.exit(1)


def api_post(path: str, api_key: str, body: dict) -> dict | None:
    url = f"{API_BASE}/v2/{path.lstrip('/')}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    data = json.dumps(body).encode("utf-8")
    for attempt in range(MAX_RETRIES):
        try:
            req = Request(url, data=data, headers=headers, method="POST")
            with urlopen(req, timeout=120) as resp:
                return json.loads(resp.read())
        except HTTPError as e:
            if e.code in (429, 529):
                wait = 30 * (2 ** attempt)
                log.warning(f"Rate limited ({e.code}). Waiting {wait}s...")
                time.sleep(wait)
                continue
            body_text = ""
            try:
                body_text = e.read().decode("utf-8", errors="replace")[:300]
            except Exception:
                pass
            log.error(f"HTTP {e.code}: {body_text}")
            if attempt < MAX_RETRIES - 1:
                time.sleep(5)
                continue
            return None
        except (URLError, TimeoutError) as e:
            log.warning(f"Connection error: {e}. Retry {attempt+1}/{MAX_RETRIES}")
            time.sleep(10)
    return None


def api_get(path: str, api_key: str, base: str = None) -> dict | None:
    if base is None:
        base = f"{API_BASE}/v2"
    url = f"{base}/{path.lstrip('/')}"
    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        req = Request(url, headers=headers)
        with urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except Exception as e:
        log.error(f"GET error for {url}: {e}")
        return None


def download_frame(url: str, dest: Path) -> bool:
    try:
        req = Request(url)
        with urlopen(req, timeout=30) as resp:
            data = resp.read()
        if len(data) < 50:
            return False
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "wb") as f:
            f.write(data)
        return True
    except Exception as e:
        log.warning(f"Download failed: {e}")
        return False

# ---------------------------------------------------------------------------
# State management
# ---------------------------------------------------------------------------

def load_state() -> dict:
    if STATE_FILE.exists():
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"completed": {}, "pending": {}, "failed": []}


def save_state(state: dict):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

# ---------------------------------------------------------------------------
# Core pipeline
# ---------------------------------------------------------------------------

def find_variants(obj_name: str) -> list[tuple[int, Path]]:
    """Find all variant PNGs for an object type."""
    biome = BIOME_MAP.get(obj_name)
    if not biome:
        return []
    obj_dir = FLORA_DIR / biome / obj_name
    variants = []
    for v in range(64):
        vstr = f"{v:03d}"
        png = obj_dir / f"sf__{biome}__{obj_name}__v{vstr}.png"
        if png.exists() and png.stat().st_size > 50:
            variants.append((v, png))
    return variants


def is_variant_done(obj_name: str, variant: int) -> bool:
    """Check if animation frames already exist on disk."""
    biome = BIOME_MAP.get(obj_name)
    if not biome:
        return False
    anim_dir = FLORA_DIR / biome / obj_name / "anim" / "wind_sway" / f"v{variant:03d}"
    if not anim_dir.exists():
        return False
    frames = list(anim_dir.glob("frame_*.png"))
    return len(frames) >= FRAME_COUNT and all(f.stat().st_size > 50 for f in frames)


def submit_animation(obj_name: str, variant: int, png_path: Path, api_key: str) -> str | None:
    """Submit a wind_sway animation job via /animate-with-text-v3."""
    with open(png_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")

    body = {
        "first_frame": {
            "base64": b64,
            "format": "png",
        },
        "action": "swaying gently in wind, natural plant movement",
        "frame_count": 8,
        "no_background": True,
    }

    result = api_post("animate-with-text-v3", api_key, body)
    if result:
        job_id = result.get("background_job_id") or result.get("id") or result.get("job_id")
        if job_id:
            log.info(f"  -> job {job_id}")
            return job_id
        log.info(f"Response for {obj_name} v{variant:03d}: {json.dumps(result)[:300]}")
    return None


def poll_job(job_id: str, api_key: str) -> dict | None:
    """Poll a background job for status."""
    return api_get(f"background-jobs/{job_id}", api_key)


def download_job_frames(job_result: dict, obj_name: str, variant: int) -> bool:
    """Download animation frames from a completed job's last_response."""
    biome = BIOME_MAP[obj_name]
    dest_dir = FLORA_DIR / biome / obj_name / "anim" / "wind_sway" / f"v{variant:03d}"
    dest_dir.mkdir(parents=True, exist_ok=True)

    last_resp = job_result.get("last_response", {})

    # The response may contain frame URLs in various formats
    # Try common patterns
    frames = last_resp.get("frames", [])
    if not frames:
        frames = last_resp.get("images", [])
    if not frames:
        # Try to find URLs in the response
        for key, val in last_resp.items():
            if isinstance(val, list) and len(val) >= 4:
                frames = val
                break

    if frames:
        for i, frame in enumerate(frames):
            if isinstance(frame, str):
                # URL string
                if frame.startswith("http"):
                    download_frame(frame, dest_dir / f"frame_{i:03d}.png")
                else:
                    # Base64 data
                    raw = frame
                    if "base64," in raw:
                        raw = raw.split("base64,")[1]
                    try:
                        img_data = base64.b64decode(raw)
                        with open(dest_dir / f"frame_{i:03d}.png", "wb") as f:
                            f.write(img_data)
                    except Exception as e:
                        log.warning(f"Failed to decode frame {i}: {e}")
            elif isinstance(frame, dict):
                # Object with base64 or url
                url = frame.get("url") or frame.get("src")
                b64 = frame.get("base64")
                if url:
                    download_frame(url, dest_dir / f"frame_{i:03d}.png")
                elif b64:
                    if "base64," in b64:
                        b64 = b64.split("base64,")[1]
                    try:
                        img_data = base64.b64decode(b64)
                        with open(dest_dir / f"frame_{i:03d}.png", "wb") as f:
                            f.write(img_data)
                    except Exception as e:
                        log.warning(f"Failed to decode frame {i}: {e}")
        # Verify
        saved = list(dest_dir.glob("frame_*.png"))
        if len(saved) >= 4 and all(f.stat().st_size > 50 for f in saved):
            log.info(f"  Downloaded {len(saved)} frames to {dest_dir}")
            return True

    log.warning(f"Could not extract frames from job response: {json.dumps(last_resp)[:300]}")
    return False


def run_pipeline(obj_names: list[str]):
    """Main pipeline: queue, poll, download for all variants of given types."""
    api_key = get_api_key()
    state = load_state()

    # Build work queue
    work = []
    for obj_name in obj_names:
        if obj_name not in OBJECT_IDS:
            log.warning(f"No object ID for {obj_name}, skipping")
            continue
        variants = find_variants(obj_name)
        for v, png in variants:
            key = f"{obj_name}/v{v:03d}"
            if is_variant_done(obj_name, v):
                state["completed"][key] = True
                continue
            if key not in state.get("pending", {}):
                work.append((obj_name, v, png))

    log.info(f"Total work: {len(work)} variants to animate")
    log.info(f"Already done: {len(state.get('completed', {}))} variants")
    save_state(state)

    # Process in batches
    pending = {}  # key -> {obj_name, variant, submitted_at}
    work_idx = 0

    while work_idx < len(work) or pending:
        # Submit new jobs up to batch size
        while len(pending) < BATCH_SIZE and work_idx < len(work):
            obj_name, variant, png = work[work_idx]
            key = f"{obj_name}/v{variant:03d}"
            work_idx += 1

            log.info(f"Submitting {key}...")
            job_id = submit_animation(obj_name, variant, png, api_key)
            if job_id:
                pending[key] = {
                    "obj_name": obj_name,
                    "variant": variant,
                    "job_id": job_id,
                    "submitted_at": time.time(),
                }
                state["pending"][key] = job_id
                save_state(state)
            else:
                log.warning(f"Failed to submit {key}, will retry later")
                work.append((obj_name, variant, png))  # re-add to end of queue
            time.sleep(3)  # Delay between submissions to avoid rate limits

        if not pending:
            break

        # Poll pending jobs
        log.info(f"Polling {len(pending)} pending jobs... ({len(work) - work_idx} remaining in queue)")
        time.sleep(POLL_INTERVAL)

        completed_keys = []
        for key, info in pending.items():
            if is_variant_done(info["obj_name"], info["variant"]):
                completed_keys.append(key)
                continue

            # Poll job status
            job_id = info.get("job_id")
            if not job_id:
                completed_keys.append(key)
                continue

            result = poll_job(job_id, api_key)
            if not result:
                continue

            status = result.get("status", "")
            if status == "completed":
                ok = download_job_frames(result, info["obj_name"], info["variant"])
                if ok:
                    completed_keys.append(key)
                else:
                    log.warning(f"{key} completed but download failed")
                    completed_keys.append(key)
                    state.setdefault("failed", []).append(key)
            elif status == "failed":
                log.error(f"{key} failed: {result.get('last_response', {})}")
                completed_keys.append(key)
                state.setdefault("failed", []).append(key)
            elif time.time() - info["submitted_at"] > JOB_TIMEOUT:
                log.warning(f"{key} stuck for {JOB_TIMEOUT//60}+ min ({status}), marking failed")
                completed_keys.append(key)
                state.setdefault("failed", []).append(key)

        for key in completed_keys:
            info = pending.pop(key)
            if key not in state.get("failed", []):
                state["completed"][key] = True
                log.info(f"Completed: {key}")
            state["pending"].pop(key, None)
            save_state(state)

    log.info(f"Done! Completed: {len(state.get('completed', {}))}, Failed: {len(state.get('failed', []))}")


def show_status():
    """Show current progress."""
    state = load_state()
    completed = len(state.get("completed", {}))
    pending = len(state.get("pending", {}))
    failed = len(state.get("failed", []))

    total_possible = 0
    for obj_name in OBJECT_IDS:
        variants = find_variants(obj_name)
        total_possible += len(variants)
        done = sum(1 for v, _ in variants if is_variant_done(obj_name, v))
        if done > 0 or obj_name in ["tall_grass_blade", "dandelion_stem", "wild_herb"]:
            print(f"  {obj_name}: {done}/{len(variants)} on disk")

    print(f"\nTotal: {completed} completed, {pending} pending, {failed} failed")
    print(f"Disk check: variants with animations on disk across all types")
    total_on_disk = 0
    for obj_name in OBJECT_IDS:
        variants = find_variants(obj_name)
        for v, _ in variants:
            if is_variant_done(obj_name, v):
                total_on_disk += 1
    print(f"  {total_on_disk}/{total_possible} variant animations on disk")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Bulk animate F2 variants")
    parser.add_argument("--type", help="Single object type to process")
    parser.add_argument("--status", action="store_true", help="Show progress")
    args = parser.parse_args()

    if args.status:
        show_status()
    elif args.type:
        run_pipeline([args.type])
    else:
        # All types, priority order: grassland first, then forest, then rest
        priority = [
            "tall_grass_blade", "dandelion_stem", "wild_herb",
            "grass_blade_cluster", "small_fern", "clover_bloom",
            "hillside_grass", "heather_sprig", "rock_flower_bud",
            "frost_flower", "dune_grass", "sea_oat", "beach_weed",
            "dark_herb", "bracket_fungus", "desert_thorn",
            "alpine_tuft", "aether_fern",
            "dry_grass_spike", "thorn_sprout", "acacia_seedling",
            "sparse_weed", "cattail_base", "swamp_herb",
            "frost_grass", "low_juniper", "cold_moss_tuft",
            "broad_fern", "orchid_sprout", "vine_tendril",
            "tundra_grass", "ice_moss",
            "ash_grass", "heat_sprout",
            "hardy_lichen", "rock_cress",
        ]
        run_pipeline(priority)
