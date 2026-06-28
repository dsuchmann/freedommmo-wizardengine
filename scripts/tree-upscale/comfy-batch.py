#!/usr/bin/env python3
"""
comfy-batch.py — Component E of the tree-upscale pipeline.

Resumable batch harness that drives a LOCAL ComfyUI over the WHOLE static tree
corpus (base + lifecycle-state variants) and produces crisp, palette-locked,
1-bit-alpha 384px native pixel-art sprites WITH AI-synthesized detail.

Mirrors the proven structure of scripts/bulk_generate_f6.py (resumable via a
_state.json, disk-first "never redo a done file", --status / --dry-run,
--biome / --type filters). NO credit guard — ComfyUI is local/free.

PIPELINE PER STATIC SPRITE (every v0NN.png under large_flora, BOTH the base
variants <biome>/<type>/v0NN.png AND the lifecycle states
<biome>/<type>/_states/<state>/v0NN.png; anim/ frames are NOT static sprites and
are skipped):

  1. load comfy-graph.json; deep-template the five tokens:
       __INPUT_IMAGE__   abs path of the source (uploaded to ComfyUI /input first;
                         the LoadImage node references it by basename)
       __POSITIVE__      per-type prompt (PROMPT / PROMPT_NAME_OVERRIDE /
                         BIOME_PROMPTS, mirroring bulk_generate_f6)
       __DENOISE__       img2img denoise (~0.40 — keep silhouette, add detail)
       __TILE_STRENGTH__ ControlNet-Tile strength (~0.60)
       __SEED__          integer (re-rolled on QA retry)
     __SEED__/__DENOISE__/__TILE_STRENGTH__ live in the JSON as quoted strings so
     plain text-substitution is valid JSON; they are coerced back to numbers
     before POST (ComfyUI wants real numbers there).
  2. POST the graph to ComfyUI http://127.0.0.1:8188/prompt; poll
     /history/<prompt_id>; fetch the SaveImage output via /view.
  3. re-pixelation TAIL: node repixelate.mjs --in <up> --out <final> --res 384
     --palette palettes/<biome>.png  (deterministic crispness; NOT the model).
  4. QA: node qa-upscale.mjs --final <final> --source <src> --palette <pal>
     (exit 0 = PASS).
  5. on QA FAIL: retry with a new seed up to MAX_RETRIES, else log + skip.
  6. write outputs next to sources as v0NN@384.png and record in _state.json.

Concurrency is bounded (MAX_INFLIGHT, default 2) because ComfyUI is one GPU.

OUTPUT LAYOUT (documented):
  Outputs sit NEXT TO their source with an @384 suffix, so the 384 corpus is
  trivially discoverable by `find ... -name 'v*@384.png'` and never collides
  with the 192 source:
    base:   <biome>/<type>/v0NN.png            -> <biome>/<type>/v0NN@384.png
    state:  .../_states/<state>/v0NN.png        -> .../_states/<state>/v0NN@384.png
  The intermediate AI upscale (pre-repixelation) is staged in a temp dir and
  discarded; only the crisp final is kept.

Usage:
  python scripts/tree-upscale/comfy-batch.py                  # full corpus
  python scripts/tree-upscale/comfy-batch.py --status         # progress report
  python scripts/tree-upscale/comfy-batch.py --dry-run        # enumerate + template ONE, no HTTP
  python scripts/tree-upscale/comfy-batch.py --biome forest
  python scripts/tree-upscale/comfy-batch.py --type oak
  python scripts/tree-upscale/comfy-batch.py --biome forest --type oak
"""

import argparse
import json
import logging
import os
import sys
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

REPO_ROOT = Path(__file__).resolve().parents[2]
TOOL_DIR = Path(__file__).resolve().parent
FLORA_DIR = REPO_ROOT / "assets" / "pixelab" / "landscape_v2" / "micro" / "large_flora"
GRAPH_FILE = TOOL_DIR / "comfy-graph.json"
PALETTE_DIR = TOOL_DIR / "palettes"
DEMO_PALETTE = REPO_ROOT / "tools" / "_repixel_demo" / "palette.png"  # fallback until per-biome palettes land
REPIXELATE = TOOL_DIR / "repixelate.mjs"
QA_SCRIPT = TOOL_DIR / "qa-upscale.mjs"
STATE_FILE = TOOL_DIR / "_comfy_batch_state.json"
LOG_FILE = TOOL_DIR / "_comfy_batch.log"

COMFY_HOST = os.environ.get("COMFY_HOST", "http://127.0.0.1:8188")
MAX_INFLIGHT = 2            # ComfyUI is one GPU — keep at most this many prompts queued at once
POLL_INTERVAL = 3          # seconds between /history polls
JOB_TIMEOUT = 600          # a single 192->384 detail-add should never take >10 min
MAX_RETRIES = 3            # QA-fail re-rolls (new seed each) before we log + skip
OUT_RES = 384              # native px grid of the produced sprite
DENOISE = 0.40             # img2img: low enough to keep silhouette, high enough to add detail
TILE_STRENGTH = 0.60       # ControlNet-Tile: locks composition to the source
BASE_SEED = 1              # seed for attempt 0; retries use BASE_SEED + attempt*step (see seed_for)
SEED_STEP = 100003         # large prime so consecutive retries land far apart in seed-space

