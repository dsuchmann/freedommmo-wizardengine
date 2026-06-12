# Pass 4 L2b — Body-Part Pilot + First Living-Entity Renderer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the per-part humanoid sprite approach with a PixelLab pilot (14 parts, adult human, south), gate it with an assembly probe, and ship the first living-entity renderer — the player avatar assembled from real part sprites at localhost:8123. **This is the first VISIBLE Pass 4 milestone.**

**Architecture:** Art pilot (controller-executed via PixelLab MCP) → hand-authored pivot meta (one-time authoring) → Python assembly probe (palette/seams/joint alignment vs the L2a rig) → node consistency probe → client renderer module (fetch rig JSON, FK rest pose via `src/life/pose.js`, draw order via `composeLayers`) → wired into `drawPlayerAt`. Pilot-gated per `scripts/asset-corpus/registry/body_parts.json` ("pilot_required") — **no mass wave fires in this plan**; wave firing belongs to the X1 art lane.

**Tech Stack:** PixelLab MCP, Python/PIL (probe), vanilla ES modules (client), node:test (probe).

---

## Context for implementers (READ FIRST)

### GIT SAFETY (non-negotiable)
- Work ONLY on branch `pass4-l2b-body-pilot`. NEVER push to origin. NEVER touch master.
- NEVER run destructive git commands (reset --hard, checkout --, clean, rebase, branch -D). NEVER amend. NEVER skip hooks.
- NEVER stage or commit: `assets/`, `.claude/`, `.playwright-mcp/`, `.superpowers/`, `scripts/bulk_generate*.py`, `*_f4_state.json`, `scripts/.bursts/`.
- **NEVER modify anything under `scripts/asset-corpus/`** — a parallel session owns that lane. Reading is fine.
- Stage files by exact name only. CRLF warnings on Windows are harmless.
- User/parallel-session commits may ride this branch — never rebase them out.

### Fixed facts (verified against working tree 2026-06-12, master 597c40456)
- **Rig** `src/life/rigs/humanoid.json` (loaded node-side by `src/life/rig.js:20` — uses `node:fs`, **client must `fetch()` the JSON instead, never import rig.js**). Rig space: +y UP, ground y≈0. Rest geometry: root pivot (0,22); spine 16 UP → (0,38); head 10 UP from (0,38)+(0,10)=(0,48), top ≈58; shoulders (±6,36) arm_u 8 / arm_f 7 / hand 3 pointing DOWN (hand tips (±6,18)); hips (±3,22) thigh 11 / shin 9 / foot 4 (foot tips (±3,−2)). Gaits: `walk {cycleTicks:40, strideFactor:0.5, bob:1.0}`, `run {cycleTicks:22, strideFactor:0.9, bob:2.0}`.
- **Pose math** `src/life/pose.js` — pure, zero imports, client-safe. `solvePose(rig, joints)` → `{bone: {origin:{x,y}, tip:{x,y}, worldDeg}}`, missing joints = 0 (rest). CCW degrees; rest direction UP for spine/head, DOWN otherwise.
- **Body data** `sim/life/body.js` — client-safe (whole import chain `rng.js → metabolism.js → composition.js → grains.js`, `identity.js`, `items/equipment.js` has zero `node:` imports). Exports: `PARTS` (14 names), `PART_BONE` (part → rig bone; torso→spine), `partKey(race,bodyType,ageBand,part,dir)` = `'race/type/band/part/dir'`, `composeLayers(plan, equipment, direction)` → ascending-z draw list (south painter order at body.js:99-100: arm_l chain, leg_l chain, leg_r chain, torso, arm_r chain, head).
- **Renderer seam**: the player is drawn by `drawPlayerAt(px, sy, zoom, player, targetCtx, skipShadow)` at `src/render/canvas-renderer.js:586` — called from BOTH the field2 depth-sorted 2D path (line 362) and the GL atlas composite path (lines 382/391), so changing `drawPlayerAt`'s body covers every mode. Inside it: `py = sy - (player?.z ?? 0)*10*zoom`; the current vector doodle (`drawModularPlayer`, line 908) spans py−10 (head top) … py+15 (feet) at zoom 1, plus a debug red dot (lines 604-606). `frame = player?.character?.frame ?? 0`, `animation = player?.character?.animation ?? 'idle'` (values seen: idle/walk/sprint/dodge_roll/glide_loop); doodle bob uses `Math.sin(frame*Math.PI/4)`.
- **Asset URL convention**: dev server serves the working tree; large objects load from `/assets/pixelab/...` (wang-image-list.js:423). Body parts will live at `/assets/pixelab/body_parts/<partKey>.png` (i.e. `.../human/average/adult/<part>/s.png`). **Assets are NEVER staged/committed** — they exist on this machine only; the renderer must degrade honestly when they are absent.
- **Registry gate** (read-only): `scripts/asset-corpus/registry/body_parts.json` — status `pilot_required`, size 64, pilot_note: "13 humanoid parts x 1 direction x adult human x few variants; assembly probe must prove seams/palette/joint alignment against the X2 rig vocabulary before any wave fires. Fallback: PixelLab character tools (full bodies + skeleton anim)." (The roster enumerates to 14 — L2a precedent.)
- **Player is not a sim humanoid**: `createPlayer` (sim/world/actions.js:35) makes a `type:'player'` node with no species. The client player object is local (`src/physics/movement.js`). The avatar's body plan is therefore CLIENT CONFIG (race human / bodyType average / ageBand adult, part scales 1) — presentation choice, not simulation state. Honest absences: no wire-carried body plans (no humanoid NPCs exist to render — L5 absent), one direction (south) until the wave fires, no equipment layers drawn (client has no equipment state), no hair/face layers.
- **One-time authoring doctrine** (binding user directive): pilot art and pivot meta are authored ONCE; the renderer only replays them. No runtime generation.

