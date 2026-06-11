#!/usr/bin/env python3
"""
bulk_generate_f5.py — Field 5 (medium objects) full asset generation pipeline.
Adapted from the proven bulk_generate_f4.py harness (spec: 2026-06-11-field5-
medium-objects-design.md).

Differences from F4:
  - 48 inanimate objects (16 biomes x geological/organic-remnant/relic), 96px
  - adaptive base calls: keep calling until 64 valid variants per object
    (96px returns fewer candidates per call than 64px did)
  - 6 inorganic weathering states (no growth lifecycle), 9 images/batch
  - selective idle animations: only 7 light/energy objects, custom action each
  - mo__ naming under assets/.../micro/medium_objects/
  - MAX_INFLIGHT kept low: the F4 wind_sway anim run shares the account's
    20-job concurrency; both schedulers back off on 429.

Resumable: all progress in _f5_state.json + disk (valid PNGs never redone).

Usage:
  python scripts/bulk_generate_f5.py                # full pipeline
  python scripts/bulk_generate_f5.py --status       # progress report
  python scripts/bulk_generate_f5.py --phase base   # one phase only
  python scripts/bulk_generate_f5.py --type mossy_boulder
  python scripts/bulk_generate_f5.py --dry-run
"""

import argparse
import base64
import io
import json
import logging
import os
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

REPO_ROOT = Path(__file__).resolve().parents[1]
OBJ_DIR = REPO_ROOT / "assets" / "pixelab" / "landscape_v2" / "micro" / "medium_objects"
MCP_JSON = REPO_ROOT / ".mcp.json"
STATE_FILE = OBJ_DIR / "_f5_state.json"
LOG_FILE = OBJ_DIR / "_f5_run.log"

API_BASE = "https://api.pixellab.ai/v2"
MAX_INFLIGHT = 6            # F4 anim run is consuming the rest of the 20-job account limit
POLL_INTERVAL = 20          # seconds between scheduler ticks
SUBMIT_DELAY = 2            # seconds between submissions
JOB_TIMEOUT = 1800          # 30 min -> requeue
MAX_RETRIES = 3
CREDITS_FLOOR = 3.00        # pause below this
CREDITS_CHECK_EVERY = 600   # seconds
SIZE = 96                   # boulders/stumps need texture detail
MAX_VARIANTS = 64
MAX_BASE_CALLS = 20         # 96px returns only 4 candidates/call; adaptive early-stop at MAX_VARIANTS
STATE_POOL = 9              # variants per state per type (= edit cap at 96px)
ANIM_FRAME_COUNT = 8        # v3 stores 8 + reference = 9

PROMPT = ("top-down high fantasy pixel art {obj}, jaw-dropping beauty, "
          "hyper-detailed, rich saturated colors, Final Fantasy aesthetic, "
          "alpha-transparent background, detailed shading, medium terrain object")

# 16 land biomes x (geological, organic remnant, relic/curiosity)
CATALOG = {
    "grassland":       ["field_boulder", "hay_bale", "fence_post"],
    "forest":          ["mossy_boulder", "tree_stump", "fallen_log"],
    "dense_forest":    ["root_mound", "hollow_stump", "rotting_log"],
    "tropical_forest": ["jungle_rock", "buttress_root", "vine_log"],
    "taiga":           ["snow_rock", "frost_stump", "ice_log"],
    "savanna":         ["termite_mound", "bone_pile", "dry_well"],
    "steppe":          ["wind_rock", "stone_cairn", "buried_post"],
    "desert":          ["sandstone_formation", "bleached_skull", "clay_pot_shard"],
    "beach":           ["tide_pool_rock", "beached_log", "anchor_relic"],
    "swamp":           ["mud_mound", "bog_log", "rotting_dock"],
    "hills":           ["granite_outcrop", "stone_pile", "old_milestone"],
    "mountains":       ["ice_boulder", "frozen_cairn", "cliff_fragment"],
    "tundra":          ["permafrost_mound", "frozen_bones", "ice_boulder"],
    "arctic":          ["ice_formation", "snow_drift_mound", "frozen_ruin"],
    "volcanic":        ["obsidian_pillar", "lava_rock", "basalt_column"],
    "mystic":          ["crystal_cluster", "rune_stone", "ancient_altar"],
}

