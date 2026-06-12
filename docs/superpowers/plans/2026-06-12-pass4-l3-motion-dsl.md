# Pass 4 L3 — Generative Motion DSL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Headless motion system — choreography programs (authored ONCE, replayed with deterministic variant noise), pose math (FK/IK), validator, action vocabulary, planner, executor — gated by Probe M: NL "pick the berry and eat it" produces ledger deltas identical to hand-written verbs.

**Architecture:** Design authority is `docs/superpowers/specs/2026-06-12-generative-motion-dsl-design.md` (read it). Pipeline: intent phrase → planner (canonical intent registry — LLM-authored ONCE, never per-invocation, per `feedback_motion_one_time_authoring.md`) → behavior compiler (verb → choreography program) → validator (joint limits / continuity / balance / world consistency) → executor (pure pose track + kernel intents through EXISTING real verbs only). World truth moves ONLY through `sim/world/actions.js` verbs; pose frames are presentation, never in the kernel ledger.

**Tech Stack:** Plain ESM JS, `node:test`, deterministic `rand(seed,...ids)` from `sim/kernel/rng.js`. No new deps.

---

## Context for implementers (READ FIRST)

**GIT SAFETY (mandatory):** Work ONLY on branch `pass4-l3-motion-dsl`. Verify with `git branch --show-current` before EVERY commit; if it differs, STOP and report — do not switch branches yourself. NEVER push to origin. NEVER stage `assets/`, `.claude/`, `.playwright-mcp/`, `.superpowers/`, `scripts/bulk_generate*.py`, `*_f4_state.json`. Stage only the exact files you created/modified. Never rebase, never touch stashes, never run destructive git commands. A parallel session works in this repo — if files you didn't touch appear modified, leave them alone.

**Salt registry:** lifecycle 101/102/200/303; identity 4100/4200/4300; body 4400. L3 OWNS: **4500** (variant timeScale), **4501** (variant amplitudeScale), **4510** (gait phase). Use no others.

**Determinism:** No `Math.random`, no `Date.now`. Every stochastic value is `rand(seed, ...integer ids)` (sim/kernel/rng.js — pure function of args).

**One-time authoring (BINDING user directive):** choreography programs are authored ONCE into `src/life/choreography/*.json` and replayed forever with variant noise. Nothing generates programs at runtime. The planner is a static registry; unknown phrases return `null` (honest absence — LLM authoring appends new canonical entries later, offline).

**Real verbs (verified, sim/world/actions.js):** `move(kernel, actorId, dx, dy, tick)` one-tile Chebyshev step (line 318); `harvest(kernel, playerId, targetId, tick)` → inventory item (line 123); `eat(kernel, playerId, itemId, tick)` → R gain (line 339); also `pick/chop/take/strike/combine`. The executor applies world consequences ONLY through these. Motion never adds physics, costs, or new event types.

**Rig (verified, src/life/rigs/humanoid.json + src/life/rig.js):** 15 bones, root pivot (0,22); spine len 16 points UP (origin (0,22)→tip (0,38)); head len 10 UP ((0,38)→(0,48)); all other bones point DOWN at rest. Shoulders at (±6,36); arm_u len 8, arm_f len 7, hand len 3 (hand tips rest at (±6,18)). Hips (±3,22); thigh 11, shin 9, foot 4 (foot tips rest at (±3,−2)). Joint limits in the JSON are the validator's ground truth. `loadRig('humanoid')`, `restPos`, `comOf` already exist.

