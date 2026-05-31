#!/usr/bin/env python3
"""
pixellab_runner.py — Autonomous PixelLab sprite generation pipeline.

Reads the generation queue, submits jobs to PixelLab REST API in batches,
polls for completion, downloads results, and updates queue state.
Survives restarts via queue.json checkpointing.

Usage:
  python pixellab_runner.py start          Run the generation pipeline
  python pixellab_runner.py status         Show queue statistics
  python pixellab_runner.py retry-failed   Reset failed items to pending
  python pixellab_runner.py scan           Scan disk and mark existing assets complete

Environment:
  PIXELLAB_API_KEY    Override API key (default: from .mcp.json)
  PIXELLAB_BATCH_SIZE Override concurrent jobs (default: 10)
  PIXELLAB_POLL_SEC   Override poll interval (default: 15)
"""

import argparse
import json
import logging
import os
import signal
import sys
import time
from collections import Counter
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]
QUEUE_PATH = REPO_ROOT / "data" / "terrain_objects" / "generation" / "queue.json"
LOG_PATH = REPO_ROOT / "data" / "terrain_objects" / "generation" / "log.txt"
MCP_JSON = REPO_ROOT / ".mcp.json"
OBJECTS_DIR = REPO_ROOT / "data" / "terrain_objects" / "objects"
PROMPTS_DIR = REPO_ROOT / "data" / "terrain_objects" / "generation" / "prompts"

API_BASE_MCP = "https://api.pixellab.ai/mcp"   # For GET status/download
API_BASE_V2 = "https://api.pixellab.ai/v2"     # For POST create
BATCH_SIZE = int(os.environ.get("PIXELLAB_BATCH_SIZE", "10"))
POLL_INTERVAL = int(os.environ.get("PIXELLAB_POLL_SEC", "15"))
MAX_RETRIES = 3
BACKOFF_BASE = 30  # seconds

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_PATH, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("pixellab_runner")

# ---------------------------------------------------------------------------
# Graceful shutdown
# ---------------------------------------------------------------------------

_shutdown = False

def _signal_handler(sig, frame):
    global _shutdown
    log.info("Shutdown requested (Ctrl+C). Finishing current batch...")
    _shutdown = True

signal.signal(signal.SIGINT, _signal_handler)

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


def api_request(method: str, path: str, api_key: str, body: dict = None, retries: int = MAX_RETRIES, base: str = None) -> dict | bytes | None:
    """Make an API request with retry and backoff."""
    if base is None:
        base = API_BASE_V2 if method == "POST" else API_BASE_MCP
    url = f"{base}/{path.lstrip('/')}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    for attempt in range(retries):
        try:
            if body is not None:
                data = json.dumps(body).encode("utf-8")
            else:
                data = None
            req = Request(url, data=data, headers=headers, method=method)
            with urlopen(req, timeout=60) as resp:
                content_type = resp.headers.get("Content-Type", "")
                raw = resp.read()
                if "application/json" in content_type:
                    return json.loads(raw)
                elif "image/" in content_type:
                    return raw  # PNG bytes
                else:
                    # Try JSON, fall back to raw
                    try:
                        return json.loads(raw)
                    except (json.JSONDecodeError, ValueError):
                        return raw
        except HTTPError as e:
            if e.code in (429, 529):
                wait = BACKOFF_BASE * (2 ** attempt)
                log.warning(f"Rate limited ({e.code}). Waiting {wait}s...")
                time.sleep(wait)
                continue
            elif e.code == 404:
                log.warning(f"404 for {url}")
                return None
            else:
                body_text = ""
                try:
                    body_text = e.read().decode("utf-8", errors="replace")[:200]
                except Exception:
                    pass
                log.error(f"HTTP {e.code} for {url}: {body_text}")
                if attempt < retries - 1:
                    time.sleep(5)
                    continue
                return None
        except (URLError, TimeoutError) as e:
            log.warning(f"Connection error: {e}. Retry {attempt+1}/{retries}")
            time.sleep(10)
            continue
    return None


def download_file(url: str, dest: Path, api_key: str) -> bool:
    """Download a file from URL to dest path."""
    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        req = Request(url, headers=headers)
        with urlopen(req, timeout=120) as resp:
            data = resp.read()
        if len(data) < 100:
            # Likely an error response, not an image
            try:
                err = json.loads(data)
                log.warning(f"Download returned error: {err}")
                return False
            except (json.JSONDecodeError, ValueError):
                pass
            return False
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "wb") as f:
            f.write(data)
        return True
    except Exception as e:
        log.error(f"Download failed {url}: {e}")
        return False

