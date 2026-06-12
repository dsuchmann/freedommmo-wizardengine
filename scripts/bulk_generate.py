#!/usr/bin/env python3
"""
bulk_generate.py — generic PixelLab batch runner for asset-corpus batches.

Consumes scripts/asset-corpus/out/batches/<burst>.json (from compile.mjs).
Job kinds: create | state | anim | wang. Resumable; never redoes valid PNGs.

Gates:
  armed          -> runs
  pilot          -> runs (pilot batches are how pilots happen)
  pilot_required -> REFUSES unless scripts/.bursts/<burst>/pilot_pass.json exists
  dormant        -> always refuses

Usage:
  python scripts/bulk_generate.py --batch scripts/asset-corpus/out/batches/w2-f6_trees.json
  python scripts/bulk_generate.py --batch <file> --dry-run
  python scripts/bulk_generate.py --batch <file> --phase create --max-inflight 4
  python scripts/bulk_generate.py --batch <file> --status
"""
import argparse, json, sys, time
import base64
import io
import logging
import os
import struct
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

REPO_ROOT = Path(__file__).resolve().parents[1]
BURSTS_DIR = REPO_ROOT / "scripts" / ".bursts"
BIOME_TILES = REPO_ROOT / "scripts" / "asset-corpus" / "registry" / "biome_base_tiles.json"
MCP_JSON = REPO_ROOT / ".mcp.json"
ACCOUNT_LIMIT = 20

LEDGER = REPO_ROOT / "scripts" / ".pixellab_inflight.json"
STALE_S = 600  # entries without heartbeat for 10 min are dead runners


class InflightLedger:
    """Cooperative inflight accounting across bulk_generate.py instances.
    Lockfile-free best-effort: read-modify-write with atomic replace; collisions
    only ever overcount briefly, which is safe (we submit fewer, never more)."""

    def __init__(self, burst: str):
        self.key = f"{burst}:{os.getpid()}"

    def _read(self) -> dict:
        try:
            with open(LEDGER) as f:
                data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {}
        now = time.time()
        return {k: v for k, v in data.items() if now - v.get("ts", 0) < STALE_S}

    def publish(self, count: int):
        data = self._read()
        data[self.key] = {"count": count, "ts": time.time()}
        tmp = LEDGER.with_suffix(".tmp")
        with open(tmp, "w") as f:
            json.dump(data, f)
        tmp.replace(LEDGER)

    def others(self) -> int:
        return sum(v["count"] for k, v in self._read().items() if k != self.key)

    def headroom(self, my_cap: int, my_inflight: int) -> int:
        budget = min(my_cap, ACCOUNT_LIMIT - self.others())
        return max(0, budget - my_inflight)

    def clear(self):
        data = self._read()
        data.pop(self.key, None)
        tmp = LEDGER.with_suffix(".tmp")
        with open(tmp, "w") as f:
            json.dump(data, f)
        tmp.replace(LEDGER)


API_BASE = "https://api.pixellab.ai/v2"
POLL_INTERVAL = 20          # seconds between scheduler ticks
SUBMIT_DELAY = 2            # seconds between submissions
JOB_TIMEOUT = 10800         # 3h
MAX_RETRIES = 3
CREDITS_FLOOR = 3.00        # pause below this
CREDITS_CHECK_EVERY = 600   # seconds

# ---------------------------------------------------------------------------
# Logging — deferred until burst_paths() is known; set up a basic stderr
# logger here so helpers can use `log` at module level.
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()],
)
log = logging.getLogger("bulk_generate")

API_KEY = None  # set in main


# ---------------------------------------------------------------------------
# API helpers  (ported verbatim from bulk_generate_f4.py)
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
    log.error("No API key. Set PIXELLAB_API_KEY or check .mcp.json")
    sys.exit(1)


def api_call(method: str, path: str, body: dict | None = None, timeout: int = 120):
    """Returns (json, http_status). json is None on failure."""
    url = f"{API_BASE}/{path.lstrip('/')}"
    headers = {"Authorization": f"Bearer {API_KEY}"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    for attempt in range(4):
        try:
            req = Request(url, data=data, headers=headers, method=method)
            with urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read()), resp.status
        except HTTPError as e:
            if e.code in (429, 529):
                wait = 30 * (2 ** attempt)
                log.warning(f"{path}: rate limited ({e.code}), waiting {wait}s")
                time.sleep(wait)
                continue
            txt = ""
            try:
                txt = e.read().decode("utf-8", errors="replace")[:300]
            except Exception:
                pass
            if e.code != 404:
                log.error(f"{method} {path}: HTTP {e.code}: {txt}")
            return None, e.code
        except (URLError, TimeoutError, OSError) as e:
            log.warning(f"{path}: connection error {e}, retry {attempt+1}/4")
            time.sleep(10 * (attempt + 1))
    return None, 0