# Token names in comfy-graph.json (must match the file exactly).
TOK_IMAGE = "__INPUT_IMAGE__"
TOK_POSITIVE = "__POSITIVE__"
TOK_DENOISE = "__DENOISE__"
TOK_TILE = "__TILE_STRENGTH__"
TOK_SEED = "__SEED__"

OUT_SUFFIX = "@384"        # v0NN.png -> v0NN@384.png
OUT_TAG = ""               # optional tag appended to outputs (v###@384<tag>.png) for A/B tuning
FORCE = False              # --force: reprocess even if an output already exists
SRC_PALETTE_COLORS = 64    # per-source palette size: quantize each sprite's OWN colors
INCLUDE_ANIMS = True       # include anim/ frames; set False with --no-anims for a fast statics-only pass

# ---------------------------------------------------------------------------
# Prompt table — mirrors bulk_generate_f6's PROMPT / BIOME_PROMPTS /
# PROMPT_NAME_OVERRIDE so the detail-add stays on-theme per tree type+biome.
# Tuned for img2img detail-ADD (not fresh gen): emphasise crisp pixel-art bark/
# leaf texture, NOT composition (ControlNet-Tile already locks composition).
# ---------------------------------------------------------------------------

PROMPT = ("top-down pixel art {obj}, crisp clean pixel-art shading, "
          "detailed bark and foliage texture, rich saturated colors, "
          "high fantasy game asset, sharp blocky pixels, no anti-aliasing")

BIOME_PROMPTS = {
    "forest":          "in a temperate deciduous forest",
    "dense_forest":    "in a dark dense old-growth forest, thick canopy",
    "tropical_forest": "in a lush tropical rainforest, humid and green",
    "grassland":       "standing alone in open rolling grassland",
    "mountains":       "on a rocky mountain slope, wind-battered",
    "savanna":         "in dry golden African savanna, scattered trees",
    "swamp":           "in a dark murky swamp with standing water and hanging moss",
    "taiga":           "in a cold boreal taiga forest, snow-dusted",
    "beach":           "on a sandy tropical beach near the shore",
    "steppe":          "on a windswept treeless steppe, vast open plain",
    "desert":          "in a hot arid desert landscape, sand and rock",
    "hills":           "on gentle rolling green hills, pastoral countryside",
    "volcanic":        "on volcanic terrain with ash and lava flows, harsh barren land",
    "mystic":          "in an enchanted mystical forest, ethereal glowing atmosphere",
    "tundra":          "on frozen tundra, permafrost, sparse stunted vegetation",
    "arctic":          "in an arctic ice landscape, extreme cold, snow and ice",
}

PROMPT_NAME_OVERRIDE = {
    "bald_cypress":    "tall bald cypress tree with hanging Spanish moss",
    "ancient_oak":     "massive ancient gnarled oak tree",
    "hollow_elm":      "large hollow elm tree with a dark opening",
    "banana_palm":     "tall banana palm tree with large fronds",
    "palm_tree":       "tall tropical palm tree with coconuts",
    "driftwood_tree":  "weathered silvery driftwood dead tree, sculptural",
    "lone_elm":        "solitary wind-bent elm tree, sparse leaves",
    "wind_oak":        "wind-sculpted oak tree, leaning from constant wind",
    "saguaro_cactus":  "tall saguaro cactus with arms, desert icon",
    "joshua_tree":     "twisted Joshua tree with spiky fronds",
    "date_palm":       "tall date palm tree with hanging fruit clusters",
    "field_oak":       "broad spreading field oak tree, pastoral",
    "charred_trunk":   "charred and blackened tree trunk, still standing, volcanic",
    "lava_palm":       "bizarre fire-resistant palm near lava, red-orange fronds",
    "crystal_tree":    "crystalline magical tree, translucent glowing branches",
    "glowing_ancient": "massive ancient tree with glowing magical aura and runes",
    "krummholz_pine":  "stunted wind-bent krummholz pine, low and twisted",
    "dwarf_willow":    "tiny arctic dwarf willow, ground-hugging",
    "frozen_birch":    "white birch tree encased in ice and frost",
    "ice_pine":        "frozen pine tree covered in thick icicles and snow",
}

# Lifecycle-state descriptor folded into the prompt for _states/<state>/ sprites,
# so the detail-add reinforces (not fights) the state the sprite already depicts.
STATE_PROMPTS = {
    "seedling":  "tiny young seedling sprout, small and delicate",
    "wilting":   "wilting and drooping, desaturated faded dry leaves",
    "dead":      "dead and withered, dry brown brittle bare branches",
    "burned":    "burned and charred, blackened with ash and embers",
    "frozen":    "frozen solid, encased in ice crystals and frost",
    "enchanted": "enchanted with a glowing arcane aura and magical sparkles",
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(),
              logging.FileHandler(LOG_FILE, encoding="utf-8")],
)
log = logging.getLogger("comfy-batch")


