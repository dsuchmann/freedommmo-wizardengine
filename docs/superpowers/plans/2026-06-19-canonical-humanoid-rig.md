# Canonical Humanoid Rig Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve `src/life/rigs/humanoid.json` from the 15-bone 2D rig into the ~21-bone canonical rig (added `chest`, `neck`, `clavicle_l/r`, `toe_l/r`; pelvis DOF; sockets; per-entity proportions) **without breaking the 944 existing choreography programs**, and ship a localhost rig viewer to see/tune it.

**Architecture:** Additive enrichment validated by a pose-level regression guard. `solvePose` is pure FK with `childWorldDeg = parentWorldDeg + jointAngle`, so intermediate bones inserted at rest-angle 0 preserve every existing bone's world rotation; the regression test pins the inserted pivots so existing bones keep their world *positions* too. Sockets and proportions are pure functions over the solved pose. The viewer is a standalone HTML tool (fetch JSON + `solvePose`, no node fs), matching the project's "every field gets a tuner / something experienceable each pass" rules.

**Tech Stack:** Vanilla JS (ESM), `node:test`, Canvas2D for the viewer, the existing `src/life/rig.js` + `src/life/pose.js`. This sub-project touches the rig DATA + sim-side loader + pure pose math + viewer ONLY — the game renderer, PSCH→`locomote`, and 8-dir assets are later sub-projects.

---

## File Structure

- `src/life/rigs/humanoid.json` — **modify**: add `version:2`, the new bones (compensated offsets), sockets, joints (incl. `twist` axis), proportions block, re-weighted lookAt. v1 fields stay.
- `src/life/rig.js` — **modify**: extend `validateRig` for sockets/twist/proportions; add `applyProportions(rig, vector)`; keep v1 valid.
- `src/life/sockets.js` — **create**: `solveSockets(rig, solved)` → world transform per socket (pure).
- `test/rig-v2.test.js` — **create**: loader/validation + the v1→v2 pose regression guard + proportions + sockets.
- `tools/rig-viewer.html` — **create**: localhost skeleton + socket viewer with a program picker and proportion sliders.
- `tools/rig-viewer-smoke.cjs` — **create**: headless smoke (page loads, solves, draws non-empty).

---

## Task 1: Pose-level regression guard (write the ground-truth test FIRST)

This test is the contract: the canonical rig must produce identical world poses to v1 for every bone the existing programs drive. We author it against the CURRENT v1 rig (must pass green now), then it guards the v2 edit.

**Files:**
- Create: `test/rig-v2.test.js`

- [ ] **Step 1: Write the regression harness test (passes on v1 today)**

```js
// test/rig-v2.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { solvePose } from '../src/life/pose.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const loadRigRaw = () => JSON.parse(readFileSync(join(ROOT, 'src/life/rigs/humanoid.json'), 'utf8'));

// Flatten every `pose` op in the 944 programs into a list of {boneName: deg} states.
function allPoseStates() {
  const dir = join(ROOT, 'src/life/choreography');
  const states = [];
  for (const f of readdirSync(dir).filter(n => n.endsWith('.json'))) {
    const prog = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.op === 'pose' && node.joints) states.push({ file: f, joints: node.joints });
      for (const c of node.children ?? []) walk(c);
    };
    walk(prog.root);
  }
  return states;
}

// The set of bones any program actually drives (the contract surface).
function drivenBones(states) {
  const s = new Set();
  for (const st of states) for (const b of Object.keys(st.joints)) s.add(b);
  return s;
}

const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('regression fixture: capture v1 world poses for every driven bone', () => {
  const rig = loadRigRaw();
  const states = allPoseStates();
  assert.ok(states.length > 100, `expected many pose states, got ${states.length}`);
  const driven = drivenBones(states);
  // Every driven bone must exist in the rig (sanity).
  for (const b of driven) assert.ok(rig.bones[b], `program drives unknown bone ${b}`);
  // Solve one representative state and confirm finite output (smoke).
  const solved = solvePose(rig, states[0].joints);
  for (const b of driven) {
    assert.ok(Number.isFinite(solved[b].origin.x), `non-finite origin for ${b}`);
  }
});
```

- [ ] **Step 2: Run it on the current v1 rig**

Run: `node --test test/rig-v2.test.js`
Expected: PASS (this only asserts v1 is solvable and programs reference real bones).