def fetch_bytes(url: str) -> bytes | None:
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0 (f4-pipeline)"}), timeout=60) as resp:
                return resp.read()
        except Exception as e:
            log.warning(f"download failed ({attempt+1}/3): {e}")
            time.sleep(5)
    return None


def valid_png(data: bytes | None) -> bool:
    """Magic bytes + size + non-trivial alpha coverage."""
    if not data or len(data) < 200 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return False
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data)).convert("RGBA")
        alpha = im.getchannel("A")
        hist = alpha.histogram()
        opaque = sum(hist[16:])  # pixels with alpha >= 16
        total = im.width * im.height
        # reject blank (almost nothing) and full-bleed (no transparency at all)
        # floor 0.3% (~12px at 64x64): tiny seedling states are legitimately sparse
        return opaque > total * 0.003 and opaque < total * 0.98
    except ImportError:
        return True  # PIL unavailable: magic check only
    except Exception:
        return False


def save_png(data: bytes, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as f:
        f.write(data)


def track_usage(state: dict, resp: dict | None):
    if not resp:
        return
    u = resp.get("usage")
    if isinstance(u, dict):
        usd = u.get("usd") or u.get("amount") or 0
        try:
            state["usage"]["usd"] = state["usage"].get("usd", 0.0) + float(usd)
        except (TypeError, ValueError):
            pass
    state["usage"]["calls"] = state["usage"].get("calls", 0) + 1


_last_credit_check = 0.0
_paused_logged = False


def credits_ok(state) -> bool:
    global _last_credit_check, _paused_logged
    if time.time() - _last_credit_check < CREDITS_CHECK_EVERY:
        return True
    resp, _ = api_call("GET", "balance")
    _last_credit_check = time.time()
    if not resp:
        return True  # transient; don't block on a failed balance check
    usd = None
    cr = resp.get("credits")
    if isinstance(cr, dict):
        for k in ("usd", "amount", "remaining", "balance"):
            if isinstance(cr.get(k), (int, float)):
                usd = float(cr[k])
                break
    elif isinstance(cr, (int, float)):
        usd = float(cr)
    usage = state.get("usage", {})
    log.info(f"[BALANCE] {json.dumps(resp)[:200]} | spent so far: ${usage.get('usd', 0.0):.2f} over {usage.get('calls', 0)} calls")
    if usd is not None and usd < CREDITS_FLOOR:
        if not _paused_logged:
            log.warning(f"*** CREDITS LOW (${usd:.2f} < ${CREDITS_FLOOR:.2f}) — PAUSED. Top up at pixellab.ai; the script rechecks every {CREDITS_CHECK_EVERY//60} min and resumes automatically. ***")
            _paused_logged = True
        return False
    _paused_logged = False
    return True


# ---------------------------------------------------------------------------
# Batch loading
# ---------------------------------------------------------------------------

def load_batch(path: Path) -> dict:
    with open(path) as f:
        batch = json.load(f)
    for k in ("burst", "registry", "gate", "jobs"):
        if k not in batch:
            sys.exit(f"malformed batch: missing {k}")
    return batch


def check_gate(batch: dict) -> None:
    gate = batch["gate"]
    if gate == "dormant":
        sys.exit(f"{batch['burst']}: dormant — refusing (enumerate-only row)")
    if gate == "pilot_required":
        marker = BURSTS_DIR / batch["burst"] / "pilot_pass.json"
        if not marker.exists():
            sys.exit(f"{batch['burst']}: pilot_required — refusing. Run the pilot batch, "
                     f"verify assembly/seams, then record {marker} "
                     f'(JSON: {{"passed_by": "<user>", "date": "YYYY-MM-DD", "evidence": "<note>"}})')
    if not batch["jobs"]:
        sys.exit(f"{batch['burst']}: batch has no jobs (matrix counts-only row?)")


# ---------------------------------------------------------------------------
# Per-burst state / logging
# ---------------------------------------------------------------------------

def burst_paths(burst: str):
    d = BURSTS_DIR / burst
    d.mkdir(parents=True, exist_ok=True)
    return d / "state.json", d / "run.log"


def load_state(state_file: Path) -> dict:
    if state_file.exists():
        with open(state_file) as f:
            return json.load(f)
    return {"tasks": {}, "usage": {}}


def save_state(state: dict, state_file: Path):
    tmp = state_file.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump(state, f)
    tmp.replace(state_file)


# ---------------------------------------------------------------------------
# Dry-run summary
# ---------------------------------------------------------------------------

def dry_run(batch: dict):
    from collections import Counter
    kinds = Counter(j["kind"] for j in batch["jobs"])
    print(f"burst={batch['burst']} gate={batch['gate']} jobs={len(batch['jobs'])} {dict(kinds)}")
    for j in batch["jobs"][:5]:
        print(" ", json.dumps(j)[:160])
    if len(batch["jobs"]) > 5:
        print(f"  ... {len(batch['jobs']) - 5} more")


# ---------------------------------------------------------------------------
# SHA-256 helper (wang tile hash)
# ---------------------------------------------------------------------------

import hashlib

def tile_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:12]


