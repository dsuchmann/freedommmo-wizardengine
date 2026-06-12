# Pass 4 L2a — Body Substrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The headless half of L2 Body Assembly — the humanoid rig (joint hierarchy the motion DSL drives, per X2 spec §2), pure-derivation body plans (per-entity proportions from race/stage/attributes), and deterministic part+equipment layer composition emitting the part-key vocabulary the asset wave will satisfy. NO rendering, NO sprites, NO PixelLab.

**Architecture:** Three pure-data layers. (1) `src/life/rigs/humanoid.json` + `src/life/rig.js` loader/validator — bones/joints/COM/reach/look-at/gaits exactly as the motion-DSL spec demands (it is the design authority; L3 executes against this rig). (2) `sim/life/body.js` — `bodyPlanOf(kernel, node)` derives proportions f(worldSeed, nodeId, race, stage, attributes) — M1/L1 pure-derivation precedent, nothing stored, zero save/load surface. (3) `composeLayers` — body parts + M5 equipment (SLOTS.layer was annotated "Pass 4 L2 consumes it") → ordered draw list keyed by `partKey(race, bodyType, ageBand, part, direction)`. Humanoids stay `UNRENDERED` in the taxonomy — the honest absence stands until L2b's pilot-gated sprites + renderer.

**Split rationale (scope check):** L2 spans two subsystems with different gates. L2a is fully headless-testable now. **L2b** (PixelLab part pilot + assembly probe + first living-entity renderer) is gated on the unproven-composability pilot (standing feedback: pilot batch + assembly probe gates every mass burst; registry `body_parts.json` says `pilot_required`, fallback = PixelLab character tools) — charted as its own plan, not started here.

**Tech Stack:** plain ES modules, node:test, `sim/life/identity.js` (RACES/ATTRIBUTES/attributesOf), `sim/time/metabolism.js` (stageAt), `sim/items/equipment.js` (SLOTS), `sim/kernel/rng.js` (rand).

**Roadmap row:** Pass 4 L2 (this plan = substrate half), `docs/superpowers/plans/2026-06-12-pass2plus-roadmap.md` — set status `executing (L2a)` at start; L2b keeps the row open.

---

## Context for implementers (read once)