# ---------------------------------------------------------------------------
# Queue management
# ---------------------------------------------------------------------------

def load_queue() -> dict:
    if not QUEUE_PATH.exists():
        log.error(f"Queue not found: {QUEUE_PATH}")
        log.error("Run build_generation_queue.py first.")
        sys.exit(1)
    with open(QUEUE_PATH, encoding="utf-8") as f:
        return json.load(f)


def save_queue(data: dict) -> None:
    queue = data["queue"]
    data["total_queued"] = len(queue)
    data["total_base_sprites"] = sum(1 for e in queue if e["asset_type"] == "base_sprite")
    data["total_animations"] = sum(1 for e in queue if e["asset_type"] == "animation")
    data["total_completed"] = sum(1 for e in queue if e["status"] == "completed")
    # Atomic write
    tmp = QUEUE_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    tmp.replace(QUEUE_PATH)


def scan_disk(data: dict) -> int:
    """Mark items completed if their output_path already exists on disk.
    Also checks the variants/v1/ convention from manual MCP downloads."""
    count = 0
    for entry in data["queue"]:
        if entry["status"] == "completed":
            continue
        if entry["asset_type"] != "base_sprite":
            continue  # Only scan for base sprites
        full_path = REPO_ROOT / entry["output_path"]
        if full_path.exists() and full_path.stat().st_size > 100:
            entry["status"] = "completed"
            count += 1
            continue
        # Also check variants/v1/base.png convention (manual MCP downloads)
        # Queue path: .../category/object_id/phase/base.png
        # Manual path: .../category_path/object_id/variants/v1/base.png
        obj_id = entry["object_id"]
        category = entry["category"]
        alt_path = REPO_ROOT / "assets" / "catalog" / "terrain_objects" / category / obj_id / "variants" / "v1" / "base.png"
        if alt_path.exists() and alt_path.stat().st_size > 100:
            entry["status"] = "completed"
            count += 1
            continue
        # Also check with extra nesting (some assets stored as .../subcategory/object_id/variants/v1/)
        import glob
        pattern = str(REPO_ROOT / "assets" / "catalog" / "terrain_objects" / "**" / obj_id / "variants" / "v1" / "base.png")
        matches = glob.glob(pattern, recursive=True)
        if matches and os.path.getsize(matches[0]) > 100:
            entry["status"] = "completed"
            count += 1
    if count > 0:
        save_queue(data)
    return count

# ---------------------------------------------------------------------------
# Object definition loader (for prompts and sizes)
# ---------------------------------------------------------------------------

_object_defs = {}

def load_object_defs():
    global _object_defs
    if _object_defs:
        return _object_defs
    for f in OBJECTS_DIR.rglob("*.json"):
        with open(f) as fh:
            d = json.load(fh)
        _object_defs[d.get("id", "")] = d
    log.info(f"Loaded {len(_object_defs)} object definitions")
    return _object_defs


def get_prompt_template(category: str) -> str:
    """Get the best matching prompt template for a category."""
    # Map category prefix to template file
    mappings = {
        "vegetation/tree": "vegetation_tree.txt",
        "vegetation/grass": "vegetation_grass.txt",
        "vegetation/": "vegetation_grass.txt",
        "mineral/": "mineral_rock.txt",
        "ground_cover/": "ground_cover.txt",
        "structure_natural/": "structure_natural.txt",
        "water_feature/": "water_feature.txt",
    }
    for prefix, template_file in mappings.items():
        if category.startswith(prefix):
            path = PROMPTS_DIR / template_file
            if path.exists():
                return path.read_text().strip()
    # Generic fallback
    return "Top-down pixel art {species}, 32x32 pixels, transparent background, 2D RPG style."


def build_prompt(entry: dict) -> str:
    """Build a PixelLab prompt for a queue entry.
    All prompts enforce consistent art style: top-down RPG pixel art."""
    obj_id = entry["object_id"]
    category = entry["category"]
    phase = entry.get("phase", "default")

    species = obj_id.replace("_", " ")
    phase_desc = "" if phase in ("default", "intact") else f", {phase} stage"

    if entry["asset_type"] == "animation":
        interaction = entry.get("interaction", "idle")
        return (f"{species}{phase_desc} performing {interaction}, "
                f"top-down RPG pixel art, transparent background, "
                f"fantasy game style, 8 frames")

    # Base sprite — consistent prompt style matching manual MCP generation
    return (f"{species}{phase_desc}, top-down RPG pixel art, "
            f"transparent background, fantasy game style")