- [ ] **Step 3: Add the v1-vs-v2 equivalence test (will FAIL until Task 2 ships v2)**

```js
// append to test/rig-v2.test.js
import { existsSync } from 'node:fs';
const loadRigV2 = () => JSON.parse(readFileSync(join(ROOT, 'src/life/rigs/humanoid.v2.json'), 'utf8'));

test('v2 preserves v1 world pose for every driven bone, across all programs', () => {
  if (!existsSync(join(ROOT, 'src/life/rigs/humanoid.v2.json'))) {
    assert.fail('humanoid.v2.json not yet authored (Task 2)');
  }
  const v1 = loadRigRaw(), v2 = loadRigV2();
  const states = allPoseStates();
  const driven = drivenBones(states);
  for (const st of states) {
    const s1 = solvePose(v1, st.joints);
    const s2 = solvePose(v2, st.joints);
    for (const b of driven) {
      assert.ok(approx(s1[b].origin.x, s2[b].origin.x, 1e-4), `${st.file} ${b} origin.x drift`);
      assert.ok(approx(s1[b].origin.y, s2[b].origin.y, 1e-4), `${st.file} ${b} origin.y drift`);
      assert.ok(approx(s1[b].worldDeg, s2[b].worldDeg, 1e-4), `${st.file} ${b} worldDeg drift`);
    }
  }
});
```

- [ ] **Step 4: Run — confirm the equivalence test fails (no v2 yet)**

Run: `node --test test/rig-v2.test.js`
Expected: the equivalence test FAILS with "humanoid.v2.json not yet authored".

- [ ] **Step 5: Commit**

```bash
git add test/rig-v2.test.js
git commit -m "test(rig): pose-level v1->v2 regression guard for canonical rig"
```

---

## Task 2: Author `humanoid.v2.json` (additive bones, compensated offsets)

We build v2 as a **separate file first** so the regression test compares against the untouched v1; Task 5 swaps it in. The new bones are inserted with pivots that **sum to the originals at rest**, so the regression guard passes.

**Files:**
- Create: `src/life/rigs/humanoid.v2.json`

- [ ] **Step 1: Author v2 by copying v1 and inserting the new chain**

Rules the executor MUST follow (the regression test in Task 1 is ground truth — tune pivots until it passes):
1. Keep all v1 bone names. `version: 2`.
2. Split the torso: keep `spine` (parent `root`) as the lower segment; add `chest` (parent `spine`, in REST_UP semantics — see note). Re-parent `head`→`neck`→`chest`; re-parent `arm_u_l`/`arm_u_r`→`clavicle_l`/`clavicle_r` (parent `chest`).
3. **Compensation constraint:** for each re-parented bone, the vector sum of the inserted pivots along the new chain (at rest angle 0) must equal that bone's original pivot relative to its old parent. Example for `head` (old pivot `[0,16]` off `spine`): choose `chest.pivot + neck.pivot + head.pivot = [0,16]`. For `arm_u_l` (old `[-6,14]` off `spine`): `chest.pivot + clavicle_l.pivot + arm_u_l.pivot = [-6,14]`.
4. Add `toe_l`/`toe_r` (parent `foot_l`/`foot_r`, small length ~2, pivot `[0,-len_foot]`).
5. `root` gains a joint entry (pelvis DOF): `"root": {"min":-15,"max":15,"stiffness":0.85}` (rest 0 → no effect on existing programs).
6. Add joint entries for every new bone (`chest`,`neck`,`clavicle_l/r`,`toe_l/r`) with rest-0 ranges (e.g. chest ±25, neck ±25, clavicle -15..+25 / -25..+15, toe 0..+45). All new joints rest at 0 so existing programs are unaffected.
7. Re-weight `lookAt` to sum to 1 with the new neck: `[["head",0.5],["neck",0.35],["spine",0.15]]`.

> **REST_UP note:** `pose.js` `REST_UP = ['spine','head']` makes those bones rest pointing +y. `chest` and `neck` are also upward — Task 3 adds them to `REST_UP`. Until then `solvePose` treats them as pointing -y; this only affects the *new* bones' tip (not used by the regression, which checks driven v1 bones), but Task 3 fixes it before any consumer reads chest/neck tips.

- [ ] **Step 2: Run the regression guard against v2**