# ---------------------------------------------------------------------------
# Corpus enumeration — DISK-FIRST. The source of truth is the PNGs on disk, not
# a hardcoded catalog: every static v0NN.png under large_flora is a job, except
# anim/ frames and already-produced @384 outputs.
# ---------------------------------------------------------------------------

def is_static_source(p: Path) -> bool:
    """A tree sprite we should upscale: a base/state variant v###.png OR an animation
    frame anim/wind_sway/v###/frame_###.png — anim frames are just more 192px images,
    run through the identical pipeline. Excludes already-produced @384 outputs."""
    if p.suffix.lower() != ".png":
        return False
    if "@384" in p.stem:                     # already an @384 output (any tag)
        return False
    name = p.stem
    if name.startswith("frame_") and name[6:].isdigit():
        return INCLUDE_ANIMS                 # anim frame — gated by --no-anims
    return name.startswith("v") and name[1:].isdigit()


def biome_type_of(p: Path):
    """Recover (biome, type) from a path under large_flora/<biome>/<type>/...
    Works for both base (<biome>/<type>/v.png) and state
    (<biome>/<type>/_states/<state>/v.png) sources."""
    rel = p.relative_to(FLORA_DIR).parts
    # rel[0]=biome, rel[1]=type, then either v.png or _states/<state>/v.png
    biome = rel[0]
    obj = rel[1]
    return biome, obj


def kind_of(p: Path) -> str:
    return "state" if "_states" in p.parts else "base"


def output_path(src: Path) -> Path:
    """v0NN.png -> v0NN@384<tag>.png, in the SAME directory as the source."""
    return src.with_name(f"{src.stem}{OUT_SUFFIX}{OUT_TAG}.png")


def f6_state():
    """The F6 generator's live state (_f6_state.json), or None if absent/unreadable."""
    sf = FLORA_DIR / "_f6_state.json"
    if not sf.exists():
        return None
    try:
        return json.loads(sf.read_text(encoding="utf-8"))
    except Exception:
        return None


F6_ANIM_MIN_FRAMES = 8   # an anim variant is "complete" once its dir holds >= this many frames (F6 = 8-9)


def _anim_done(anim_dir):
    """True if anim_dir holds a full set of source frame PNGs (not @384, not partial)."""
    if not anim_dir.is_dir():
        return False
    n = sum(1 for f in anim_dir.iterdir()
            if f.suffix.lower() == '.png' and f.stem.startswith('frame_') and '@384' not in f.stem)
    return n >= F6_ANIM_MIN_FRAMES


def complete_f6_types():
    """Set of 'biome/obj' types whose generation is COMPLETE, judged PURELY from disk — NO reliance on
    _f6_state.json, whose 'status' AND state-variant plan are BOTH unreliable for the current generator
    (status frozen at the old bulk run; states on disk are 1 variant/state vs the old plan's 9). A type is
    ready when: it has base variants, EVERY base variant has a complete anim dir (>= F6_ANIM_MIN_FRAMES
    frames), and it has at least one populated _states/<state>/ subdir. The anim check is the real guard
    (no half-generated anim can end up mixed 192/384); states are static fallbacks so 'present' suffices.
    Self-correcting: as the generator finishes a type's anims on disk, it flips to ready on the next scan."""
    ready = set()
    if not FLORA_DIR.exists():
        return ready
    for bd in FLORA_DIR.iterdir():
        if not bd.is_dir() or bd.name.startswith('_'):
            continue
        for od in bd.iterdir():
            if not od.is_dir():
                continue
            base = {f.stem for f in od.glob("v*.png") if f.stem[1:].isdigit() and '@384' not in f.stem}
            if not base:
                continue
            aroot = od / "anim" / "wind_sway"
            if not aroot.is_dir() or not all(_anim_done(aroot / v) for v in base):
                continue                                              # a base variant's anim missing/partial
            sdir = od / "_states"
            if not sdir.is_dir() or not any(s.is_dir() and any(s.glob("v*.png")) for s in sdir.iterdir()):
                continue                                              # no states yet
            ready.add(bd.name + '/' + od.name)
    return ready


def all_f6_types():
    """Every 'biome/obj' the generator plans to produce (from _f6_state.json), or None."""
    d = f6_state()
    if d is None:
        return None
    return {v['biome'] + '/' + v['obj'] for v in d.get('variants', {}).values()}


def enumerate_corpus(only_biome=None, only_type=None, ready_only=False):
    """Return a sorted list of source Paths to process, applying filters.
    Disk-first: globs the real tree on disk. ready_only=True keeps ONLY fully-generated types."""
    out = []
    if not FLORA_DIR.exists():
        return out
    ready = complete_f6_types() if ready_only else None
    for p in FLORA_DIR.rglob("*.png"):       # v###.png (base/state) + frame_###.png (anim); predicate filters
        if not is_static_source(p):
            continue
        biome, obj = biome_type_of(p)
        if only_biome and biome != only_biome:
            continue
        if only_type and obj != only_type:
            continue
        if ready is not None and (biome + '/' + obj) not in ready:
            continue
        out.append(p)
    # Process base sprites FIRST, then states, then the (much larger) anim frames — so a full
    # run upgrades the visible trees in ~15 min and the animations fill in after, rather than
    # burying the base behind 576 frames.
    out.sort(key=lambda p: ("anim" in p.parts, "_states" in p.parts, str(p)))
    return out