### Honest-absence rules for this plan
- Sprites missing on disk → renderer falls back to the existing `drawModularPlayer` doodle (the doodle is the pre-L2b status quo, not a mock of a body system).
- If the pilot FAILS the assembly probe → record verdict, do NOT ship a degraded part renderer; fall back path is re-planned (see Contingency).

### Conventions
- Commit after every task. Deviations from this plan are recorded in the Deviations section (canonical).
- Tests: `node --test sim/test/<file>` for single files. Full suite only at close-out.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `assets/pixelab/body_parts/human/average/adult/<part>/s.png` ×14 | create (NEVER staged) | pilot part sprites, south |
| `assets/pixelab/body_parts/_probe/` | create (NEVER staged) | probe composite + report |
| `src/life/rigs/humanoid-parts-south.json` | create (committed) | one-time-authored pivot meta: part → {pivot px, ppu} |
| `scripts/body_pilot_probe.py` | create (committed) | assembly probe: alpha/palette/seam checks + composite render |
| `sim/test/probe-body-assembly.test.js` | create (committed) | node consistency probe (meta↔rig↔PARTS↔composeLayers) |
| `src/render/humanoid-player-renderer.js` | create (committed) | sprite store + FK-posed part assembly draw |
| `src/render/canvas-renderer.js` | modify (drawPlayerAt only) | humanoid body first, doodle fallback |
| `scripts/.bursts/body_parts_pilot/pilot_pass.json` | create on PASS only (NEVER staged) | gate artifact for the X1 lane |

---

### Task 1: Pilot art generation (CONTROLLER-EXECUTED — PixelLab MCP, not a subagent)

Art generation is async MCP work with credit cost and visual judgment; the controller runs it directly (loop deviation, pre-declared).

**Files:** Create `assets/pixelab/body_parts/human/average/adult/<part>/s.png` for all 14 PARTS.

- [ ] **Step 1: Generate the 14 parts.** Use `mcp__pixellab__create_1_direction_object` (or `create_map_object` if it proves better for small props), canvas 64×64, transparent background, south/front view, per-part descriptions sharing ONE palette directive. Shared style suffix for every prompt: *"pixel art, 64x64 canvas, plain transparent background, side-lit from upper-left, limited palette: skin #e8b08a with #c98a64 shade, brown hair #5a3a22, simple cloth #4d6fb8 blue tunic / #755037 brown trousers, dark outline #2b2030. Part drawn in vertical rest orientation, centered, isolated body part for a modular paper-doll character of total height ~58 units where this part is N units."* Per-part subjects (N = rig length in units):
  - head: "human head with neck stub, front view" (10)
  - torso: "human torso chest+pelvis block in blue tunic, front" (16)
  - arm_upper_l / arm_upper_r: "upper arm, shoulder to elbow, tunic sleeve top" (8)
  - arm_fore_l / arm_fore_r: "forearm, elbow to wrist, bare skin" (7)
  - hand_l / hand_r: "small hand, relaxed" (3)
  - thigh_l / thigh_r: "thigh in brown trouser, hip to knee" (11)
  - shin_l / shin_r: "shin/calf in brown trouser, knee to ankle" (9)
  - foot_l / foot_r: "small boot/foot, side-front" (4)
  Mirror pairs may be generated once and flipped horizontally when saved (deterministic, honest — record in Deviations).