# ---------------------------------------------------------------------------
# Variant path helpers (mirrors F4 convention)
# ---------------------------------------------------------------------------

def variant_path(job: dict, v: int) -> Path:
    return REPO_ROOT / job["out"] / f"v{v:03d}.png"


def anim_variant_dir(job: dict, v: int) -> Path:
    return REPO_ROOT / job["out"] / f"v{v:03d}"


def state_variant_path(job: dict, v: int) -> Path:
    return REPO_ROOT / job["out"] / f"v{v:03d}.png"


def count_disk_variants(job_out: str) -> int:
    d = REPO_ROOT / job_out
    if not d.exists():
        return 0
    return sum(1 for p in d.glob("v???.png") if p.stat().st_size > 200)


def anim_done(job: dict, v: int) -> bool:
    d = anim_variant_dir(job, v)
    if not d.exists():
        return False
    frames = list(d.glob("frame_*.png"))
    return len(frames) >= job["frames"] and all(f.stat().st_size > 200 for f in frames)


# ---------------------------------------------------------------------------
# Task table helpers
# ---------------------------------------------------------------------------

def ensure_tasks(batch: dict, state: dict, phase: str | None):
    """Populate task table from batch jobs. Idempotent (skip existing keys).

    Always populates ALL job kinds regardless of --phase so that dependency
    bookkeeping (create task records) is intact when phase='state'/'anim' resumes
    a prior session.  The phase filter is applied at selection time in pick_next.
    """
    tasks = state["tasks"]

    for job in batch["jobs"]:
        kind = job["kind"]
        if kind == "create":
            for c in range(job["calls"]):
                key = f"create:{job['id']}:{c}"
                if key not in tasks:
                    tasks[key] = {"status": "pending", "kind": "create",
                                  "job_id_ref": job["id"], "call_n": c}
        elif kind == "state":
            key = f"state:{job['id']}"
            if key not in tasks:
                parent_done = _parent_finalized(job["parent"], tasks)
                tasks[key] = {"status": "pending" if parent_done else "waiting",
                              "kind": "state", "job_id_ref": job["id"]}
        elif kind == "anim":
            key = f"anim:{job['id']}:{job['animState']}"
            if key not in tasks:
                parent_done = _parent_finalized(job["parent"], tasks)
                tasks[key] = {"status": "pending" if parent_done else "waiting",
                              "kind": "anim", "job_id_ref": job["id"]}
        elif kind == "wang":
            key = f"wang:{job['id']}"
            if key not in tasks:
                tasks[key] = {"status": "pending", "kind": "wang", "job_id_ref": job["id"]}


def _parent_finalized(parent_id: str, tasks: dict) -> bool:
    """True if all create tasks for this parent are done/failed."""
    parent_keys = [k for k in tasks if k.startswith(f"create:{parent_id}:")]
    if not parent_keys:
        return False
    return all(tasks[k].get("status") in ("done", "failed") for k in parent_keys)


def unlock_dependents(batch: dict, state: dict, parent_id: str, phase: str | None):
    """After a create parent finalizes: unlock waiting state/anim tasks."""
    tasks = state["tasks"]
    for job in batch["jobs"]:
        if job.get("parent") != parent_id:
            continue
        kind = job["kind"]
        if kind == "state":
            key = f"state:{job['id']}"
        elif kind == "anim":
            key = f"anim:{job['id']}:{job['animState']}"
        else:
            continue
        if phase and kind != phase:
            continue
        if key not in tasks:
            tasks[key] = {"status": "pending", "kind": kind, "job_id_ref": job["id"]}
        elif tasks[key].get("status") == "waiting":
            tasks[key]["status"] = "pending"