def palette_for(biome: str) -> Path:
    """Per-biome palette path. Falls back to the proven demo palette until the
    per-biome palettes are generated (sibling component), so the pipeline is
    runnable today. Logged once per biome."""
    pal = PALETTE_DIR / f"{biome}.png"
    if pal.exists():
        return pal
    return DEMO_PALETTE


# ---------------------------------------------------------------------------
# Prompt building
# ---------------------------------------------------------------------------

def build_prompt(biome: str, obj: str, src: Path) -> str:
    tree_desc = PROMPT_NAME_OVERRIDE.get(obj, obj.replace("_", " "))
    biome_desc = BIOME_PROMPTS.get(biome, "")
    full = f"{tree_desc} {biome_desc}".strip()
    prompt = PROMPT.format(obj=full)
    # state sprites: append the lifecycle descriptor so detail-add stays on-state
    if kind_of(src) == "state":
        state = src.parent.name  # .../_states/<state>/v.png
        sd = STATE_PROMPTS.get(state)
        if sd:
            prompt = f"{prompt}, {sd}"
    return prompt


def seed_for(attempt: int) -> int:
    # Deterministic per-attempt seed so a resumed run reproduces the same try,
    # but each QA re-roll lands far away in seed-space.
    return BASE_SEED + attempt * SEED_STEP


# ---------------------------------------------------------------------------
# Graph templating — the core of step (1). String-substitute the five tokens in
# the RAW JSON text, then re-parse; finally coerce seed/denoise/strength back to
# numbers (they live as quoted strings in the file so the substitution is valid
# JSON, but ComfyUI requires real numbers there).
# ---------------------------------------------------------------------------

def load_graph_text() -> str:
    return GRAPH_FILE.read_text(encoding="utf-8")


def template_graph(graph_text: str, *, image_name: str, positive: str,
                   denoise: float, tile_strength: float, seed: int) -> dict:
    """Substitute all five placeholders and return a POST-ready graph dict.
    Raises if any placeholder survives (templating must be total)."""
    txt = graph_text
    # __INPUT_IMAGE__ and __POSITIVE__ are string values -> JSON-escape them.
    txt = txt.replace(TOK_IMAGE, json.dumps(image_name)[1:-1])      # escape, keep inside existing quotes
    txt = txt.replace(TOK_POSITIVE, json.dumps(positive)[1:-1])
    # Numeric tokens sit inside quotes in the file ("__SEED__"): replace the
    # token text, then strip the now-redundant quotes by parsing + coercing.
    txt = txt.replace(TOK_DENOISE, str(denoise))
    txt = txt.replace(TOK_TILE, str(tile_strength))
    txt = txt.replace(TOK_SEED, str(seed))

    leftover = [t for t in (TOK_IMAGE, TOK_POSITIVE, TOK_DENOISE, TOK_TILE, TOK_SEED) if t in txt]
    if leftover:
        raise ValueError(f"unsubstituted placeholders remain: {leftover}")

    graph = json.loads(txt)

    # Coerce the numeric inputs: they may now be the string "0.4"/"0.6"/"1"
    # (because they were "__SEED__" in the file). Walk known nodes and fix.
    for node in graph.values():
        if not isinstance(node, dict):
            continue
        ins = node.get("inputs")
        if not isinstance(ins, dict):
            continue
        for k in ("seed",):
            if k in ins and isinstance(ins[k], str):
                ins[k] = int(float(ins[k]))
        for k in ("denoise", "strength", "strength_model", "strength_clip", "cfg"):
            if k in ins and isinstance(ins[k], str):
                try:
                    ins[k] = float(ins[k])
                except ValueError:
                    pass

    # ComfyUI treats EVERY top-level key in the posted prompt as a node and calls
    # node_data.get('_meta') on it — so a documentation key like "_comment" (a plain
    # string) crashes validate_prompt with "'str' object has no attribute 'get'".
    # Keep only real nodes (dict with a class_type) so comfy-graph.json can still carry
    # a human-readable "_comment" without breaking the POST.
    graph = {k: v for k, v in graph.items() if isinstance(v, dict) and "class_type" in v}
    return graph


# ---------------------------------------------------------------------------
# ComfyUI HTTP client (step 2). Short-circuited entirely in --dry-run.
# ---------------------------------------------------------------------------

CLIENT_ID = uuid.uuid4().hex