- [ ] **Step 2: Poll jobs, download, save** to `assets/pixelab/body_parts/human/average/adult/<part>/s.png` (matching `partKey(...,'s') + '.png'`). Do NOT stage anything under assets/.
- [ ] **Step 3: Eyeball gate (controller is multimodal — Read each PNG).** Reject/regenerate (≤2 retries per part) if: baked background, wrong orientation, palette wildly off, part unrecognizable. If after retries the per-part approach is clearly unworkable (parts incoherent at this size), STOP and go to Contingency.

### Task 2: Pivot meta authoring (CONTROLLER-EXECUTED — visual, one-time authoring)

**Files:** Create `src/life/rigs/humanoid-parts-south.json` (committed).

- [ ] **Step 1: Measure each PNG** (Read the image; use the Python below to get alpha bboxes):

```bash
python - <<'EOF'
from PIL import Image; import os, json
base = 'assets/pixelab/body_parts/human/average/adult'
for part in sorted(os.listdir(base)):
    im = Image.open(f'{base}/{part}/s.png').convert('RGBA')
    print(part, 'bbox', im.getbbox(), 'size', im.size)
EOF
```

- [ ] **Step 2: Author the meta.** Schema per part: `pivot: [x, y]` = source-PNG pixel (x right, y down) that maps onto the part's BONE ORIGIN (head/torso: bottom-center of the part's alpha bbox, since spine/head point UP from their origin; all limb parts: top-center of bbox, since they point DOWN); `ppu` = source pixels per rig unit = (alpha-bbox height along the bone axis) / (rig bone length). Example shape (values are authored from the real art, NOT these):

```json
{
  "direction": "s",
  "race": "human", "bodyType": "average", "ageBand": "adult",
  "parts": {
    "head":        { "pivot": [32, 52], "ppu": 3.2 },
    "torso":       { "pivot": [32, 56], "ppu": 2.4 },
    "arm_upper_l": { "pivot": [32,  8], "ppu": 3.0 },
    "arm_upper_r": { "pivot": [32,  8], "ppu": 3.0 },
    "arm_fore_l":  { "pivot": [32,  8], "ppu": 3.0 },
    "arm_fore_r":  { "pivot": [32,  8], "ppu": 3.0 },
    "hand_l":      { "pivot": [32,  6], "ppu": 3.0 },
    "hand_r":      { "pivot": [32,  6], "ppu": 3.0 },
    "thigh_l":     { "pivot": [32,  6], "ppu": 2.6 },
    "thigh_r":     { "pivot": [32,  6], "ppu": 2.6 },
    "shin_l":      { "pivot": [32,  6], "ppu": 2.6 },
    "shin_r":      { "pivot": [32,  6], "ppu": 2.6 },
    "foot_l":      { "pivot": [32, 10], "ppu": 2.6 },
    "foot_r":      { "pivot": [32, 10], "ppu": 2.6 }
  }
}
```

- [ ] **Step 3: Commit** `src/life/rigs/humanoid-parts-south.json` only: `git add src/life/rigs/humanoid-parts-south.json && git commit -m "feat(l2b): one-time-authored part pivot meta (south pilot)"`.

### Task 3: Python assembly probe (subagent OK)

**Files:** Create `scripts/body_pilot_probe.py`. Outputs to `assets/pixelab/body_parts/_probe/` (never staged).

- [ ] **Step 1: Write the probe** — full content:

```python
#!/usr/bin/env python3
"""body_pilot_probe.py - L2b assembly probe (registry gate: seams/palette/joint
alignment vs the rig). Reads the rig + pivot meta + 14 pilot PNGs, composites the
rest pose, measures palette and joint-seam coverage. Exit 0 = PASS, 1 = FAIL,
2 = assets missing. Writes _probe/composite_s.png and _probe/report.json."""
import json, os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RIG = json.load(open(os.path.join(ROOT, 'src/life/rigs/humanoid.json')))
META = json.load(open(os.path.join(ROOT, 'src/life/rigs/humanoid-parts-south.json')))
BASE = os.path.join(ROOT, 'assets/pixelab/body_parts/human/average/adult')
PROBE_DIR = os.path.join(ROOT, 'assets/pixelab/body_parts/_probe')

# painter order = body.js south order (keep in sync; node probe asserts the set)
SOUTH = ['arm_upper_l','arm_fore_l','hand_l','thigh_l','shin_l','foot_l',
         'thigh_r','shin_r','foot_r','torso','arm_upper_r','arm_fore_r','hand_r','head']
PART_BONE = {'head':'head','torso':'spine','arm_upper_l':'arm_u_l','arm_upper_r':'arm_u_r',
  'arm_fore_l':'arm_f_l','arm_fore_r':'arm_f_r','hand_l':'hand_l','hand_r':'hand_r',
  'thigh_l':'thigh_l','thigh_r':'thigh_r','shin_l':'shin_l','shin_r':'shin_r',
  'foot_l':'foot_l','foot_r':'foot_r'}
REST_UP = {'spine','head'}

def rest_origin(bone):
    x = y = 0.0
    cur = bone
    while cur is not None:
        b = RIG['bones'][cur]; x += b['pivot'][0]; y += b['pivot'][1]; cur = b['parent']
    return x, y

# joint positions (rest): child bone origins for seam checks
SEAMS = [('arm_u_l','arm_f_l'),('arm_f_l','hand_l'),('arm_u_r','arm_f_r'),('arm_f_r','hand_r'),
         ('thigh_l','shin_l'),('shin_l','foot_l'),('thigh_r','shin_r'),('shin_r','foot_r')]

S = 6  # composite px per rig unit
CW, CH = 64*S//4*4, 72*S  # canvas; ground line near bottom
GROUND_Y = CH - 4*S
CX = CW // 2

def to_canvas(rx, ry):
    return CX + rx*S, GROUND_Y - ry*S

def main():
    if not os.path.isdir(BASE):
        print('SKIP: pilot assets missing'); return 2
    report = {'parts': {}, 'palette': {}, 'seams': {}, 'verdict': 'PASS'}
    fails = []
    imgs = {}
    palette_union = set()
    per_part_colors = {}
    for part in SOUTH:
        path = os.path.join(BASE, part, 's.png')
        if not os.path.isfile(path):
            fails.append(f'{part}: missing png'); continue
        im = Image.open(path).convert('RGBA')
        bbox = im.getbbox()
        if bbox is None:
            fails.append(f'{part}: empty alpha'); continue
        imgs[part] = im
        cols = {p[:3] for p in im.getdata() if p[3] > 128}
        per_part_colors[part] = cols
        palette_union |= cols
        report['parts'][part] = {'bbox': bbox, 'colors': len(cols)}
    # palette: union bounded; skin shared between head and at least one arm part
    report['palette']['union'] = len(palette_union)
    if len(palette_union) > 96:
        fails.append(f'palette union too large: {len(palette_union)}')
    if 'head' in per_part_colors:
        arm = set().union(*(per_part_colors.get(p, set()) for p in
              ('arm_fore_l','arm_fore_r','hand_l','hand_r')))
        shared = per_part_colors['head'] & arm
        report['palette']['skin_shared'] = len(shared)
        if not shared:
            fails.append('no shared skin colors between head and arm parts')
    # composite at rest pose
    canvas = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
    for part in SOUTH:
        if part not in imgs: continue
        m = META['parts'][part]
        bone = PART_BONE[part]
        ox, oy = rest_origin(bone)
        k = S / m['ppu']
        im = imgs[part]
        w, h = round(im.width*k), round(im.height*k)
        scaled = im.resize((max(1, w), max(1, h)), Image.NEAREST)
        cxp, cyp = to_canvas(ox, oy)
        canvas.alpha_composite(scaled, (round(cxp - m['pivot'][0]*k), round(cyp - m['pivot'][1]*k)))
    os.makedirs(PROBE_DIR, exist_ok=True)
    canvas.save(os.path.join(PROBE_DIR, 'composite_s.png'))
    # seam coverage: alpha presence in a 1.5-rig-unit disc around each joint
    a = canvas.getchannel('A').load()
    for parent, child in SEAMS:
        jx, jy = rest_origin(child)
        cxp, cyp = to_canvas(jx, jy)
        r = round(1.5*S); hit = total = 0
        for dy in range(-r, r+1):
            for dx in range(-r, r+1):
                if dx*dx+dy*dy > r*r: continue
                x, y = round(cxp)+dx, round(cyp)+dy
                if 0 <= x < CW and 0 <= y < CH:
                    total += 1
                    if a[x, y] > 20: hit += 1
        cov = hit/total if total else 0
        report['seams'][f'{parent}->{child}'] = round(cov, 3)
        if cov < 0.35:
            fails.append(f'seam gap at {parent}->{child}: coverage {cov:.2f}')
    if fails:
        report['verdict'] = 'FAIL'; report['fails'] = fails
    json.dump(report, open(os.path.join(PROBE_DIR, 'report.json'), 'w'), indent=1)
    print(json.dumps(report, indent=1))
    return 0 if not fails else 1

if __name__ == '__main__':
    sys.exit(main())
```