def all_creates_done(batch: dict, state: dict, parent_id: str) -> bool:
    tasks = state["tasks"]
    parent_keys = [k for k in tasks if k.startswith(f"create:{parent_id}:")]
    if not parent_keys:
        return False
    return all(tasks[k].get("status") in ("done", "failed") for k in parent_keys)


def get_parent_variants(batch: dict, state: dict, parent_id: str) -> list[dict]:
    """Return list of {v, path} for all finalized variants of a parent."""
    tasks = state["tasks"]
    result = []
    for key, t in tasks.items():
        if not key.startswith(f"create:{parent_id}:"):
            continue
        for obj_id_info in t.get("object_ids", []):
            v = obj_id_info["v"]
            job = next((j for j in batch["jobs"] if j["id"] == parent_id and j["kind"] == "create"), None)
            if job:
                p = variant_path(job, v)
                if p.exists():
                    result.append({"v": v, "path": p, "object_id": obj_id_info.get("object_id")})
    # also scan disk for pre-existing variants not in task table
    cjob = next((j for j in batch["jobs"] if j["id"] == parent_id and j["kind"] == "create"), None)
    if cjob:
        existing_vs = {r["v"] for r in result}
        d = REPO_ROOT / cjob["out"]
        if d.exists():
            for p in sorted(d.glob("v???.png")):
                v = int(p.stem[1:])
                if v not in existing_vs:
                    result.append({"v": v, "path": p, "object_id": None})
    result.sort(key=lambda r: r["v"])
    return result


# ---------------------------------------------------------------------------
# Stage: create
# ---------------------------------------------------------------------------

def submit_create(job: dict) -> dict | None:
    resp, code = api_call("POST", "create-1-direction-object", {
        "description": job["prompt"],
        "size": job["size"],
        "view": "top-down",
    })
    return resp


def finalize_create(batch: dict, state: dict, key: str, t: dict) -> bool:
    """Download candidates from the object, validate, save as v{NNN}.png."""
    job = next((j for j in batch["jobs"] if j["id"] == t["job_id_ref"] and j["kind"] == "create"), None)
    if not job:
        log.error(f"{key}: can't find job record")
        return False
    obj_id = t.get("object_id")
    resp, code = api_call("GET", f"objects/{obj_id}")
    if not resp:
        return False
    frame_urls = resp.get("frame_urls") or []
    if not frame_urls:
        su = resp.get("storage_urls") or {}
        # prefer frame_* keys; fall back to any non-None URL (e.g. "unknown")
        frame_keyed = [su[k] for k in sorted(su) if k.startswith("frame_") and su[k]]
        frame_urls = frame_keyed if frame_keyed else [v for v in su.values() if v]
    existing = count_disk_variants(job["out"])
    good = []
    for i, url in enumerate(frame_urls):
        if existing + len(good) >= job["keep"]:
            break
        data = fetch_bytes(url)
        if valid_png(data):
            good.append((i, data))
        else:
            log.info(f"  {key}: candidate {i} rejected")
    if not good:
        log.warning(f"{key}: no valid candidates")
        return True  # call done; no variants to save
    # select-frames to keep the object alive / mark selected
    sel, code = api_call("POST", f"objects/{obj_id}/select-frames",
                         {"indices": [i for i, _ in good],
                          "common_tag": f"bulk_{job['id'].replace('/', '_')}"})
    track_usage(state, sel)
    created_ids = (sel or {}).get("created_object_ids") or []
    saved_ids = []
    for n, (idx, data) in enumerate(good):
        v = existing + n
        save_png(data, variant_path(job, v))
        saved_ids.append({"v": v, "object_id": created_ids[n] if n < len(created_ids) else None})
    t["object_ids"] = t.get("object_ids", []) + saved_ids
    log.info(f"{key}: kept {len(good)} variants ({job['id']} now {existing + len(good)})")
    return True


# ---------------------------------------------------------------------------
# Stage: state
# ---------------------------------------------------------------------------