Run: `node --test test/rig-v2.test.js`
Expected: the equivalence test now PASSES (all driven bones match within 1e-4). If a bone drifts, adjust that bone's chain pivots so they sum to the v1 pivot.

- [ ] **Step 3: Commit**

```bash
git add src/life/rigs/humanoid.v2.json
git commit -m "feat(rig): canonical humanoid.v2.json (additive bones, compensated offsets)"
```

---

## Task 3: Extend `REST_UP` + validator for the new bones, sockets, twist, proportions

**Files:**
- Modify: `src/life/pose.js:5`
- Modify: `src/life/rig.js:28-63`
- Modify: `test/rig-v2.test.js`

- [ ] **Step 1: Write failing validation tests**

```js
// append to test/rig-v2.test.js
import { validateRig } from '../src/life/rig.js';
test('v2 rig is valid under the extended validator', () => {
  const v2 = loadRigV2();
  assert.deepEqual(validateRig(v2), []);
});
test('v1 rig still valid (back-compat)', () => {
  assert.deepEqual(validateRig(loadRigRaw()), []);
});
```

- [ ] **Step 2: Run — confirm fail**

Run: `node --test test/rig-v2.test.js`
Expected: FAIL — validator rejects v2 (new joints may carry a `twist` field / sockets unknown), or lookAt issues.

- [ ] **Step 3: Add `chest`,`neck` to REST_UP**

```js
// src/life/pose.js:5
export const REST_UP = ['spine', 'chest', 'neck', 'head'];   // bones whose rest direction is +y
```

- [ ] **Step 4: Extend the validator (additive, v1-safe)**

In `src/life/rig.js` `validateRig`, after the existing joint loop, accept an optional `twist` sub-object on joints and validate `sockets`/`proportions` when present:

```js
// inside validateRig, joints loop: allow optional twist axis
for (const [name, j] of Object.entries(rig.joints ?? {})) {
  if (!bones[name]) v.push(`joint ${name}: no such bone`);
  if (!(j.min < j.max)) v.push(`joint ${name}: min >= max`);
  if (!(j.stiffness > 0 && j.stiffness <= 1)) v.push(`joint ${name}: stiffness out of (0,1]`);
  if (j.twist && !(j.twist.min <= j.twist.max)) v.push(`joint ${name}: twist min > max`);
}
// after the loops:
for (const [s, sk] of Object.entries(rig.sockets ?? {})) {
  if (!bones[sk.bone]) v.push(`socket ${s}: unknown bone ${sk.bone}`);
  if (!Array.isArray(sk.offset) || sk.offset.length < 2) v.push(`socket ${s}: bad offset`);
}
if (rig.proportions && !Array.isArray(rig.proportions.axes)) v.push('proportions.axes must be an array');
```

Note: the existing rule "every non-root bone needs joint limits" now requires `chest/neck/clavicle_l/r/toe_l/r` joints — already added in Task 2.

- [ ] **Step 5: Run — confirm pass**

Run: `node --test test/rig-v2.test.js`
Expected: PASS (both validity tests green; regression still green).

- [ ] **Step 6: Commit**

```bash
git add src/life/pose.js src/life/rig.js test/rig-v2.test.js
git commit -m "feat(rig): validator + REST_UP support for canonical v2 bones/sockets/twist"
```

---

## Task 4: Per-entity proportion scaling

**Files:**
- Modify: `src/life/rig.js`
- Modify: `test/rig-v2.test.js`

- [ ] **Step 1: Write failing test**

```js
// append to test/rig-v2.test.js
import { applyProportions } from '../src/life/rig.js';
import { solvePose as solve2 } from '../src/life/pose.js';
test('applyProportions scales bone lengths/pivots and lowers/raises feet', () => {
  const v2 = loadRigV2();
  const child = applyProportions(v2, { all: 0.5 });          // half-size
  assert.equal(child.bones.thigh_l.length, v2.bones.thigh_l.length * 0.5);
  // identity vector is a no-op
  const same = applyProportions(v2, {});
  assert.equal(same.bones.thigh_l.length, v2.bones.thigh_l.length);
  // foot tip y scales with the body (grounding stays consistent)
  const restJoints = {};
  const tallFoot = solve2(v2, restJoints).foot_l.tip.y;
  const shortFoot = solve2(child, restJoints).foot_l.tip.y;
  assert.ok(Math.abs(shortFoot) < Math.abs(tallFoot), 'smaller body → foot closer to root');
});
```