# state name -> edit_description (inorganic weathering; rocks don't grow)
STATES = {
    "cracked":         "cracked and fractured, deep fissures running through it, chipped fragments",
    "destroyed":       "destroyed and broken apart, collapsed into rubble and scattered fragments",
    "mossy_overgrown": "overgrown with thick green moss and creeping vines, weathered by ages",
    "burned":          "burned and charred, blackened with soot and ash, faint glowing embers",
    "frozen":          "frozen solid, encased in ice crystals, thick frost coating",
    "enchanted":       "enchanted with glowing arcane aura, magical runes and sparkles, ethereal light",
}

# (biome, obj) -> (anim_name, action). Only objects with inherent light/energy.
ANIMS = {
    ("mystic", "crystal_cluster"):   ("glow_pulse",   "magical crystal glow pulsing softly brighter and dimmer, light breathing in and out, object stays perfectly still"),
    ("mystic", "rune_stone"):        ("rune_shimmer", "glowing runes shimmering and flickering gently across the stone surface, object stays perfectly still"),
    ("mystic", "ancient_altar"):     ("faint_aura",   "faint magical aura swirling slowly around the altar, soft wisps of light, object stays perfectly still"),
    ("volcanic", "lava_rock"):       ("ember_glow",   "molten cracks glowing and pulsing with inner heat, faint embers sparking, object stays perfectly still"),
    ("volcanic", "obsidian_pillar"): ("heat_shimmer", "heat haze shimmering subtly around the pillar, faint orange glow pulsing in the cracks, object stays perfectly still"),
    ("beach", "tide_pool_rock"):     ("water_glint",  "water in the tide pool glinting and sparkling with shifting light reflections, object stays perfectly still"),
    ("arctic", "ice_formation"):     ("ice_sparkle",  "ice crystals sparkling and glinting as light shifts across the surface, object stays perfectly still"),
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(),
              logging.FileHandler(LOG_FILE, encoding="utf-8")],
)
log = logging.getLogger("f5")

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
    log.error("No API key. Set PIXELLAB_API_KEY or check .mcp.json")
    sys.exit(1)


API_KEY = None  # set in main


def api_call(method: str, path: str, body: dict | None = None, timeout: int = 120):
    """Returns (json, http_status). json is None on failure."""
    url = f"{API_BASE}/{path.lstrip('/')}"
    headers = {"Authorization": f"Bearer {API_KEY}"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    last_code = 0
    for attempt in range(4):
        try:
            req = Request(url, data=data, headers=headers, method=method)
            with urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read()), resp.status
        except HTTPError as e:
            if e.code in (429, 529):
                last_code = e.code
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
    return None, last_code  # 429/529 if rate-limit starved, else 0 (connection)


def fetch_bytes(url: str) -> bytes | None:
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0 (f5-pipeline)"}), timeout=60) as resp:
                return resp.read()
        except Exception as e:
            log.warning(f"download failed ({attempt+1}/3): {e}")
            time.sleep(5)
    return None


# ---------------------------------------------------------------------------
# PNG validation
# ---------------------------------------------------------------------------

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
        # reject blank and full-bleed; destroyed/cracked states can be sparse
        return opaque > total * 0.003 and opaque < total * 0.98
    except ImportError:
        return True  # PIL unavailable: magic check only
    except Exception:
        return False


def save_png(data: bytes, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as f:
        f.write(data)


# ---------------------------------------------------------------------------
# State management
# ---------------------------------------------------------------------------

def load_state() -> dict:
    if STATE_FILE.exists():
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"base_calls": {}, "variants": {}, "states": {}, "anims": {}, "spend": {"usd": 0.0, "calls": 0}}


_last_save = 0.0

def save_state(state: dict, force: bool = False):
    global _last_save
    if not force and time.time() - _last_save < 5:
        return
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".json.tmp")
    with open(tmp, "w") as f:
        json.dump(state, f, indent=1)
    os.replace(tmp, STATE_FILE)
    _last_save = time.time()


def track_usage(state: dict, resp: dict | None):
    if not resp:
        return
    u = resp.get("usage")
    if isinstance(u, dict):
        usd = u.get("usd") or u.get("amount") or 0
        try:
            state["spend"]["usd"] += float(usd)
        except (TypeError, ValueError):
            pass
    state["spend"]["calls"] += 1


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

def variant_path(biome, obj, v):
    return OBJ_DIR / biome / obj / f"mo__{biome}__{obj}__v{v:03d}.png"

def state_path(biome, obj, st, v):
    return OBJ_DIR / biome / obj / "_states" / st / f"mo__{biome}__{obj}__{st}__v{v:03d}.png"