def submit_state(batch: dict, state: dict, job: dict, t: dict) -> dict | None:
    variants = get_parent_variants(batch, state, job["parent"])
    pool = variants[:job["pool"]]
    if not pool:
        log.warning(f"state {job['id']}: no parent variants available yet")
        return None
    imgs, sent_vs = [], []
    for info in pool:
        p = info["path"]
        if not p.exists():
            continue
        b64 = base64.b64encode(p.read_bytes()).decode("ascii")
        imgs.append({"image": {"base64": b64}, "width": job["size"] if "size" in job else 192,
                     "height": job["size"] if "size" in job else 192})
        sent_vs.append(info["v"])
        if len(imgs) >= 16:
            break
    if not imgs:
        return None
    # resolve size from parent create job
    cjob = next((j for j in batch["jobs"] if j["id"] == job["parent"] and j["kind"] == "create"), None)
    sz = cjob["size"] if cjob else 192
    for img in imgs:
        img["width"] = sz; img["height"] = sz
    t["sent_vs"] = sent_vs
    resp, code = api_call("POST", "edit-images-v2", {
        "method": "edit_with_text",
        "edit_images": imgs,
        "image_size": {"width": sz, "height": sz},
        "description": job["edit"],
        "no_background": True,
    })
    return resp


def finalize_state(batch: dict, state: dict, key: str, t: dict, job_resp: dict) -> bool:
    job = next((j for j in batch["jobs"] if j["id"] == t["job_id_ref"] and j["kind"] == "state"), None)
    if not job:
        return False
    last = (job_resp or {}).get("last_response") or {}
    images = last.get("images") or []
    sent = t.get("sent_vs") or []
    n = 0
    for i, v in enumerate(sent):
        if i >= len(images):
            break
        fr = images[i]
        b64 = fr.get("base64") if isinstance(fr, dict) else fr
        data = None
        if isinstance(b64, str):
            if b64.startswith("http"):
                data = fetch_bytes(b64)
            else:
                try:
                    data = base64.b64decode(b64.split("base64,")[-1])
                except Exception:
                    data = None
        if valid_png(data):
            save_png(data, state_variant_path(job, v))
            n += 1
        else:
            log.warning(f"{key}: v{v:03d} rejected by validation")
    log.info(f"state {key}: saved {n}/{len(sent)}")
    return n > 0


# ---------------------------------------------------------------------------
# Stage: anim
# ---------------------------------------------------------------------------

def submit_anim(batch: dict, state: dict, job: dict, t: dict) -> dict | None:
    variants = get_parent_variants(batch, state, job["parent"])
    if not variants:
        log.warning(f"anim {job['id']}: no parent variants")
        return None
    # pick first variant not yet animated
    chosen = None
    for info in variants:
        if not anim_done(job, info["v"]):
            chosen = info
            break
    if not chosen:
        log.info(f"anim {job['id']}: all variants already animated")
        return None
    t["anim_v"] = chosen["v"]
    p = chosen["path"]
    b64 = base64.b64encode(p.read_bytes()).decode("ascii")
    resp, code = api_call("POST", "animate-with-text-v3", {
        "first_frame": {"base64": b64, "format": "png"},
        "action": job["action"],
        "frame_count": job["frames"],
        "no_background": True,
    })
    return resp


def finalize_anim(batch: dict, state: dict, key: str, t: dict, job_resp: dict) -> bool:
    job = next((j for j in batch["jobs"] if j["id"] == t["job_id_ref"] and j["kind"] == "anim"), None)
    if not job:
        return False
    v = t.get("anim_v", 0)
    d = anim_variant_dir(job, v)
    last = (job_resp or {}).get("last_response") or {}
    frames = last.get("frames") or last.get("images") or []
    if not frames:
        for k, val in last.items():
            if isinstance(val, list) and len(val) >= 4:
                frames = val; break
    n = 0
    for i, fr in enumerate(frames):
        data = None
        if isinstance(fr, str):
            if fr.startswith("http"):
                data = fetch_bytes(fr)
            else:
                try:
                    data = base64.b64decode(fr.split("base64,")[-1])
                except Exception:
                    data = None
        elif isinstance(fr, dict):
            url = fr.get("url") or fr.get("src")
            b64 = fr.get("base64")
            if url:
                data = fetch_bytes(url)
            elif b64:
                try:
                    data = base64.b64decode(b64.split("base64,")[-1])
                except Exception:
                    data = None
        if data and len(data) > 200:
            save_png(data, d / f"frame_{i:03d}.png")
            n += 1
    if n >= job["frames"]:
        return True
    log.warning(f"{key}: only {n} frames extracted")
    return n > 0


