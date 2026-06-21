#!/usr/bin/env python3
"""
bulk_generate_buildings.py — Building wall + roof asset generation pipeline.

Generates the full building-asset matrix defined in
  assets/pixelab/buildings/manifest/building-materials.json
and specced in
  docs/superpowers/specs/2026-06-20-building-asset-manifest-design.md

Matrix (per the spec): 21 biomes x (4 wall + 4 roof) materials.
  Per WALL material (55 calls):
    - exterior structural (south_base, 2 corners, north_back, edge_ew) x4 wear  = 20
    - 6 windows (static)                                                        =  6
    - 6 doors x (closed + open + open/close anim)                               = 18
    - matched interior (interior_base x4 wear + archway + 2 doors x3)           = 11
  Per ROOF material (5 calls):
    - roof_top base + 3 interpolation variants + roof_fascia                    =  5
  Grand total ~= 5,040 API calls.

Mirrors the proven bulk_generate_f6.py harness:
  - REST API at https://api.pixellab.ai/v2 ; auth via PIXELLAB_API_KEY or .mcp.json
  - create-1-direction-object (base pieces, sidescroller=wall / top-down=roof)
  - edit-images-v2          (windows / doors / wear / interior, seeded from a base PNG)
  - animate-with-text-v3    (door open/close clips)
  - DISK-FIRST resumability: a valid output PNG = done, never redone.
    _buildings_state.json only tracks in-flight job ids + retry counts.
  - Concurrency cap, credits guard, PNG validation, exponential backoff.

THE GENERATION MECHANICS (square gen-size -> non-square target crop) are
deliberately TUNABLE in the PIECE_SPEC block below — finalize them empirically
during the pilot run (one biome, then mass). Default: store the raw square
generation; crop is a no-op until enabled at the pilot.

Usage:
  python scripts/bulk_generate_buildings.py --status                # progress report
  python scripts/bulk_generate_buildings.py --dry-run               # enumerate matrix, NO API calls
  python scripts/bulk_generate_buildings.py --biome grassland       # one biome (pilot)
  python scripts/bulk_generate_buildings.py --biome grassland --material fieldstone
  python scripts/bulk_generate_buildings.py --phase roof            # roofs only
  python scripts/bulk_generate_buildings.py                         # full matrix
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
BUILD_DIR = REPO_ROOT / "assets" / "pixelab" / "buildings"
MANIFEST_DIR = BUILD_DIR / "manifest"
MATERIALS_JSON = MANIFEST_DIR / "building-materials.json"
STATE_FILE = MANIFEST_DIR / "_buildings_state.json"
LOG_FILE = MANIFEST_DIR / "_buildings_run.log"
MCP_JSON = REPO_ROOT / ".mcp.json"

API_BASE = "https://api.pixellab.ai/v2"
MAX_INFLIGHT = 10
POLL_INTERVAL = 20
SUBMIT_DELAY = 2
JOB_TIMEOUT = 10800
MAX_RETRIES = 3
CREDITS_FLOOR = 3.00
CREDITS_CHECK_EVERY = 600
BALANCE_LOG_EVERY = 20
ANIM_FRAME_COUNT = 8        # v3 stores 8 generated + 1 reference = 9

# ---------------------------------------------------------------------------
# Variant vocabularies (the per-material expansion)
# ---------------------------------------------------------------------------

WEAR = {
    # "normal" is the base piece itself (not an edit).
    "weathered": "weathered and aged: faded sun-bleached surface, fine hairline cracks, "
                 "worn crumbling mortar, scattered patches of lichen, but structurally whole",
    "damaged":   "battle-damaged and crumbling: chunks broken away, deep cracks, a section "
                 "of the surface fallen to expose the inner structure, rubble at the base",
    "mossy":     "heavily overgrown: thick green moss, creeping ivy and vines climbing the "
                 "surface, damp shaded growth in every crevice",
}

# Interior surfaces weather differently (scuffs, water stains, mildew).
INTERIOR_WEAR = {
    "weathered": "scuffed and aged interior surface, faded paint/finish, worn patches near the floor",
    "damaged":   "damaged interior wall: cracked plaster, holes, dark water stains, peeling finish",
    "mossy":     "damp neglected interior: mildew, mold and creeping moss in the corners, peeling",
}

WINDOW_SHAPES = ["arched", "round", "shuttered", "lattice", "bay", "slit"]
DOOR_SHAPES   = ["plank", "iron_banded", "arched_double", "carved", "rounded", "studded"]
INTERIOR_DOOR_SHAPES = ["plank", "arched"]

ROOF_VARIANTS = 3   # roof_top__v001..v003 in addition to v000 base

# ---- edit-prompt templates (the {} fields are filled per task) -------------

def window_prompt(shape, mat_name):
    return (f"Replace the central two tiles of this {mat_name} wall with a {shape.replace('_',' ')} "
            f"window: glass set in a frame in the upper-middle above head height, the wall "
            f"material continuing as cap above and foundation below, 2 tiles wide, seamless edges.")

def door_closed_prompt(shape, mat_name):
    return (f"Replace the central two tiles of this {mat_name} wall with a tall CLOSED "
            f"{shape.replace('_',' ')} door: the doorway reaches from the floor up to near the "
            f"ceiling (about 3 tiles / 96px tall) so a person can walk through, framed in the wall "
            f"material, 2 tiles wide, arch or lintel at the top.")

def door_open_prompt(shape, mat_name):
    return (f"The same {shape.replace('_',' ')} doorway with the door now standing WIDE OPEN, "
            f"swung inward, revealing a dark interior threshold beyond; frame and wall unchanged.")

def door_anim_action(shape):
    return f"the {shape.replace('_',' ')} door swinging open from fully closed to fully open"

def interior_face_prompt(mat_name):
    return (f"The INTERIOR face of this {mat_name} wall as seen from inside a room: a smooth "
            f"finished surface (plaster or wood paneling in keeping with the material), warmer "
            f"tone, NO exterior weather staining, a subtle baseboard at the bottom and trim at the top.")

def interior_archway_prompt(mat_name):
    return (f"Cut an OPEN interior archway passage through this {mat_name} interior wall: no door, "
            f"always passable, 2 tiles wide, a clean framed opening reaching near ceiling height.")

def interior_door_closed_prompt(shape, mat_name):
    return (f"An interior {shape.replace('_',' ')} door, CLOSED, set in this {mat_name} interior "
            f"wall, reaching near ceiling height, 2 tiles wide, simple interior frame.")

def interior_door_open_prompt(shape, mat_name):
    return (f"The same interior {shape.replace('_',' ')} door now standing OPEN into a dark "
            f"adjoining room; frame and wall unchanged.")

def roof_variant_prompt(mat_name):
    return (f"A natural variation of the same {mat_name} roof: slightly different tile/thatch "
            f"pattern and weathering, still a seamless tileable top-down roof texture, no ground.")

def roof_fascia_prompt(mat_name):
    return (f"The vertical EDGE FASCIA of this {mat_name} roof seen face-on: the drop/overhang "
            f"face where the roof meets the wall below, a horizontal band of {mat_name} roofing "
            f"edge, side elevation, tileable horizontally, alpha background.")

# ---------------------------------------------------------------------------
# PIECE_SPEC — generation mechanics per piece-class. TUNE AT PILOT.
#   gen_size : square px sent to PixelLab (it only generates square)
#   target   : (w, h) the renderer ultimately wants (crop applied at integration)
#   view     : "sidescroller" (front elevation, walls) | "top-down" (roofs)
# ---------------------------------------------------------------------------

PIECE_SPEC = {
    "wall_base":   {"gen_size": 128, "target": (32, 128),  "view": "sidescroller"},
    "wall_wide":   {"gen_size": 128, "target": (64, 128),  "view": "sidescroller"},  # windows/doors/archway
    "wall_north":  {"gen_size": 128, "target": (32, 64),   "view": "sidescroller"},
    "wall_edge":   {"gen_size": 128, "target": (32, 32),   "view": "sidescroller"},
    "roof_top":    {"gen_size": 64,  "target": (64, 64),   "view": "top-down"},
    "roof_fascia": {"gen_size": 64,  "target": (64, 64),   "view": "sidescroller"},
}

# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(),
              logging.FileHandler(LOG_FILE, encoding="utf-8")] if MANIFEST_DIR.exists()
             else [logging.StreamHandler()],
)
log = logging.getLogger("buildings")

API_KEY = None


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


def api_call(method, path, body=None, timeout=120):
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
    return None, last_code


def fetch_bytes(url):
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0 (buildings-pipeline)"}), timeout=60) as resp:
                return resp.read()
        except Exception as e:
            log.warning(f"download failed ({attempt+1}/3): {e}")
            time.sleep(5)
    return None


def valid_png(data) -> bool:
    if not data or len(data) < 200 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return False
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data)).convert("RGBA")
        alpha = im.getchannel("A")
        hist = alpha.histogram()
        opaque = sum(hist[16:])
        total = im.width * im.height
        # walls/doors fill most of the frame; roofs are full-bleed textures.
        # Floor 0.5%, no upper cap (roof textures legitimately have ~no alpha).
        return opaque > total * 0.005
    except ImportError:
        return True
    except Exception:
        return False


def valid_png_file(p: Path) -> bool:
    try:
        return p.exists() and p.stat().st_size > 200 and valid_png(p.read_bytes())
    except Exception:
        return False


def save_png(data, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as f:
        f.write(data)


# ---------------------------------------------------------------------------
# Task graph — built from building-materials.json
#
# A task is a dict:
#   id     : stable unique string
#   kind   : "base" | "edit" | "anim"
#   spec   : PIECE_SPEC key (gen_size / view)
#   out    : Path to the output PNG (or, for anim, the frame directory)
#   src    : Path to the source PNG that must exist first (None for roots)
#   prompt : description (base) or edit_description (edit) or action (anim)
#   group  : (biome, role, material) for filtering / reporting
#
# DONE  = output exists & valid on disk.
# READY = not done AND (src is None OR src valid on disk).
# ---------------------------------------------------------------------------

def wall_dir(biome, mat):  return BUILD_DIR / "walls" / biome / mat
def roof_dir(biome, mat):  return BUILD_DIR / "roof" / biome / mat


def build_tasks(materials, only_biomes=None, only_materials=None, phases=None):
    """only_biomes / only_materials: None (all) or a set of ids to include."""
    phases = phases or {"base", "states", "doors", "anims", "roof"}
    tasks = []

    def add(tid, kind, spec, out, src, prompt, group):
        tasks.append({"id": tid, "kind": kind, "spec": spec, "out": out,
                      "src": src, "prompt": prompt, "group": group})

    for biome, bdata in materials["biomes"].items():
        if only_biomes and biome not in only_biomes:
            continue

        # ---- WALL materials ----
        for m in bdata.get("walls", []):
            mat, name = m["slug"], m["name"]
            if only_materials and mat not in only_materials:
                continue
            d = wall_dir(biome, mat)
            g = (biome, "wall", mat)
            base = d / "south_base__normal.png"

            # 1. base column (root)
            if "base" in phases:
                add(f"{biome}/{mat}/south_base__normal", "base", "wall_base",
                    base, None, m["prompt"], g)

            if "states" in phases:
                # 2. south_base wear
                for w, wp in WEAR.items():
                    add(f"{biome}/{mat}/south_base__{w}", "edit", "wall_base",
                        d / f"south_base__{w}.png", base, wp, g)
                # 3. corners (per wear, seeded from matching south_base wear)
                for side, side_word in (("west", "left"), ("east", "right")):
                    for w in ["normal", *WEAR.keys()]:
                        srcp = base if w == "normal" else d / f"south_base__{w}.png"
                        add(f"{biome}/{mat}/south_corner_{side}__{w}", "edit", "wall_base",
                            d / f"south_corner_{side}__{w}.png", srcp,
                            f"Add a vertical {side_word} corner-return molding to this wall edge, "
                            f"the wall material wrapping the corner.", g)
                # 4. north_back (per wear)
                for w in ["normal", *WEAR.keys()]:
                    srcp = base if w == "normal" else d / f"south_base__{w}.png"
                    add(f"{biome}/{mat}/north_back__{w}", "edit", "wall_north",
                        d / f"north_back__{w}.png", srcp,
                        "Reduce to a back/rear wall face: top cap plus upper wall only, less "
                        "detail, as seen from behind the building.", g)
                # 5. edge_ew (per wear)
                for w in ["normal", *WEAR.keys()]:
                    srcp = base if w == "normal" else d / f"south_base__{w}.png"
                    add(f"{biome}/{mat}/edge_ew__{w}", "edit", "wall_edge",
                        d / f"edge_ew__{w}.png", srcp,
                        "A thin wall edge cap: just the top-of-wall sliver and a sliver of side "
                        "material, for the east/west building edge seen edge-on.", g)
                # 6. windows (static, seeded from base)
                for shp in WINDOW_SHAPES:
                    add(f"{biome}/{mat}/south_window__{shp}", "edit", "wall_wide",
                        d / f"south_window__{shp}.png", base, window_prompt(shp, name), g)

            # 7. doors (closed -> open -> anim)
            if "doors" in phases:
                for shp in DOOR_SHAPES:
                    closed = d / f"south_door__{shp}.png"
                    add(f"{biome}/{mat}/south_door__{shp}", "edit", "wall_wide",
                        closed, base, door_closed_prompt(shp, name), g)
                    add(f"{biome}/{mat}/south_door__{shp}__open", "edit", "wall_wide",
                        d / f"south_door__{shp}__open.png", closed, door_open_prompt(shp, name), g)
                if "anims" in phases:
                    for shp in DOOR_SHAPES:
                        closed = d / f"south_door__{shp}.png"
                        add(f"{biome}/{mat}/anim/door_open/{shp}", "anim", "wall_wide",
                            d / "anim" / "door_open" / shp, closed, door_anim_action(shp), g)

            # 8. interior (matched per exterior)
            if "states" in phases:
                int_base = d / "interior_base__normal.png"
                add(f"{biome}/{mat}/interior_base__normal", "edit", "wall_base",
                    int_base, base, interior_face_prompt(name), g)
                for w, wp in INTERIOR_WEAR.items():
                    add(f"{biome}/{mat}/interior_base__{w}", "edit", "wall_base",
                        d / f"interior_base__{w}.png", int_base, wp, g)
                add(f"{biome}/{mat}/interior_archway", "edit", "wall_wide",
                    d / "interior_archway.png", int_base, interior_archway_prompt(name), g)
                for shp in INTERIOR_DOOR_SHAPES:
                    iclosed = d / f"interior_door__{shp}.png"
                    add(f"{biome}/{mat}/interior_door__{shp}", "edit", "wall_wide",
                        iclosed, int_base, interior_door_closed_prompt(shp, name), g)
                    add(f"{biome}/{mat}/interior_door__{shp}__open", "edit", "wall_wide",
                        d / f"interior_door__{shp}__open.png", iclosed,
                        interior_door_open_prompt(shp, name), g)
            if "doors" in phases and "anims" in phases:
                for shp in INTERIOR_DOOR_SHAPES:
                    iclosed = d / f"interior_door__{shp}.png"
                    add(f"{biome}/{mat}/anim/interior_door_open/{shp}", "anim", "wall_wide",
                        d / "anim" / "interior_door_open" / shp, iclosed,
                        f"the interior {shp} door swinging open", g)

        # ---- ROOF materials ----
        if "roof" in phases:
            for m in bdata.get("roofs", []):
                mat, name = m["slug"], m["name"]
                if only_materials and mat not in only_materials:
                    continue
                d = roof_dir(biome, mat)
                g = (biome, "roof", mat)
                v0 = d / "roof_top__v000.png"
                add(f"{biome}/{mat}/roof_top__v000", "base", "roof_top",
                    v0, None, m["prompt"], g)
                for i in range(1, ROOF_VARIANTS + 1):
                    add(f"{biome}/{mat}/roof_top__v{i:03d}", "edit", "roof_top",
                        d / f"roof_top__v{i:03d}.png", v0, roof_variant_prompt(name), g)
                add(f"{biome}/{mat}/roof_fascia", "edit", "roof_fascia",
                    d / "roof_fascia.png", v0, roof_fascia_prompt(name), g)

    return tasks


def task_done(t) -> bool:
    if t["kind"] == "anim":
        out = t["out"]
        if not out.exists():
            return False
        frames = list(out.glob("frame_*.png"))
        return len(frames) >= ANIM_FRAME_COUNT and all(f.stat().st_size > 200 for f in frames)
    return valid_png_file(t["out"])


def task_ready(t) -> bool:
    if t["src"] is None:
        return True
    return valid_png_file(t["src"])


# ---------------------------------------------------------------------------
# State (in-flight jobs + retries only; disk is the source of truth for done)
# ---------------------------------------------------------------------------

def load_state():
    if STATE_FILE.exists():
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"jobs": {}, "spend": {"usd": 0.0, "calls": 0}}


_last_save = 0.0

def save_state(state, force=False):
    global _last_save
    if not force and time.time() - _last_save < 5:
        return
    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".json.tmp")
    with open(tmp, "w") as f:
        json.dump(state, f, indent=1)
    os.replace(tmp, STATE_FILE)
    _last_save = time.time()


def track_usage(state, resp):
    if not resp:
        return
    u = resp.get("usage")
    if isinstance(u, dict):
        try:
            state["spend"]["usd"] += float(u.get("usd") or u.get("amount") or 0)
        except (TypeError, ValueError):
            pass
    state["spend"]["calls"] += 1


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
        return True
    usd = None
    cr = resp.get("credits")
    if isinstance(cr, dict):
        for k in ("usd", "amount", "remaining", "balance"):
            if isinstance(cr.get(k), (int, float)):
                usd = float(cr[k]); break
    elif isinstance(cr, (int, float)):
        usd = float(cr)
    log.info(f"[BALANCE] {json.dumps(resp)[:160]} | spent ${state['spend']['usd']:.2f} / {state['spend']['calls']} calls")
    if usd is not None and usd < CREDITS_FLOOR:
        if not _paused_logged:
            log.warning(f"*** CREDITS LOW (${usd:.2f}) — PAUSED. Top up at pixellab.ai; rechecks every {CREDITS_CHECK_EVERY//60} min. ***")
            _paused_logged = True
        return False
    _paused_logged = False
    return True


# ---------------------------------------------------------------------------
# Submit / poll / finalize
# ---------------------------------------------------------------------------

def submit(state, t):
    """Submit a task. Returns (inflight_record | None)."""
    spec = PIECE_SPEC[t["spec"]]
    if t["kind"] == "base":
        resp, code = api_call("POST", "create-1-direction-object",
                              {"description": t["prompt"], "size": spec["gen_size"], "view": spec["view"]})
        track_usage(state, resp)
        if resp and resp.get("object_id"):
            return {"t": t, "object_id": resp["object_id"], "submitted": time.time()}
        return None
    # edit / anim -> need source PNG base64
    src = t["src"]
    if not valid_png_file(src):
        return None  # dep not ready (shouldn't happen — scheduler checks)
    b64 = base64.b64encode(src.read_bytes()).decode("ascii")
    if t["kind"] == "edit":
        gs = spec["gen_size"]
        resp, code = api_call("POST", "edit-images-v2",
                              {"method": "edit_with_text",
                               "edit_images": [{"image": {"base64": b64}, "width": gs, "height": gs}],
                               "image_size": {"width": gs, "height": gs},
                               "description": t["prompt"],
                               "no_background": True})
        track_usage(state, resp)
        job_id = (resp or {}).get("background_job_id")
        if job_id:
            return {"t": t, "job_id": job_id, "submitted": time.time()}
        return None
    if t["kind"] == "anim":
        resp, code = api_call("POST", "animate-with-text-v3",
                              {"first_frame": {"base64": b64, "format": "png"},
                               "action": t["prompt"],
                               "frame_count": ANIM_FRAME_COUNT,
                               "no_background": True})
        track_usage(state, resp)
        job_id = (resp or {}).get("background_job_id") or (resp or {}).get("id")
        if job_id:
            return {"t": t, "job_id": job_id, "submitted": time.time()}
        return None
    return None


def finalize_base(t, info):
    obj_id = info["object_id"]
    resp, code = api_call("GET", f"objects/{obj_id}")
    if not resp:
        return None  # keep polling
    status = resp.get("status")
    if status == "failed":
        return False
    if status not in ("review", "completed"):
        return None
    urls = resp.get("frame_urls") or []
    if not urls:
        su = resp.get("storage_urls") or {}
        urls = [su[k] for k in sorted(su) if k.startswith("frame_")] or \
               ([su["unknown"]] if su.get("unknown") else [])
    chosen = None
    for i, url in enumerate(urls):
        data = fetch_bytes(url)
        if valid_png(data):
            save_png(data, t["out"])
            chosen = i
            break
    if chosen is None:
        return False
    # Resolve the multi-candidate 'review' so objects don't pile up in the
    # PixelLab account (mirrors bulk_generate_f6.py:532 — only needed when the
    # generation produced multiple candidates). Best-effort; we already have the PNG.
    if len(urls) > 1:
        api_call("POST", f"objects/{obj_id}/select-frames",
                 {"indices": [chosen], "common_tag": t["id"].replace("/", "_")[:60]})
    return True


def _extract_images(last):
    return last.get("images") or last.get("frames") or []


def finalize_edit(t, job):
    last = (job or {}).get("last_response") or {}
    imgs = _extract_images(last)
    for fr in imgs:
        data = _decode(fr)
        if valid_png(data):
            save_png(data, t["out"])
            return True
    return False


def finalize_anim(t, job):
    last = (job or {}).get("last_response") or {}
    frames = _extract_images(last)
    if not frames:
        for v in last.values():
            if isinstance(v, list) and len(v) >= 4:
                frames = v; break
    n = 0
    for i, fr in enumerate(frames):
        data = _decode(fr)
        if data and len(data) > 200:
            save_png(data, t["out"] / f"frame_{i:03d}.png")
            n += 1
    return n >= ANIM_FRAME_COUNT or (n > 0 and None) or False


def _decode(fr):
    if isinstance(fr, str):
        if fr.startswith("http"):
            return fetch_bytes(fr)
        try:
            return base64.b64decode(fr.split("base64,")[-1])
        except Exception:
            return None
    if isinstance(fr, dict):
        url = fr.get("url") or fr.get("src")
        if url:
            return fetch_bytes(url)
        b64 = fr.get("base64")
        if b64:
            try:
                return base64.b64decode(b64.split("base64,")[-1])
            except Exception:
                return None
    return None


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def run(tasks, dry_run):
    state = load_state()

    pending = [t for t in tasks if not task_done(t)]
    log.info(f"{len(tasks)} total tasks | {len(tasks)-len(pending)} already on disk | {len(pending)} to do")
    if dry_run:
        report(tasks)
        return

    inflight = {}   # id -> info
    jobs = state["jobs"]
    idle = 0

    while True:
        # ---- submit ----
        while len(inflight) < MAX_INFLIGHT and credits_ok(state):
            nxt = None
            for t in pending:
                if t["id"] in inflight or task_done(t):
                    continue
                rec = jobs.get(t["id"], {})
                if rec.get("status") == "failed":
                    continue
                if task_ready(t):
                    nxt = t; break
            if not nxt:
                break
            info = submit(state, nxt)
            if info:
                inflight[nxt["id"]] = info
                jobs.setdefault(nxt["id"], {})["status"] = "queued"
                log.info(f"submit {nxt['kind']:5s} {nxt['id']}")
            else:
                rec = jobs.setdefault(nxt["id"], {})
                rec["retries"] = rec.get("retries", 0) + 1
                if rec["retries"] >= MAX_RETRIES:
                    rec["status"] = "failed"
                    log.error(f"FAILED submit {nxt['id']}")
            save_state(state)
            time.sleep(SUBMIT_DELAY)

        if not inflight:
            # anything left that's blocked only by an unfinished dep?
            remaining = [t for t in pending if not task_done(t)
                         and jobs.get(t["id"], {}).get("status") != "failed"]
            if not remaining:
                log.info("All work complete (or parked/failed).")
                break
            if not credits_ok(state):
                time.sleep(60); continue
            idle += 1
            if idle > 40:
                log.warning("Stalled too long (deps unmet or starved); stopping.")
                break
            log.info(f"Nothing runnable (tick {idle}/40) — sleeping 60s")
            time.sleep(60)
            continue
        idle = 0

        time.sleep(POLL_INTERVAL)

        # ---- poll ----
        done_ids = []
        for tid, info in list(inflight.items()):
            t = info["t"]
            age = time.time() - info["submitted"]
            try:
                if t["kind"] == "base":
                    res = finalize_base(t, info)
                else:
                    job, _ = api_call("GET", f"background-jobs/{info['job_id']}")
                    st = (job or {}).get("status")
                    if st == "completed":
                        res = finalize_anim(t, job) if t["kind"] == "anim" else finalize_edit(t, job)
                    elif st == "failed":
                        res = False
                    else:
                        res = None
                if res is True:
                    jobs[tid] = {"status": "done"}
                    done_ids.append(tid)
                    log.info(f"done   {t['id']}")
                elif res is False:
                    rec = jobs.setdefault(tid, {})
                    rec["retries"] = rec.get("retries", 0) + 1
                    rec["status"] = "failed" if rec["retries"] >= MAX_RETRIES else "pending"
                    done_ids.append(tid)
                    if rec["status"] == "failed":
                        log.error(f"FAILED {t['id']}")
                # res None -> keep polling
            except Exception as e:
                log.error(f"poll {tid}: {e}")
            if tid not in done_ids and age > JOB_TIMEOUT:
                log.warning(f"{tid}: stuck {int(age)}s -> requeue (no penalty)")
                jobs.setdefault(tid, {})["status"] = "pending"
                done_ids.append(tid)
        for k in done_ids:
            inflight.pop(k, None)
        save_state(state)

    save_state(state, force=True)
    report(tasks)


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def report(tasks):
    by_biome, kinds = {}, {"base": 0, "edit": 0, "anim": 0}
    done = 0
    for t in tasks:
        kinds[t["kind"]] += 1
        b = t["group"][0]
        d = by_biome.setdefault(b, {"total": 0, "done": 0})
        d["total"] += 1
        if task_done(t):
            d["done"] += 1
            done += 1
    log.info("=" * 64)
    log.info("Building Asset Manifest — Progress")
    log.info(f"tasks: {len(tasks)}  (base={kinds['base']} edit={kinds['edit']} anim={kinds['anim']})")
    log.info(f"on disk: {done}/{len(tasks)}  ({100*done//max(1,len(tasks))}%)")
    for b in sorted(by_biome):
        d = by_biome[b]
        mark = " [DONE]" if d["done"] >= d["total"] else ""
        log.info(f"    {b:16s} {d['done']:4d}/{d['total']:<4d}{mark}")
    log.info("=" * 64)


def main():
    global API_KEY
    ap = argparse.ArgumentParser(description="Building wall+roof PixelLab asset pipeline")
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--biome", default=None,
                    help="comma-separated biome ids (e.g. grassland,forest,desert); omit for all 21")
    ap.add_argument("--material", default=None,
                    help="comma-separated material slugs to restrict to (within --biome scope)")
    ap.add_argument("--phase", default="all",
                    choices=["all", "base", "states", "doors", "anims", "roof"])
    args = ap.parse_args()

    if not MATERIALS_JSON.exists():
        log.error(f"Missing {MATERIALS_JSON} — author the material vocabulary first.")
        sys.exit(1)
    with open(MATERIALS_JSON, encoding="utf-8") as f:
        materials = json.load(f)

    if args.phase == "all":
        phases = {"base", "states", "doors", "anims", "roof"}
    elif args.phase == "doors":
        phases = {"base", "doors"}           # doors need the base
    elif args.phase == "anims":
        phases = {"base", "doors", "anims"}  # anims need closed doors
    elif args.phase == "states":
        phases = {"base", "states"}
    else:
        phases = {args.phase}

    only_biomes = set(s.strip() for s in args.biome.split(",")) if args.biome else None
    only_materials = set(s.strip() for s in args.material.split(",")) if args.material else None
    tasks = build_tasks(materials, only_biomes, only_materials, phases)

    if args.status or args.dry_run:
        report(tasks)
        return

    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    API_KEY = get_api_key()
    run(tasks, dry_run=False)


if __name__ == "__main__":
    main()