**Honest absences (declared, not faked):** no renderer binding (spec §9 — entities keep rendering by lifecycle state); no LLM calls; no LOD tiers; no caching (spec says measure first, ship none); `attack/talk/trade/sleep` compile to `null` (their consuming systems don't exist).

**Loop conventions:** TDD per step; commit per task; `createNode` needs `causeEventId` outside boot; `kernel.stocks()` is DESTRUCTIVE — call only at the current tick, capture transferLoss baseline after a `stocks(0)`.

---

## File map

- Create: `sim/life/motion/program.js` — primitive table, structural validation, stable hash, variant noise, program loader
- Create: `src/life/choreography/wave.json`, `nervous_glance.json`, `sit_down.json`, `dance_improvised.json` — the one-time-authored library
- Create: `src/life/pose.js` — FK solve, COM, support polygon, 2-bone analytic IK
- Create: `sim/life/motion/validator.js` — choreography validator (verdict + offending node path)
- Create: `sim/life/motion/vocabulary.js` — 18-verb action schemas
- Create: `sim/life/motion/behavior.js` — verb → program compiler
- Create: `sim/life/motion/planner.js` — canonical intent registry
- Create: `sim/life/motion/executor.js` — pure track solver + kernel adapter
- Test: `sim/test/program.test.js`, `sim/test/pose.test.js`, `sim/test/motion-validator.test.js`, `sim/test/behavior.test.js`, `sim/test/probe-motion.test.js`

---

### Task 1: Program format, hashing, variant noise, authored library

**Files:**
- Create: `sim/life/motion/program.js`
- Create: `src/life/choreography/wave.json`, `src/life/choreography/nervous_glance.json`, `src/life/choreography/sit_down.json`, `src/life/choreography/dance_improvised.json`
- Test: `sim/test/program.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// sim/test/program.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIMITIVES, validateProgram, stableStringify, hashProgram, variantOf, loadProgram,
} from '../life/motion/program.js';

test('primitive table covers exactly the spec §4 ops', () => {
  assert.deepEqual(Object.keys(PRIMITIVES).sort(), [
    'attach', 'balance', 'detach', 'emit', 'ik_reach', 'locomote',
    'look_at', 'parallel', 'pose', 'sequence', 'wait',
  ]);
});

test('validateProgram rejects structural garbage, accepts the library', () => {
  assert.ok(validateProgram({ id: 'x', kind: 'gesture', variant: { time: [1, 1], amplitude: [1, 1] },
    root: { op: 'wait', ticks: 1 } }).length === 0);
  assert.ok(validateProgram({ root: { op: 'nope' } }).length > 0);          // unknown op
  assert.ok(validateProgram({ id: 'x', kind: 'gesture',
    root: { op: 'pose', joints: { spine: 5 } } }).length > 0);              // pose missing ticks
  assert.ok(validateProgram({ id: 'x', kind: 'gesture',
    root: { op: 'sequence' } }).length > 0);                                // sequence missing children
  for (const id of ['wave', 'nervous_glance', 'sit_down', 'dance_improvised']) {
    assert.deepEqual(validateProgram(loadProgram(id)), [], id);
  }
});

test('stableStringify is key-order independent; hash is stable uint32', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  const h = hashProgram(loadProgram('wave'));
  assert.equal(h, hashProgram(loadProgram('wave')));
  assert.ok(Number.isInteger(h) && h >= 0 && h < 2 ** 32);
  assert.notEqual(h, hashProgram(loadProgram('sit_down')));
});

test('variantOf is deterministic per (seed, entity, program) and stays in bounds', () => {
  const p = loadProgram('wave');
  const a = variantOf(7, 42, p), b = variantOf(7, 42, p), c = variantOf(7, 43, p);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(a.timeScale >= p.variant.time[0] && a.timeScale <= p.variant.time[1]);
  assert.ok(a.amplitudeScale >= p.variant.amplitude[0] && a.amplitudeScale <= p.variant.amplitude[1]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test sim/test/program.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` (program.js doesn't exist).

- [ ] **Step 3: Write the four authored choreography programs**

These are the one-time-authored library (authored at dev time, replayed forever). All joint targets verified against humanoid joint limits at amplitude hi-bound, all transitions ≤ 30°/tick at hi-bound.

```json
// src/life/choreography/wave.json
{
  "id": "wave", "kind": "gesture",
  "variant": { "time": [0.9, 1.15], "amplitude": [0.85, 1.1] },
  "root": { "op": "sequence", "children": [
    { "op": "pose", "joints": { "arm_u_r": 150 }, "ticks": 6 },
    { "op": "pose", "joints": { "arm_u_r": 150, "arm_f_r": 40 }, "ticks": 3 },
    { "op": "pose", "joints": { "arm_u_r": 150, "arm_f_r": 10 }, "ticks": 2 },
    { "op": "pose", "joints": { "arm_u_r": 150, "arm_f_r": 40 }, "ticks": 2 },
    { "op": "pose", "joints": { "arm_u_r": 150, "arm_f_r": 10 }, "ticks": 2 },
    { "op": "pose", "joints": { "arm_u_r": 0, "arm_f_r": 0 }, "ticks": 6 }
  ] }
}
```

(Limit check: arm_u_r max 170; 150×1.1 = 165 ✓. Rate: 150/6 = 25°/tick, ×1.1 = 27.5 ✓. arm_f_r 0..140: 44 ✓, 30/2×1.1 = 16.5°/tick ✓.)

```json
// src/life/choreography/nervous_glance.json
{
  "id": "nervous_glance", "kind": "emote",
  "variant": { "time": [0.85, 1.2], "amplitude": [0.9, 1.1] },
  "root": { "op": "sequence", "children": [
    { "op": "pose", "joints": { "head": -40 }, "ticks": 2 },
    { "op": "wait", "ticks": 3 },
    { "op": "pose", "joints": { "head": 45 }, "ticks": 4 },
    { "op": "wait", "ticks": 2 },
    { "op": "pose", "joints": { "head": 0 }, "ticks": 2 }
  ] }
}
```

(head ±60: 49.5 max ✓; worst rate 85/4×1.1 = 23.4°/tick ✓.)

```json
// src/life/choreography/sit_down.json
{
  "id": "sit_down", "kind": "sit",
  "variant": { "time": [0.9, 1.1], "amplitude": [1, 1] },
  "root": { "op": "sequence", "children": [
    { "op": "balance", "on": false },
    { "op": "pose", "joints": { "thigh_l": -90, "thigh_r": -90, "shin_l": 85, "shin_r": 85, "spine": -10 }, "ticks": 4 },
    { "op": "emit", "event": "sat_down" }
  ] }
}
```

(thigh −110..30: −90 ✓; shin 0..140: 85 ✓; spine ±30: −10 ✓; rate 90/4 = 22.5 ✓. amplitude pinned [1,1]: sitting depth is not a personality knob.)

```json
// src/life/choreography/dance_improvised.json
{
  "id": "dance_improvised", "kind": "dance",
  "variant": { "time": [0.8, 1.25], "amplitude": [0.7, 1.1] },
  "root": { "op": "sequence", "children": [
    { "op": "parallel", "children": [
      { "op": "pose", "joints": { "arm_u_l": -90, "arm_u_r": 90, "spine": 15 }, "ticks": 4 },
      { "op": "pose", "joints": { "head": 20 }, "ticks": 4 }
    ] },
    { "op": "parallel", "children": [
      { "op": "pose", "joints": { "arm_u_l": -20, "arm_u_r": 20, "spine": -15 }, "ticks": 4 },
      { "op": "pose", "joints": { "head": -20 }, "ticks": 4 }
    ] },
    { "op": "parallel", "children": [
      { "op": "pose", "joints": { "arm_u_l": -90, "arm_u_r": 90, "spine": 15 }, "ticks": 4 },
      { "op": "pose", "joints": { "head": 20 }, "ticks": 4 }
    ] },
    { "op": "pose", "joints": { "arm_u_l": 0, "arm_u_r": 0, "spine": 0, "head": 0 }, "ticks": 4 }
  ] }
}
```

(At hi 1.1: arm_u_l −99 in −170..50 ✓; arm_u_r 99 in −50..170 ✓; spine 16.5 in ±30 ✓; head 22 ✓; worst rate (90+20)/4... per-joint: arm swing 70/4 = 17.5×1.1 = 19.25 ✓, spine 30/4×1.1 = 8.25 ✓.)

- [ ] **Step 4: Implement program.js**

```js
// sim/life/motion/program.js — choreography program format (motion-DSL spec §4).
// Programs are AUTHORED ONCE into src/life/choreography/ and replayed with
// deterministic variant noise (feedback_motion_one_time_authoring.md). Nothing
// here generates programs at runtime.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rand } from '../../kernel/rng.js';

const CHOREO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'life', 'choreography');

export const VARIANT_TIME_SALT = 4500;
export const VARIANT_AMPLITUDE_SALT = 4501;
export const GAIT_PHASE_SALT = 4510;

/** Spec §4 primitive ops → required arg names (structural contract only). */
export const PRIMITIVES = {
  pose:     ['joints', 'ticks'],
  ik_reach: ['effector', 'target'],
  look_at:  ['target'],
  locomote: ['target', 'gait', 'duration'],   // duration added vs spec sketch — record as deviation
  balance:  ['on'],
  attach:   ['entity', 'effector'],
  detach:   ['effector'],
  sequence: ['children'],
  parallel: ['children'],
  wait:     ['ticks'],
  emit:     ['event'],
};

/** Structural validation. Returns [] when valid, else violation strings with node paths. */
export function validateProgram(program) {
  const v = [];
  if (!program?.id) v.push('missing id');
  if (!program?.kind) v.push('missing kind');
  const vt = program?.variant;
  if (vt) {
    for (const k of ['time', 'amplitude']) {
      const r = vt[k];
      if (!Array.isArray(r) || r.length !== 2 || !(r[0] <= r[1]) || !(r[0] > 0)) v.push(`variant.${k}: bad range`);
    }
  }
  if (!program?.root) { v.push('missing root'); return v; }
  walk(program.root, 'root');
  return v;

  function walk(node, path) {
    const req = PRIMITIVES[node?.op];
    if (!req) { v.push(`${path}: unknown op ${node?.op}`); return; }
    for (const arg of req) {
      if (node[arg] === undefined) v.push(`${path}: ${node.op} missing ${arg}`);
    }
    if (node.op === 'pose') {
      if (node.joints && typeof node.joints !== 'object') v.push(`${path}: joints must be object`);
      if (node.ticks !== undefined && !(node.ticks > 0)) v.push(`${path}: ticks must be > 0`);
    }
    if (node.op === 'wait' && node.ticks !== undefined && !(node.ticks > 0)) v.push(`${path}: ticks must be > 0`);
    if ((node.op === 'sequence' || node.op === 'parallel')) {
      if (!Array.isArray(node.children) || node.children.length === 0) v.push(`${path}: children must be non-empty array`);
      else node.children.forEach((c, i) => walk(c, `${path}.children[${i}]`));
    }
  }
}

/** Deterministic JSON: keys sorted at every level (arrays keep order). */
export function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** FNV-1a 32-bit over the stable serialization. */
export function hashProgram(program) {
  const s = stableStringify(program);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic per-(entity, program) replay noise within the program's authored bounds. */
export function variantOf(seed, entityId, program) {
  const h = hashProgram(program);
  const vt = program.variant ?? { time: [1, 1], amplitude: [1, 1] };
  const lerp = (r, t) => r[0] + (r[1] - r[0]) * t;
  return {
    timeScale: lerp(vt.time, rand(seed, entityId, VARIANT_TIME_SALT, h)),
    amplitudeScale: lerp(vt.amplitude, rand(seed, entityId, VARIANT_AMPLITUDE_SALT, h)),
  };
}

/** Load an authored program from the one-time library; throws on invalid. */
export function loadProgram(id) {
  const p = JSON.parse(readFileSync(join(CHOREO_DIR, `${id}.json`), 'utf8'));
  const violations = validateProgram(p);
  if (violations.length) throw new Error(`program ${id} invalid: ${violations.join('; ')}`);
  return p;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test sim/test/program.test.js`
Expected: PASS (4/4).

- [ ] **Step 6: Commit**

```bash
git add sim/life/motion/program.js src/life/choreography/wave.json src/life/choreography/nervous_glance.json src/life/choreography/sit_down.json src/life/choreography/dance_improvised.json sim/test/program.test.js
git commit -m "feat(l3): choreography program format + one-time-authored library + variant noise"
```

### Task 2: Pose math — FK, COM, support polygon, 2-bone IK

**Files:**
- Create: `src/life/pose.js`
- Test: `sim/test/pose.test.js`

**Conventions (read carefully):** rig-space, +y up, ground at y≈0. Joint angles are DEGREES of rotation relative to the bone's rest direction. Rest direction is UP `(0,1)` for `spine`/`head`, DOWN `(0,-1)` for everything else. World rotation of a bone = sum of joint angles along its parent chain (root contributes 0). Positive angle = counter-clockwise. Bone origin = parent origin + parent's world rotation applied to the bone's pivot offset. Bone tip = origin + worldRotation(restDir × length).

- [ ] **Step 1: Write the failing tests**

```js
// sim/test/pose.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRig, restPos } from '../../src/life/rig.js';
import { REST_UP, MAX_DEG_PER_TICK, solvePose, comAt, supportOf, ikReach2, IK_CHAINS } from '../../src/life/pose.js';

const rig = loadRig('humanoid');

test('solvePose at all-zero joints reproduces rest positions', () => {
  const solved = solvePose(rig, {});
  for (const bone of Object.keys(rig.bones)) {
    const r = restPos(rig, bone);
    assert.ok(Math.abs(solved[bone].origin.x - r.x) < 1e-9, `${bone} x`);
    assert.ok(Math.abs(solved[bone].origin.y - r.y) < 1e-9, `${bone} y`);
  }
  // tips: spine/head point up, others down
  assert.ok(Math.abs(solved.spine.tip.y - (22 + 16)) < 1e-9);
  assert.ok(Math.abs(solved.hand_r.tip.y - 18) < 1e-9);
  assert.ok(Math.abs(solved.foot_l.tip.y - (-2)) < 1e-9);
});

test('rotating a parent joint carries children (90° arm raise)', () => {
  // arm_u_r at +90 CCW: rest dir (0,-1) rotates to (1,0) — the arm goes horizontal.
  const solved = solvePose(rig, { arm_u_r: 90 });
  // shoulder fixed at (6,36); forearm origin = shoulder + R(90)·(0,-8)
  assert.ok(Math.abs(solved.arm_u_r.origin.x - 6) < 1e-9);
  assert.ok(Math.abs(solved.arm_u_r.origin.y - 36) < 1e-9);
  const fo = solved.arm_f_r.origin;
  const d = Math.hypot(fo.x - 6, fo.y - 36);
  assert.ok(Math.abs(d - 8) < 1e-9, 'forearm origin stays 8 from shoulder');
  assert.ok(Math.abs(fo.y - 36) < 1e-9, 'at 90° the upper arm is horizontal');
  // whole chain rigid: hand tip distance from shoulder unchanged vs rest (18 = 8+7+3)
  const tip = solved.hand_r.tip;
  assert.ok(Math.abs(Math.hypot(tip.x - 6, tip.y - 36) - 18) < 1e-9);
});

test('comAt at rest matches rig.comOf-style mass weighting and moves with pose', () => {
  const rest = comAt(rig, solvePose(rig, {}));
  assert.ok(rest.mass > 0 && Math.abs(rest.x) < 1e-9, 'symmetric rig: COM on centerline');
  const leaned = comAt(rig, solvePose(rig, { spine: 30 }));
  assert.notEqual(Math.round(leaned.x * 1000), 0, 'leaning the spine moves COM off centerline');
});

test('supportOf gives foot-tip x-interval with margin; balance detection works', () => {
  const solved = solvePose(rig, {});
  const s = supportOf(rig, solved);
  assert.ok(s.minX < -3 + 0.001 && s.maxX > 3 - 0.001, 'covers both rest foot tips ±margin');
  const com = comAt(rig, solved);
  assert.ok(com.x >= s.minX && com.x <= s.maxX, 'rest pose is balanced');
});

test('ikReach2 solves reachable targets round-trip and refuses unreachable', () => {
  for (const [effector, chain] of Object.entries(IK_CHAINS)) {
    // pick a known-reachable pose, FK it, then ask IK to find it back
    const probe = effector.startsWith('hand')
      ? { [chain[0]]: effector === 'hand_l' ? -60 : 60, [chain[1]]: effector === 'hand_l' ? -40 : 40 }
      : { [chain[0]]: -45, [chain[1]]: 30 };
    const solved = solvePose(rig, probe);
    const target = solved[chain[1]].tip;   // distal bone tip = chain end
    const angles = ikReach2(rig, effector, target);
    assert.ok(angles, `${effector}: reachable target solved`);
    const re = solvePose(rig, angles);
    const got = re[chain[1]].tip;
    assert.ok(Math.hypot(got.x - target.x, got.y - target.y) < 1e-6, `${effector} round-trip`);
  }
  assert.equal(ikReach2(rig, 'hand_r', { x: 500, y: 500 }), null, 'unreachable → null');
});

test('constants', () => {
  assert.deepEqual(REST_UP, ['spine', 'head']);
  assert.equal(MAX_DEG_PER_TICK, 30);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test sim/test/pose.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement pose.js**

```js
// src/life/pose.js — Pass 4 L3: pose math over L2a rigs (motion-DSL spec §5).
// Pure geometry: FK solve, center of mass, support polygon, analytic 2-bone IK.
// No kernel imports — consumed by the validator, executor, and (later) renderer.

export const REST_UP = ['spine', 'head'];          // bones whose rest direction is +y
export const MAX_DEG_PER_TICK = 30;                // continuity limit (validator ground truth)

const DEG = Math.PI / 180;
const rot = (a, x, y) => {                          // CCW rotation by a degrees
  const c = Math.cos(a * DEG), s = Math.sin(a * DEG);
  return { x: c * x - s * y, y: s * x + c * y };
};

/** Forward kinematics. joints = {boneName: degrees} (missing → 0).
 *  Returns {bone: {origin:{x,y}, tip:{x,y}, worldDeg}} for every bone. */
export function solvePose(rig, joints) {
  const out = {};
  const solve = (name) => {
    if (out[name]) return out[name];
    const bone = rig.bones[name];
    let origin, parentDeg = 0;
    if (bone.parent === null) {
      origin = { x: bone.pivot[0], y: bone.pivot[1] };
    } else {
      const p = solve(bone.parent);
      parentDeg = p.worldDeg;
      const off = rot(parentDeg, bone.pivot[0], bone.pivot[1]);
      origin = { x: p.origin.x + off.x, y: p.origin.y + off.y };
    }
    const worldDeg = parentDeg + (joints[name] ?? 0);
    const restY = REST_UP.includes(name) ? 1 : -1;
    const dir = rot(worldDeg, 0, restY);
    const tip = { x: origin.x + dir.x * bone.length, y: origin.y + dir.y * bone.length };
    return (out[name] = { origin, tip, worldDeg });
  };
  for (const name of Object.keys(rig.bones)) solve(name);
  return out;
}

/** Mass-weighted COM of a SOLVED pose (segment midpoints). */
export function comAt(rig, solved) {
  let mx = 0, my = 0, m = 0;
  for (const [name, bone] of Object.entries(rig.bones)) {
    if (bone.mass === 0) continue;
    const s = solved[name];
    mx += ((s.origin.x + s.tip.x) / 2) * bone.mass;
    my += ((s.origin.y + s.tip.y) / 2) * bone.mass;
    m += bone.mass;
  }
  return { x: mx / m, y: my / m, mass: m };
}

export const SUPPORT_MARGIN = 1.5;

/** Support polygon (2D side-view: an x-interval) from foot tips, widened by margin. */
export function supportOf(rig, solved) {
  const xs = ['foot_l', 'foot_r'].map(f => solved[f].tip.x);
  return { minX: Math.min(...xs) - SUPPORT_MARGIN, maxX: Math.max(...xs) + SUPPORT_MARGIN };
}

/** 2-bone IK chains per effector (proximal, distal). Hand/foot bones ride as end caps. */
export const IK_CHAINS = {
  hand_l: ['arm_u_l', 'arm_f_l'],
  hand_r: ['arm_u_r', 'arm_f_r'],
  foot_l: ['thigh_l', 'shin_l'],
  foot_r: ['thigh_r', 'shin_r'],
};

/** Analytic 2-bone IK in rig space. target = desired DISTAL BONE TIP position
 *  (the hand/foot cap keeps joint angle 0, so chain tip == distal tip when the
 *  cap pivot is colinear — pivots here are (0,-len) so this holds).
 *  Returns {proximalJoint: deg, distalJoint: deg} or null when out of reach
 *  or outside joint limits. Both elbow solutions are tried; first in-limits wins.
 *  NOTE for implementer: the round-trip test is ground truth — if it fails,
 *  flip the sign convention of alpha/elbow below rather than changing the test. */
export function ikReach2(rig, effector, target) {
  const chain = IK_CHAINS[effector];
  if (!chain) return null;
  const [prox, dist] = chain;
  const base = baseOrigin(rig, prox);                 // chain base in rig space (parents at rest)
  const l1 = rig.bones[prox].length, l2 = rig.bones[dist].length;
  const dx = target.x - base.x, dy = target.y - base.y;
  const d = Math.hypot(dx, dy);
  if (d > l1 + l2 || d < Math.abs(l1 - l2) || d < 1e-9) return null;
  // CCW rotation taking rest dir (0,-1) onto target dir: rot(θ)(0,-1) = (sinθ, -cosθ)
  // ⇒ sinθ = dx/d, cosθ = -dy/d ⇒ θ = atan2(dx, -dy).
  const phi = Math.atan2(dx, -dy) / DEG;
  const cosElbow = (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2);
  const elbow = 180 - Math.acos(Math.min(1, Math.max(-1, cosElbow))) / DEG;  // interior → joint deg
  const cosAlpha = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const alpha = Math.acos(Math.min(1, Math.max(-1, cosAlpha))) / DEG;
  // Both elbow solutions × ±360 normalizations (joint limits live on the raw
  // degree line, e.g. −210 ≡ +150 must be tried as +150). Numeric FK verify
  // rejects any wrong-sign candidate, so only true solutions are returned.
  for (const sign of [1, -1]) {
    const p = phi + sign * alpha, e = -sign * elbow;
    for (const dp of [0, 360, -360]) {
      for (const de of [0, 360, -360]) {
        const angles = { [prox]: p + dp, [dist]: e + de };
        if (!withinLimits(rig, angles)) continue;
        const tip = solvePose(rig, angles)[dist].tip;
        if (Math.hypot(tip.x - target.x, tip.y - target.y) < 1e-6) return angles;
      }
    }
  }
  return null;
}

function baseOrigin(rig, boneName) {
  let x = 0, y = 0;
  for (let cur = boneName; cur !== null; cur = rig.bones[cur].parent) {
    x += rig.bones[cur].pivot[0]; y += rig.bones[cur].pivot[1];
  }
  return { x, y };
}

function withinLimits(rig, angles) {
  for (const [j, a] of Object.entries(angles)) {
    const lim = rig.joints[j];
    if (!lim || a < lim.min - 1e-9 || a > lim.max + 1e-9) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test sim/test/pose.test.js`
Expected: PASS (6/6). If the IK round-trip fails, debug the sign conventions in `ikReach2` (the numeric-verify loop makes wrong-sign solutions return null rather than wrong answers — a `null` on a reachable target means the convention is flipped).

- [ ] **Step 5: Commit**

```bash
git add src/life/pose.js sim/test/pose.test.js
git commit -m "feat(l3): pose math — FK solve, COM, support interval, analytic 2-bone IK"
```

---

### Task 3: Choreography validator

**Files:**
- Create: `sim/life/motion/validator.js`
- Test: `sim/test/motion-validator.test.js`

Spec §5: verdicts `OK | OUT_OF_REACH | UNBALANCED | LIMIT_VIOLATION | WORLD_REJECTED`, each with the offending node path. Checks: joint limits AT THE AMPLITUDE HI-BOUND (variant noise must never push a program out of limits), continuity (≤ MAX_DEG_PER_TICK per joint per tick, also at hi-bound), COM-in-support (unless balance off — programs of kind `jump`/`sit`/`sleep` start with balance off), world consistency (attach only to takeable + in-range entities).

- [ ] **Step 1: Write the failing tests**

```js
// sim/test/motion-validator.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRig } from '../../src/life/rig.js';
import { loadProgram } from '../life/motion/program.js';
import { validateChoreography } from '../life/motion/validator.js';

const rig = loadRig('humanoid');
const prog = (kind, root, variant = { time: [1, 1], amplitude: [1, 1] }) =>
  ({ id: 't', kind, variant, root });

test('the authored library validates OK', () => {
  for (const id of ['wave', 'nervous_glance', 'sit_down', 'dance_improvised']) {
    assert.deepEqual(validateChoreography(rig, loadProgram(id)), { verdict: 'OK', path: null }, id);
  }
});

test('joint limit violation is caught — including via amplitude hi-bound', () => {
  const over = prog('gesture', { op: 'pose', joints: { spine: 45 }, ticks: 10 });
  assert.deepEqual(validateChoreography(rig, over), { verdict: 'LIMIT_VIOLATION', path: 'root' });
  // 28 is legal at amplitude 1, but 28×1.2 = 33.6 > 30 max
  const sneaky = prog('gesture', { op: 'pose', joints: { spine: 28 }, ticks: 10 },
    { time: [1, 1], amplitude: [1, 1.2] });
  assert.equal(validateChoreography(rig, sneaky).verdict, 'LIMIT_VIOLATION');
});

test('continuity: too-fast transition violates', () => {
  const fast = prog('gesture', { op: 'pose', joints: { arm_u_r: 150 }, ticks: 2 });  // 75°/tick
  assert.deepEqual(validateChoreography(rig, fast), { verdict: 'LIMIT_VIOLATION', path: 'root' });
});

test('balance: heavy one-sided lean while standing is UNBALANCED; sit kind is exempt', () => {
  // both legs swung one way moves the support interval away from the COM
  const lean = { op: 'pose', joints: { thigh_l: 30, thigh_r: 30, shin_l: 100, shin_r: 100 }, ticks: 8 };
  assert.equal(validateChoreography(rig, prog('gesture', lean)).verdict, 'UNBALANCED');
  assert.equal(validateChoreography(rig, prog('sit', lean)).verdict, 'OK');
});

test('ik_reach: unreachable target is OUT_OF_REACH with path', () => {
  const p = prog('gesture', { op: 'sequence', children: [
    { op: 'wait', ticks: 1 },
    { op: 'ik_reach', effector: 'hand_r', target: { x: 99, y: 99 } },
  ] });
  assert.deepEqual(validateChoreography(rig, p), { verdict: 'OUT_OF_REACH', path: 'root.children[1]' });
});

test('attach: requires world context naming a takeable, in-range entity', () => {
  const p = prog('gesture', { op: 'attach', entity: 5, effector: 'hand_r' });
  assert.equal(validateChoreography(rig, p).verdict, 'WORLD_REJECTED');           // no ctx
  const okCtx = { takeable: id => id === 5, inRange: () => true };
  assert.equal(validateChoreography(rig, p, okCtx).verdict, 'OK');
  const farCtx = { takeable: id => id === 5, inRange: () => false };
  assert.equal(validateChoreography(rig, p, farCtx).verdict, 'WORLD_REJECTED');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test sim/test/motion-validator.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement validator.js**

```js
// sim/life/motion/validator.js — choreography validator (motion-DSL spec §5).
// Walks a program tree with simulated joint state; first violation wins.
// Verdicts: OK | OUT_OF_REACH | UNBALANCED | LIMIT_VIOLATION | WORLD_REJECTED.
import { solvePose, comAt, supportOf, ikReach2, MAX_DEG_PER_TICK } from '../../../src/life/pose.js';

const BALANCE_EXEMPT_KINDS = ['jump', 'sit', 'sleep'];

/** worldCtx (optional): { takeable(entityId)→bool, inRange(entityId)→bool }.
 *  Returns { verdict, path } — path null when OK. */
export function validateChoreography(rig, program, worldCtx = null) {
  const ampHi = program.variant?.amplitude?.[1] ?? 1;
  const state = {};                                   // current joint degrees
  let balanceOn = !BALANCE_EXEMPT_KINDS.includes(program.kind);
  let fail = null;

  walk(program.root, 'root');
  return fail ?? { verdict: 'OK', path: null };

  function bail(verdict, path) { if (!fail) fail = { verdict, path }; }

  function applyJoints(targets, ticks, path) {
    for (const [j, raw] of Object.entries(targets)) {
      const a = raw * ampHi;                           // worst-case variant amplitude
      const lim = rig.joints[j];
      if (!lim) return bail('LIMIT_VIOLATION', path);
      if (a < lim.min - 1e-9 || a > lim.max + 1e-9) return bail('LIMIT_VIOLATION', path);
      const rate = Math.abs(a - (state[j] ?? 0)) / Math.max(1, ticks ?? 1);
      if (rate > MAX_DEG_PER_TICK + 1e-9) return bail('LIMIT_VIOLATION', path);
      state[j] = a;
    }
    if (balanceOn) {
      const solved = solvePose(rig, state);
      const com = comAt(rig, solved), sup = supportOf(rig, solved);
      if (com.x < sup.minX || com.x > sup.maxX) return bail('UNBALANCED', path);
    }
  }

  function walk(node, path) {
    if (fail) return;
    switch (node.op) {
      case 'pose':
        applyJoints(node.joints, node.ticks, path);
        break;
      case 'ik_reach': {
        const angles = ikReach2(rig, node.effector, node.target);
        if (!angles) return bail('OUT_OF_REACH', path);
        applyJoints(angles, node.ticks ?? 4, path);   // IK transitions get a default glide
        break;
      }
      case 'balance':
        balanceOn = !!node.on;
        break;
      case 'attach':
        if (!worldCtx) return bail('WORLD_REJECTED', path);
        if (!worldCtx.takeable(node.entity)) return bail('WORLD_REJECTED', path);
        if (!worldCtx.inRange(node.entity)) return bail('WORLD_REJECTED', path);
        break;
      case 'sequence':
        for (let i = 0; i < node.children.length; i++) walk(node.children[i], `${path}.children[${i}]`);
        break;
      case 'parallel': {
        // children share the entry state; merged exit state (later child wins per joint)
        const entry = { ...state };
        const exits = [];
        for (let i = 0; i < node.children.length; i++) {
          Object.keys(state).forEach(k => delete state[k]);
          Object.assign(state, entry);
          walk(node.children[i], `${path}.children[${i}]`);
          exits.push({ ...state });
        }
        Object.keys(state).forEach(k => delete state[k]);
        Object.assign(state, entry, ...exits);
        break;
      }
      case 'look_at': case 'locomote': case 'wait': case 'detach': case 'emit':
        break;                                        // structurally checked by validateProgram
      default:
        bail('LIMIT_VIOLATION', path);                // unknown op should never reach here
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test sim/test/motion-validator.test.js`
Expected: PASS (6/6). If the balance test's lean pose turns out balanced (geometry surprises), adjust the TEST's joint values until `comAt.x` actually leaves the support interval — print both to find a genuinely unbalanced pose. Do NOT weaken the validator.

- [ ] **Step 5: Commit**

```bash
git add sim/life/motion/validator.js sim/test/motion-validator.test.js
git commit -m "feat(l3): choreography validator — limits/continuity/balance/world verdicts with node paths"
```

### Task 4: Action vocabulary, behavior compiler, planner

**Files:**
- Create: `sim/life/motion/vocabulary.js`
- Create: `sim/life/motion/behavior.js`
- Create: `sim/life/motion/planner.js`
- Test: `sim/test/behavior.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// sim/test/behavior.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRig } from '../../src/life/rig.js';
import { ACTION_SCHEMAS, validateAction } from '../life/motion/vocabulary.js';
import { compileAction } from '../life/motion/behavior.js';
import { plan, CANONICAL_INTENTS } from '../life/motion/planner.js';
import { validateProgram } from '../life/motion/program.js';
import { validateChoreography } from '../life/motion/validator.js';

const rig = loadRig('humanoid');

test('vocabulary covers exactly the spec §6 verbs', () => {
  assert.deepEqual(Object.keys(ACTION_SCHEMAS).sort(), [
    'attack', 'dance', 'drop', 'emote', 'face', 'follow', 'gesture', 'investigate',
    'jump', 'look_at', 'move_to', 'pick_up', 'run', 'sit', 'sleep', 'talk',
    'trade', 'use', 'wait',
  ]);
  assert.deepEqual(validateAction({ verb: 'move_to', x: 3, y: 4 }), []);
  assert.ok(validateAction({ verb: 'move_to' }).length > 0);          // missing x,y
  assert.ok(validateAction({ verb: 'levitate' }).length > 0);         // unknown verb
});

test('compileAction: every non-null compile is a valid, validator-OK program', () => {
  const cases = [
    { verb: 'move_to', x: 3, y: 4 }, { verb: 'run', x: 3, y: 4 },
    { verb: 'follow', target: 9 }, { verb: 'face', target: 9 },
    { verb: 'look_at', target: 9 }, { verb: 'gesture', name: 'wave' },
    { verb: 'emote', name: 'nervous_glance' }, { verb: 'dance' },
    { verb: 'sit' }, { verb: 'jump' }, { verb: 'wait', ticks: 5 },
    { verb: 'drop', item: 1 }, { verb: 'investigate', target: 9, x: 3, y: 4 },
    { verb: 'pick_up', target: 9, x: 3, y: 4 },
    { verb: 'use', mode: 'eat', item: 1 },
  ];
  for (const action of cases) {
    const p = compileAction(action);
    assert.ok(p, `${action.verb} compiles`);
    assert.deepEqual(validateProgram(p), [], `${action.verb} structurally valid`);
    const ctx = { takeable: () => true, inRange: () => true };
    assert.equal(validateChoreography(rig, p, ctx).verdict, 'OK', `${action.verb} choreography OK`);
  }
});

test('honest absences compile to null', () => {
  for (const verb of ['attack', 'talk', 'trade', 'sleep']) {
    assert.equal(compileAction({ verb }), null, verb);
  }
});

test('planner: canonical intent resolves; unknown phrase is null (one-time authoring)', () => {
  const ctx = { bush: { id: 7, x: 5, y: 5 } };
  const actions = plan('pick the berry and eat it', ctx);
  assert.deepEqual(actions.map(a => a.verb), ['move_to', 'pick_up', 'use']);
  assert.equal(actions[1].target, 7);
  assert.equal(actions[2].mode, 'eat');
  for (const a of actions) assert.deepEqual(validateAction(a), []);
  assert.equal(plan('do a backflip off the roof', ctx), null);
  assert.ok(Object.keys(CANONICAL_INTENTS).includes('pick the berry and eat it'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test sim/test/behavior.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement vocabulary.js**

```js
// sim/life/motion/vocabulary.js — the action vocabulary (motion-DSL spec §6).
// 18 verbs; schemas list REQUIRED fields. Anything not expressible here is not
// an action — the planner can only emit these.
export const ACTION_SCHEMAS = {
  move_to:     ['x', 'y'],
  follow:      ['target'],
  face:        ['target'],
  gesture:     ['name'],
  look_at:     ['target'],
  pick_up:     ['target', 'x', 'y'],
  drop:        ['item'],
  use:         ['mode', 'item'],
  investigate: ['target', 'x', 'y'],
  sit:         [],
  sleep:       [],
  attack:      ['target'],
  talk:        ['target'],
  trade:       ['target'],
  emote:       ['name'],
  dance:       [],
  jump:        [],
  run:         ['x', 'y'],
  wait:        ['ticks'],
};

/** Returns [] when valid, else violation strings. */
export function validateAction(action) {
  const req = ACTION_SCHEMAS[action?.verb];
  if (!req) return [`unknown verb ${action?.verb}`];
  return req.filter(f => action[f] === undefined).map(f => `${action.verb}: missing ${f}`);
}
```

NOTE: `use` requires `item` — Probe M's planner emits `use` with `mode:'eat'` and `item` resolved at EXECUTION time (the harvested item id is unknowable at plan time). To keep schemas honest, the planner emits `item: '$last'` (a placeholder string the executor resolves to the most recently acquired item). This is the only placeholder token in the vocabulary; document it in the code comment.

- [ ] **Step 4: Implement behavior.js**

```js
// sim/life/motion/behavior.js — verb → choreography program compiler (spec §6→§4).
// Authored library verbs load one-time programs; manipulation verbs build small
// canonical trees; attack/talk/trade/sleep return null (consuming systems absent).
import { loadProgram } from './program.js';
import { validateAction } from './vocabulary.js';

const NO_VARIANT = { time: [1, 1], amplitude: [1, 1] };

/** Canonical rig-space reach target for ground-level pick-ups: from the right
 *  shoulder (6,36) to (12,24) is √(36+144)=13.4 ≤ arm reach 15 — verified reachable. */
const PICK_TARGET = { x: 12, y: 24 };
/** Hand-to-mouth target. VERIFIED reachable WITHIN right-arm joint limits:
 *  prox 150° (≤170), elbow 120° (≤140) puts the hand tip-of-forearm at
 *  (3, 42.93) — beside the head ((0,38)→(0,48)). Targets nearer the centerline
 *  (e.g. (0,42)) are provably outside arm_u_r/arm_f_r limits — don't "fix" by
 *  widening limits. */
const MOUTH_TARGET = { x: 3, y: 42.93 };

export function compileAction(action) {
  if (validateAction(action).length) return null;
  switch (action.verb) {
    case 'attack': case 'talk': case 'trade': case 'sleep':
      return null;                                   // honest absence: no combat/dialogue/trade/rest systems
    case 'gesture': return loadProgram(action.name);
    case 'emote':   return loadProgram(action.name);
    case 'dance':   return loadProgram('dance_improvised');
    case 'sit':     return loadProgram('sit_down');
    case 'move_to': case 'run':
      return prog(action.verb, action.verb === 'run' ? 'run' : 'walk', {
        op: 'locomote', target: { x: action.x, y: action.y },
        gait: action.verb === 'run' ? 'run' : 'walk', duration: null });
    case 'follow':
      return prog('follow', 'follow',
        { op: 'locomote', target: { entity: action.target }, gait: 'walk', duration: null });
    case 'face': case 'look_at':
      return prog(action.verb, action.verb, { op: 'look_at', target: { entity: action.target } });
    case 'wait':
      return prog('wait', 'wait', { op: 'wait', ticks: action.ticks });
    case 'jump':
      return { id: 'jump', kind: 'jump', variant: { time: [0.95, 1.1], amplitude: [1, 1] },
        root: { op: 'sequence', children: [
          { op: 'balance', on: false },
          { op: 'pose', joints: { thigh_l: -50, thigh_r: -50, shin_l: 70, shin_r: 70, spine: -15 }, ticks: 3 },
          { op: 'pose', joints: { thigh_l: 0, thigh_r: 0, shin_l: 0, shin_r: 0, spine: 0 }, ticks: 2 },
        ] } };
    case 'drop':
      return prog('drop', 'drop', { op: 'sequence', children: [
        { op: 'ik_reach', effector: 'hand_r', target: PICK_TARGET, ticks: 4 },
        { op: 'detach', effector: 'hand_r' },
        { op: 'pose', joints: { arm_u_r: 0, arm_f_r: 0 }, ticks: 4 },
      ] });
    case 'investigate':
      return prog('investigate', 'investigate', { op: 'sequence', children: [
        { op: 'locomote', target: { x: action.x, y: action.y }, gait: 'walk', duration: null },
        { op: 'look_at', target: { entity: action.target } },
        { op: 'wait', ticks: 6 },
      ] });
    case 'pick_up':
      return prog('pick_up', 'pick_up', { op: 'sequence', children: [
        { op: 'locomote', target: { x: action.x, y: action.y }, gait: 'walk', duration: null },
        { op: 'pose', joints: { spine: -20 }, ticks: 4 },
        { op: 'ik_reach', effector: 'hand_r', target: PICK_TARGET, ticks: 4 },
        { op: 'attach', entity: action.target, effector: 'hand_r' },
        { op: 'pose', joints: { spine: 0, arm_u_r: 0, arm_f_r: 0 }, ticks: 4 },
      ] });
    case 'use':
      if (action.mode !== 'eat') return null;        // only consumption exists today
      return prog('use_eat', 'use', { op: 'sequence', children: [
        { op: 'ik_reach', effector: 'hand_r', target: MOUTH_TARGET, ticks: 6 },
        { op: 'emit', event: 'consume' },
        { op: 'pose', joints: { arm_u_r: 0, arm_f_r: 0 }, ticks: 6 },
      ] });
      // ticks 6 both ways: IK lands prox≈150° — 150/6 = 25°/tick ≤ 30 continuity
      // limit; 4 or 5 ticks would violate it (37.5 / 30.0 borderline).
    default: return null;
  }
}

function prog(id, kind, root) {
  return { id, kind, variant: NO_VARIANT, root };
}
```

NOTE for implementer: if the validator rejects `pick_up` (the spine −20 lean may shift COM outside the foot interval, or the IK targets may violate limits in combination), debug with `solvePose`/`comAt` prints and adjust the CANONICAL joint values/targets here — never the validator. Record final values in Deviations.

- [ ] **Step 5: Implement planner.js**

```js
// sim/life/motion/planner.js — intent phrase → action list (spec §3 Action Planner).
// CANONICAL_INTENTS is the one-time-authored registry (feedback_motion_one_time_authoring):
// each entry was authored ONCE (by an LLM or a human, offline) and replays forever.
// Unknown phrases return null — honest absence; runtime NEVER generates plans.
export const CANONICAL_INTENTS = {
  'pick the berry and eat it': ctx => [
    { verb: 'move_to', x: ctx.bush.x, y: ctx.bush.y },
    { verb: 'pick_up', target: ctx.bush.id, x: ctx.bush.x, y: ctx.bush.y },
    { verb: 'use', mode: 'eat', item: '$last' },
  ],
};

/** Returns an action list or null (unknown phrase). */
export function plan(phrase, ctx) {
  const entry = CANONICAL_INTENTS[phrase];
  return entry ? entry(ctx) : null;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test sim/test/behavior.test.js`
Expected: PASS (4/4).

- [ ] **Step 7: Commit**

```bash
git add sim/life/motion/vocabulary.js sim/life/motion/behavior.js sim/life/motion/planner.js sim/test/behavior.test.js
git commit -m "feat(l3): 18-verb vocabulary, behavior compiler, canonical-intent planner"
```

---

### Task 5: Executor — pure track solver + kernel adapter

**Files:**
- Create: `sim/life/motion/executor.js`
- Test: extend `sim/test/behavior.test.js` (append tests; no new file)

Two halves, strictly separated:
1. `solveProgramTrack(rig, program, {seed, entityId, startTick})` — PURE. Walks the program, produces `{frames, intents, events}`. Frames = presentation poses `{tick, joints}` (variant time/amplitude applied; gait phase `rand(seed, entityId, 4510, startTick)`). Intents = world-facing nodes (`locomote`/`attach`/`detach`/`emit`) tagged with relative tick. NOTHING here touches a kernel.
2. `performAction(kernel, entityId, action, tick)` — adapter. compile → validate (worldCtx built from the kernel) → apply intents through REAL verbs ONLY: `locomote` → repeated `move()` one-tile greedy steps toward target; `attach` → `harvest()`; `emit consume` → `eat()`. Presentation frames/events never enter the kernel ledger.

- [ ] **Step 1: Append failing tests to sim/test/behavior.test.js**

```js
// (append) — executor tests
import { solveProgramTrack, performAction } from '../life/motion/executor.js';
import { loadProgram } from '../life/motion/program.js';   // merge with existing imports

test('solveProgramTrack is pure and bit-identical across calls; variant differs per entity', () => {
  const p = loadProgram('wave');
  const a = solveProgramTrack(rig, p, { seed: 7, entityId: 42, startTick: 100 });
  const b = solveProgramTrack(rig, p, { seed: 7, entityId: 42, startTick: 100 });
  assert.deepEqual(a, b);
  const c = solveProgramTrack(rig, p, { seed: 7, entityId: 43, startTick: 100 });
  assert.notDeepEqual(a.frames, c.frames);              // variant noise per entity
  assert.ok(a.frames.length > 0);
  assert.ok(a.frames.every(f => Number.isInteger(f.tick)));
  // every frame's joints are within limits (amplitude was validated at hi-bound)
  for (const f of a.frames) {
    for (const [j, deg] of Object.entries(f.joints)) {
      const lim = rig.joints[j];
      assert.ok(deg >= lim.min - 1e-6 && deg <= lim.max + 1e-6, `${j}@${f.tick}`);
    }
  }
});

test('solveProgramTrack surfaces intents in order with ticks', () => {
  const p = compileAction({ verb: 'pick_up', target: 9, x: 3, y: 4 });
  const t = solveProgramTrack(rig, p, { seed: 7, entityId: 1, startTick: 0 });
  assert.deepEqual(t.intents.map(i => i.kind), ['locomote', 'attach']);
  assert.equal(t.intents[1].entity, 9);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test sim/test/behavior.test.js`
Expected: the two new tests FAIL (`ERR_MODULE_NOT_FOUND` for executor.js); prior tests still pass.

- [ ] **Step 3: Implement executor.js**

```js
// sim/life/motion/executor.js — spec §3 Animation Controller (pure track) +
// the kernel adapter. World truth moves ONLY through existing real verbs
// (sim/world/actions.js); frames are presentation and never enter the ledger.
import { rand } from '../../kernel/rng.js';
import { variantOf, GAIT_PHASE_SALT } from './program.js';
import { ikReach2 } from '../../../src/life/pose.js';
import { compileAction } from './behavior.js';
import { validateChoreography } from './validator.js';
import { loadRig } from '../../../src/life/rig.js';
import { move, harvest, eat } from '../../world/actions.js';

/** PURE: program → {frames:[{tick,joints}], intents:[{tick,kind,...}], events:[{tick,event}]}.
 *  Deterministic in (rig, program, seed, entityId, startTick). */
export function solveProgramTrack(rig, program, { seed, entityId, startTick }) {
  const { timeScale, amplitudeScale } = variantOf(seed, entityId, program);
  const phase = rand(seed, entityId, GAIT_PHASE_SALT, startTick);
  const frames = [], intents = [], events = [];
  const state = {};
  let t = startTick;

  walk(program.root);
  return { frames, intents, events, phase, timeScale, amplitudeScale };

  function scaledTicks(ticks) { return Math.max(1, Math.round((ticks ?? 1) * timeScale)); }

  function glideTo(targets, ticks) {
    const n = scaledTicks(ticks);
    const from = { ...state };
    for (let i = 1; i <= n; i++) {
      const f = i / n, joints = {};
      for (const j of new Set([...Object.keys(from), ...Object.keys(targets)])) {
        const a = from[j] ?? 0;
        const b = (targets[j] !== undefined ? targets[j] * amplitudeScale : a);
        joints[j] = a + (b - a) * f;
        state[j] = joints[j];
      }
      frames.push({ tick: t + i, joints });
    }
    t += n;
  }

  function walk(node) {
    switch (node.op) {
      case 'pose': glideTo(node.joints, node.ticks); break;
      case 'ik_reach': {
        const angles = ikReach2(rig, node.effector, node.target);
        if (angles) glideTo(scaleInvert(angles), node.ticks ?? 4);   // see note below
        break;
      }
      case 'wait': {
        const n = scaledTicks(node.ticks);
        for (let i = 1; i <= n; i++) frames.push({ tick: t + i, joints: { ...state } });
        t += n;
        break;
      }
      case 'locomote': {
        const gait = rig.gaits[node.gait] ?? rig.gaits.walk;
        intents.push({ tick: t, kind: 'locomote', target: node.target, gait: node.gait });
        // gait bob frames: one cycle as presentation placeholder-free motion —
        // real per-step frames are produced when the adapter knows the route length
        const cyc = Math.max(2, Math.round(gait.cycleTicks * timeScale));
        for (let i = 1; i <= cyc; i++) {
          const ph = (phase + i / cyc) * 2 * Math.PI;
          const swing = Math.sin(ph) * 25 * gait.strideFactor * amplitudeScale;
          const joints = { ...state, thigh_l: -swing, thigh_r: swing,
            arm_u_l: swing * 0.6, arm_u_r: -swing * 0.6 };
          Object.assign(state, joints);
          frames.push({ tick: t + i, joints });
        }
        t += cyc;
        break;
      }
      case 'balance': break;                          // validator concern; no frames
      case 'look_at':
        intents.push({ tick: t, kind: 'look_at', target: node.target });
        break;
      case 'attach':
        intents.push({ tick: t, kind: 'attach', entity: node.entity, effector: node.effector });
        break;
      case 'detach':
        intents.push({ tick: t, kind: 'detach', effector: node.effector });
        break;
      case 'emit':
        events.push({ tick: t, event: node.event });
        break;
      case 'sequence': for (const c of node.children) walk(c); break;
      case 'parallel': {
        const t0 = t; let tMax = t;
        for (const c of node.children) { t = t0; walk(c); tMax = Math.max(tMax, t); }
        t = tMax;
        break;
      }
    }
  }

  // IK angles are exact geometry — variant amplitude must NOT scale them
  // (a scaled reach misses the target). glideTo multiplies by amplitudeScale,
  // so pre-divide to cancel.
  function scaleInvert(angles) {
    const out = {};
    for (const [j, a] of Object.entries(angles)) out[j] = a / amplitudeScale;
    return out;
  }
}

/** Adapter: run an action against a REAL kernel via existing verbs only.
 *  `lastItem` threading resolves the '$last' placeholder (vocabulary note).
 *  Returns { ok, verdict, items, tick, track } — tick = tick after completion. */
export function performAction(kernel, entityId, action, tick, lastItem = null) {
  const rig = loadRig('humanoid');
  const resolved = action.item === '$last' ? { ...action, item: lastItem?.id } : action;
  const program = compileAction(resolved);
  if (!program) return { ok: false, verdict: 'NO_PROGRAM', items: [], tick, track: null };
  const actor = kernel.graph.nodes.get(entityId);
  const worldCtx = {
    takeable: id => kernel.graph.nodes.get(id) != null,
    inRange: id => {
      const n = kernel.graph.nodes.get(id);
      return n && Math.max(Math.abs(n.x - actor.x), Math.abs(n.y - actor.y)) <= 1;
    },
  };
  // World-consequence application FIRST (movement may bring targets into range),
  // then validation against the post-locomotion world, per spec §5 world checks.
  const items = [];
  let t = tick;
  const track = solveProgramTrack(rig, program, { seed: kernel.seed, entityId, startTick: tick });
  for (const intent of track.intents) {
    if (intent.kind === 'locomote' && intent.target.x != null) {
      // greedy one-tile steps via the real move() verb until adjacent or blocked
      let guard = 1000;
      while (guard-- > 0) {
        const dx = Math.sign(intent.target.x - actor.x), dy = Math.sign(intent.target.y - actor.y);
        if (Math.max(Math.abs(intent.target.x - actor.x), Math.abs(intent.target.y - actor.y)) <= 1) break;
        if (!move(kernel, entityId, dx, dy, t)) break;
        t += 1;
      }
    } else if (intent.kind === 'attach') {
      const verdict = validateChoreography(rig, program, worldCtx);
      if (verdict.verdict !== 'OK') return { ok: false, verdict: verdict.verdict, items, tick: t, track };
      const item = harvest(kernel, entityId, intent.entity, t);
      if (item) items.push(item);
      t += 1;
    }
  }
  for (const ev of track.events) {
    if (ev.event === 'consume') {
      const target = resolved.item ?? items[items.length - 1]?.id;
      if (target != null) { eat(kernel, entityId, target, t); t += 1; }
    }
  }
  return { ok: true, verdict: 'OK', items, tick: t, track };
}
```

NOTE for implementer: `performAction` validates the choreography with the worldCtx at the attach point (after locomotion), which is the spec's world-consistency semantics. If the behavior tests want pre-validation too, validate once with `null` ctx replaced by the kernel ctx at entry AND at attach — record whichever you ship in Deviations.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test sim/test/behavior.test.js`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add sim/life/motion/executor.js sim/test/behavior.test.js
git commit -m "feat(l3): executor — pure deterministic pose tracks + real-verb kernel adapter"
```

### Task 6: Probe M — NL intent replays the hand-written world bit-identically

**Files:**
- Test: `sim/test/probe-motion.test.js`

Spec §10 gate: same seed, two worlds. World A: hand-written real verbs (probe-6 style: `move` steps + `harvest` + `eat`). World B: `plan('pick the berry and eat it') → performAction` chain. Assert: identical ledger event-type sequences, bit-identical player/bush deltas, conservation <1e-9, tracks bit-identical across solves, variant noise differs per entity WITHOUT changing world deltas.

**BINDING: before writing the fixture, READ `sim/test/probe-interaction.test.js` (lines 9–47 — probe 6's `world(seed)` helper, seed 77) and mirror its kernel construction EXACTLY (Kernel options, `graph.boot`, `addLiving` args). The code below shows the shape; adapt fixture constants to probe 6's actuals and record any divergence in Deviations.**

- [ ] **Step 1: Write the probe**

```js
// sim/test/probe-motion.test.js — Probe M (motion-DSL spec §10).
// "pick the berry and eat it": planner-driven execution must be ledger-identical
// to hand-written real verbs. Headless; no renderer, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';                 // adapt path/ctor to probe 6
import { createPlayer, move, harvest, eat } from '../world/actions.js';
import { plan } from '../life/motion/planner.js';
import { performAction, solveProgramTrack } from '../life/motion/executor.js';
import { loadProgram } from '../life/motion/program.js';
import { loadRig } from '../../src/life/rig.js';

const SEED = 77;

function world() {
  // MIRROR PROBE 6's world(seed) EXACTLY (probe-interaction.test.js lines 9-47):
  // kernel construction, boot, bush placement. Player starts 3 tiles from the bush.
  const k = new Kernel({ seed: SEED, phi: 4, bounds: { x0: 0, y0: 0, w: 10, h: 10 } });
  let bush;
  k.graph.boot(() => {
    bush = k.addLiving({ species: 'berry_bush', x: 6, y: 4, R: 5000, body: 900, tick: 0 });
  });
  const player = createPlayer(k, 0, { x: 3, y: 4 });
  return { k, player, bush };
}

const eventTypes = k => k.ledger.events.map(e => e.type);
const snapshot = (k, ids) => ids.map(id => {
  const n = k.graph.nodes.get(id);
  return n ? { R: n.R, body: n.attrs.body ?? null, x: n.x, y: n.y } : null;
});

test('probe M: planner path is ledger-identical to hand-written verbs', () => {
  // ---- World A: hand-written (probe-6 style)
  const A = world();
  let t = 1;
  while (Math.max(Math.abs(A.bush.x - A.player.x), Math.abs(A.bush.y - A.player.y)) > 1) {
    const dx = Math.sign(A.bush.x - A.player.x), dy = Math.sign(A.bush.y - A.player.y);
    assert.ok(move(A.k, A.player.id, dx, dy, t)); t += 1;
  }
  const itemA = harvest(A.k, A.player.id, A.bush.id, t); t += 1;
  assert.ok(itemA);
  const gainedA = eat(A.k, A.player.id, itemA.id, t); t += 1;
  assert.ok(gainedA > 0);

  // ---- World B: planner-driven
  const B = world();
  const actions = plan('pick the berry and eat it', { bush: { id: B.bush.id, x: B.bush.x, y: B.bush.y } });
  assert.ok(actions, 'canonical intent resolves');
  let tick = 1, last = null;
  for (const action of actions) {
    const r = performAction(B.k, B.player.id, action, tick, last);
    assert.ok(r.ok, `${action.verb}: ${r.verdict}`);
    if (r.items.length) last = r.items[r.items.length - 1];
    tick = r.tick;
  }

  // ---- identical world consequences
  assert.deepEqual(eventTypes(B.k), eventTypes(A.k), 'ledger event-type sequence identical');
  assert.deepEqual(snapshot(B.k, [B.player.id, B.bush.id]),
                   snapshot(A.k, [A.player.id, A.bush.id]), 'node deltas bit-identical');

  // ---- conservation in both worlds
  for (const W of [A, B]) {
    const s = W.k.stocks(Math.max(t, tick));
    assert.ok(Math.abs(s.drift) < 1e-9, `conservation drift ${s.drift}`);
  }
});

test('probe M: tracks are bit-identical; variant noise never touches world deltas', () => {
  const rig = loadRig('humanoid');
  const p = loadProgram('wave');
  const t1 = solveProgramTrack(rig, p, { seed: SEED, entityId: 5, startTick: 10 });
  const t2 = solveProgramTrack(rig, p, { seed: SEED, entityId: 5, startTick: 10 });
  assert.deepEqual(t1, t2, 'replay is bit-identical');
  const t3 = solveProgramTrack(rig, p, { seed: SEED, entityId: 6, startTick: 10 });
  assert.notDeepEqual(t1.frames, t3.frames, 'different entities move differently');
  assert.deepEqual(t1.intents, t3.intents, 'variant noise NEVER changes world-facing intents');
  assert.deepEqual(t1.events.map(e => e.event), t3.events.map(e => e.event));
});
```

NOTE: `k.stocks(...)` is DESTRUCTIVE (closes segments) — call it ONCE per world at the final tick, as the last act of the test. If probe 6 audits conservation differently (e.g. compares stocks fields rather than a `drift` key), mirror probe 6's audit exactly.

- [ ] **Step 2: Run the probe**

Run: `node --test sim/test/probe-motion.test.js`
Expected: PASS (2/2). Most likely failure: ledger sequences differ because `performAction`'s greedy locomotion takes a different number of `move` events than the hand-written loop. Both use Math.sign greedy stepping from the same start, so step counts must match — if they don't, print both event lists and align the adapter (NOT the hand-written reference; the hand-written side is ground truth).

- [ ] **Step 3: Commit**

```bash
git add sim/test/probe-motion.test.js
git commit -m "test(l3): probe M — NL intent replays hand-written verbs bit-identically"
```

---

## Close-out checklist (controller)

- [ ] Full suite in background: `npm test > /tmp/l3-suite.log 2>&1`; read log ONLY after the EXIT line. Expect 340 prior + new tests, all green.
- [ ] Fill the **Deviations** section below (canonical record).
- [ ] Roadmap `docs/superpowers/plans/2026-06-12-pass2plus-roadmap.md` L3 row → DONE with delivery summary + honest absences.
- [ ] Final whole-branch opus review (READ-ONLY): salt uniqueness (4500/4501/4510), no Math.random/Date.now, no wire/ledger leakage of frames, real-verbs-only world mutation, one-time-authoring honored, pure additions only.
- [ ] Merge: `git -C .worktrees/merge-master merge --no-edit pass4-l3-motion-dsl` ("Filename too long" warnings harmless). Verify `git log --oneline -3 master`.
- [ ] Memory update (`project_pass2_loop_state.md` + MEMORY.md line): L3 DONE, next row.

## Honest absences (declare, don't fake)

No renderer binding (entities still render by lifecycle state — spec §9); no LLM calls anywhere; `attack/talk/trade/sleep` compile null; no pathfinding in locomote (greedy Chebyshev via real `move()`, walls refuse honestly); no caching (spec: measure first); no quadruped gaits (L4); frames are presentation-only and never persisted; no ledger record of planned action lists — the spec's "action lists recorded in ledger" exists for LLM auditability, but the planner is a static registry today and an extra ledger event would break Probe M's ledger-identity gate; record at AUTHORING time when the LLM lane lands, not at execution time.

## Deviations (canonical — fill during execution)

_(empty until execution)_