- [ ] **Step 2: Run it**: `python scripts/body_pilot_probe.py`. Expected: composite + report written; exit 0.
- [ ] **Step 3: Iterate** — pivot/ppu tuning in `humanoid-parts-south.json` is expected (the probe exists to catch misalignment). Art regeneration goes back to the controller.
- [ ] **Step 4: Controller visual review** of `_probe/composite_s.png` (Read the image). PASS requires: probe exit 0 AND composite reads as a coherent humanoid (proportions, palette, no severed limbs).
- [ ] **Step 5: On PASS**, controller writes `scripts/.bursts/body_parts_pilot/pilot_pass.json` containing the report + `{"pilot": "body_parts", "passed_at": "<date>", "meta": "src/life/rigs/humanoid-parts-south.json"}` (untracked; the X1 lane consumes/relocates it when firing the wave — coordination point, do not touch scripts/asset-corpus/).
- [ ] **Step 6: Commit** the probe script: `git add scripts/body_pilot_probe.py && git commit -m "feat(l2b): assembly probe — palette/seam/joint-alignment gate"`.

### Task 4: Node consistency probe (subagent)

**Files:** Create `sim/test/probe-body-assembly.test.js`.

- [ ] **Step 1: Write the test** — full content:

```js
// sim/test/probe-body-assembly.test.js — L2b: meta↔rig↔PARTS↔composeLayers consistency.
// Asset PNGs are machine-local (never committed): file-presence checks SKIP when the
// pilot directory is absent (honest absence), but meta/rig invariants always run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { loadRig } from '../../src/life/rig.js';
import { PARTS, PART_BONE, partKey, composeLayers } from '../life/body.js';

const META = JSON.parse(readFileSync(new URL('../../src/life/rigs/humanoid-parts-south.json', import.meta.url)));
const ASSET_BASE = new URL('../../assets/pixelab/body_parts/human/average/adult/', import.meta.url);

test('part meta covers exactly the 14 PARTS with valid pivots', () => {
  const rig = loadRig('humanoid');
  assert.deepEqual(Object.keys(META.parts).sort(), [...PARTS].sort());
  for (const [part, m] of Object.entries(META.parts)) {
    assert.ok(Array.isArray(m.pivot) && m.pivot.length === 2, `${part}: pivot [x,y]`);
    assert.ok(m.pivot.every(v => v >= 0 && v <= 64), `${part}: pivot inside 64px canvas`);
    assert.ok(m.ppu > 0, `${part}: ppu positive`);
    assert.ok(rig.bones[PART_BONE[part]], `${part}: maps to real rig bone`);
  }
  assert.equal(META.direction, 's');
});

test('composeLayers south order is total over PARTS and z-ascending', () => {
  const plan = {
    race: 'human', bodyType: 'average', ageBand: 'adult',
    parts: Object.fromEntries(PARTS.map(p => [p, { scale: 1 }])),
  };
  const layers = composeLayers(plan, null, 's');
  const parts = layers.filter(l => l.part);
  assert.equal(parts.length, 14);
  assert.deepEqual(parts.map(l => l.part).sort(), [...PARTS].sort());
  for (let i = 1; i < layers.length; i++) assert.ok(layers[i].z >= layers[i - 1].z);
  for (const l of parts) assert.equal(l.key, partKey('human', 'average', 'adult', l.part, 's'));
});

test('pilot sprites exist on disk for every part (skips when assets absent)', (t) => {
  if (!existsSync(ASSET_BASE)) return t.skip('pilot assets not on this machine');
  for (const part of PARTS) {
    assert.ok(existsSync(new URL(`${part}/s.png`, ASSET_BASE)), `${part}/s.png present`);
  }
});
```