- [ ] **Step 2: Run — confirm fail** (`applyProportions` undefined)

Run: `node --test test/rig-v2.test.js` → FAIL

- [ ] **Step 3: Implement `applyProportions`**

```js
// src/life/rig.js — append
/** Returns a deep-scaled copy of the rig. vector = { all?, <boneOrGroup>: scalar }.
 *  Scales bone length + pivot magnitude so the whole skeleton + its sockets shrink/grow together. */
export function applyProportions(rig, vector = {}) {
  const s = (name) => vector[name] ?? vector.all ?? 1;
  const out = structuredClone(rig);
  for (const [name, b] of Object.entries(out.bones)) {
    const k = s(name);
    if (k === 1) continue;
    b.length *= k;
    b.pivot = [b.pivot[0] * k, b.pivot[1] * k];
  }
  return out;
}
```

- [ ] **Step 4: Run — confirm pass**

Run: `node --test test/rig-v2.test.js` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/life/rig.js test/rig-v2.test.js
git commit -m "feat(rig): per-entity proportion scaling (applyProportions)"
```

---

## Task 5: Socket world-transform resolution + promote v2 to the live rig

**Files:**
- Create: `src/life/sockets.js`
- Modify: `test/rig-v2.test.js`
- Modify: `src/life/rigs/humanoid.json` (promote v2 → live)

- [ ] **Step 1: Write failing socket test**

```js
// append to test/rig-v2.test.js
import { solveSockets } from '../src/life/sockets.js';
test('solveSockets places each socket on its bone with offset + rotation', () => {
  const v2 = loadRigV2();
  const solved = solvePose(v2, {});
  const sk = solveSockets(v2, solved);
  for (const name of Object.keys(v2.sockets)) {
    assert.ok(Number.isFinite(sk[name].origin.x), `socket ${name} unresolved`);
    assert.ok(Number.isFinite(sk[name].rot), `socket ${name} no rotation`);
  }
  // grip_r rides hand_r: its origin is within the hand bone span
  const hr = solved.hand_r;
  const span = Math.hypot(hr.tip.x - hr.origin.x, hr.tip.y - hr.origin.y) + 5;
  assert.ok(Math.hypot(sk.grip_r.origin.x - hr.origin.x, sk.grip_r.origin.y - hr.origin.y) <= span);
});
```

- [ ] **Step 2: Run — confirm fail**

Run: `node --test test/rig-v2.test.js` → FAIL

- [ ] **Step 3: Implement `solveSockets`**

```js
// src/life/sockets.js
const DEG = Math.PI / 180;
const rot = (a, x, y) => {
  const c = Math.cos(a * DEG), s = Math.sin(a * DEG);
  return { x: c * x - s * y, y: s * x + c * y };
};
/** For each socket {bone, offset:[x,y], rot}, return {origin:{x,y}, rot} in world space
 *  by riding the bone's solved transform. Items attach here (rot lets weapons orient/swing). */
export function solveSockets(rig, solved) {
  const out = {};
  for (const [name, sk] of Object.entries(rig.sockets ?? {})) {
    const b = solved[sk.bone];
    const off = rot(b.worldDeg, sk.offset[0], sk.offset[1] ?? 0);
    out[name] = { origin: { x: b.origin.x + off.x, y: b.origin.y + off.y }, rot: b.worldDeg + (sk.rot ?? 0) };
  }
  return out;
}
```

- [ ] **Step 4: Run — confirm pass**

Run: `node --test test/rig-v2.test.js` → PASS

- [ ] **Step 5: Promote v2 to the live rig (the cutover)**

Replace `src/life/rigs/humanoid.json` contents with `humanoid.v2.json` contents (keep the filename `humanoid.json`; delete `humanoid.v2.json`). Update the regression test's `loadRigV2` to read `humanoid.json`, and snapshot the pre-cutover v1 into `test/fixtures/humanoid.v1.json` so the regression keeps a frozen baseline.

```bash
mkdir -p test/fixtures
git show HEAD:src/life/rigs/humanoid.json > test/fixtures/humanoid.v1.json
cp src/life/rigs/humanoid.v2.json src/life/rigs/humanoid.json
rm src/life/rigs/humanoid.v2.json
```
Then point `loadRigRaw`→`test/fixtures/humanoid.v1.json` and `loadRigV2`→`src/life/rigs/humanoid.json` in the test.

- [ ] **Step 6: Run the full suite + the existing motion suites**

Run: `node --test test/rig-v2.test.js` (PASS) and the project's existing motion/validator tests (must stay green — confirms the 944 programs still validate on the live rig).
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/life/sockets.js src/life/rigs/humanoid.json test/fixtures/humanoid.v1.json test/rig-v2.test.js
git commit -m "feat(rig): socket resolution + promote canonical rig to live humanoid.json"
```