def anim_dir(biome, obj, v):
    name = ANIMS[(biome, obj)][0]
    return OBJ_DIR / biome / obj / "anim" / name / f"v{v:03d}"

def anim_done(biome, obj, v) -> bool:
    d = anim_dir(biome, obj, v)
    if not d.exists():
        return False
    frames = list(d.glob("frame_*.png"))
    return len(frames) >= ANIM_FRAME_COUNT and all(f.stat().st_size > 200 for f in frames)


def all_types():
    out = []
    for biome, objs in CATALOG.items():
        for obj in objs:
            out.append((biome, obj))
    return out


def variant_count(state, biome, obj) -> int:
    return sum(1 for i in state["variants"].values()
               if i["biome"] == biome and i["obj"] == obj and i.get("png"))


# ---------------------------------------------------------------------------
# Credits guard
# ---------------------------------------------------------------------------

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
    log.info(f"[BALANCE] {json.dumps(resp)[:200]} | spent so far: ${state['spend']['usd']:.2f} over {state['spend']['calls']} calls")
    if usd is not None and usd < CREDITS_FLOOR:
        if not _paused_logged:
            log.warning(f"*** CREDITS LOW (${usd:.2f} < ${CREDITS_FLOOR:.2f}) — PAUSED. Top up at pixellab.ai; the script rechecks every {CREDITS_CHECK_EVERY//60} min and resumes automatically. ***")
            _paused_logged = True
        return False
    _paused_logged = False
    return True


# ---------------------------------------------------------------------------
# Task scheduler
#
# Statuses:
#   base_calls:  pending -> queued -> done | failed | skipped
#   variants:    (created by base finalize) {object_id, png: bool}
#   states:      pending -> queued -> done | failed
#   anims:       pending -> queued -> done | failed
# ---------------------------------------------------------------------------

def ensure_tasks(state, only_type=None):
    """Populate base_call tasks; states/anims spawn as dependencies complete."""
    for biome, obj in all_types():
        if only_type and obj != only_type:
            continue
        for c in range(MAX_BASE_CALLS):
            key = f"{biome}/{obj}/c{c}"
            if key not in state["base_calls"]:
                state["base_calls"][key] = {"status": "pending", "biome": biome, "obj": obj, "call": c}
    # re-scan disk for already-downloaded variants
    for biome, obj in all_types():
        if only_type and obj != only_type:
            continue
        for v in range(MAX_VARIANTS + 8):
            vkey = f"{biome}/{obj}/v{v:03d}"
            if vkey not in state["variants"] and variant_path(biome, obj, v).exists():
                state["variants"][vkey] = {"object_id": None, "png": True, "biome": biome, "obj": obj, "v": v}