- [ ] **Step 2: Run**: `node --test sim/test/probe-body-assembly.test.js`. Expected: 3 pass (third skips off-machine).
- [ ] **Step 3: Commit**: `git add sim/test/probe-body-assembly.test.js && git commit -m "test(l2b): body-assembly consistency probe"`.

### Task 5: Client humanoid player renderer (subagent)

**Files:** Create `src/render/humanoid-player-renderer.js`.

- [ ] **Step 1: Write the module** — full content:

```js
// src/render/humanoid-player-renderer.js — Pass 4 L2b: the first living-entity
// renderer. Assembles the player avatar from pilot part sprites at the FK rest
// pose (walk = simple limb swing from rig gait params). Replays one-time-authored
// art + pivot meta — nothing is generated at runtime.
// HONEST ABSENCES: south direction only (pilot scope); no equipment layers
// (client has no equipment state); no hair/face layers; humanoid NPCs are not
// rendered (none exist until L5). When sprites/meta are absent the caller falls
// back to the legacy doodle (pre-L2b status quo, not a mock).
import { PARTS, PART_BONE, partKey, composeLayers } from '../../sim/life/body.js';
import { solvePose } from '../life/pose.js';

const BP_BASE = '/assets/pixelab/body_parts/';
const RIG_URL = '/src/life/rigs/humanoid.json';
const META_URL = '/src/life/rigs/humanoid-parts-south.json';
const DEG = Math.PI / 180;
const RIG_UNIT_PX = 0.55;   // ~58-unit body ≈ 32px (one tile) at zoom 1
const FEET_OFFSET = 15;     // legacy doodle feet line: py + 15*zoom (keep continuity)

// Avatar body plan is CLIENT CONFIG (player node has no species; presentation choice).
const AVATAR = {
  race: 'human', bodyType: 'average', ageBand: 'adult',
  parts: Object.fromEntries(PARTS.map(p => [p, { scale: 1 }])),
};

let rig = null, meta = null, layers = null;
const images = new Map();   // part -> HTMLImageElement | null(failed)
let started = false, failed = false;

function startLoading() {
  started = true;
  Promise.all([fetch(RIG_URL), fetch(META_URL)])
    .then(rs => Promise.all(rs.map(r => { if (!r.ok) throw new Error(r.status); return r.json(); })))
    .then(([r, m]) => {
      rig = r; meta = m;
      layers = composeLayers(AVATAR, null, 's').filter(l => l.part);
      for (const l of layers) {
        const img = new Image();
        img.src = BP_BASE + partKey(AVATAR.race, AVATAR.bodyType, AVATAR.ageBand, l.part, 's') + '.png';
        img.onload = () => images.set(l.part, img);
        img.onerror = () => images.set(l.part, null);
      }
    })
    .catch(() => { failed = true; });
}

function ready() {
  return rig && meta && layers && layers.every(l => images.get(l.part));
}

/** Walk/sprint limb swing from gait params; idle = rest. frame matches the
 *  legacy doodle's 8-frame cycle (phase = frame * PI/4). */
function jointsFor(frame, animation) {
  if (animation !== 'walk' && animation !== 'sprint') return {};
  const gait = rig.gaits[animation === 'sprint' ? 'run' : 'walk'];
  const phase = frame * Math.PI / 4;
  const leg = Math.sin(phase) * 18 * gait.strideFactor;   // walk ±9°, run ±16.2°
  const arm = -Math.sin(phase) * 12 * gait.strideFactor;  // counter-swing
  return { thigh_l: leg, thigh_r: -leg, arm_u_l: arm, arm_u_r: -arm };
}

/** Draw the assembled avatar. Returns false when not ready (caller falls back).
 *  (x, y) matches drawPlayerAt's doodle anchor: feet at y + FEET_OFFSET*zoom. */
export function drawHumanoidPlayer(ctx, x, y, zoom, frame, animation) {
  if (failed) return false;
  if (!started) { startLoading(); return false; }
  if (!ready()) return false;
  const pose = solvePose(rig, jointsFor(frame, animation));
  const gait = rig.gaits[animation === 'sprint' ? 'run' : 'walk'];
  const bob = (animation === 'walk' || animation === 'sprint')
    ? Math.abs(Math.sin(frame * Math.PI / 4)) * gait.bob * RIG_UNIT_PX * zoom : 0;
  const S = RIG_UNIT_PX * zoom;
  const groundY = y + FEET_OFFSET * zoom - bob;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const l of layers) {
    const img = images.get(l.part);
    const m = meta.parts[l.part];
    const b = pose[PART_BONE[l.part]];
    const k = (S / m.ppu) * l.scale;
    ctx.save();
    ctx.translate(x + b.origin.x * S, groundY - b.origin.y * S);
    ctx.rotate(-b.worldDeg * DEG);   // rig CCW(+y up) -> canvas (y down)
    ctx.drawImage(img, -m.pivot[0] * k, -m.pivot[1] * k, img.width * k, img.height * k);
    ctx.restore();
  }
  ctx.restore();
  return true;
}
```