def comfy_upload_image(src: Path) -> str:
    """POST the source PNG to ComfyUI /upload/image. Returns the server-side
    filename the LoadImage node should reference. multipart/form-data by hand
    (stdlib only, mirrors the no-deps house style)."""
    boundary = "----comfybatch" + uuid.uuid4().hex
    data = src.read_bytes()
    body = b"".join([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="image"; filename="{src.name}"\r\n'.encode(),
        b"Content-Type: image/png\r\n\r\n",
        data,
        b"\r\n",
        f"--{boundary}\r\n".encode(),
        b'Content-Disposition: form-data; name="overwrite"\r\n\r\n',
        b"true\r\n",
        f"--{boundary}--\r\n".encode(),
    ])
    req = Request(f"{COMFY_HOST}/upload/image", data=body,
                  headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
                  method="POST")
    with urlopen(req, timeout=60) as resp:
        j = json.loads(resp.read())
    # ComfyUI returns {"name": ..., "subfolder": ..., "type": "input"}
    name = j.get("name", src.name)
    sub = j.get("subfolder") or ""
    return f"{sub}/{name}" if sub else name


def comfy_submit(graph: dict) -> str:
    """POST graph to /prompt, return prompt_id."""
    body = json.dumps({"prompt": graph, "client_id": CLIENT_ID}).encode()
    req = Request(f"{COMFY_HOST}/prompt", data=body,
                  headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=60) as resp:
        j = json.loads(resp.read())
    pid = j.get("prompt_id")
    if not pid:
        raise RuntimeError(f"no prompt_id in response: {str(j)[:200]}")
    return pid


def comfy_history(pid: str):
    """GET /history/<pid>. Returns the entry dict or None if not done yet."""
    try:
        with urlopen(Request(f"{COMFY_HOST}/history/{pid}"), timeout=30) as resp:
            j = json.loads(resp.read())
    except HTTPError as e:
        if e.code == 404:
            return None
        raise
    return j.get(pid)


def comfy_fetch_output(entry: dict) -> bytes:
    """Pull the SaveImage output image bytes from a finished /history entry."""
    outputs = entry.get("outputs", {})
    for node_out in outputs.values():
        for img in node_out.get("images", []):
            fn = img.get("filename")
            sub = img.get("subfolder", "")
            typ = img.get("type", "output")
            if not fn:
                continue
            qs = urllib.parse.urlencode({"filename": fn, "subfolder": sub, "type": typ})
            with urlopen(Request(f"{COMFY_HOST}/view?{qs}"), timeout=60) as resp:
                return resp.read()
    raise RuntimeError("no SaveImage output image in history entry")


# ---------------------------------------------------------------------------
# Tail + QA (steps 3-4) — shell out to the sibling node scripts.
# ---------------------------------------------------------------------------

def source_palette(src: Path, dest: Path, colors: int = SRC_PALETTE_COLORS):
    """Per-SOURCE remap palette: quantize THIS sprite's OWN opaque colors. The shared
    per-biome palette is built from the green base trees, so off-base states (burned
    reds/blacks, frozen blues, enchanted teals) snap to green and get tinted/crunched.
    Remapping to the source's own colors keeps every state faithful."""
    import subprocess
    subprocess.run(["magick", str(src), "-alpha", "off", "-colors", str(colors), str(dest)],
                   check=True, capture_output=True)


def run_repixelate(up_png: Path, final_png: Path, palette: Path, source: Path):
    import subprocess
    # --source: the SDXL output is a solid RGB square; the tail re-applies the
    # ORIGINAL sprite's 1-bit alpha so the cutout matches the game's expectation.
    cmd = ["node", str(REPIXELATE), "--in", str(up_png), "--out", str(final_png),
           "--res", str(OUT_RES), "--palette", str(palette), "--source", str(source)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"repixelate failed: {r.stderr or r.stdout}")


def run_qa(final_png: Path, source: Path, palette: Path) -> tuple[bool, str]:
    import subprocess
    cmd = ["node", str(QA_SCRIPT), "--final", str(final_png),
           "--source", str(source), "--palette", str(palette)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode == 0, (r.stdout or r.stderr).strip()


# ---------------------------------------------------------------------------
# State (resumable) — disk-first. _state.json is a cache/log; the authority for
# "is this file done" is output_path(src).exists().
# ---------------------------------------------------------------------------

def load_state() -> dict:
    if STATE_FILE.exists():
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {"done": {}, "failed": {}, "stats": {"produced": 0, "skipped": 0}}


_last_save = 0.0

def save_state(state: dict, force=False):
    global _last_save
    if not force and time.time() - _last_save < 5:
        return
    tmp = STATE_FILE.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=1)
    # Windows transiently locks STATE_FILE (another reader, AV scan, or a 2nd batch run) -> os.replace
    # raises PermissionError/WinError 32. State-save is best-effort: outputs are already on disk and a
    # re-run skips them, so retry briefly and NEVER let a failed save crash the whole batch.
    for _ in range(10):
        try:
            os.replace(tmp, STATE_FILE)
            break
        except PermissionError:
            time.sleep(0.3)
    else:
        try:
            os.remove(tmp)
        except OSError:
            pass
        print(f"[WARN] {STATE_FILE.name} locked by another process; continued without saving state",
              flush=True)
        return
    _last_save = time.time()


