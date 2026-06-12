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
# Stubs — implemented in Task 9
# ---------------------------------------------------------------------------

def report_status(batch: dict):
    sys.exit("report_status: not yet implemented (Task 9)")


def run(batch: dict, args):
    sys.exit("run: not yet implemented (Task 9)")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
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
    if args.status:
        report_status(batch); return  # implemented in Task 9
    check_gate(batch)
    run(batch, args)                  # implemented in Task 9


if __name__ == "__main__":
    main()