# ---------------------------------------------------------------------------
# Stage: wang
# ---------------------------------------------------------------------------

_biome_tiles: dict | None = None

def load_biome_tiles() -> dict:
    global _biome_tiles
    if _biome_tiles is None:
        with open(BIOME_TILES) as f:
            _biome_tiles = json.load(f)
    return _biome_tiles


def submit_wang(job: dict) -> dict | None:
    tiles = load_biome_tiles()
    biome = job["lower_biome"]
    if biome not in tiles:
        log.error(f"wang {job['id']}: biome '{biome}' not in biome_base_tiles.json")
        return None
    lower_desc = tiles[biome]["desc"]
    lower_base_id = tiles[biome]["base_tile_id"]
    upper_desc = job["upper_description"]
    transition_size = job.get("transition_size", 0.5)
    body = {
        "lower_description": lower_desc,
        "lower_base_tile_id": lower_base_id,
        "upper_description": upper_desc,
        "transition_description": f"{lower_desc} transitioning to {upper_desc}",
        "transition_size": transition_size,
        "tile_size": {"width": 32, "height": 32},
        "view": "high top-down",
        "outline": "lineless",
        "detail": "highly detailed",
        "shading": "highly detailed shading",
    }
    resp, code = api_call("POST", "create-tileset", body)
    return resp


def finalize_wang(state: dict, key: str, t: dict, job: dict, tileset_data: dict) -> bool:
    tiles = tileset_data.get("tileset", {}).get("tiles", [])
    if not tiles:
        log.warning(f"{key}: no tiles in response")
        return False
    out_dir = REPO_ROOT / job["out"]
    out_dir.mkdir(parents=True, exist_ok=True)
    saved = 0
    hashes = {}
    for tile in tiles:
        idx = tile.get("name", "").replace("wang_", "")
        b64 = tile.get("image", {}).get("base64", "")
        if not b64:
            continue
        data = base64.b64decode(b64)
        fn = out_dir / f"{job['id']}__wang_{idx}.png"
        with open(fn, "wb") as f:
            f.write(data)
        h = tile_hash(data)
        hashes[str(idx)] = h
        # detect if identical reference tile id produces different content across bursts
        prev = t.get("tile_hashes", {}).get(str(idx))
        if prev and prev != h:
            log.warning(f"{key}: tile {idx} hash changed {prev} -> {h} (different regeneration)")
        saved += 1
    t["tile_hashes"] = {**t.get("tile_hashes", {}), **hashes}
    log.info(f"{key}: saved {saved} wang tiles to {out_dir}")
    return saved > 0


# ---------------------------------------------------------------------------
# Scheduler helpers
# ---------------------------------------------------------------------------

def pick_next(batch: dict, state: dict, phase: str | None) -> tuple | None:
    """Priority: create > state > anim > wang. Returns (kind, key, task, job) or None."""
    tasks = state["tasks"]
    job_by_id = {}
    for j in batch["jobs"]:
        job_by_id[(j["kind"], j["id"])] = j

    for order in (["create", "state", "anim", "wang"] if not phase else [phase]):
        for key, t in tasks.items():
            if t["status"] != "pending":
                continue
            if t["kind"] != order:
                continue
            # find the job record
            jid = t["job_id_ref"]
            job = job_by_id.get((order, jid))
            if not job:
                continue
            return order, key, t, job
    return None


def re_adopt_inflight(batch: dict, state: dict) -> dict:
    """Re-adopt queued tasks after restart (same as F4 :595-602)."""
    inflight = {}
    job_by_id = {(j["kind"], j["id"]): j for j in batch["jobs"]}
    for key, t in state["tasks"].items():
        if t.get("status") not in ("queued",):
            continue
        kind = t["kind"]
        jid = t["job_id_ref"]
        job = job_by_id.get((kind, jid))
        if not job:
            continue
        # tasks without a job_id cannot be polled — re-queue
        if not t.get("job_id") and kind in ("state", "anim", "wang"):
            t["status"] = "pending"
            continue
        inflight[key] = {"kind": kind, "key": key, "task": t, "job": job, "submitted": time.time()}
    return inflight


# ---------------------------------------------------------------------------
# report_status
# ---------------------------------------------------------------------------