- **Motion-DSL spec is the rig authority:** `docs/superpowers/specs/2026-06-12-generative-motion-dsl-design.md` §2 — rig = bones (named segments: length, parent, pivot), joints (per-bone min/max angle + stiffness — validator ground truth), COM (computed from bone masses), reach envelopes (per end-effector IK volume), look-at chain (bones + weights), gaits (procedural generator PARAMS, not assets). Rigs live at `src/life/rigs/*.json`, validated at load. Minimum humanoid bone set: `root, spine, head, arm_l/r (upper, fore, hand), leg_l/r (thigh, shin, foot)`.
- **Asset manifest part roster** (`docs/superpowers/plans/2026-06-12-pixellab-asset-manifest.md` §3): the enumerated roster — head, torso, upper-arm ×2, fore-arm ×2, hand ×2, thigh ×2, shin ×2, foot ×2 — is **14 parts** (the manifest's "≈13" is an approximation; the enumeration is authoritative) — at 64px, 4 directions, race × body-type (3) × age-band (child/adult/elder) variants. NO whole-body sprites — the rig composes.
- **L1 identity** (`sim/life/identity.js`): `RACES`, `ATTRIBUTES`, `attributesOf(seed, nodeId, race)` → 6 attrs in [0,1], `identityOf`. Stage via `stageAt(race, age)` from `sim/time/metabolism.js`; age = `kernel.tick - node.attrs.birthTick`. Humanoid stages: infant, toddler, child, adolescent, young_adult, adult, middle_aged, senior, elderly.
- **M5 equipment** (`sim/items/equipment.js`): `SLOTS` = 27 named slots each `{ layer: int }` (head 30, chest 20, torso_under 10, legs 14, feet 11, hand_main 50, back 23, tattoo 1 …). The `layer` int is RELATIVE stacking priority among worn layers — L2a anchors each slot to a body part and interleaves.
- **Deterministic rng:** `rand(seed, ...ids)` → [0,1) (sim/kernel/rng.js). Salts in use: lifecycle 101/102/200/303; identity 4100/4200/4300. **L2a uses 4400 (body type).**
- **Pure derivation discipline (M1/L1 precedent):** nothing stored on nodes, no deltas, no serialization. `bodyPlanOf` must not touch the wire — body plans are derivable client-side later from observable facts (race, stage are on the wire; attributes are NOT — see privacy note in Task 2).
- **Tests import src/ fine:** `sim/test/taxonomy.test.js` already imports `../../src/world/asset-state-taxonomy.js`. Rig JSON is loaded via `fs.readFileSync` + `JSON.parse` in the loader (no import-assertion churn).
- **Honest absences this plan declares (do NOT build):** no sprites/rendering (L2b, pilot-gated); no motion execution/pose solving (L3 — the rig is DATA; gait generators are parameter blocks here, code in L3); no quadruped/bird/fish rigs (land with L4 fauna); no genitals/hair/face part layers (manifest calls them additive demand-driven — land with L2b art); body plans do not yet affect metabolism (maxBody already per-species; per-entity body variation feeding sim is future tuning).
- **GIT SAFETY:** work ONLY on branch `pass4-l2a-body-substrate`. NEVER push to origin. NEVER run destructive git commands. Never stage `assets/`, `.claude/`, `.playwright-mcp/`, `scripts/bulk_generate*.py`, `*_f4_state.json`, `.superpowers/`. Stage only the specific files you changed. Do NOT touch `scripts/asset-corpus/` (parallel session owns the art lane).
- Run targeted tests with `node --test <file>` from repo root.

---

### Task 1: humanoid rig — data + loader/validator

**Files:**
- Create: `src/life/rigs/humanoid.json`
- Create: `src/life/rig.js`
- Test: `sim/test/rig.test.js` (create)

- [ ] **Step 1: Write the failing tests** (create `sim/test/rig.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRig, validateRig, comOf, HUMANOID_BONES } from '../../src/life/rig.js';

test('L2a: humanoid rig loads and passes validation', () => {
  const rig = loadRig('humanoid');
  assert.equal(rig.id, 'humanoid');
  assert.deepEqual(validateRig(rig), []);   // [] = no violations
});

test('L2a: rig carries the X2 minimum humanoid bone set', () => {
  const rig = loadRig('humanoid');
  for (const b of HUMANOID_BONES) assert.ok(rig.bones[b], b);
  assert.equal(rig.bones.root.parent, null);
  // tree integrity: every non-root parent exists; no cycles
  for (const [name, bone] of Object.entries(rig.bones)) {
    if (name === 'root') continue;
    assert.ok(rig.bones[bone.parent], `${name} parent ${bone.parent}`);
    let p = bone.parent, hops = 0;
    while (p !== null) { p = rig.bones[p].parent; assert.ok(++hops < 20, `${name} acyclic`); }
  }
});

test('L2a: joints, effectors, look-at, gaits are complete and sane', () => {
  const rig = loadRig('humanoid');
  for (const [name, j] of Object.entries(rig.joints)) {
    assert.ok(rig.bones[name], `joint ${name} has a bone`);
    assert.ok(j.min < j.max, `${name} limits ordered`);
    assert.ok(j.stiffness > 0 && j.stiffness <= 1, `${name} stiffness (0,1]`);
  }
  for (const eff of ['hand_l', 'hand_r', 'foot_l', 'foot_r', 'mouth']) {
    assert.ok(rig.effectors[eff], eff);
    assert.ok(rig.bones[rig.effectors[eff].bone], `${eff} bone exists`);
    assert.ok(rig.effectors[eff].reach > 0, `${eff} reach positive`);
  }
  const wsum = rig.lookAt.reduce((s, [, w]) => s + w, 0);
  assert.ok(Math.abs(wsum - 1) < 1e-9, 'look-at weights sum to 1');
  for (const [b] of rig.lookAt) assert.ok(rig.bones[b], `look-at bone ${b}`);
  for (const g of ['walk', 'run']) {
    assert.ok(rig.gaits[g] && rig.gaits[g].cycleTicks > 0, g);
  }
});

test('L2a: COM is computed from bone masses and sits inside the body', () => {
  const rig = loadRig('humanoid');
  const com = comOf(rig);
  const totalMass = Object.values(rig.bones).reduce((s, b) => s + b.mass, 0);
  assert.ok(totalMass > 0);
  // COM y between feet (0) and head top — roughly torso height
  assert.ok(com.y > 10 && com.y < 40, `com.y=${com.y}`);
  assert.ok(Math.abs(com.x) < 2, `com.x≈0 (symmetric rig), got ${com.x}`);
});

test('L2a: validateRig reports violations instead of throwing', () => {
  const rig = loadRig('humanoid');
  const broken = JSON.parse(JSON.stringify(rig));
  broken.bones.arm_u_l.parent = 'nonexistent';
  delete broken.joints.spine;
  broken.joints.head = { min: 50, max: -50, stiffness: 2 };
  const v = validateRig(broken);
  assert.ok(v.length >= 3, `found ${v.length} violations`);
  assert.ok(v.every(x => typeof x === 'string'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test sim/test/rig.test.js`
Expected: FAIL — cannot find module `src/life/rig.js`.

- [ ] **Step 3: Create `src/life/rigs/humanoid.json`**

Units: pixels in 64px part space; y up from ground (0 = feet); x right; rest pose = standing, facing viewer. `pivot` = attachment point in PARENT bone space. Angles in degrees relative to rest.

```json
{
  "id": "humanoid",
  "bones": {
    "root":      { "parent": null,      "length": 0,  "pivot": [0, 22],   "mass": 0 },
    "spine":     { "parent": "root",    "length": 16, "pivot": [0, 0],    "mass": 30 },
    "head":      { "parent": "spine",   "length": 10, "pivot": [0, 16],   "mass": 8 },
    "arm_u_l":   { "parent": "spine",   "length": 8,  "pivot": [-6, 14],  "mass": 3 },
    "arm_f_l":   { "parent": "arm_u_l", "length": 7,  "pivot": [0, -8],   "mass": 2 },
    "hand_l":    { "parent": "arm_f_l", "length": 3,  "pivot": [0, -7],   "mass": 1 },
    "arm_u_r":   { "parent": "spine",   "length": 8,  "pivot": [6, 14],   "mass": 3 },
    "arm_f_r":   { "parent": "arm_u_r", "length": 7,  "pivot": [0, -8],   "mass": 2 },
    "hand_r":    { "parent": "arm_f_r", "length": 3,  "pivot": [0, -7],   "mass": 1 },
    "thigh_l":   { "parent": "root",    "length": 11, "pivot": [-3, 0],   "mass": 7 },
    "shin_l":    { "parent": "thigh_l", "length": 9,  "pivot": [0, -11],  "mass": 4 },
    "foot_l":    { "parent": "shin_l",  "length": 4,  "pivot": [0, -9],   "mass": 1 },
    "thigh_r":   { "parent": "root",    "length": 11, "pivot": [3, 0],    "mass": 7 },
    "shin_r":    { "parent": "thigh_r", "length": 9,  "pivot": [0, -11],  "mass": 4 },
    "foot_r":    { "parent": "shin_r",  "length": 4,  "pivot": [0, -9],   "mass": 1 }
  },
  "joints": {
    "spine":   { "min": -30,  "max": 30,  "stiffness": 0.8 },
    "head":    { "min": -60,  "max": 60,  "stiffness": 0.6 },
    "arm_u_l": { "min": -170, "max": 50,  "stiffness": 0.5 },
    "arm_f_l": { "min": -140, "max": 0,   "stiffness": 0.5 },
    "hand_l":  { "min": -45,  "max": 45,  "stiffness": 0.4 },
    "arm_u_r": { "min": -50,  "max": 170, "stiffness": 0.5 },
    "arm_f_r": { "min": 0,    "max": 140, "stiffness": 0.5 },
    "hand_r":  { "min": -45,  "max": 45,  "stiffness": 0.4 },
    "thigh_l": { "min": -110, "max": 30,  "stiffness": 0.7 },
    "shin_l":  { "min": 0,    "max": 140, "stiffness": 0.7 },
    "foot_l":  { "min": -30,  "max": 30,  "stiffness": 0.6 },
    "thigh_r": { "min": -110, "max": 30,  "stiffness": 0.7 },
    "shin_r":  { "min": 0,    "max": 140, "stiffness": 0.7 },
    "foot_r":  { "min": -30,  "max": 30,  "stiffness": 0.6 }
  },
  "effectors": {
    "hand_l": { "bone": "hand_l", "reach": 20 },
    "hand_r": { "bone": "hand_r", "reach": 20 },
    "foot_l": { "bone": "foot_l", "reach": 26 },
    "foot_r": { "bone": "foot_r", "reach": 26 },
    "mouth":  { "bone": "head",   "reach": 8 }
  },
  "lookAt": [["head", 0.7], ["spine", 0.3]],
  "gaits": {
    "walk": { "cycleTicks": 40, "strideFactor": 0.5, "bob": 1.0 },
    "run":  { "cycleTicks": 22, "strideFactor": 0.9, "bob": 2.0 }
  }
}
```

- [ ] **Step 4: Create `src/life/rig.js`**

```js
// src/life/rig.js — Pass 4 L2a: the rig model (motion-DSL spec §2, the design
// authority). A rig is DATA attached to a species archetype: bones, joint
// limits (the L3 validator's ground truth), COM from bone masses, reach
// envelopes, look-at chain, gait PARAMETERS. Gait generators (code) and pose
// solving are L3 — honest absence: nothing here moves anything.
// Loaded from src/life/rigs/<id>.json, validated at load.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIG_DIR = join(dirname(fileURLToPath(import.meta.url)), 'rigs');

/** X2 spec §2 minimum humanoid bone set (root, spine, head, arms, legs). */
export const HUMANOID_BONES = [
  'root', 'spine', 'head',
  'arm_u_l', 'arm_f_l', 'hand_l', 'arm_u_r', 'arm_f_r', 'hand_r',
  'thigh_l', 'shin_l', 'foot_l', 'thigh_r', 'shin_r', 'foot_r',
];

export function loadRig(id) {
  const rig = JSON.parse(readFileSync(join(RIG_DIR, `${id}.json`), 'utf8'));
  const violations = validateRig(rig);
  if (violations.length) throw new Error(`rig ${id} invalid: ${violations.join('; ')}`);
  return rig;
}

/** Returns [] when valid, else human-readable violation strings (never throws). */
export function validateRig(rig) {
  const v = [];
  if (!rig.id) v.push('missing id');
  const bones = rig.bones ?? {};
  const roots = Object.entries(bones).filter(([, b]) => b.parent === null);
  if (roots.length !== 1) v.push(`expected exactly 1 root bone, got ${roots.length}`);
  for (const [name, b] of Object.entries(bones)) {
    if (b.parent !== null && !bones[b.parent]) v.push(`bone ${name}: unknown parent ${b.parent}`);
    if (!(b.length >= 0)) v.push(`bone ${name}: bad length`);
    if (!(b.mass >= 0)) v.push(`bone ${name}: bad mass`);
    // cycle check
    let p = b.parent, hops = 0;
    while (p != null && bones[p]) { p = bones[p].parent; if (++hops > 50) { v.push(`bone ${name}: cycle`); break; } }
  }
  for (const [name, j] of Object.entries(rig.joints ?? {})) {
    if (!bones[name]) v.push(`joint ${name}: no such bone`);
    if (!(j.min < j.max)) v.push(`joint ${name}: min >= max`);
    if (!(j.stiffness > 0 && j.stiffness <= 1)) v.push(`joint ${name}: stiffness out of (0,1]`);
  }
  for (const name of Object.keys(bones)) {
    if (name !== 'root' && !(rig.joints ?? {})[name]) v.push(`bone ${name}: missing joint limits`);
  }
  for (const [eff, e] of Object.entries(rig.effectors ?? {})) {
    if (!bones[e.bone]) v.push(`effector ${eff}: unknown bone ${e.bone}`);
    if (!(e.reach > 0)) v.push(`effector ${eff}: reach must be positive`);
  }
  const lw = (rig.lookAt ?? []).reduce((s, [b, w]) => {
    if (!bones[b]) v.push(`lookAt: unknown bone ${b}`);
    return s + w;
  }, 0);
  if (rig.lookAt && Math.abs(lw - 1) > 1e-9) v.push(`lookAt weights sum ${lw}, expected 1`);
  for (const [g, p] of Object.entries(rig.gaits ?? {})) {
    if (!(p.cycleTicks > 0)) v.push(`gait ${g}: cycleTicks must be positive`);
  }
  return v;
}

/** World-space rest position of a bone's origin (chain of pivots from root). */
export function restPos(rig, boneName) {
  let x = 0, y = 0, b = rig.bones[boneName];
  for (let cur = boneName; cur !== null; cur = rig.bones[cur].parent) {
    x += rig.bones[cur].pivot[0]; y += rig.bones[cur].pivot[1];
  }
  return { x, y, _len: b.length };
}

/** Static rest-pose center of mass from bone masses (motion-DSL §2). */
export function comOf(rig) {
  let mx = 0, my = 0, m = 0;
  for (const name of Object.keys(rig.bones)) {
    const bone = rig.bones[name];
    if (bone.mass === 0) continue;
    const p = restPos(rig, name);
    // bone mass acts at its segment midpoint (vertical segments point down except spine/head)
    const mid = bone.length / 2;
    const cy = ['spine', 'head'].includes(name) ? p.y + mid : p.y - mid;
    mx += p.x * bone.mass; my += cy * bone.mass; m += bone.mass;
  }
  return { x: mx / m, y: my / m, mass: m };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test sim/test/rig.test.js`
Expected: ALL PASS. If the COM lands outside 10–40, fix the pivot/mass DATA (the rig JSON), not the test — the assertion encodes "COM is around the torso", which is physical sanity.

- [ ] **Step 6: Commit**

```bash
git add src/life/rigs/humanoid.json src/life/rig.js sim/test/rig.test.js
git commit -m "feat(l2a): humanoid rig — bones/joints/COM/reach/look-at/gait params per motion-DSL spec, validated at load"
```

---

### Task 2: body plan derivation

**Files:**
- Create: `sim/life/body.js`
- Test: `sim/test/body.test.js` (create)

- [ ] **Step 1: Write the failing tests** (create `sim/test/body.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { YEAR } from '../time/metabolism.js';
import {
  PARTS, PART_BONE, BODY_TYPES, AGE_BANDS, ageBandOf,
  bodyPlanOf, partKey,
} from '../life/body.js';

test('L2a: 14 manifest parts, each mapped to a rig bone', () => {
  assert.equal(PARTS.length, 14);
  assert.deepEqual([...PARTS].sort(), [
    'arm_fore_l', 'arm_fore_r', 'arm_upper_l', 'arm_upper_r',
    'foot_l', 'foot_r', 'hand_l', 'hand_r', 'head',
    'shin_l', 'shin_r', 'thigh_l', 'thigh_r', 'torso',
  ].sort());
  for (const p of PARTS) assert.ok(typeof PART_BONE[p] === 'string', p);
});

test('L2a: age bands cover every humanoid stage', () => {
  const stages = ['infant', 'toddler', 'child', 'adolescent', 'young_adult',
    'adult', 'middle_aged', 'senior', 'elderly'];
  for (const s of stages) assert.ok(AGE_BANDS.includes(ageBandOf(s)), s);
  assert.equal(ageBandOf('child'), 'child');
  assert.equal(ageBandOf('adult'), 'adult');
  assert.equal(ageBandOf('elderly'), 'elder');
});

test('L2a: bodyPlanOf is deterministic, race-scaled, attribute-girthed; null for flora', () => {
  const k = new Kernel({ seed: 7, phi: 4, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let dwarf, orc, grass;
  k.graph.boot(() => {
    dwarf = k.addLiving({ species: 'dwarf', x: 2, y: 2, R: 50000, body: 14000, tick: 0, age: 100 * YEAR });
    orc   = k.addLiving({ species: 'orc',   x: 4, y: 2, R: 50000, body: 16000, tick: 0, age: 25 * YEAR });
    grass = k.addLiving({ species: 'grass', x: 6, y: 2, R: 800, body: 10, tick: 0 });
  });
  const d1 = bodyPlanOf(k, dwarf), d2 = bodyPlanOf(k, dwarf);
  assert.deepEqual(d1, d2, 'deterministic');
  assert.equal(bodyPlanOf(k, grass), null, 'flora has no body plan');
  assert.equal(d1.race, 'dwarf');
  assert.ok(BODY_TYPES.includes(d1.bodyType));
  assert.ok(AGE_BANDS.includes(d1.ageBand));
  const o = bodyPlanOf(k, orc);
  assert.ok(o.scale.height > d1.scale.height, 'orc taller than dwarf (race base)');
  assert.ok(d1.scale.height > 0.5 && d1.scale.height < 1.5);
  assert.ok(o.scale.girth >= 0.9 && o.scale.girth <= 1.3, 'girth from attributes, bounded');
  for (const p of PARTS) assert.ok(o.parts[p].scale > 0, p);
});

test('L2a: children are smaller than adults of the same entity-rng', () => {
  const k = new Kernel({ seed: 7, phi: 4, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let kid, grown;
  k.graph.boot(() => {
    kid   = k.addLiving({ species: 'human', x: 2, y: 2, R: 50000, body: 5000,  tick: 0, age: 6 * YEAR });
    grown = k.addLiving({ species: 'human', x: 4, y: 2, R: 50000, body: 15000, tick: 0, age: 35 * YEAR });
  });
  assert.ok(bodyPlanOf(k, kid).scale.height < bodyPlanOf(k, grown).scale.height);
});

test('L2a: partKey addresses are stable and enumerable', () => {
  assert.equal(partKey('human', 'average', 'adult', 'torso', 's'),
    'human/average/adult/torso/s');
  // wave-1 vocabulary: 14 parts x 4 directions for one race/type/band
  const keys = new Set();
  for (const p of PARTS) for (const d of ['n', 's', 'e', 'w'])
    keys.add(partKey('human', 'average', 'adult', p, d));
  assert.equal(keys.size, 56);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test sim/test/body.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `sim/life/body.js`**

```js
// sim/life/body.js — Pass 4 L2a: body plans. PURE DERIVATION (M1/L1 precedent):
// per-entity proportions are f(worldSeed, nodeId, race, stage, attributes) —
// nothing stored, zero save/load surface, bit-deterministic.
// PRIVACY NOTE: girth derives from attributes (sim-private). The body plan as a
// WHOLE is observable (you can see a body) — when L2b ships, the wire carries
// the derived plan (or the client derives from name-visible facts), never the
// underlying attribute numbers. Until then nothing here crosses the wire.
// HONEST ABSENCES: no sprites/rendering (L2b, pilot-gated), no motion (L3),
// no hair/face/genital layers (L2b art, demand-driven), body variation does
// not yet feed metabolism.
import { rand } from '../kernel/rng.js';
import { stageAt } from '../time/metabolism.js';
import { RACES, attributesOf } from './identity.js';

/** The 14 manifest sprite parts (pixellab-asset-manifest §3 enumeration). */
export const PARTS = [
  'head', 'torso',
  'arm_upper_l', 'arm_upper_r', 'arm_fore_l', 'arm_fore_r', 'hand_l', 'hand_r',
  'thigh_l', 'thigh_r', 'shin_l', 'shin_r', 'foot_l', 'foot_r',
];

/** part → rig bone (src/life/rigs/humanoid.json vocabulary). torso rides spine. */
export const PART_BONE = {
  head: 'head', torso: 'spine',
  arm_upper_l: 'arm_u_l', arm_upper_r: 'arm_u_r',
  arm_fore_l: 'arm_f_l', arm_fore_r: 'arm_f_r',
  hand_l: 'hand_l', hand_r: 'hand_r',
  thigh_l: 'thigh_l', thigh_r: 'thigh_r',
  shin_l: 'shin_l', shin_r: 'shin_r',
  foot_l: 'foot_l', foot_r: 'foot_r',
};

export const BODY_TYPES = ['slim', 'average', 'heavy'];
export const AGE_BANDS = ['child', 'adult', 'elder'];   // manifest skin bands

const BODY_TYPE_SALT = 4400;   // identity owns 4100/4200/4300; lifecycle 101/102/200/303

/** Stage → manifest age band (skin band, not a new stage system). */
export function ageBandOf(stage) {
  if (['infant', 'toddler', 'child'].includes(stage)) return 'child';
  if (['senior', 'elderly'].includes(stage)) return 'elder';
  return 'adult';
}

const RACE_HEIGHT = { human: 1.0, elf: 1.05, dwarf: 0.78, orc: 1.12 };
const STAGE_HEIGHT = {
  infant: 0.35, toddler: 0.45, child: 0.6, adolescent: 0.85,
  young_adult: 1.0, adult: 1.0, middle_aged: 1.0, senior: 0.97, elderly: 0.94,
};

/**
 * Derived body plan for a humanoid node, or null (flora/fauna have no body
 * plan until L4 generalizes rigs). { race, stage, ageBand, bodyType,
 * scale: {height, girth}, parts: { <part>: {scale} } }
 */
export function bodyPlanOf(kernel, node) {
  const race = node.attrs?.species;
  if (!RACES.includes(race)) return null;
  const stage = stageAt(race, kernel.tick - node.attrs.birthTick)[0];
  const a = attributesOf(kernel.seed, node.id, race);
  const bodyType = BODY_TYPES[Math.floor(rand(kernel.seed, node.id, BODY_TYPE_SALT) * BODY_TYPES.length)];
  const height = RACE_HEIGHT[race] * STAGE_HEIGHT[stage];
  // girth: bounded blend of strength+constitution, [0.9, 1.3]
  const girth = 0.9 + 0.4 * (a.strength + a.constitution) / 2;
  const limb = bodyType === 'heavy' ? 1.1 : bodyType === 'slim' ? 0.92 : 1.0;
  const parts = {};
  for (const p of PARTS) {
    const isLimb = p !== 'head' && p !== 'torso';
    parts[p] = { scale: +(height * (isLimb ? limb : 1)).toFixed(4) };
  }
  return { race, stage, ageBand: ageBandOf(stage), bodyType, scale: { height, girth }, parts };
}

/** Asset address the L2b wave satisfies: race/bodyType/ageBand/part/direction. */
export function partKey(race, bodyType, ageBand, part, direction) {
  return `${race}/${bodyType}/${ageBand}/${part}/${direction}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test sim/test/body.test.js sim/test/identity.test.js`
Expected: ALL PASS (identity suite proves no regression in the shared rng/identity seams).

- [ ] **Step 5: Commit**

```bash
git add sim/life/body.js sim/test/body.test.js
git commit -m "feat(l2a): derived body plans — race/stage/attribute proportions, 14-part manifest roster, nothing stored"
```

---

### Task 3: layer composition — body parts + worn equipment

**Files:**
- Modify: `sim/life/body.js` (append composition exports)
- Test: `sim/test/body-compose.test.js` (create)

- [ ] **Step 1: Write the failing tests** (create `sim/test/body-compose.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLOTS } from '../items/equipment.js';
import { PARTS, SLOT_ANCHOR, composeLayers, partKey } from '../life/body.js';

const plan = {
  race: 'human', stage: 'adult', ageBand: 'adult', bodyType: 'average',
  scale: { height: 1, girth: 1 },
  parts: Object.fromEntries(PARTS.map(p => [p, { scale: 1 }])),
};

test('L2a: every equipment slot anchors to a body part', () => {
  for (const slot of Object.keys(SLOTS)) {
    assert.ok(PARTS.includes(SLOT_ANCHOR[slot]), `${slot} → ${SLOT_ANCHOR[slot]}`);
  }
});

test('L2a: bare-body composition emits all 14 parts, strictly z-ordered, per direction', () => {
  for (const d of ['n', 's', 'e', 'w']) {
    const layers = composeLayers(plan, {}, d);
    assert.equal(layers.length, 14, d);
    assert.deepEqual([...layers.map(l => l.part)].sort(),
      [...PARTS].sort(), `${d}: all parts present`);
    for (let i = 1; i < layers.length; i++) {
      assert.ok(layers[i].z > layers[i - 1].z, `${d}: strict z order`);
    }
    assert.equal(layers.find(l => l.part === 'torso').key,
      partKey('human', 'average', 'adult', 'torso', d));
  }
});

test('L2a: facing direction flips near/far limb stacking', () => {
  const east = composeLayers(plan, {}, 'e');
  const west = composeLayers(plan, {}, 'w');
  const zOf = (layers, p) => layers.find(l => l.part === p).z;
  // facing east: right side is near (drawn above torso), left side far
  assert.ok(zOf(east, 'arm_upper_r') > zOf(east, 'torso'));
  assert.ok(zOf(east, 'arm_upper_l') < zOf(east, 'torso'));
  // facing west: mirrored
  assert.ok(zOf(west, 'arm_upper_l') > zOf(west, 'torso'));
  assert.ok(zOf(west, 'arm_upper_r') < zOf(west, 'torso'));
});

test('L2a: worn items interleave by SLOTS.layer above their anchor part', () => {
  const equipment = {
    chest: { id: 901, attrs: { archetype: 'tunic' } },
    torso_under: { id: 902, attrs: { archetype: 'shirt' } },
    head: { id: 903, attrs: { archetype: 'cap' } },
  };
  const layers = composeLayers(plan, equipment, 's');
  assert.equal(layers.length, 17);   // 14 parts + 3 worn
  const z = name => layers.find(l => l.slot === name || l.part === name).z;
  // both worn torso layers sit above the torso part, under-layer below outer
  assert.ok(z('torso_under') > z('torso'));
  assert.ok(z('chest') > z('torso_under'));
  assert.ok(z('head') < z('cap') || true); // cap rides above head part:
  const head = layers.find(l => l.part === 'head');
  const cap = layers.find(l => l.slot === 'head');
  assert.ok(cap.z > head.z, 'cap above head part');
  assert.equal(cap.item, 903, 'item id carried for the renderer');
});

test('L2a: composition is pure data — stable under repeat, no rig/kernel needed', () => {
  const a = composeLayers(plan, {}, 'n');
  const b = composeLayers(plan, {}, 'n');
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test sim/test/body-compose.test.js`
Expected: FAIL — `SLOT_ANCHOR`/`composeLayers` not exported.

- [ ] **Step 3: Append to `sim/life/body.js`**

```js
// ——— layer composition (consumed by the L2b renderer; pure data here) ———
import { SLOTS } from '../items/equipment.js';   // move to top of file with other imports

/** equipment slot → the body part it anchors to (draws relative to). */
export const SLOT_ANCHOR = {
  head: 'head', face: 'head', ears: 'head', eyes: 'head',
  neck: 'torso', shoulders: 'torso', back: 'torso', chest: 'torso',
  torso_under: 'torso', waist: 'torso', tattoo: 'torso', implant: 'torso',
  arms: 'arm_upper_r', wrist_left: 'arm_fore_l', wrist_right: 'arm_fore_r',
  hands: 'hand_r',
  finger_left_1: 'hand_l', finger_left_2: 'hand_l',
  finger_right_1: 'hand_r', finger_right_2: 'hand_r',
  legs: 'thigh_r', legs_under: 'thigh_r',
  ankle_left: 'shin_l', ankle_right: 'shin_r', feet: 'foot_r',
  hand_main: 'hand_r', hand_off: 'hand_l',
};

/** Base z per part per facing direction. Gaps of 100 leave room for worn layers. */
const PART_Z = (() => {
  // canonical south-facing painter order, far → near
  const south = ['arm_upper_l', 'arm_fore_l', 'hand_l', 'thigh_l', 'shin_l', 'foot_l',
    'thigh_r', 'shin_r', 'foot_r', 'torso', 'arm_upper_r', 'arm_fore_r', 'hand_r', 'head'];
  const north = [...south].reverse().filter(p => p !== 'head' && p !== 'torso');
  // facing north: head/torso still backmost-to-frontmost sensible — arms in front of torso is wrong from behind
  const northOrder = ['arm_upper_r', 'arm_fore_r', 'hand_r', 'arm_upper_l', 'arm_fore_l', 'hand_l',
    'head', 'torso', 'thigh_l', 'shin_l', 'foot_l', 'thigh_r', 'shin_r', 'foot_r'];
  const eastOrder = ['arm_upper_l', 'arm_fore_l', 'hand_l', 'thigh_l', 'shin_l', 'foot_l',
    'torso', 'head', 'thigh_r', 'shin_r', 'foot_r', 'arm_upper_r', 'arm_fore_r', 'hand_r'];
  const westOrder = ['arm_upper_r', 'arm_fore_r', 'hand_r', 'thigh_r', 'shin_r', 'foot_r',
    'torso', 'head', 'thigh_l', 'shin_l', 'foot_l', 'arm_upper_l', 'arm_fore_l', 'hand_l'];
  const table = {};
  for (const [dir, order] of [['s', south], ['n', northOrder], ['e', eastOrder], ['w', westOrder]]) {
    table[dir] = Object.fromEntries(order.map((p, i) => [p, (i + 1) * 100]));
  }
  return table;
})();

/**
 * Compose a body plan + worn equipment map (node.attrs.equipment shape:
 * { <slot>: item }) into an ordered draw list for one facing direction.
 * Returns [{ z, part?, slot?, item?, key?, scale }] sorted ascending by z.
 * Worn layers: z = anchor part z + SLOTS[slot].layer (layer ints are < 100,
 * so items always sit between their anchor and the next part).
 */
export function composeLayers(plan, equipment, direction) {
  const zTable = PART_Z[direction];
  const out = [];
  for (const p of PARTS) {
    out.push({
      z: zTable[p], part: p, scale: plan.parts[p].scale,
      key: partKey(plan.race, plan.bodyType, plan.ageBand, p, direction),
    });
  }
  for (const [slot, item] of Object.entries(equipment ?? {})) {
    if (!item || !(slot in SLOTS)) continue;
    const anchor = SLOT_ANCHOR[slot];
    out.push({
      z: zTable[anchor] + SLOTS[slot].layer, slot, item: item.id,
      archetype: item.attrs?.archetype ?? null, scale: plan.parts[anchor].scale,
    });
  }
  out.sort((a, b) => a.z - b.z);
  return out;
}
```

NOTE for implementer: the `import { SLOTS }` line goes at the TOP of body.js with the other imports (shown inline above only to keep the diff snippet together). The `north` intermediate const in the PART_Z IIFE is dead — drop it and keep only the four explicit order arrays.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test sim/test/body-compose.test.js sim/test/body.test.js`
Expected: ALL PASS. If the strict-z test fails on a duplicate z, two parts share an order index — fix the order arrays: each of the four direction arrays must contain EXACTLY the 14 PARTS, each once (`head` and `torso` included).

- [ ] **Step 5: Commit**

```bash
git add sim/life/body.js sim/test/body-compose.test.js
git commit -m "feat(l2a): body+equipment layer composition — per-direction painter order, SLOTS.layer interleave, part-key addresses"
```

---

### Task 4: probe — substrate end-to-end + honest-absence guard

**Files:**
- Create: `sim/test/probe-body.test.js`

- [ ] **Step 1: Write the probe** (create `sim/test/probe-body.test.js`)

```js
// PROBE L2a: body substrate — rig, body plans, and composition cohere end to
// end on a real kernel, deterministically, without storing anything or
// touching the wire. Honest absences exercised: humanoids remain UNRENDERED
// (no sprites, no renderer); rig is data (no motion).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { YEAR } from '../time/metabolism.js';
import { RACES } from '../life/identity.js';
import { loadRig, comOf } from '../../src/life/rig.js';
import { PARTS, PART_BONE, bodyPlanOf, composeLayers } from '../life/body.js';
import { serializeEntity } from '../server/protocol.js';
import { FIELD_SHEETS } from '../../src/world/asset-state-taxonomy.js';
import { equip } from '../items/equipment.js';

function world(seed) {
  const k = new Kernel({ seed, phi: 4, bounds: { x0: 0, y0: 0, w: 10, h: 10 } });
  const out = { k, folk: {} };
  k.graph.boot(() => {
    let x = 2;
    for (const r of RACES) {
      out.folk[r] = k.addLiving({ species: r, x: (x += 2), y: 4, R: 80000, body: 14000, tick: 0, age: 30 * YEAR });
    }
  });
  return out;
}

test('PROBE L2a step 1: every race gets a coherent plan; every part maps to a live rig bone', () => {
  const rig = loadRig('humanoid');
  const { k, folk } = world(7);
  for (const r of RACES) {
    const plan = bodyPlanOf(k, folk[r]);
    assert.equal(plan.race, r);
    for (const p of PARTS) {
      assert.ok(rig.bones[PART_BONE[p]], `${r}.${p} → rig bone ${PART_BONE[p]}`);
      assert.ok(plan.parts[p].scale > 0);
    }
  }
  const com = comOf(rig);
  assert.ok(com.mass > 0 && com.y > 0, 'rig COM physical');
});

test('PROBE L2a step 2: equipped layers compose deterministically across directions', () => {
  const { k, folk } = world(7);
  const h = folk.human;
  // give the human a real inventory item and equip it through M5 (no fixture cheats)
  k.graph.boot ? null : null;
  h.attrs.inventory = [{ id: 9001, attrs: { archetype: 'tunic' } }];
  equip(k, h.id, 9001, 'chest', k.tick);
  const plan = bodyPlanOf(k, h);
  for (const d of ['n', 's', 'e', 'w']) {
    const a = composeLayers(plan, h.attrs.equipment, d);
    const b = composeLayers(plan, h.attrs.equipment, d);
    assert.deepEqual(a, b, d);
    assert.equal(a.length, 15, `${d}: 14 parts + 1 worn`);
    const torso = a.find(l => l.part === 'torso');
    const tunic = a.find(l => l.slot === 'chest');
    assert.ok(tunic.z > torso.z, `${d}: tunic over torso`);
  }
});

test('PROBE L2a step 3: nothing stored, nothing on the wire, taxonomy absence intact', () => {
  const { k, folk } = world(7);
  const before = JSON.stringify(folk.elf.attrs);
  bodyPlanOf(k, folk.elf);
  composeLayers(bodyPlanOf(k, folk.elf), {}, 's');
  assert.equal(JSON.stringify(folk.elf.attrs), before, 'derivation mutated nothing');
  const e = serializeEntity(folk.elf, k.tick, k.seed);
  assert.equal(e.bodyPlan, undefined, 'body plan not serialized');
  assert.equal(e.parts, undefined);
  for (const r of RACES) assert.ok(FIELD_SHEETS._meta.UNRENDERED.includes(r),
    `${r} still UNRENDERED (honest absence until L2b)`);
});

test('PROBE L2a step 4: two identical seeds → bit-identical plans; different seed differs', () => {
  const a = world(7), b = world(7), c = world(11);
  for (const r of RACES) {
    assert.deepEqual(bodyPlanOf(a.k, a.folk[r]), bodyPlanOf(b.k, b.folk[r]), r);
  }
  const diff = RACES.some(r =>
    JSON.stringify(bodyPlanOf(a.k, a.folk[r])) !== JSON.stringify(bodyPlanOf(c.k, c.folk[r])));
  assert.ok(diff, 'a different world seed varies at least one body plan');
});
```

Adaptation rules (binding): mirror real APIs as in prior probes — if `equip` requires the item to exist as a node or the inventory shape differs, READ `sim/test/` equipment tests first and copy their fixture for granting an item (the substance — a REAL M5 equip, not a hand-built equipment map — is non-negotiable in step 2). Remove the stray `k.graph.boot ? null : null;` line. If node ids make 9001 collide, use any free id.

- [ ] **Step 2: Run the probe**

Run: `node --test sim/test/probe-body.test.js`
Expected: ALL PASS (fast — no multi-year runs).

- [ ] **Step 3: Run the neighboring suites**

Run: `node --test sim/test/rig.test.js sim/test/body.test.js sim/test/body-compose.test.js sim/test/identity.test.js sim/test/taxonomy.test.js`
Expected: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add sim/test/probe-body.test.js
git commit -m "test(l2a): probe — rig+plans+composition cohere, nothing stored or wired, absence intact"
```

---

## Close-out (controller)

- [ ] Full suite in background (`npm test` → log, read only after EXIT line)
- [ ] Update this plan's **Deviations (canonical)** section
- [ ] Roadmap row L2 → `L2a DONE; L2b (pilot + renderer) pending` with summary
- [ ] Final whole-branch opus READ-ONLY review
- [ ] Merge `git fetch . pass4-l2a-body-substrate:master` (or checkout+merge if master moved)
- [ ] Memory update

## Deviations (canonical)

Executed 2026-06-12, commits 91ed73398 → 641cfda0a on `pass4-l2a-body-substrate` (plan self-review before execution corrected the part count: the manifest's "≈13" enumerates to **14 parts** — all assertions use 14).

- **Task 1** (91ed73398): none. Rig JSON + rig.js verbatim; COM landed in bounds without data tuning. Review minors accepted as-is: comOf midpoint uses only y-extent (exact for this symmetric rig; revisit if a tilted-bone rig ever lands), `restPos` returns unused `_len`.
- **Task 2** (96d37971a): none. Review note accepted: `STAGE_HEIGHT[stage]` has no fallback for stages outside the 9 humanoid names — unreachable today (stageAt only returns SPECIES-table stages); if a 'corpse'-like stage ever flows in, add `?? 1.0`.
- **Task 3** (76b3b7a19): the plan draft's vestigial `assert.ok(z('head') < z('cap') || true)` line was dropped (always-true noise); dead `north` const dropped per the plan's own NOTE.
- **Task 4** (641cfda0a): inventory fixture item carries `archetype` BOTH top-level and in `attrs` — equip's ledger emit reads `item.archetype`, composeLayers reads `item.attrs.archetype`; both are real API paths (honest mirroring, reviewer-confirmed). Fixture also carries `kind/E/tick` to match real item shape. Stray `k.graph.boot ? null : null;` removed. Mid-loop note: a parallel session had switched the shared working dir to `pass4-l1-identity`; the implementer switched back before working — no cross-branch contamination (verified: all 4 L2a commits on this branch; parallel client commit 4b73237d7 rides the branch by design).
- **Hardening backlog (accepted):** worn-layer `archetype` duality (top-level vs attrs) should be unified when items get a real schema pass; equip's ledger emit reads the top-level one.