def src_key(src: Path) -> str:
    return str(src.relative_to(FLORA_DIR)).replace("\\", "/")


# ---------------------------------------------------------------------------
# Process one sprite end-to-end (steps 1-6). Returns "produced"|"skipped"|"failed".
# ---------------------------------------------------------------------------

def process_one(state: dict, src: Path, graph_text: str) -> str:
    key = src_key(src)
    if not src.exists():
        # Source vanished between enumeration and now (e.g. a transient 9th/reference anim
        # frame trimmed back to the canonical 8). Skip instantly instead of 3x ComfyUI-retry.
        log.info(f"{key}: source no longer on disk -> skip")
        return "skipped"
    out = output_path(src)
    biome, obj = biome_type_of(src)
    palette = palette_for(biome)

    # disk-first short-circuit: skip a previously-produced output ONLY if it still
    # PASSES QA. A killed/buggy run can leave a bad @384 on disk; don't let "it
    # exists" mask a reject — re-validate, and reprocess if stale.
    if not FORCE and out.exists() and out.stat().st_size > 200:
        import tempfile
        with tempfile.TemporaryDirectory(prefix="comfy-rev-") as _td:
            _pal = Path(_td) / "srcpal.png"
            try:
                source_palette(src, _pal)
            except Exception:
                _pal = palette
            ok, _ = run_qa(out, src, _pal)
        if ok:
            state["done"][key] = {"out": src_key(out)}
            return "skipped"
        out.unlink()  # stale/failed output — drop it and regenerate below

    positive = build_prompt(biome, obj, src)

    import tempfile
    for attempt in range(MAX_RETRIES):
        seed = seed_for(attempt)
        graph = template_graph(graph_text, image_name=src.name, positive=positive,
                               denoise=DENOISE, tile_strength=TILE_STRENGTH, seed=seed)
        try:
            uploaded = comfy_upload_image(src)
            # LoadImage references the basename; re-template with the server name
            graph = template_graph(graph_text, image_name=uploaded, positive=positive,
                                   denoise=DENOISE, tile_strength=TILE_STRENGTH, seed=seed)
            pid = comfy_submit(graph)
            log.info(f"{key}: submitted prompt {pid} (attempt {attempt+1}/{MAX_RETRIES}, seed {seed})")
            entry = None
            t0 = time.time()
            while time.time() - t0 < JOB_TIMEOUT:
                entry = comfy_history(pid)
                if entry and entry.get("outputs"):
                    break
                time.sleep(POLL_INTERVAL)
            if not entry or not entry.get("outputs"):
                log.warning(f"{key}: timed out waiting for ComfyUI (attempt {attempt+1})")
                continue
            up_bytes = comfy_fetch_output(entry)
        except (HTTPError, URLError, OSError, RuntimeError) as e:
            log.warning(f"{key}: ComfyUI error (attempt {attempt+1}): {e}")
            time.sleep(5)
            continue

        with tempfile.TemporaryDirectory(prefix="comfy-up-") as td:
            up_png = Path(td) / "up.png"
            up_png.write_bytes(up_bytes)
            # per-source palette (this sprite's own colors) — keeps off-base states faithful
            pal = Path(td) / "srcpal.png"
            try:
                source_palette(src, pal)
            except Exception:
                pal = palette  # fall back to the biome palette if quantize fails
            try:
                run_repixelate(up_png, out, pal, src)
            except RuntimeError as e:
                log.warning(f"{key}: repixelate failed (attempt {attempt+1}): {e}")
                continue
            ok, qa_out = run_qa(out, src, pal)
            if ok:
                state["done"][key] = {"out": src_key(out), "seed": seed, "attempt": attempt}
                state["stats"]["produced"] += 1
                log.info(f"{key}: PASS -> {src_key(out)} (seed {seed})")
                return "produced"
            log.warning(f"{key}: QA FAIL (attempt {attempt+1}/{MAX_RETRIES}): {qa_out[:200]}")
            # leave the failed output in place for inspection; next attempt overwrites

    # exhausted retries
    state["failed"][key] = {"reason": "qa_fail_or_error", "attempts": MAX_RETRIES}
    state["stats"]["skipped"] += 1
    log.error(f"{key}: SKIPPED after {MAX_RETRIES} attempts")
    return "failed"


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