def report_status(batch: dict):
    state_file, _ = burst_paths(batch["burst"])
    state = load_state(state_file)
    tasks = state.get("tasks", {})
    from collections import Counter
    by_kind: dict[str, Counter] = {}
    for t in tasks.values():
        k = t.get("kind", "?")
        s = t.get("status", "?")
        by_kind.setdefault(k, Counter())[s] += 1
    usage = state.get("usage", {})
    print(f"burst={batch['burst']}  gate={batch['gate']}  total_jobs={len(batch['jobs'])}")
    for kind in ("create", "state", "anim", "wang"):
        if kind in by_kind:
            print(f"  {kind:8s}: {dict(by_kind[kind])}")
    print(f"  usage:    ${usage.get('usd', 0.0):.4f}  calls={usage.get('calls', 0)}")


# ---------------------------------------------------------------------------
# Main run loop
# ---------------------------------------------------------------------------

def run(batch: dict, args):
    state_file, log_file = burst_paths(batch["burst"])

    # add file handler to logger now that we have the path
    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    log.addHandler(fh)

    state = load_state(state_file)
    ledger = InflightLedger(batch["burst"])
    phase = args.phase  # None = all

    # Populate task table
    ensure_tasks(batch, state, phase)
    # Unlock dependents for already-completed parents (resume)
    for job in batch["jobs"]:
        if job["kind"] == "create":
            if all_creates_done(batch, state, job["id"]):
                unlock_dependents(batch, state, job["id"], phase)
    save_state(state, state_file)

    inflight = re_adopt_inflight(batch, state)
    log.info(f"Starting burst={batch['burst']} gate={batch['gate']} inflight(adopted)={len(inflight)}")

    idle_ticks = 0
    job_by_id = {(j["kind"], j["id"]): j for j in batch["jobs"]}

    try:
        while True:
            # ---- submit up to headroom ----
            while ledger.headroom(args.max_inflight, len(inflight)) > 0 and credits_ok(state):
                nxt = pick_next(batch, state, phase)
                if not nxt:
                    break
                kind, key, t, job = nxt

                if kind == "create":
                    resp = submit_create(job)
                    track_usage(state, resp)
                    if resp and resp.get("object_id"):
                        t["status"] = "queued"
                        t["object_id"] = resp["object_id"]
                        t["job_id"] = resp.get("background_job_id")
                        inflight[key] = {"kind": kind, "key": key, "task": t, "job": job, "submitted": time.time()}
                        log.info(f"create {key} -> {t['object_id']}")
                    else:
                        t["retries"] = t.get("retries", 0) + 1
                        if t["retries"] >= MAX_RETRIES:
                            t["status"] = "failed"
                            log.error(f"create {key}: failed permanently")

                elif kind == "state":
                    resp = submit_state(batch, state, job, t)
                    track_usage(state, resp)
                    job_id = (resp or {}).get("background_job_id")
                    if job_id:
                        t["status"] = "queued"
                        t["job_id"] = job_id
                        inflight[key] = {"kind": kind, "key": key, "task": t, "job": job, "submitted": time.time()}
                        log.info(f"state {key} -> job {job_id} ({len(t.get('sent_vs') or [])} imgs)")
                    else:
                        t["retries"] = t.get("retries", 0) + 1
                        if t["retries"] >= MAX_RETRIES:
                            t["status"] = "failed"

                elif kind == "anim":
                    resp = submit_anim(batch, state, job, t)
                    track_usage(state, resp)
                    job_id = (resp or {}).get("background_job_id") or (resp or {}).get("id")
                    if job_id:
                        t["status"] = "queued"
                        t["job_id"] = job_id
                        inflight[key] = {"kind": kind, "key": key, "task": t, "job": job, "submitted": time.time()}
                        log.info(f"anim {key} -> job {job_id}")
                    else:
                        t["retries"] = t.get("retries", 0) + 1
                        if t["retries"] >= MAX_RETRIES:
                            t["status"] = "failed"

                elif kind == "wang":
                    resp = submit_wang(job)
                    track_usage(state, resp)
                    tileset_id = (resp or {}).get("tileset_id")
                    if tileset_id:
                        t["status"] = "queued"
                        t["job_id"] = tileset_id
                        inflight[key] = {"kind": kind, "key": key, "task": t, "job": job, "submitted": time.time()}
                        log.info(f"wang {key} -> tileset {tileset_id}")
                    else:
                        t["retries"] = t.get("retries", 0) + 1
                        if t["retries"] >= MAX_RETRIES:
                            t["status"] = "failed"

                ledger.publish(len(inflight))
                save_state(state, state_file)
                time.sleep(SUBMIT_DELAY)

            if not inflight:
                nxt = pick_next(batch, state, phase)
                if not nxt:
                    log.info("All work complete (or parked).")
                    break
                if not credits_ok(state):
                    time.sleep(60)
                    continue
                idle_ticks += 1
                if idle_ticks > 40:
                    log.warning("Starved of submit capacity for too long; stopping.")
                    break
                log.info(f"Submit-starved (tick {idle_ticks}/40) — sleeping 120s")
                time.sleep(120)
                continue
            idle_ticks = 0

            time.sleep(POLL_INTERVAL)
            ledger.publish(len(inflight))

            # ---- poll inflight ----
            done_keys = []
            for ikey, info in list(inflight.items()):
                kind, key, t, job = info["kind"], info["key"], info["task"], info["job"]
                age = time.time() - info["submitted"]
                try:
                    if kind == "create":
                        resp, code = api_call("GET", f"objects/{t['object_id']}")
                        if resp is None and code == 404:
                            t["status"] = "pending"
                            t["retries"] = t.get("retries", 0) + 1
                            done_keys.append(ikey)
                            continue
                        status = (resp or {}).get("status")
                        if status in ("review", "completed"):
                            if finalize_create(batch, state, key, t):
                                t["status"] = "done"
                                done_keys.append(ikey)
                                if all_creates_done(batch, state, job["id"]):
                                    unlock_dependents(batch, state, job["id"], phase)
                        elif status == "failed":
                            t["status"] = "pending"
                            t["retries"] = t.get("retries", 0) + 1
                            if t["retries"] >= MAX_RETRIES:
                                t["status"] = "failed"
                            done_keys.append(ikey)

                    elif kind in ("state", "anim"):
                        job_resp, code = api_call("GET", f"background-jobs/{t['job_id']}")
                        status = (job_resp or {}).get("status")
                        if status == "completed":
                            ok = (finalize_anim(batch, state, key, t, job_resp) if kind == "anim"
                                  else finalize_state(batch, state, key, t, job_resp))
                            if ok:
                                t["status"] = "done"
                            else:
                                t["status"] = "pending"
                                t["retries"] = t.get("retries", 0) + 1
                                if t["retries"] >= MAX_RETRIES:
                                    t["status"] = "failed"
                            done_keys.append(ikey)
                        elif status == "failed":
                            t["status"] = "pending"
                            t["retries"] = t.get("retries", 0) + 1
                            if t["retries"] >= MAX_RETRIES:
                                t["status"] = "failed"
                            done_keys.append(ikey)

                    elif kind == "wang":
                        tileset_data, code = api_call("GET", f"create-tileset/{t['job_id']}")
                        status = (tileset_data or {}).get("status")
                        # Wang: done when response has no "detail" error key and has tiles
                        detail = (tileset_data or {}).get("detail")
                        if tileset_data and not detail and tileset_data.get("tileset"):
                            ok = finalize_wang(state, key, t, job, tileset_data)
                            t["status"] = "done" if ok else "failed"
                            done_keys.append(ikey)
                        elif detail or status in ("error", "failed"):
                            t["status"] = "pending"
                            t["retries"] = t.get("retries", 0) + 1
                            if t["retries"] >= MAX_RETRIES:
                                t["status"] = "failed"
                            done_keys.append(ikey)
                        # else still processing — leave in inflight

                except Exception as e:
                    log.error(f"poll {ikey}: {e}")

                if ikey not in done_keys and age > JOB_TIMEOUT:
                    log.warning(f"{ikey}: stuck {int(age)}s -> requeue (no retry penalty)")
                    t["status"] = "pending"
                    t.pop("job_id", None)
                    done_keys.append(ikey)

            for k in done_keys:
                inflight.pop(k, None)
            ledger.publish(len(inflight))
            save_state(state, state_file)

    finally:
        ledger.clear()
        save_state(state, state_file)
        report_status(batch)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    global API_KEY
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--phase", choices=["create", "state", "anim", "wang"])
    ap.add_argument("--max-inflight", type=int, default=4)
    args = ap.parse_args()
    batch = load_batch(Path(args.batch))
    if args.dry_run:
        check_gate(batch); dry_run(batch); return
    API_KEY = get_api_key()
    if args.status:
        report_status(batch); return  # implemented in Task 9
    check_gate(batch)
    run(batch, args)                  # implemented in Task 9


if __name__ == "__main__":
    main()