- [ ] **Step 2: Verify the sim import resolves in the browser** — the dev server serves the working tree root; confirm `GET /sim/life/body.js` returns 200 (e.g. `curl -s -o /dev/null -w "%{http_code}" http://localhost:8123/sim/life/body.js`). If the server does not serve `/sim`, report BLOCKED (do not duplicate the painter order client-side).
- [ ] **Step 3: Commit**: `git add src/render/humanoid-player-renderer.js && git commit -m "feat(l2b): first living-entity renderer — FK-posed part assembly for the player avatar"`.

### Task 6: Wire-in + browser verification (subagent code; controller screenshot)

**Files:** Modify `src/render/canvas-renderer.js` (drawPlayerAt only, line 586ff).

- [ ] **Step 1: Import** (top of file, with the other render imports): `import { drawHumanoidPlayer } from './humanoid-player-renderer.js';`
- [ ] **Step 2: Replace the doodle call** at lines 603-606:

```js
    const bodyDrawn = drawHumanoidPlayer(ctx, px, py, zoom, frame, player?.character?.animation ?? 'idle');
    if (!bodyDrawn) {
      drawModularPlayer(ctx, px, py, zoom, frame, player?.character?.animation ?? 'idle');
      // Visible red dot only on the fallback path (player never invisible)
      ctx.fillStyle = '#ff3333';
      ctx.fillRect(px - 4 * zoom, py - 4 * zoom, 8 * zoom, 8 * zoom);
    }
```

(dodge_roll/glide_loop keep working: the roll rotation lives inside drawModularPlayer — for L2b the humanoid renderer draws those animations at rest pose; the ctx rotation trick is NOT replicated. Acceptable pilot scope; record in Deviations.)
- [ ] **Step 3: Run the touched probes**: `node --test sim/test/probe-body-assembly.test.js` → pass.
- [ ] **Step 4: Commit**: `git add src/render/canvas-renderer.js && git commit -m "feat(l2b): player avatar renders as assembled humanoid body (doodle fallback)"`.
- [ ] **Step 5 (controller): browser verification** at `http://localhost:8123/?x=7712&y=-224` via playwright MCP — screenshot idle + while walking; verify assembled body (not doodle, no red dot), depth sorting vs flora intact, GL mode intact. Hard-refresh/incognito (workers cache).

---

## Contingency (registry-sanctioned fallback — only if Task 1 or Task 3 FAILS)

Per-part generation judged unworkable → STOP this plan's remaining art tasks, record the verdict in Deviations + `_probe/report.json`, do NOT write pilot_pass.json. Fallback = PixelLab `create_character` (full body, 64px, south first) rendered as a whole sprite at the same `drawPlayerAt` seam; part composition + equipment layering become honest absences pending better part tooling. That is a re-plan (new short plan), not an improvisation inside this one.

## Close-out checklist
- [ ] Full suite green (background, read log only after EXIT line)
- [ ] Deviations section below filled (canonical)
- [ ] Roadmap L2 row → DONE (or pilot verdict recorded if contingency)
- [ ] Registry coordination note for X1 lane (pilot_pass.json location) in memory
- [ ] Merge to master; memory updated

## Deviations

(filled during execution; canonical over the task text above)