---

## Task 6: Localhost rig viewer (the visible, tunable deliverable)

**Files:**
- Create: `tools/rig-viewer.html`
- Create: `tools/rig-viewer-smoke.cjs`

- [ ] **Step 1: Build the viewer**

A standalone page (served, not `file://`) that: `fetch('../src/life/rigs/humanoid.json')`, imports `solvePose` from `../src/life/pose.js` and `solveSockets` from `../src/life/sockets.js` and `applyProportions` from `../src/life/rig.js`, then on a Canvas2D draws bones as lines (origin→tip) and sockets as labeled dots. Controls: a **program picker** (fetch a choreography JSON from `../src/life/choreography/`, step its pose states), **proportion sliders** (all + per-limb → `applyProportions`), and a **direction selector** stub (applies the renderer's `xProj`/`xSign` table so the projection reads correctly). Set `window.__rigViewerReady = { bones: N, sockets: M }` after first draw. Draw through a plain canvas (this is an out-of-world DEV TOOL/HUD, so Canvas2D is allowed — the GL-pipeline rule governs in-world rendering, which is sub-project 2).

- [ ] **Step 2: Write the headless smoke**

```js
// tools/rig-viewer-smoke.cjs  (mirror skeleton-viewer/tools/psch/smoke-gen-walk.cjs)
const puppeteer = require('puppeteer-core');
(async () => {
  const exe = process.env.PSCH_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const b = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.goto('http://localhost:8766/tools/rig-viewer.html', { waitUntil: 'networkidle0', timeout: 60000 });
  await p.waitForFunction('window.__rigViewerReady', { timeout: 60000 });
  const r = await p.evaluate(() => window.__rigViewerReady);
  console.log('RIG VIEWER SMOKE OK', JSON.stringify(r));
  if (!(r.bones >= 21 && r.sockets >= 10)) { console.error('FAIL', r); process.exit(1); }
  await b.close();
})();
```

- [ ] **Step 3: Run the smoke (serve repo root on :8766 first)**

Run: `npx http-server -p 8766 -c-1 &` then `node tools/rig-viewer-smoke.cjs`
Expected: `RIG VIEWER SMOKE OK {"bones":21,...}`

- [ ] **Step 4: Human review gate**

Open `http://localhost:8766/tools/rig-viewer.html`: confirm the skeleton reads as a humanoid, all sockets sit on the right body points, a chosen choreography animates, and proportion sliders scale the whole figure with feet staying on the baseline. (User-facing visual gate — do not self-approve.)

- [ ] **Step 5: Commit**

```bash
git add tools/rig-viewer.html tools/rig-viewer-smoke.cjs
git commit -m "feat(rig): localhost rig viewer + headless smoke"
```

---

## Self-Review

- **Spec coverage:** bones §4 → Task 2; transform/REST_UP §5 → Tasks 2-3; proportions §6 → Task 4; sockets §7 → Task 5; data contract §8 → Tasks 2-3; migration/regression §9 → Tasks 1,5; viewer (visible deliverable) → Task 6. Out-of-scope items (renderer 2.5D, PSCH→locomote, assets, combat twist) are correctly NOT in this plan.
- **Placeholders:** none — every code/test step shows code; offsets are regression-driven (Task 1 is ground truth).
- **Type consistency:** `loadRigV2`/`loadRigRaw`/`allPoseStates`/`drivenBones`/`approx` defined in Task 1 and reused; `applyProportions`/`solveSockets` signatures match across definition and tests.
- **Known risk owned:** the re-parenting pivot compensation is enforced by the Task-1 equivalence test across ALL programs, not asserted by hand.
