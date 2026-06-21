#!/usr/bin/env python3
"""
_gen_grassland_apertures.py — Aperture assets for the grassland pilot (decoupled doors).

Generates:
  1. south_doorway__normal.png per grassland WALL material — the wall with an empty doorway
     cut in the centre (dark threshold, no door, molding cut to the floor). Edited from the
     material's south_base via edit-images-v2 (proven endpoint).
  2. A SHARED door-leaf library (a few styles) — standalone closed door panels on transparent
     background, via create-1-direction-object (sidescroller / front elevation).

The leaf is later normalised (scripts/_normalize_door_leaves.py) and the renderer composites it
over the doorway opening with a procedural hinge swing.

Resumable: skips any output PNG already on disk. Run:
  python scripts/_gen_grassland_apertures.py
"""
import base64, importlib.util as ilu, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = ilu.spec_from_file_location('bg', ROOT / 'scripts' / 'bulk_generate_buildings.py')
bg = ilu.module_from_spec(spec); spec.loader.exec_module(bg)
bg.API_KEY = bg.get_api_key()

WALL_DIR = ROOT / 'assets' / 'pixelab' / 'buildings' / 'walls' / 'grassland'
LEAF_DIR = ROOT / 'assets' / 'pixelab' / 'buildings' / 'doors'
MATERIALS = ['wattle_daub', 'timber_frame', 'fieldstone', 'cob']

DOORWAY_PROMPT = (
    "Cut a tall OPEN DOORWAY through the centre of this wall: an empty doorway opening with a "
    "dark interior threshold visible through it, NO door installed, reaching from the very bottom "
    "floor edge up to about three-quarters of the wall height, the wall material forming a simple "
    "frame/jambs around the opening, and the bottom molding/foundation course cut away across the "
    "doorway so the floor is flush — just an empty passage.")

# shared, material-agnostic door leaves (front elevation, transparent background)
LEAVES = {
    'plank':       "a single tall CLOSED wooden plank door panel, front view, vertical planks, "
                   "black iron hinges down the LEFT edge and an iron ring handle on the right, the "
                   "door leaf ONLY on a transparent background, no wall, no frame, no opening, "
                   "high fantasy pixel art, saturated, detailed shading",
    'ledged':      "a single tall CLOSED wooden ledged-and-braced door (Z-brace) panel, front "
                   "view, diagonal brace, iron hinges on the LEFT edge, the door leaf ONLY on a "
                   "transparent background, no wall, no frame, high fantasy pixel art, saturated",
    'arched':      "a single tall CLOSED wooden door panel with an arched/rounded top, front view, "
                   "iron studs and hinges on the LEFT edge, the door leaf ONLY on a transparent "
                   "background, no wall, no frame, high fantasy pixel art, saturated, detailed",
}

SIZE = 128
POLL = 6
TIMEOUT = 600


def poll_object(obj_id):
    t0 = time.time()
    while time.time() - t0 < TIMEOUT:
        resp, code = bg.api_call('GET', f'objects/{obj_id}')
        st = (resp or {}).get('status')
        if st in ('review', 'completed'):
            return resp
        if st == 'failed':
            return None
        time.sleep(POLL)
    return None


def poll_job(job_id):
    t0 = time.time()
    while time.time() - t0 < TIMEOUT:
        job, code = bg.api_call('GET', f'background-jobs/{job_id}')
        st = (job or {}).get('status')
        if st == 'completed':
            return job
        if st == 'failed':
            return None
        time.sleep(POLL)
    return None


def gen_doorway(mat):
    out = WALL_DIR / mat / 'south_doorway__normal.png'
    if bg.valid_png_file(out):
        print(f'  skip (exists) {mat}/south_doorway'); return
    src = WALL_DIR / mat / 'south_base__normal.png'
    if not bg.valid_png_file(src):
        print(f'  MISSING base {mat}/south_base'); return
    b64 = base64.b64encode(src.read_bytes()).decode('ascii')
    resp, code = bg.api_call('POST', 'edit-images-v2', {
        'method': 'edit_with_text',
        'edit_images': [{'image': {'base64': b64}, 'width': SIZE, 'height': SIZE}],
        'image_size': {'width': SIZE, 'height': SIZE},
        'description': DOORWAY_PROMPT, 'no_background': True})
    job_id = (resp or {}).get('background_job_id')
    if not job_id:
        print(f'  submit FAIL {mat}/south_doorway (HTTP {code})'); return
    job = poll_job(job_id)
    imgs = ((job or {}).get('last_response') or {}).get('images') or []
    for fr in imgs:
        data = bg._decode(fr)
        if bg.valid_png(data):
            bg.save_png(data, out); print(f'  OK {mat}/south_doorway'); return
    print(f'  download FAIL {mat}/south_doorway')


def gen_leaf(style, prompt):
    out = LEAF_DIR / f'{style}.png'
    if bg.valid_png_file(out):
        print(f'  skip (exists) leaf/{style}'); return
    resp, code = bg.api_call('POST', 'create-1-direction-object',
                             {'description': prompt, 'size': SIZE, 'view': 'sidescroller'})
    obj_id = (resp or {}).get('object_id')
    if not obj_id:
        print(f'  submit FAIL leaf/{style} (HTTP {code})'); return
    r = poll_object(obj_id)
    urls = (r or {}).get('frame_urls') or []
    if not urls:
        su = (r or {}).get('storage_urls') or {}
        urls = [su[k] for k in sorted(su) if k.startswith('frame_')] or ([su['unknown']] if su.get('unknown') else [])
    chosen = None
    for i, u in enumerate(urls):
        data = bg.fetch_bytes(u)
        if bg.valid_png(data):
            bg.save_png(data, out); chosen = i; print(f'  OK leaf/{style}'); break
    if chosen is not None and len(urls) > 1:
        bg.api_call('POST', f'objects/{obj_id}/select-frames', {'indices': [chosen], 'common_tag': f'door_leaf_{style}'})
    if chosen is None:
        print(f'  download FAIL leaf/{style}')


def main():
    print('== doorway openings (per wall material) ==')
    for m in MATERIALS:
        gen_doorway(m)
    print('== shared door leaves ==')
    for style, prompt in LEAVES.items():
        gen_leaf(style, prompt)
    print('done.')


if __name__ == '__main__':
    main()