def run(only_biome, only_type, limit=None, ready_only=False):
    state = load_state()
    graph_text = load_graph_text()
    if ready_only:
        ready = complete_f6_types()
        allt = all_f6_types()
        if ready is None:
            log.warning("--ready: no _f6_state.json found -> treating ALL types as ready")
        else:
            log.info(f"--ready gate: {len(ready)}/{len(allt or ready)} F6 types fully generated on disk "
                     f"(base+states+anims) -> processing those; the rest wait for PixelLab")
    sources = enumerate_corpus(only_biome, only_type, ready_only=ready_only)
    if limit:
        sources = sources[:limit]
    log.info(f"Corpus: {len(sources)} sprites to consider"
             f"{f' (biome={only_biome})' if only_biome else ''}"
             f"{f' (type={only_type})' if only_type else ''}"
             f"{' [READY-ONLY]' if ready_only else ''}")

    # Bounded concurrency is conceptually MAX_INFLIGHT, but each sprite's tail+QA
    # is serial and short; the real GPU bound is one prompt at a time in ComfyUI.
    # We process sequentially here (MAX_INFLIGHT prompts would interleave their
    # uploads/polls); a future optimization can pipeline up to MAX_INFLIGHT.
    n_done = n_skip = n_fail = 0
    for src in sources:
        result = process_one(state, src, graph_text)
        if result == "produced":
            n_done += 1
        elif result == "skipped":
            n_skip += 1
        else:
            n_fail += 1
        save_state(state)
    save_state(state, force=True)
    log.info(f"Run complete: produced={n_done} skipped(done)={n_skip} failed={n_fail}")
    report(state, only_biome, only_type)
    return n_done


def watch_run(only_biome, only_type, interval_min):
    """Kick once, walk the whole F6 corpus in completeness order: process every fully-generated type,
    then poll _f6_state.json for newly-finished types and process them too, until all are done (or Ctrl+C).
    Lets the upscale run continuously ALONGSIDE PixelLab generation (different compute) without ever
    touching a half-generated type."""
    import time
    while True:
        produced = run(only_biome, only_type, ready_only=True)
        ready = complete_f6_types() or set()
        allt = all_f6_types() or set()
        if allt and ready >= allt and produced == 0:
            log.info(f"watch: all {len(allt)} F6 types complete and upscaled — done.")
            return
        remaining = (len(allt) - len(ready)) if allt else '?'
        log.info(f"watch: {len(ready)}/{len(allt) if allt else '?'} types ready, {remaining} still "
                 f"generating; sleeping {interval_min} min then re-checking...")
        time.sleep(max(1, interval_min) * 60)


# ---------------------------------------------------------------------------
# --dry-run: enumerate the real corpus + template ONE asset's graph, NO HTTP.
# ---------------------------------------------------------------------------

def dry_run(only_biome, only_type, ready_only=False):
    sources = enumerate_corpus(only_biome, only_type, ready_only=ready_only)
    n_base = sum(1 for p in sources if kind_of(p) == "base")
    n_state = sum(1 for p in sources if kind_of(p) == "state")

    # breakdown by biome/type
    by_bt = {}
    for p in sources:
        b, o = biome_type_of(p)
        by_bt[f"{b}/{o}"] = by_bt.get(f"{b}/{o}", 0) + 1

    biomes_in_scope = sorted({k.split("/")[0] for k in by_bt})
    have_pal = [b for b in biomes_in_scope if (PALETTE_DIR / f"{b}.png").exists()]

    print("=" * 64)
    print("DRY RUN - tree-upscale corpus enumeration (no ComfyUI calls)")
    print("=" * 64)
    print(f"flora dir:        {FLORA_DIR}")
    print(f"static sprites:   {len(sources)}  (base={n_base}, states={n_state})")
    print(f"biome/type pairs: {len(by_bt)}")
    print(f"output naming:    v0NN.png -> v0NN{OUT_SUFFIX}.png (next to source)")
    print(f"comfy host:       {COMFY_HOST}  (MAX_INFLIGHT={MAX_INFLIGHT})")
    print(f"denoise={DENOISE}  tile_strength={TILE_STRENGTH}  res={OUT_RES}")
    if len(have_pal) == len(biomes_in_scope) and biomes_in_scope:
        palette_state = "per-biome palettes/<biome>.png (all present)"
    elif have_pal:
        palette_state = (f"MIXED: {len(have_pal)}/{len(biomes_in_scope)} biomes have a palette; "
                         f"rest fall back to demo palette ({DEMO_PALETTE.name})")
    else:
        palette_state = (f"FALLBACK demo palette ({DEMO_PALETTE.name}) "
                         f"- per-biome palettes/<biome>.png not generated yet")
    print(f"palette source:   {palette_state}")
    print("-" * 64)
    print("per biome/type (count of static sprites):")
    for k in sorted(by_bt):
        print(f"  {k:38s} {by_bt[k]:4d}")
    print("-" * 64)

    if not sources:
        print("No sources matched the filter - nothing to template.")
        return

    # Template ONE asset and print the resolved node set, proving all 5 tokens
    # substitute. Prefer a BASE variant as the sample (most representative); fall
    # back to whatever's first if the filter selected states only.
    sample = next((p for p in sources if kind_of(p) == "base"), sources[0])
    biome, obj = biome_type_of(sample)
    positive = build_prompt(biome, obj, sample)
    seed = seed_for(0)
    graph_text = load_graph_text()

    # Verify every placeholder is present in the template before substitution.
    present = {t: (t in graph_text) for t in (TOK_IMAGE, TOK_POSITIVE, TOK_DENOISE, TOK_TILE, TOK_SEED)}
    print(f"SAMPLE asset:     {src_key(sample)}")
    print(f"  biome/type:     {biome}/{obj}  (kind={kind_of(sample)})")
    print(f"  palette:        {palette_for(biome)}")
    print(f"  output:         {src_key(output_path(sample))}")
    print(f"  placeholders in template: {present}")
    print(f"  positive prompt:\n    {positive}")

    graph = template_graph(graph_text, image_name=sample.name, positive=positive,
                           denoise=DENOISE, tile_strength=TILE_STRENGTH, seed=seed)

    # Confirm no placeholder survived.
    serialized = json.dumps(graph)
    survived = [t for t in (TOK_IMAGE, TOK_POSITIVE, TOK_DENOISE, TOK_TILE, TOK_SEED) if t in serialized]
    print(f"  unsubstituted-after-templating: {survived}  ({'OK - all 5 substituted' if not survived else 'ERROR'})")
    print("-" * 64)
    print("TEMPLATED GRAPH - load-bearing nodes (resolved values):")
    # Print the nodes that carry the substituted tokens so the reviewer can see
    # the real values, not the whole graph.
    interesting = []
    for nid, node in graph.items():
        ins = node.get("inputs", {}) if isinstance(node, dict) else {}
        ct = node.get("class_type", "?") if isinstance(node, dict) else "?"
        if ct in ("LoadImage", "CLIPTextEncode", "ControlNetApply",
                  "ControlNetApplyAdvanced", "KSampler"):
            interesting.append((nid, ct, ins))
    for nid, ct, ins in sorted(interesting, key=lambda x: int(x[0])):
        # show only the inputs that received a token (or all scalar inputs)
        shown = {k: v for k, v in ins.items() if not isinstance(v, list)}
        print(f"  node {nid:>3} {ct}:")
        for k, v in shown.items():
            vs = v if not isinstance(v, str) else (v if len(v) <= 80 else v[:77] + "...")
            print(f"      {k} = {vs!r}")
    print("=" * 64)


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def report(state, only_biome=None, only_type=None):
    sources = enumerate_corpus(only_biome, only_type)
    total = len(sources)
    done = sum(1 for s in sources if output_path(s).exists() and output_path(s).stat().st_size > 200)
    failed = len(state.get("failed", {}))
    print("=" * 60)
    print("tree-upscale (Component E) - progress")
    if only_biome or only_type:
        print(f"filter: biome={only_biome} type={only_type}")
    print(f"static sprites (in scope): {total}")
    print(f"produced @384 on disk:     {done}")
    print(f"remaining:                 {total - done}")
    print(f"failed (logged in state):  {failed}")
    print(f"stats:                     {state.get('stats', {})}")
    print("=" * 60)