def get_object_size(entry: dict) -> tuple[int, int]:
    """Get pixel dimensions for a queue entry."""
    obj_def = load_object_defs().get(entry["object_id"], {})
    size = obj_def.get("size", [1, 1])
    px = obj_def.get("pixel_size", 32)
    return (size[0] * px, size[1] * px)

# ---------------------------------------------------------------------------
# PixelLab job management
# ---------------------------------------------------------------------------

def submit_base_sprite(entry: dict, api_key: str) -> str | None:
    """Submit a base sprite generation job. Returns job ID or None."""
    w, h = get_object_size(entry)
    prompt = build_prompt(entry)
    body = {
        "description": prompt,
        "image_size": {"width": min(w, 400), "height": min(h, 400)},
        "view": "high top-down",
        "detail": "medium detail",
        "shading": "medium shading",
        "outline": "selective outline",
    }
    if w > 32 or h > 64:
        body["detail"] = "high detail"
        body["shading"] = "detailed shading"

    resp = api_request("POST", "map-objects", api_key, body)
    if resp and isinstance(resp, dict):
        # v2 API returns object_id (for download) and background_job_id
        job_id = resp.get("object_id") or resp.get("id")
        if job_id:
            log.info(f"Submitted {entry['object_id']}/{entry['phase']}: obj={job_id}")
            return job_id
    log.error(f"Failed to submit {entry['object_id']}/{entry['phase']}: {resp}")
    return None


def check_and_download(job_id: str, dest: Path, api_key: str) -> str:
    """Try to download the result. Returns 'completed', 'processing', or 'failed'.
    Skips status endpoint (404 for v2-created objects) — just try download."""
    url = f"{API_BASE_MCP}/map-objects/{job_id}/download"
    try:
        headers = {"Authorization": f"Bearer {api_key}"}
        req = Request(url, headers=headers)
        with urlopen(req, timeout=60) as resp:
            data = resp.read()
        if len(data) > 200:
            # Real image data
            dest.parent.mkdir(parents=True, exist_ok=True)
            with open(dest, "wb") as f:
                f.write(data)
            return "completed"
        else:
            # Small response = error or still processing
            try:
                err = json.loads(data)
                msg = err.get("detail", "")
                if "still being generated" in msg or "processing" in msg.lower():
                    return "processing"
            except (json.JSONDecodeError, ValueError):
                pass
            return "processing"  # Assume still working
    except HTTPError as e:
        if e.code == 404:
            return "processing"  # Not ready yet
        return "failed"
    except Exception:
        return "processing"

# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def run_pipeline(data: dict, api_key: str):
    """Process the queue: submit, poll, download, checkpoint."""
    queue = data["queue"]

    # Sort: base_sprites first, then animations. Within each, by category.
    pending = [e for e in queue if e["status"] == "pending" and e["asset_type"] == "base_sprite"]
    pending += [e for e in queue if e["status"] == "pending" and e["asset_type"] == "animation"]

    total_pending = len(pending)
    completed_this_run = 0
    failed_this_run = 0

    log.info(f"Pipeline starting: {total_pending} pending items")
    log.info(f"Batch size: {BATCH_SIZE}, poll interval: {POLL_INTERVAL}s")

    idx = 0
    while idx < len(pending) and not _shutdown:
        # Submit a batch
        batch = pending[idx:idx + BATCH_SIZE]
        active_jobs: list[dict] = []  # {entry, job_id}

        for entry in batch:
            if _shutdown:
                break
            if entry["asset_type"] == "animation":
                # Skip animations for now — focus on base sprites
                # TODO: implement animate_object API call
                log.info(f"Skipping animation: {entry['object_id']}/{entry['interaction']}")
                entry["status"] = "pending"  # Keep pending for future
                continue

            job_id = submit_base_sprite(entry, api_key)
            if job_id:
                entry["status"] = "in_progress"
                entry["pixellab_job_id"] = job_id
                active_jobs.append({"entry": entry, "job_id": job_id})
            else:
                entry["status"] = "failed"
                failed_this_run += 1
            time.sleep(1)  # Brief pause between submissions

        if not active_jobs:
            idx += BATCH_SIZE
            continue

        # Poll for completion
        log.info(f"Polling {len(active_jobs)} active jobs...")
        max_polls = 40  # 40 * 15s = 10 min max wait
        for poll in range(max_polls):
            if _shutdown:
                break
            time.sleep(POLL_INTERVAL)

            still_active = []
            for job in active_jobs:
                dest = REPO_ROOT / job["entry"]["output_path"]
                result = check_and_download(job["job_id"], dest, api_key)
                if result == "completed":
                    job["entry"]["status"] = "completed"
                    completed_this_run += 1
                    log.info(f"✓ {job['entry']['object_id']}/{job['entry']['phase']} -> {dest.name}")
                elif result == "failed":
                    job["entry"]["status"] = "failed"
                    failed_this_run += 1
                    log.warning(f"✗ Failed: {job['entry']['object_id']}")
                else:
                    still_active.append(job)

            active_jobs = still_active
            if not active_jobs:
                break
            log.info(f"  ...{len(active_jobs)} still processing (poll {poll+1}/{max_polls})")

        # Mark timed-out jobs as failed
        for job in active_jobs:
            job["entry"]["status"] = "failed"
            failed_this_run += 1
            log.warning(f"✗ Timed out: {job['entry']['object_id']}")

        # Checkpoint
        save_queue(data)
        idx += BATCH_SIZE

        total_complete = sum(1 for e in queue if e["status"] == "completed")
        log.info(f"Checkpoint: {total_complete}/{len(queue)} complete "
                 f"(+{completed_this_run} this run, {failed_this_run} failed)")

    log.info(f"Pipeline finished. +{completed_this_run} completed, {failed_this_run} failed")
    save_queue(data)

# ---------------------------------------------------------------------------
# CLI commands
# ---------------------------------------------------------------------------

def cmd_status(data: dict):
    queue = data["queue"]
    total = len(queue)
    by_status = Counter(e["status"] for e in queue)
    by_type = Counter(e["asset_type"] for e in queue)
    by_type_status = Counter(f"{e['asset_type']}/{e['status']}" for e in queue)

    print(f"=== PixelLab Generation Queue ===")
    print(f"Total:     {total}")
    print(f"Completed: {by_status.get('completed', 0)}")
    print(f"Pending:   {by_status.get('pending', 0)}")
    print(f"Failed:    {by_status.get('failed', 0)}")
    print(f"In prog:   {by_status.get('in_progress', 0)}")
    print()
    print(f"Base sprites: {by_type.get('base_sprite', 0)} "
          f"({by_type_status.get('base_sprite/completed', 0)} done, "
          f"{by_type_status.get('base_sprite/pending', 0)} pending)")
    print(f"Animations:   {by_type.get('animation', 0)} "
          f"({by_type_status.get('animation/completed', 0)} done, "
          f"{by_type_status.get('animation/pending', 0)} pending)")

    # Top categories pending
    cat_pending = Counter()
    for e in queue:
        if e["status"] == "pending":
            cat_pending[e["category"].split("/")[0]] += 1
    if cat_pending:
        print("\nPending by category:")
        for cat, count in cat_pending.most_common():
            print(f"  {cat:<20} {count}")


def cmd_retry_failed(data: dict):
    count = 0
    for entry in data["queue"]:
        if entry["status"] == "failed":
            entry["status"] = "pending"
            entry["pixellab_job_id"] = None
            count += 1
    save_queue(data)
    print(f"Reset {count} failed items to pending")


def cmd_scan(data: dict):
    count = scan_disk(data)
    print(f"Marked {count} items as completed (found on disk)")


def cmd_start(data: dict):
    api_key = get_api_key()
    # Scan disk first to catch manual downloads
    found = scan_disk(data)
    if found:
        log.info(f"Disk scan: found {found} existing assets, marked completed")
    run_pipeline(data, api_key)

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Autonomous PixelLab sprite generation pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("command", choices=["start", "status", "retry-failed", "scan"],
                        help="Command to run")
    args = parser.parse_args()

    data = load_queue()

    if args.command == "status":
        cmd_status(data)
    elif args.command == "retry-failed":
        cmd_retry_failed(data)
    elif args.command == "scan":
        cmd_scan(data)
    elif args.command == "start":
        cmd_start(data)


if __name__ == "__main__":
    main()