def spawn_state_tasks(state, biome, obj):
    """After a type's base finalize: queue one edit-images-v2 batch per state."""
    vs = sorted([info for k, info in state["variants"].items()
                 if info["biome"] == biome and info["obj"] == obj and info.get("png")],
                key=lambda i: i["v"])
    if not vs:
        return
    step = max(1, len(vs) // STATE_POOL)
    pool = vs[::step][:STATE_POOL]
    for st in STATES:
        key = f"{biome}/{obj}/{st}"
        if key in state["states"]:
            continue
        missing = [info["v"] for info in pool
                   if not state_path(biome, obj, st, info["v"]).exists()]
        if not missing:
            state["states"][key] = {"status": "done", "biome": biome, "obj": obj,
                                    "state": st, "vs": []}
            continue
        state["states"][key] = {"status": "pending", "biome": biome, "obj": obj,
                                "state": st, "vs": missing}


def spawn_anim_tasks(state, only_type=None):
    for vkey, info in state["variants"].items():
        if (info["biome"], info["obj"]) not in ANIMS:
            continue
        if only_type and info["obj"] != only_type:
            continue
        if not info.get("png"):
            continue
        if anim_done(info["biome"], info["obj"], info["v"]):
            state["anims"].setdefault(vkey, {"biome": info["biome"], "obj": info["obj"], "v": info["v"]})["status"] = "done"
            continue
        if vkey not in state["anims"]:
            state["anims"][vkey] = {"status": "pending", "biome": info["biome"], "obj": info["obj"], "v": info["v"]}


# --- submissions -----------------------------------------------------------

def submit_base(t):
    obj_name = t["obj"].replace("_", " ")
    return api_call("POST", "create-1-direction-object",
                    {"description": PROMPT.format(obj=obj_name),
                     "size": SIZE, "view": "top-down"})


def submit_state(t):
    """Batch edit: variant PNGs -> one edit-images-v2 background job."""
    cap = 16 if SIZE <= 64 else 9  # server caps frames per edit call by size
    imgs, sent_vs = [], []
    for v in t["vs"][:cap]:
        p = variant_path(t["biome"], t["obj"], v)
        if not p.exists():
            continue
        b64 = base64.b64encode(p.read_bytes()).decode("ascii")
        imgs.append({"image": {"base64": b64}, "width": SIZE, "height": SIZE})
        sent_vs.append(v)
    if not imgs:
        return None, 400
    t["sent_vs"] = sent_vs
    return api_call("POST", "edit-images-v2",
                    {"method": "edit_with_text",
                     "edit_images": imgs,
                     "image_size": {"width": SIZE, "height": SIZE},
                     "description": STATES[t["state"]],
                     "no_background": True})


def submit_anim(t):
    png = variant_path(t["biome"], t["obj"], t["v"])
    if not png.exists():
        return None, 400
    action = ANIMS[(t["biome"], t["obj"])][1]
    b64 = base64.b64encode(png.read_bytes()).decode("ascii")
    return api_call("POST", "animate-with-text-v3",
                    {"first_frame": {"base64": b64, "format": "png"},
                     "action": action,
                     "frame_count": ANIM_FRAME_COUNT,
                     "no_background": True})


# --- finalizers -------------------------------------------------------------

def finalize_base(state, key, t):
    """Object reached review: download candidates, validate, select, record variants."""
    obj_id = t["object_id"]
    resp, code = api_call("GET", f"objects/{obj_id}")
    if not resp:
        return False
    frame_urls = resp.get("frame_urls") or []
    if not frame_urls:
        su = resp.get("storage_urls") or {}
        frame_urls = [su[k] for k in sorted(su) if k.startswith("frame_")]
    biome, obj = t["biome"], t["obj"]
    existing = variant_count(state, biome, obj)
    good = []   # (index, data)
    for i, url in enumerate(frame_urls):
        if existing + len(good) >= MAX_VARIANTS:
            break
        data = fetch_bytes(url)
        if valid_png(data):
            good.append((i, data))
        else:
            log.info(f"  {key}: candidate {i} rejected by validation")
    if not good:
        log.warning(f"{key}: no valid candidates")
        return True  # nothing to select; treat call as done
    sel, code = api_call("POST", f"objects/{obj_id}/select-frames",
                         {"indices": [i for i, _ in good],
                          "common_tag": f"f5_{biome}_{obj}"})
    track_usage(state, sel)
    created = (sel or {}).get("created_object_ids") or []
    for n, (idx, data) in enumerate(good):
        v = existing + n
        save_png(data, variant_path(biome, obj, v))
        state["variants"][f"{biome}/{obj}/v{v:03d}"] = {
            "object_id": created[n] if n < len(created) else None,
            "png": True, "biome": biome, "obj": obj, "v": v,
        }
    log.info(f"{key}: kept {len(good)} variants ({biome}/{obj} now {existing + len(good)})")
    return True


def finalize_state(state, key, t, job):
    """Batch edit job completed: images[] map 1:1 to sent_vs order."""
    last = (job or {}).get("last_response") or {}
    images = last.get("images") or []
    sent = t.get("sent_vs") or t["vs"][:9]
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
            save_png(data, state_path(t["biome"], t["obj"], t["state"], v))
            n += 1
        else:
            log.warning(f"{key}: v{v:03d} output rejected by validation")
    log.info(f"state {key}: saved {n}/{len(sent)}")
    if n < len(sent):
        # retry only the still-missing variants
        t["vs"] = [v for v in sent if not state_path(t["biome"], t["obj"], t["state"], v).exists()]
        return False
    return True


def finalize_anim(state, key, t, job):
    last = job.get("last_response") or {}
    frames = last.get("frames") or last.get("images") or []
    if not frames:
        for k, val in last.items():
            if isinstance(val, list) and len(val) >= 4:
                frames = val
                break
    d = anim_dir(t["biome"], t["obj"], t["v"])
    n = 0
    for i, fr in enumerate(frames):
        data = None
        if isinstance(fr, str):
            if fr.startswith("http"):
                data = fetch_bytes(fr)
            else:
                raw = fr.split("base64,")[-1]
                try:
                    data = base64.b64decode(raw)
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
    if n >= ANIM_FRAME_COUNT:
        return True
    log.warning(f"{key}: only {n} frames extracted")
    return n > 0


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def penalize_submit_failure(t, key, code):
    """Rate-limit starvation (429/529) and connection failures (0) are not the
    task's fault — leave pending with no retry penalty. Only definitive HTTP
    errors (400/404/422...) count toward permanent failure."""
    if code in (429, 529, 0):
        return
    t["retries"] = t.get("retries", 0) + 1
    if t["retries"] >= MAX_RETRIES:
        t["status"] = "failed"
        log.error(f"{key}: failed permanently (HTTP {code})")


def pick_next(state, phases, only_type):
    """Priority: base > states > anims. Returns (kind, key, task) or None."""
    if "base" in phases:
        for key, t in state["base_calls"].items():
            if t["status"] != "pending" or (only_type and t["obj"] != only_type):
                continue
            # adaptive early-stop: target reached -> skip remaining calls
            if variant_count(state, t["biome"], t["obj"]) >= MAX_VARIANTS:
                t["status"] = "skipped"
                continue
            return "base", key, t
    if "states" in phases:
        for key, t in state["states"].items():
            if t["status"] == "pending" and (not only_type or t["obj"] == only_type):
                return "state", key, t
    if "anims" in phases:
        for key, t in state["anims"].items():
            if t["status"] == "pending" and (not only_type or t["obj"] == only_type):
                return "anim", key, t
    return None


def base_type_complete(state, biome, obj):
    if variant_count(state, biome, obj) >= MAX_VARIANTS:
        return True
    keys = [f"{biome}/{obj}/c{c}" for c in range(MAX_BASE_CALLS)]
    return all(state["base_calls"].get(k, {}).get("status") in ("done", "failed", "skipped") for k in keys)


def run(phases, only_type, dry_run):
    state = load_state()
    ensure_tasks(state, only_type)
    if "anims" in phases:
        spawn_anim_tasks(state, only_type)
    # respawn states for types whose base already finished (e.g. resume)
    for biome, obj in all_types():
        if only_type and obj != only_type:
            continue
        if base_type_complete(state, biome, obj):
            spawn_state_tasks(state, biome, obj)
    save_state(state, force=True)

    if dry_run:
        report(state)
        return

    inflight = {}  # key -> {kind, task, submitted}

    # Re-adopt previously queued jobs after restart
    for kind, table in (("base", state["base_calls"]), ("state", state["states"]), ("anim", state["anims"])):
        for key, t in table.items():
            if t.get("status") == "queued" and (not only_type or t.get("obj") == only_type):
                if kind in ("anim", "state") and not t.get("job_id"):
                    t["status"] = "pending"
                    continue
                inflight[f"{kind}:{key}"] = {"kind": kind, "key": key, "task": t, "submitted": time.time()}

    log.info(f"Starting. inflight(adopted)={len(inflight)}")
    idle_ticks = 0

    while True:
        # ---- submit up to MAX_INFLIGHT ----
        while len(inflight) < MAX_INFLIGHT and credits_ok(state):
            nxt = pick_next(state, phases, only_type)
            if not nxt:
                break
            kind, key, t = nxt
            if kind == "base":
                resp, code = submit_base(t)
                track_usage(state, resp)
                if resp and resp.get("object_id"):
                    t["status"] = "queued"
                    t["object_id"] = resp["object_id"]
                    t["job_id"] = resp.get("background_job_id")
                    inflight[f"base:{key}"] = {"kind": "base", "key": key, "task": t, "submitted": time.time()}
                    log.info(f"base {key} -> {t['object_id']} ({resp.get('n_frames')} candidates)")
                else:
                    penalize_submit_failure(t, key, code)
            elif kind == "state":
                resp, code = submit_state(t)
                track_usage(state, resp)
                job_id = (resp or {}).get("background_job_id")
                if job_id:
                    t["status"] = "queued"
                    t["job_id"] = job_id
                    inflight[f"state:{key}"] = {"kind": "state", "key": key, "task": t, "submitted": time.time()}
                    log.info(f"state batch {key} -> job {job_id} ({len(t.get('sent_vs') or [])} images)")
                else:
                    penalize_submit_failure(t, key, code)
            elif kind == "anim":
                resp, code = submit_anim(t)
                track_usage(state, resp)
                job_id = (resp or {}).get("background_job_id") or (resp or {}).get("id")
                if job_id:
                    t["status"] = "queued"
                    t["job_id"] = job_id
                    inflight[f"anim:{key}"] = {"kind": "anim", "key": key, "task": t, "submitted": time.time()}
                else:
                    penalize_submit_failure(t, key, code)
            save_state(state)
            time.sleep(SUBMIT_DELAY)
            if code in (429, 529, 0) and not (resp or {}):
                break  # API saturated/unreachable: stop submitting, go poll instead

        if not inflight:
            nxt = pick_next(state, phases, only_type)
            if not nxt:
                log.info("All work complete (or parked).")
                break
            if not credits_ok(state):
                time.sleep(60)
                continue
            idle_ticks += 1
            if idle_ticks > 3:
                log.warning("No inflight jobs and nothing submittable; stopping.")
                break
            continue
        idle_ticks = 0

        time.sleep(POLL_INTERVAL)

        # ---- poll ----
        done_keys = []
        for ikey, info in list(inflight.items()):
            kind, key, t = info["kind"], info["key"], info["task"]
            age = time.time() - info["submitted"]
            try:
                if kind == "base":
                    resp, code = api_call("GET", f"objects/{t['object_id']}")
                    if resp is None and code == 404:
                        t["status"] = "pending"
                        t["retries"] = t.get("retries", 0) + 1
                        done_keys.append(ikey)
                        continue
                    status = (resp or {}).get("status")
                    if status in ("review", "completed"):
                        if finalize_base(state, key, t):
                            t["status"] = "done"
                            done_keys.append(ikey)
                            if base_type_complete(state, t["biome"], t["obj"]):
                                spawn_state_tasks(state, t["biome"], t["obj"])
                                if "anims" in phases:
                                    spawn_anim_tasks(state, t["obj"])
                    elif status == "failed":
                        t["status"] = "pending"
                        t["retries"] = t.get("retries", 0) + 1
                        if t["retries"] >= MAX_RETRIES:
                            t["status"] = "failed"
                        done_keys.append(ikey)
                elif kind in ("anim", "state"):
                    job, code = api_call("GET", f"background-jobs/{t['job_id']}")
                    status = (job or {}).get("status")
                    if status == "completed":
                        ok = (finalize_anim(state, key, t, job) if kind == "anim"
                              else finalize_state(state, key, t, job))
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
            except Exception as e:
                log.error(f"poll {ikey}: {e}")
            if ikey in inflight and ikey not in done_keys and age > JOB_TIMEOUT:
                log.warning(f"{ikey}: stuck {int(age)}s -> requeue")
                t["status"] = "pending"
                t["retries"] = t.get("retries", 0) + 1
                if t["retries"] >= MAX_RETRIES:
                    t["status"] = "failed"
                done_keys.append(ikey)
        for k in done_keys:
            inflight.pop(k, None)
        save_state(state)

    save_state(state, force=True)
    report(state)


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def count_statuses(table):
    out = {}
    for t in table.values():
        s = t.get("status", "?")
        out[s] = out.get(s, 0) + 1
    return out


def report(state):
    n_var = sum(1 for i in state["variants"].values() if i.get("png"))
    per_type = {}
    for i in state["variants"].values():
        if i.get("png"):
            k = f"{i['biome']}/{i['obj']}"
            per_type[k] = per_type.get(k, 0) + 1
    done_types = sum(1 for v in per_type.values() if v >= MAX_VARIANTS)
    log.info("=" * 60)
    log.info(f"base calls:  {count_statuses(state['base_calls'])}")
    log.info(f"variants on disk: {n_var} | types at {MAX_VARIANTS}: {done_types}/48 | types started: {len(per_type)}/48")
    log.info(f"states:      {count_statuses(state['states'])}")
    log.info(f"anims:       {count_statuses(state['anims'])}")
    log.info(f"spend:       ${state['spend']['usd']:.2f} across {state['spend']['calls']} calls")
    log.info("=" * 60)


def main():
    global API_KEY
    ap = argparse.ArgumentParser()
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--phase", default="all", choices=["all", "base", "states", "anims"])
    ap.add_argument("--type", default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    OBJ_DIR.mkdir(parents=True, exist_ok=True)
    API_KEY = get_api_key()

    if args.status:
        report(load_state())
        return

    phases = ["base", "states", "anims"] if args.phase == "all" else [args.phase]
    run(phases, args.type, args.dry_run)


if __name__ == "__main__":
    main()