def main():
    global DENOISE, TILE_STRENGTH, OUT_TAG, FORCE, INCLUDE_ANIMS
    ap = argparse.ArgumentParser(description="Component E — ComfyUI tree-upscale batch harness")
    ap.add_argument("--status", action="store_true", help="Print progress and exit")
    ap.add_argument("--dry-run", action="store_true",
                    help="Enumerate corpus + template ONE asset, no ComfyUI calls")
    ap.add_argument("--biome", default=None, help="Process only this biome")
    ap.add_argument("--type", default=None, help="Process only this tree type")
    ap.add_argument("--denoise", type=float, default=None,
                    help=f"Override img2img denoise (default {DENOISE}). LOWER = closer to source / crisper leaves; higher = more invented detail.")
    ap.add_argument("--tile", type=float, default=None,
                    help=f"Override ControlNet-Tile strength (default {TILE_STRENGTH}). Higher locks composition tighter to the source.")
    ap.add_argument("--limit", type=int, default=None, help="Process at most N sprites (fast A/B tuning)")
    ap.add_argument("--force", action="store_true", help="Reprocess even if an output already exists")
    ap.add_argument("--out-tag", default="", help="Append a tag to outputs (v###@384<tag>.png) so settings don't overwrite, e.g. --out-tag -dn30")
    ap.add_argument("--no-anims", action="store_true", help="Skip anim/ frames (fast statics-only pass: base + states)")
    ap.add_argument("--ready", action="store_true", help="Process ONLY types fully generated on disk (base+states+anims per _f6_state.json); skip ones PixelLab is still rendering")
    ap.add_argument("--watch", type=int, default=0, metavar="MIN", help="Loop: process ready types, re-check every MIN min for newly-finished types, until all done (implies --ready). Kick once, walks the whole corpus.")
    args = ap.parse_args()

    if args.denoise is not None:
        DENOISE = args.denoise
    if args.tile is not None:
        TILE_STRENGTH = args.tile
    OUT_TAG = args.out_tag
    FORCE = args.force
    INCLUDE_ANIMS = not args.no_anims

    if not GRAPH_FILE.exists():
        log.error(f"missing graph template: {GRAPH_FILE}")
        sys.exit(1)

    if args.status:
        report(load_state(), args.biome, args.type)
        return
    if args.dry_run:
        dry_run(args.biome, args.type, ready_only=args.ready)
        return
    if args.watch:
        watch_run(args.biome, args.type, args.watch)
        return
    run(args.biome, args.type, args.limit, ready_only=args.ready)


if __name__ == "__main__":
    main()
