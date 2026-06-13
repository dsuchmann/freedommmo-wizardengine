# Motion Eval System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An automated pipeline where any motion command produces a visually-verified choreography via stick-figure rendering + vision-model eval, stored in a permanent validated dictionary reusable by any entity.

**Architecture:** Verified poses (atoms) compose into choreographies (molecules) via LLM. A stick-figure renderer draws each motion as a frame strip. A vision model judges whether the strip matches the command. Passes go to the validated dictionary; failures get critique-driven retries. A QA workbench provides a browser UI for browsing, previewing, and generating motions.

**Tech Stack:** `solvePose` (FK, `src/life/pose.js`), `@napi-rs/canvas` (Node headless rendering), OpenAI gpt-4o-mini (vision eval + composition), existing provider system (`src/life/motion-llm.js`).

**Key files (read before starting any task):**
- `src/life/pose.js` — FK solver, `solvePose(rig, joints)` → `{bone: {origin, tip, worldDeg}}`
- `src/life/rigs/humanoid.json` — rig data (15 bones, 14 joints with min/max)
- `src/life/motion-llm.js` — OpenAI/Anthropic provider abstraction
- `src/render/motion-player.js` — browser-safe track solver + playback
- `src/life/choreography/postures.js` — 14 named postures with joint snapshots
- `docs/superpowers/specs/2026-06-13-motion-eval-system-design.md` — full spec

---

### Task 1: Install @napi-rs/canvas + stick figure renderer

**Files:**
- Modify: `package.json` (add `@napi-rs/canvas` dependency)
- Create: `src/life/eval/stick-renderer.js`
- Test: `sim/test/stick-renderer.test.js`

- [ ] **Step 1: Install @napi-rs/canvas**

```bash
npm install @napi-rs/canvas
```

- [ ] **Step 2: Write the failing test**

```js
// sim/test/stick-renderer.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPose, renderStrip } from '../../src/life/eval/stick-renderer.js';
import { readFileSync } from 'node:fs';

const rig = JSON.parse(readFileSync('src/life/rigs/humanoid.json', 'utf8'));

test('renderPose returns a PNG buffer for rest pose', async () => {
  const buf = await renderPose(rig, {}, { width: 400, height: 600 });
  assert.ok(Buffer.isBuffer(buf), 'should return a Buffer');
  assert.ok(buf.length > 100, 'buffer should contain image data');
  // PNG magic bytes
  assert.ok(buf[0] === 0x89 && buf[1] === 0x50, 'should be a PNG');
});

test('renderPose with joints produces different image than rest', async () => {
  const rest = await renderPose(rig, {}, { width: 400, height: 600 });
  const wave = await renderPose(rig, { arm_u_r: 150 }, { width: 400, height: 600 });
  assert.ok(!rest.equals(wave), 'posed image should differ from rest');
});

test('renderStrip produces a wide image from multiple frames', async () => {
  const frames = [
    { joints: {}, label: 'rest' },
    { joints: { arm_u_r: 150 }, label: 'arm up' },
    { joints: {}, label: 'rest' },
  ];
  const buf = await renderStrip(rig, frames, { frameWidth: 200, frameHeight: 400, title: 'wave test' });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 100);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test sim/test/stick-renderer.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 4: Implement stick-renderer.js**

```js
// src/life/eval/stick-renderer.js — Renders the humanoid rig as a color-coded
// stick figure. Used by the eval pipeline (Node headless via @napi-rs/canvas)
// and the QA workbench (browser native canvas).
//
// solvePose is imported from src/life/pose.js (pure math, no deps).
import { solvePose } from '../pose.js';

// Bone colors by group
const BONE_COLORS = {
  spine: '#e0e0e0', head: '#f0d060',
  arm_u_l: '#6090e0', arm_f_l: '#6090e0', hand_l: '#6090e0',
  arm_u_r: '#4070c0', arm_f_r: '#4070c0', hand_r: '#4070c0',
  thigh_l: '#50b050', shin_l: '#50b050', foot_l: '#50b050',
  thigh_r: '#308030', shin_r: '#308030', foot_r: '#308030',
};
const JOINT_RADIUS = 4;
const BONE_WIDTH = 3;
const BG_COLOR = '#1a1a1a';
const GROUND_COLOR = '#444';

/** Draw one pose onto a canvas context.
 *  coordSpace: the rig's y-up world is mapped to canvas y-down.
 *  Scale + translate so the figure is centered and fills ~70% of the frame. */
function drawPose(ctx, rig, joints, x, y, w, h, opts = {}) {
  const solved = solvePose(rig, joints);
  // Compute bounding box of rest pose for consistent framing
  const restSolved = solvePose(rig, {});
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of Object.values(restSolved)) {
    for (const p of [b.origin, b.tip]) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  // Also include current pose in bounds
  for (const b of Object.values(solved)) {
    for (const p of [b.origin, b.tip]) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  const rigW = maxX - minX || 1;
  const rigH = maxY - minY || 1;
  const scale = Math.min(w * 0.7 / rigW, h * 0.7 / rigH);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  const toScreen = (p) => ({
    sx: cx + (p.x - midX) * scale,
    sy: cy - (p.y - midY) * scale,  // flip y
  });

  // Ground line at foot level (min y of rest pose)
  const groundY = cy - (minY - midY) * scale + 5;
  ctx.strokeStyle = GROUND_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 10, groundY);
  ctx.lineTo(x + w - 10, groundY);
  ctx.stroke();

  // Draw bones
  const drawOrder = ['thigh_l', 'shin_l', 'foot_l', 'thigh_r', 'shin_r', 'foot_r',
    'spine', 'arm_u_l', 'arm_f_l', 'hand_l', 'arm_u_r', 'arm_f_r', 'hand_r', 'head'];
  for (const name of drawOrder) {
    const b = solved[name];
    if (!b || rig.bones[name].length === 0) continue;
    const from = toScreen(b.origin);
    const to = toScreen(b.tip);
    ctx.strokeStyle = BONE_COLORS[name] || '#aaa';
    ctx.lineWidth = BONE_WIDTH;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(from.sx, from.sy);
    ctx.lineTo(to.sx, to.sy);
    ctx.stroke();
  }

  // Draw joints
  for (const name of drawOrder) {
    const b = solved[name];
    if (!b) continue;
    const o = toScreen(b.origin);
    ctx.fillStyle = BONE_COLORS[name] || '#aaa';
    ctx.beginPath();
    ctx.arc(o.sx, o.sy, JOINT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  // Head circle (larger, at tip of head bone)
  const headTip = toScreen(solved.head.tip);
  ctx.strokeStyle = BONE_COLORS.head;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(headTip.sx, headTip.sy, 8, 0, Math.PI * 2);
  ctx.stroke();

  // Label if provided
  if (opts.label) {
    ctx.fillStyle = '#888';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(opts.label, x + w / 2, y + h - 8);
  }
}

/** Create a canvas (Node or browser). Returns { canvas, ctx }. */
async function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return { canvas: c, ctx: c.getContext('2d') };
  }
  const { createCanvas } = await import('@napi-rs/canvas');
  const c = createCanvas(w, h);
  return { canvas: c, ctx: c.getContext('2d') };
}

/** Render a single pose to a PNG buffer (Node) or canvas (browser). */
export async function renderPose(rig, joints, { width = 400, height = 600, label = '' } = {}) {
  const { canvas, ctx } = await makeCanvas(width, height);
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, width, height);
  drawPose(ctx, rig, joints, 0, 0, width, height, { label });
  if (typeof document !== 'undefined') return canvas;
  return canvas.toBuffer('image/png');
}

/** Render a strip of frames side by side. frames = [{joints, label}].
 *  Returns PNG buffer (Node) or canvas (browser). */
export async function renderStrip(rig, frames, { frameWidth = 200, frameHeight = 400, title = '' } = {}) {
  const totalW = frameWidth * frames.length;
  const headerH = title ? 30 : 0;
  const { canvas, ctx } = await makeCanvas(totalW, frameHeight + headerH);
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, totalW, frameHeight + headerH);

  if (title) {
    ctx.fillStyle = '#ccc';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(title, totalW / 2, 20);
  }

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    // Separator line between frames
    if (i > 0) {
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(i * frameWidth, headerH);
      ctx.lineTo(i * frameWidth, frameHeight + headerH);
      ctx.stroke();
    }
    drawPose(ctx, rig, f.joints, i * frameWidth, headerH, frameWidth, frameHeight, { label: f.label });
  }

  if (typeof document !== 'undefined') return canvas;
  return canvas.toBuffer('image/png');
}

// Export drawPose for browser QA workbench (direct canvas drawing)
export { drawPose };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test sim/test/stick-renderer.test.js`
Expected: 3/3 PASS

- [ ] **Step 6: Visual smoke test — write rest pose to disk and inspect**

```bash
node -e "
import { renderPose } from './src/life/eval/stick-renderer.js';
import { readFileSync, writeFileSync } from 'fs';
const rig = JSON.parse(readFileSync('src/life/rigs/humanoid.json', 'utf8'));
const buf = await renderPose(rig, {}, { width: 400, height: 600, label: 'rest pose' });
writeFileSync('_test_rest.png', buf);
console.log('wrote _test_rest.png');
"
```

Open `_test_rest.png` and verify: upright stick figure, colored bones (blue arms, green legs, white spine, yellow head), ground line, centered in frame.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/life/eval/stick-renderer.js sim/test/stick-renderer.test.js
git commit -m "feat(eval): stick figure renderer — FK skeleton for pose/motion visualization"
```

---

### Task 2: Verified pose dictionary + bootstrap

**Files:**
- Create: `src/life/choreography/poses.json`
- Create: `src/life/eval/pose-bootstrap.js` (script)
- Test: `sim/test/pose-dictionary.test.js`

- [ ] **Step 1: Write the failing test**

```js
// sim/test/pose-dictionary.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rig = JSON.parse(readFileSync('src/life/rigs/humanoid.json', 'utf8'));
const poses = JSON.parse(readFileSync('src/life/choreography/poses.json', 'utf8'));

test('poses.json is a non-empty array of valid poses', () => {
  assert.ok(Array.isArray(poses));
  assert.ok(poses.length >= 30, `expected >= 30 poses, got ${poses.length}`);
});

test('every pose has required fields', () => {
  for (const p of poses) {
    assert.ok(p.id, `pose missing id: ${JSON.stringify(p)}`);
    assert.ok(typeof p.joints === 'object', `${p.id}: joints must be object`);
    assert.ok(p.desc, `${p.id}: missing desc`);
    assert.ok(Array.isArray(p.tags), `${p.id}: tags must be array`);
    assert.ok(p.category, `${p.id}: missing category`);
  }
});

test('every pose id is unique', () => {
  const ids = poses.map(p => p.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepStrictEqual(dupes, [], `duplicate ids: ${dupes}`);
});

test('all joint values are within rig limits', () => {
  for (const p of poses) {
    for (const [j, deg] of Object.entries(p.joints)) {
      const lim = rig.joints[j];
      assert.ok(lim, `${p.id}: unknown joint ${j}`);
      assert.ok(deg >= lim.min && deg <= lim.max,
        `${p.id}: ${j}=${deg} out of [${lim.min},${lim.max}]`);
    }
  }
});

test('rest pose exists with empty joints', () => {
  const rest = poses.find(p => p.id === 'rest');
  assert.ok(rest, 'rest pose must exist');
  assert.deepStrictEqual(rest.joints, {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/pose-dictionary.test.js`
Expected: FAIL (poses.json doesn't exist)

- [ ] **Step 3: Create poses.json with ≥30 essential poses**

Write `src/life/choreography/poses.json` — a JSON array of pose objects. Each pose must have `id`, `joints`, `desc`, `tags`, `category`, `verified`. Cover the categories from the spec:

```json
[
  { "id": "rest", "joints": {}, "desc": "Standing upright, all limbs at neutral rest position", "tags": ["rest", "stand", "idle", "neutral", "default"], "category": "full_body", "verified": false },

  { "id": "right_arm_overhead", "joints": { "arm_u_r": 150 }, "desc": "Right arm raised straight overhead, left arm at rest", "tags": ["arm", "raise", "right", "up", "overhead", "reach"], "category": "arms", "verified": false },
  { "id": "left_arm_overhead", "joints": { "arm_u_l": -150 }, "desc": "Left arm raised straight overhead, right arm at rest", "tags": ["arm", "raise", "left", "up", "overhead", "reach"], "category": "arms", "verified": false },
  { "id": "both_arms_overhead", "joints": { "arm_u_l": -150, "arm_u_r": 150 }, "desc": "Both arms raised straight overhead", "tags": ["arms", "raise", "both", "up", "overhead", "cheer", "surrender"], "category": "arms", "verified": false },
  { "id": "right_arm_forward", "joints": { "arm_u_r": 90 }, "desc": "Right arm extended forward horizontally, pointing ahead", "tags": ["arm", "forward", "right", "point", "extend", "horizontal"], "category": "arms", "verified": false },
  { "id": "left_arm_forward", "joints": { "arm_u_l": -90 }, "desc": "Left arm extended forward horizontally", "tags": ["arm", "forward", "left", "extend", "horizontal"], "category": "arms", "verified": false },
  { "id": "arms_crossed_chest", "joints": { "arm_u_l": -40, "arm_u_r": 40, "arm_f_l": -120, "arm_f_r": 120 }, "desc": "Arms folded across the chest", "tags": ["arms", "crossed", "fold", "chest", "closed", "defensive"], "category": "arms", "verified": false },
  { "id": "hands_on_hips", "joints": { "arm_u_l": -30, "arm_u_r": 30, "arm_f_l": -100, "arm_f_r": 100 }, "desc": "Hands resting on hips, elbows out", "tags": ["hands", "hips", "akimbo", "confident", "stance"], "category": "arms", "verified": false },
  { "id": "right_arm_wave_high", "joints": { "arm_u_r": 150, "arm_f_r": 40 }, "desc": "Right arm overhead with forearm bent outward for waving", "tags": ["wave", "arm", "right", "greeting", "hello"], "category": "arms", "verified": false },
  { "id": "right_arm_wave_low", "joints": { "arm_u_r": 150, "arm_f_r": 10 }, "desc": "Right arm overhead with forearm bent inward (wave return)", "tags": ["wave", "arm", "right", "greeting"], "category": "arms", "verified": false },
  { "id": "flex_biceps", "joints": { "arm_u_l": -140, "arm_u_r": 140, "arm_f_l": -120, "arm_f_r": 120 }, "desc": "Classic double bicep flex pose, both arms raised and bent", "tags": ["flex", "muscles", "bicep", "strong", "show off", "pose"], "category": "arms", "verified": false },
  { "id": "arms_behind_back", "joints": { "arm_u_l": 40, "arm_u_r": -40 }, "desc": "Both arms held behind the back, formal stance", "tags": ["arms", "behind", "back", "formal", "attention", "military"], "category": "arms", "verified": false },
  { "id": "right_salute", "joints": { "arm_u_r": 150, "arm_f_r": 130, "hand_r": -30 }, "desc": "Right hand raised to forehead in a military salute", "tags": ["salute", "military", "respect", "formal", "hand", "forehead"], "category": "arms", "verified": false },

  { "id": "deep_squat", "joints": { "thigh_l": -80, "thigh_r": -80, "shin_l": 110, "shin_r": 110, "spine": -15 }, "desc": "Deep squat, knees bent past 90 degrees, slight forward lean", "tags": ["squat", "low", "crouch", "bend", "legs", "exercise"], "category": "legs", "verified": false },
  { "id": "half_squat", "joints": { "thigh_l": -45, "thigh_r": -45, "shin_l": 60, "shin_r": 60 }, "desc": "Partial squat, knees bent about 45 degrees", "tags": ["squat", "half", "bend", "legs", "ready"], "category": "legs", "verified": false },
  { "id": "lunge_right", "joints": { "thigh_r": -90, "shin_r": 120, "thigh_l": -20 }, "desc": "Right leg forward in a deep lunge, left leg extended back", "tags": ["lunge", "right", "forward", "step", "exercise", "stretch"], "category": "legs", "verified": false },
  { "id": "lunge_left", "joints": { "thigh_l": -90, "shin_l": 120, "thigh_r": -20 }, "desc": "Left leg forward in a deep lunge, right leg extended back", "tags": ["lunge", "left", "forward", "step", "exercise"], "category": "legs", "verified": false },
  { "id": "right_knee_up", "joints": { "thigh_r": -70, "shin_r": 90 }, "desc": "Right knee raised high, shin bent back (marching step)", "tags": ["knee", "lift", "right", "march", "step", "high"], "category": "legs", "verified": false },
  { "id": "left_knee_up", "joints": { "thigh_l": -70, "shin_l": 90 }, "desc": "Left knee raised high, shin bent back (marching step)", "tags": ["knee", "lift", "left", "march", "step"], "category": "legs", "verified": false },
  { "id": "tiptoe", "joints": { "foot_l": -25, "foot_r": -25 }, "desc": "Standing on tiptoes, both feet angled up", "tags": ["tiptoe", "balance", "reach", "tall", "sneak"], "category": "legs", "verified": false },
  { "id": "kneel", "joints": { "thigh_l": -90, "thigh_r": -90, "shin_l": 130, "shin_r": 130 }, "desc": "Kneeling with both knees fully bent", "tags": ["kneel", "down", "ground", "pray", "reverence"], "category": "legs", "verified": false },

  { "id": "bow_forward", "joints": { "spine": -25, "head": -20 }, "desc": "Bowing forward at the waist with head dipped", "tags": ["bow", "forward", "respect", "greeting", "formal", "lean"], "category": "spine", "verified": false },
  { "id": "deep_bow", "joints": { "spine": -30, "head": -40 }, "desc": "Deep bow, torso tilted far forward, head down", "tags": ["bow", "deep", "respect", "reverence", "formal"], "category": "spine", "verified": false },
  { "id": "lean_back", "joints": { "spine": 20 }, "desc": "Leaning backward slightly", "tags": ["lean", "back", "casual", "relax", "dodge"], "category": "spine", "verified": false },

  { "id": "look_left", "joints": { "head": -45 }, "desc": "Head turned to the left", "tags": ["look", "left", "turn", "head", "glance"], "category": "head", "verified": false },
  { "id": "look_right", "joints": { "head": 45 }, "desc": "Head turned to the right", "tags": ["look", "right", "turn", "head", "glance"], "category": "head", "verified": false },
  { "id": "look_down", "joints": { "head": -30 }, "desc": "Head tilted downward", "tags": ["look", "down", "head", "sad", "shame"], "category": "head", "verified": false },
  { "id": "look_up", "joints": { "head": 50 }, "desc": "Head tilted upward, looking at the sky", "tags": ["look", "up", "head", "sky", "wonder"], "category": "head", "verified": false },

  { "id": "sit", "joints": { "thigh_l": -90, "thigh_r": -90, "shin_l": 90, "shin_r": 90 }, "desc": "Seated position, thighs horizontal, shins vertical", "tags": ["sit", "seated", "chair", "rest", "down"], "category": "full_body", "verified": false },
  { "id": "lie_back", "joints": { "thigh_l": -90, "thigh_r": -90, "spine": -30 }, "desc": "Lying on back, legs up, spine reclined", "tags": ["lie", "back", "supine", "rest", "sleep", "horizontal"], "category": "full_body", "verified": false },
  { "id": "crouch_ready", "joints": { "thigh_l": -70, "thigh_r": -70, "shin_l": 100, "shin_r": 100, "spine": -15 }, "desc": "Low defensive crouch, ready to spring", "tags": ["crouch", "ready", "low", "defensive", "hide", "stealth"], "category": "full_body", "verified": false },
  { "id": "shrug", "joints": { "arm_u_l": -30, "arm_u_r": 30, "arm_f_l": -40, "arm_f_r": 40, "head": 10 }, "desc": "Shoulders raised with palms up and slight head tilt — 'I dunno'", "tags": ["shrug", "dunno", "confused", "unsure", "shoulders", "gesture"], "category": "compound", "verified": false },
  { "id": "prayer", "joints": { "arm_u_l": -40, "arm_u_r": 40, "arm_f_l": -90, "arm_f_r": 90, "head": -15 }, "desc": "Hands pressed together in prayer with bowed head", "tags": ["pray", "prayer", "hands", "together", "worship", "reverence"], "category": "compound", "verified": false },
  { "id": "surrender", "joints": { "arm_u_l": -150, "arm_u_r": 150, "arm_f_l": -60, "arm_f_r": 60 }, "desc": "Both arms raised high with forearms up — surrender or celebration", "tags": ["surrender", "hands up", "arms up", "celebrate", "cheer", "victory"], "category": "compound", "verified": false },
  { "id": "facepalm", "joints": { "arm_u_r": 130, "arm_f_r": 130, "head": -15, "spine": -5 }, "desc": "Right hand covering face, head dipped, exasperated", "tags": ["facepalm", "embarrassed", "frustrated", "hand", "face", "oh no"], "category": "compound", "verified": false },
  { "id": "point_forward_right", "joints": { "arm_u_r": 90, "hand_r": -20 }, "desc": "Right arm extended forward, hand pointing ahead", "tags": ["point", "forward", "right", "direct", "indicate", "there"], "category": "compound", "verified": false }
]
```

That is 36 poses. Categories: arms (13), legs (8), spine (3), head (4), full_body (4), compound (5). Well above the 30 minimum.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test sim/test/pose-dictionary.test.js`
Expected: 5/5 PASS

- [ ] **Step 5: Create pose-bootstrap.js — renders every pose and writes PNGs for manual inspection**

```js
// src/life/eval/pose-bootstrap.js — Render every pose in poses.json as a stick figure PNG.
// Usage: node src/life/eval/pose-bootstrap.js
// Writes to src/life/choreography/evals/poses/
import { renderPose } from './stick-renderer.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const rig = JSON.parse(readFileSync('src/life/rigs/humanoid.json', 'utf8'));
const poses = JSON.parse(readFileSync('src/life/choreography/poses.json', 'utf8'));
const outDir = 'src/life/choreography/evals/poses';
mkdirSync(outDir, { recursive: true });

for (const p of poses) {
  const buf = await renderPose(rig, p.joints, { width: 400, height: 600, label: `${p.id}: ${p.desc}` });
  writeFileSync(`${outDir}/${p.id}.png`, buf);
  console.log(`  ✓ ${p.id}`);
}
console.log(`\nRendered ${poses.length} poses to ${outDir}/`);
```

- [ ] **Step 6: Run bootstrap, eyeball the PNGs, fix any wrong poses**

```bash
node src/life/eval/pose-bootstrap.js
```

Open the PNGs in `src/life/choreography/evals/poses/`. For each: does the stick figure match the description? Fix any joint values in poses.json where the pose doesn't match, re-run bootstrap, re-check.

- [ ] **Step 7: Commit**

```bash
git add src/life/choreography/poses.json src/life/eval/pose-bootstrap.js sim/test/pose-dictionary.test.js
git commit -m "feat(eval): verified pose dictionary — 36 named poses + bootstrap renderer"
```

---

### Task 3: Automated pose verification via vision model

**Files:**
- Create: `src/life/eval/vision-eval.js`
- Create: `src/life/eval/verify-poses.js` (script)
- Test: `sim/test/vision-eval.test.js`

- [ ] **Step 1: Write the failing test**

```js
// sim/test/vision-eval.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPoseEvalPrompt, parseEvalResponse } from '../../src/life/eval/vision-eval.js';

test('buildPoseEvalPrompt returns system + user messages with image placeholder', () => {
  const { system, userContent } = buildPoseEvalPrompt('right_arm_overhead', 'Right arm raised straight overhead');
  assert.ok(system.includes('stick figure'));
  assert.ok(typeof userContent === 'function', 'userContent should be a function taking base64 image');
  const msg = userContent('BASE64DATA');
  assert.ok(Array.isArray(msg), 'should return array of content parts');
  assert.ok(msg.some(p => p.type === 'image_url' || p.type === 'image'), 'should include image');
});

test('parseEvalResponse extracts score and critique', () => {
  const { score, critique } = parseEvalResponse('Score: 4\nThe arm is raised but slightly angled.');
  assert.strictEqual(score, 4);
  assert.ok(critique.includes('slightly angled'));
});

test('parseEvalResponse handles missing score gracefully', () => {
  const { score, critique } = parseEvalResponse('Looks good overall.');
  assert.strictEqual(score, 0);
  assert.ok(critique.includes('Looks good'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/vision-eval.test.js`
Expected: FAIL

- [ ] **Step 3: Implement vision-eval.js**

```js
// src/life/eval/vision-eval.js — Vision model evaluation for poses and motions.
// Builds prompts with stick-figure images, sends to OpenAI/Anthropic vision,
// parses structured score + critique responses.
// Provider config: reads from process.env.MOTION_LLM_KEY or a config file.
import { readFileSync } from 'node:fs';

let _config = null;
function getConfig() {
  if (_config) return _config;
  // Try env var first, then config file
  const key = process.env.MOTION_LLM_KEY;
  if (key) {
    const isAnthropic = key.startsWith('sk-ant-');
    _config = {
      key, provider: isAnthropic ? 'anthropic' : 'openai',
      url: isAnthropic ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/chat/completions',
      model: isAnthropic ? 'claude-haiku-4-5-20251001' : 'gpt-4o-mini',
      visionModel: isAnthropic ? 'claude-haiku-4-5-20251001' : 'gpt-4o-mini',
    };
    return _config;
  }
  try {
    _config = JSON.parse(readFileSync('motion-llm-config.json', 'utf8'));
    return _config;
  } catch { return null; }
}

/** Build the eval prompt for a single pose. */
export function buildPoseEvalPrompt(poseId, description) {
  const system = `You are evaluating a stick figure rendering of a humanoid pose.
The figure uses colored lines: white=spine, yellow=head, blue=left arm, darker blue=right arm, green=left leg, darker green=right leg.
Circles mark joints. A horizontal gray line is the ground.

Score the pose 1-5:
5 = Clearly matches the description, anatomically correct
4 = Recognizable, minor issues
3 = Somewhat matches but awkward positioning
2 = Wrong position or confusing
1 = Nonsensical, body parts in impossible positions

Respond in exactly this format:
Score: N
<one line explaining what's right or wrong>`;

  const userContent = (base64Png) => [
    { type: 'text', text: `This pose is called "${poseId}" and should show: "${description}". Score it.` },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Png}` } },
  ];

  return { system, userContent };
}

/** Build the eval prompt for a motion strip (sequence of frames). */
export function buildMotionEvalPrompt(command, frameCount) {
  const system = `You are evaluating a stick figure animation strip showing a humanoid performing a motion.
The strip shows ${frameCount} keyframes left-to-right. Colored lines: white=spine, yellow=head, blue=left arm, darker blue=right arm, green=left leg, darker green=right leg.

Score the motion 1-5:
5 = Clearly shows the described motion, natural movement flow
4 = Recognizable motion, minor timing or pose issues
3 = Somewhat matches but awkward or incomplete
2 = Wrong motion or confusing body positions
1 = Nonsensical, limbs in impossible positions

Respond in exactly this format:
Score: N
<one line explaining what's right or wrong>`;

  const userContent = (base64Png) => [
    { type: 'text', text: `This animation strip should show: "${command}". Score it.` },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Png}` } },
  ];

  return { system, userContent };
}

/** Parse "Score: 4\nExplanation..." into { score, critique }. */
export function parseEvalResponse(text) {
  const scoreMatch = text.match(/Score:\s*(\d)/i);
  const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;
  const critique = text.replace(/Score:\s*\d\s*/i, '').trim();
  return { score, critique };
}

/** Send an image to the vision model and get a score + critique.
 *  Returns { score, critique, raw } or { score: 0, critique: errorMsg }. */
export async function evalImage(base64Png, promptBuilder) {
  const cfg = getConfig();
  if (!cfg) return { score: 0, critique: 'No LLM config. Set MOTION_LLM_KEY env var.', raw: '' };

  const messages = [{ role: 'user', content: promptBuilder(base64Png) }];

  if (cfg.provider === 'openai') {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.visionModel || cfg.model,
        max_tokens: 200,
        messages: [{ role: 'system', content: promptBuilder._system || '' }, ...messages],
      }),
    });
    if (!res.ok) return { score: 0, critique: `API ${res.status}`, raw: await res.text() };
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    return { ...parseEvalResponse(text), raw: text };
  }

  if (cfg.provider === 'anthropic') {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'x-api-key': cfg.key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: cfg.visionModel || cfg.model,
        max_tokens: 200,
        system: promptBuilder._system || '',
        messages,
      }),
    });
    if (!res.ok) return { score: 0, critique: `API ${res.status}`, raw: await res.text() };
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    return { ...parseEvalResponse(text), raw: text };
  }

  return { score: 0, critique: `Unknown provider: ${cfg.provider}`, raw: '' };
}

/** Convenience: evaluate a single pose image. */
export async function evalPose(base64Png, poseId, description) {
  const { system, userContent } = buildPoseEvalPrompt(poseId, description);
  userContent._system = system;
  return evalImage(base64Png, userContent);
}

/** Convenience: evaluate a motion strip image. */
export async function evalMotion(base64Png, command, frameCount) {
  const { system, userContent } = buildMotionEvalPrompt(command, frameCount);
  userContent._system = system;
  return evalImage(base64Png, userContent);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test sim/test/vision-eval.test.js`
Expected: 3/3 PASS

- [ ] **Step 5: Create verify-poses.js — runs every pose through vision eval**

```js
// src/life/eval/verify-poses.js — Batch-verify all poses via vision model.
// Usage: MOTION_LLM_KEY=sk-... node src/life/eval/verify-poses.js
// Updates poses.json verified field + writes eval results.
import { renderPose } from './stick-renderer.js';
import { evalPose } from './vision-eval.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const rig = JSON.parse(readFileSync('src/life/rigs/humanoid.json', 'utf8'));
const poses = JSON.parse(readFileSync('src/life/choreography/poses.json', 'utf8'));
const evalDir = 'src/life/choreography/evals/poses';
mkdirSync(evalDir, { recursive: true });

const results = [];
let passCount = 0;

for (const p of poses) {
  const buf = await renderPose(rig, p.joints, { width: 400, height: 600, label: p.id });
  const base64 = buf.toString('base64');
  writeFileSync(`${evalDir}/${p.id}.png`, buf);

  const { score, critique, raw } = await evalPose(base64, p.id, p.desc);
  const passed = score >= 4;
  if (passed) passCount++;
  p.verified = passed;

  results.push({ id: p.id, score, critique, passed });
  console.log(`  ${passed ? '✓' : '✗'} ${p.id}: ${score}/5 — ${critique}`);

  // Rate limit: 200ms between calls
  await new Promise(r => setTimeout(r, 200));
}

// Write updated poses.json with verified flags
writeFileSync('src/life/choreography/poses.json', JSON.stringify(poses, null, 2));
// Write eval report
writeFileSync(`${evalDir}/report.json`, JSON.stringify({ total: poses.length, passed: passCount, results }, null, 2));

console.log(`\n${passCount}/${poses.length} poses verified.`);
if (passCount < poses.length) {
  console.log('Failed poses need joint angle fixes in poses.json, then re-run.');
}
```

- [ ] **Step 6: Run verification (requires API key)**

```bash
MOTION_LLM_KEY=sk-proj-... node src/life/eval/verify-poses.js
```

Review output. Fix any failed poses in poses.json (adjust joint angles), re-run until all pass.

- [ ] **Step 7: Commit**

```bash
git add src/life/eval/vision-eval.js src/life/eval/verify-poses.js sim/test/vision-eval.test.js src/life/choreography/poses.json
git commit -m "feat(eval): vision model pose verification — automated visual QA pipeline"
```

---

### Task 4: Choreography composer (pose-ref format + compiler)

**Files:**
- Create: `src/life/eval/compose.js`
- Create: `src/life/eval/compile-plan.js`
- Test: `sim/test/compose.test.js`

- [ ] **Step 1: Write the failing test**

```js
// sim/test/compose.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compilePlan } from '../../src/life/eval/compile-plan.js';
import { readFileSync } from 'node:fs';

const poses = JSON.parse(readFileSync('src/life/choreography/poses.json', 'utf8'));

test('compilePlan converts pose refs to DSL program', () => {
  const plan = {
    id: 'test_wave', kind: 'gesture',
    steps: [
      { pose: 'right_arm_overhead', ticks: 6 },
      { pose: 'right_arm_wave_high', ticks: 3 },
      { pose: 'right_arm_wave_low', ticks: 2 },
      { pose: 'rest', ticks: 6 },
    ],
  };
  const program = compilePlan(plan, poses);
  assert.strictEqual(program.id, 'test_wave');
  assert.strictEqual(program.root.op, 'sequence');
  assert.strictEqual(program.root.children.length, 4);
  assert.deepStrictEqual(program.root.children[0].joints, { arm_u_r: 150 });
  assert.strictEqual(program.root.children[0].ticks, 6);
  assert.deepStrictEqual(program.root.children[3].joints, {});
});

test('compilePlan throws on unknown pose ref', () => {
  const plan = {
    id: 'bad', kind: 'gesture',
    steps: [{ pose: 'nonexistent_pose', ticks: 3 }],
  };
  assert.throws(() => compilePlan(plan, poses), /unknown pose/i);
});

test('compilePlan detects NEW: prefix and returns missing poses', () => {
  const plan = {
    id: 'novel', kind: 'gesture',
    steps: [
      { pose: 'rest', ticks: 3 },
      { pose: 'NEW:arms stretched wide to both sides', ticks: 5 },
      { pose: 'rest', ticks: 3 },
    ],
  };
  const result = compilePlan(plan, poses);
  assert.ok(result.missingPoses, 'should flag missing poses');
  assert.strictEqual(result.missingPoses.length, 1);
  assert.ok(result.missingPoses[0].includes('arms stretched wide'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/compose.test.js`
Expected: FAIL

- [ ] **Step 3: Implement compile-plan.js**

```js
// src/life/eval/compile-plan.js — Compile a pose-ref choreography plan into
// a standard DSL program (the {op:"pose", joints, ticks} format).
// The plan format uses named pose references; the compiler resolves them.

/** Compile a choreography plan into a DSL program.
 *  plan = { id, kind, steps: [{pose, ticks}], variant? }
 *  poses = array of {id, joints, ...} from poses.json
 *  Returns a program object OR { missingPoses: [...descriptions] } if NEW: refs found. */
export function compilePlan(plan, poses) {
  const poseMap = new Map(poses.map(p => [p.id, p]));
  const missing = [];

  const children = plan.steps.map((step, i) => {
    if (step.pose.startsWith('NEW:')) {
      missing.push(step.pose.slice(4).trim());
      return { op: 'pose', joints: {}, ticks: step.ticks }; // placeholder
    }
    const p = poseMap.get(step.pose);
    if (!p) throw new Error(`Unknown pose "${step.pose}" at step ${i}`);
    return { op: 'pose', joints: { ...p.joints }, ticks: step.ticks };
  });

  if (missing.length > 0) {
    return { missingPoses: missing };
  }

  return {
    id: plan.id,
    kind: plan.kind,
    variant: plan.variant || { time: [0.9, 1.1], amplitude: [0.9, 1.1] },
    root: { op: 'sequence', children },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test sim/test/compose.test.js`
Expected: 3/3 PASS

- [ ] **Step 5: Implement compose.js — LLM composition from pose dictionary**

```js
// src/life/eval/compose.js — Ask an LLM to compose a choreography plan
// from the pose dictionary. The LLM outputs pose refs + timing, never raw joints.
import { readFileSync } from 'node:fs';

/** Build the composition prompt. poseSummary = [{id, desc}]. */
export function buildComposePrompt(poseSummary) {
  const poseList = poseSummary.map(p => `  ${p.id} — ${p.desc}`).join('\n');

  return `You are a choreography composer for a 2D humanoid character.
You create motion sequences by picking from a library of verified poses and specifying timing.

AVAILABLE POSES:
${poseList}

RULES:
1. Output a JSON object with: id, kind, steps (array of {pose, ticks})
2. Each step references a pose by its exact id from the list above
3. ticks = duration to glide to that pose. 10 ticks = 1 second.
4. Start and end with "rest" unless it's a terminal pose (sit, lie, kneel)
5. Use 2-6 ticks per step for natural timing
6. Think about the full motion arc — setup, action, recovery
7. If you need a pose NOT in the list, use "NEW:description of the pose needed"

EXAMPLE — wave:
{"id":"wave","kind":"gesture","steps":[
  {"pose":"right_arm_overhead","ticks":6},
  {"pose":"right_arm_wave_high","ticks":3},
  {"pose":"right_arm_wave_low","ticks":2},
  {"pose":"right_arm_wave_high","ticks":2},
  {"pose":"right_arm_wave_low","ticks":2},
  {"pose":"rest","ticks":6}]}

EXAMPLE — bow:
{"id":"bow","kind":"gesture","steps":[
  {"pose":"bow_forward","ticks":5},
  {"pose":"bow_forward","ticks":8},
  {"pose":"rest","ticks":5}]}

Respond with ONLY the JSON object. No markdown, no explanation.`;
}

/** Compose a choreography for a command. Returns { plan, error }.
 *  cfg = { key, url?, model?, provider? } */
export async function composeChoreography(command, poseSummary, cfg) {
  const system = buildComposePrompt(poseSummary);
  const id = command.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  const userMsg = `Create a choreography for: "${command}"\nThe id should be "${id}".`;

  const isOpenAI = (cfg.provider || (cfg.key?.startsWith('sk-ant-') ? 'anthropic' : 'openai')) === 'openai';
  const url = cfg.url || (isOpenAI ? 'https://api.openai.com/v1/chat/completions' : 'https://api.anthropic.com/v1/messages');
  const model = cfg.model || (isOpenAI ? 'gpt-4o-mini' : 'claude-haiku-4-5-20251001');

  const headers = isOpenAI
    ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.key}` }
    : { 'Content-Type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01' };

  const body = isOpenAI
    ? { model, max_tokens: 1024, messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }] }
    : { model, max_tokens: 1024, system, messages: [{ role: 'user', content: userMsg }] };

  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) return { plan: null, error: `API ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const data = await res.json();
    const text = isOpenAI
      ? (data.choices?.[0]?.message?.content || '')
      : (data.content?.[0]?.text || '');
    const jsonStr = text.replace(/^```json?\s*/m, '').replace(/\s*```$/m, '').trim();
    const plan = JSON.parse(jsonStr);
    return { plan, error: null };
  } catch (e) {
    return { plan: null, error: e.message };
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/life/eval/compile-plan.js src/life/eval/compose.js sim/test/compose.test.js
git commit -m "feat(eval): choreography composer + plan compiler — pose-ref → DSL programs"
```

---

### Task 5: Full motion generation + eval pipeline

**Files:**
- Create: `src/life/eval/generate-motion.js` (script — end-to-end pipeline)
- Modify: `src/life/eval/vision-eval.js` (add motion strip eval)

- [ ] **Step 1: Implement generate-motion.js — the full compose→render→eval loop**

```js
// src/life/eval/generate-motion.js — End-to-end motion generation pipeline.
// Usage: MOTION_LLM_KEY=sk-... node src/life/eval/generate-motion.js "do a wave"
// Composes from pose dictionary → compiles → renders strip → vision eval → validates → saves.
import { composeChoreography } from './compose.js';
import { compilePlan } from './compile-plan.js';
import { renderStrip } from './stick-renderer.js';
import { evalMotion } from './vision-eval.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const command = process.argv[2];
if (!command) { console.error('Usage: node generate-motion.js "command"'); process.exit(1); }

const key = process.env.MOTION_LLM_KEY;
if (!key) { console.error('Set MOTION_LLM_KEY env var'); process.exit(1); }

const rig = JSON.parse(readFileSync('src/life/rigs/humanoid.json', 'utf8'));
const poses = JSON.parse(readFileSync('src/life/choreography/poses.json', 'utf8'));
const poseSummary = poses.map(p => ({ id: p.id, desc: p.desc }));
const cfg = { key };

const evalDir = 'src/life/choreography/evals/motions';
const validatedDir = 'src/life/choreography/validated';
mkdirSync(evalDir, { recursive: true });
mkdirSync(validatedDir, { recursive: true });

const id = command.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
const attempts = [];
let finalProgram = null;

for (let attempt = 0; attempt < 3; attempt++) {
  console.log(`\nAttempt ${attempt + 1}/3...`);

  // Step 1: Compose
  const composePrompt = attempt === 0 ? command :
    `${command}\n\nPrevious attempt scored ${attempts[attempt - 1].score}/5. Critique: ${attempts[attempt - 1].critique}\nFix the issues.`;
  const { plan, error: composeErr } = await composeChoreography(composePrompt, poseSummary, cfg);
  if (composeErr) { console.error(`  Compose error: ${composeErr}`); continue; }
  console.log(`  Composed: ${plan.steps?.length} steps`);

  // Step 2: Compile
  let program;
  try {
    program = compilePlan(plan, poses);
  } catch (e) { console.error(`  Compile error: ${e.message}`); continue; }

  if (program.missingPoses) {
    console.log(`  Missing poses: ${program.missingPoses.join(', ')}`);
    console.log('  → Pose authoring not yet implemented. Skipping.');
    continue;
  }

  // Step 3: Render strip
  // Extract keyframes from the compiled program (each child = one pose)
  const frames = program.root.children.map((c, i) => ({
    joints: c.joints,
    label: plan.steps[i]?.pose || `step${i}`,
  }));
  const stripBuf = await renderStrip(rig, frames, {
    frameWidth: 200, frameHeight: 400, title: `"${command}"`,
  });
  const stripPath = `${evalDir}/${id}_attempt${attempt + 1}.png`;
  writeFileSync(stripPath, stripBuf);
  console.log(`  Rendered ${frames.length} frames → ${stripPath}`);

  // Step 4: Vision eval
  const base64 = stripBuf.toString('base64');
  const { score, critique, raw } = await evalMotion(base64, command, frames.length);
  console.log(`  Score: ${score}/5 — ${critique}`);

  attempts.push({ plan, score, critique, stripPath });

  if (score >= 4) {
    finalProgram = program;
    break;
  }

  await new Promise(r => setTimeout(r, 500)); // rate limit
}

if (finalProgram) {
  // Save to validated directory
  writeFileSync(`${validatedDir}/${id}.json`, JSON.stringify(finalProgram, null, 2));
  console.log(`\n✓ PASS — saved to ${validatedDir}/${id}.json`);
} else {
  console.log(`\n✗ FAILED after 3 attempts — needs human review`);
}

// Save eval report
writeFileSync(`${evalDir}/${id}_report.json`, JSON.stringify({
  command, id, attempts: attempts.map(a => ({ score: a.score, critique: a.critique, stripPath: a.stripPath })),
  verdict: finalProgram ? 'pass' : 'fail',
}, null, 2));
```

- [ ] **Step 2: Test the pipeline end-to-end**

```bash
MOTION_LLM_KEY=sk-proj-... node src/life/eval/generate-motion.js "do a wave"
```

Expected: composes 5-6 steps from pose dictionary, renders strip, vision model scores ≥4, saves to `src/life/choreography/validated/do_a_wave.json`.

- [ ] **Step 3: Test a harder command**

```bash
MOTION_LLM_KEY=sk-proj-... node src/life/eval/generate-motion.js "do five jumping jacks"
```

- [ ] **Step 4: Commit**

```bash
git add src/life/eval/generate-motion.js
git commit -m "feat(eval): end-to-end motion generation pipeline — compose→render→eval→validate"
```

---

### Task 6: QA Workbench (browser tool)

**Files:**
- Create: `tools/motion-qa.html`
- Modify: `src/life/eval/stick-renderer.js` (already exports `drawPose` for browser use)

- [ ] **Step 1: Create the QA workbench HTML page**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Motion QA Workbench</title>
  <style>
    * { box-sizing: border-box; margin: 0; }
    body { background: #111; color: #ddd; font: 14px/1.5 monospace; display: flex; flex-direction: column; height: 100vh; }
    header { background: #1a1a2a; padding: 8px 16px; display: flex; align-items: center; gap: 16px; border-bottom: 1px solid #333; }
    header h1 { font-size: 16px; color: #9af; }
    main { display: flex; flex: 1; overflow: hidden; }
    .panel { border-right: 1px solid #333; overflow-y: auto; }
    #library { width: 220px; padding: 8px; }
    #library input { width: 100%; padding: 4px 8px; background: #222; color: #ddd; border: 1px solid #444; border-radius: 4px; margin-bottom: 8px; }
    .pose-item { padding: 4px 8px; cursor: pointer; border-radius: 4px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pose-item:hover { background: #2a2a3a; }
    .pose-item.selected { background: #335; }
    .pose-item .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
    .dot.pass { background: #5b5; } .dot.fail { background: #b55; } .dot.untested { background: #555; }
    #canvas-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #1a1a1a; }
    #canvas-wrap canvas { border: 1px solid #333; }
    .controls { padding: 8px; display: flex; gap: 8px; align-items: center; }
    .controls button { background: #333; color: #ddd; border: 1px solid #555; border-radius: 4px; padding: 4px 12px; cursor: pointer; }
    .controls button:hover { background: #444; }
    #details { width: 300px; padding: 12px; overflow-y: auto; }
    #details h3 { color: #9af; margin-bottom: 8px; }
    #details pre { background: #1a1a1a; padding: 8px; border-radius: 4px; font-size: 11px; overflow-x: auto; white-space: pre-wrap; max-height: 300px; overflow-y: auto; }
    #command-bar { background: #1a1a2a; padding: 8px 16px; border-top: 1px solid #333; display: flex; gap: 8px; }
    #command-bar input { flex: 1; padding: 6px 10px; background: #222; color: #ddd; border: 1px solid #444; border-radius: 4px; }
    #command-bar button { background: #446; color: #ddd; border: 1px solid #556; border-radius: 4px; padding: 6px 16px; cursor: pointer; }
    .status { padding: 4px 8px; font-size: 12px; color: #888; }
  </style>
</head>
<body>
  <header>
    <h1>Motion QA Workbench</h1>
    <span class="status" id="status">Loading...</span>
  </header>
  <main>
    <div class="panel" id="library">
      <input type="text" id="filter" placeholder="Filter poses..." />
      <div id="pose-list"></div>
    </div>
    <div id="canvas-wrap">
      <canvas id="preview" width="400" height="600"></canvas>
      <div class="controls">
        <button id="btn-prev">⏮</button>
        <button id="btn-play">▶</button>
        <button id="btn-next">⏭</button>
        <button id="btn-loop">🔁</button>
        <span class="status" id="frame-info">-</span>
      </div>
    </div>
    <div class="panel" id="details">
      <h3 id="detail-title">Select a pose</h3>
      <div id="detail-desc"></div>
      <h3 style="margin-top:12px">Joints</h3>
      <pre id="detail-json">{}</pre>
      <h3 style="margin-top:12px">Tags</h3>
      <div id="detail-tags"></div>
    </div>
  </main>
  <div id="command-bar">
    <input type="text" id="command" placeholder="Type a motion command to generate..." />
    <button id="btn-generate">Generate</button>
  </div>
  <script type="module">
    import { solvePose } from '/src/life/pose.js';
    import { drawPose } from '/src/life/eval/stick-renderer.js';

    let rig = null;
    let poses = [];
    let selectedPose = null;

    async function init() {
      rig = await (await fetch('/src/life/rigs/humanoid.json')).json();
      poses = await (await fetch('/src/life/choreography/poses.json')).json();
      document.getElementById('status').textContent = `${poses.length} poses loaded`;
      renderList();
      if (poses.length) selectPose(poses[0]);
    }

    function renderList(filter = '') {
      const list = document.getElementById('pose-list');
      const f = filter.toLowerCase();
      list.innerHTML = poses
        .filter(p => !f || p.id.includes(f) || p.tags.some(t => t.includes(f)))
        .map(p => {
          const cls = p.verified ? 'pass' : 'untested';
          return `<div class="pose-item" data-id="${p.id}"><span class="dot ${cls}"></span>${p.id}</div>`;
        }).join('');
      list.querySelectorAll('.pose-item').forEach(el => {
        el.onclick = () => selectPose(poses.find(p => p.id === el.dataset.id));
      });
    }

    function selectPose(p) {
      selectedPose = p;
      document.querySelectorAll('.pose-item').forEach(el => el.classList.toggle('selected', el.dataset.id === p.id));
      document.getElementById('detail-title').textContent = p.id;
      document.getElementById('detail-desc').textContent = p.desc;
      document.getElementById('detail-json').textContent = JSON.stringify(p.joints, null, 2);
      document.getElementById('detail-tags').textContent = p.tags.join(', ');
      drawPreview(p.joints);
    }

    function drawPreview(joints) {
      const canvas = document.getElementById('preview');
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawPose(ctx, rig, joints, 0, 0, canvas.width, canvas.height, {});
    }

    document.getElementById('filter').oninput = (e) => renderList(e.target.value);

    document.getElementById('btn-generate').onclick = async () => {
      const cmd = document.getElementById('command').value.trim();
      if (!cmd) return;
      document.getElementById('status').textContent = 'Generating...';
      // For now, display a message — full generation requires Node pipeline
      document.getElementById('status').textContent = 'Generation requires: MOTION_LLM_KEY=... node src/life/eval/generate-motion.js "' + cmd + '"';
    };

    init();
  </script>
</body>
</html>
```

- [ ] **Step 2: Test in browser**

Open `http://localhost:8123/tools/motion-qa.html`. Verify:
- Left panel shows all poses from poses.json with colored dots
- Clicking a pose renders the stick figure on the center canvas
- Filter input narrows the list
- Details panel shows joints, tags, description

- [ ] **Step 3: Commit**

```bash
git add tools/motion-qa.html
git commit -m "feat(tool): motion QA workbench — browse, preview, and inspect poses"
```

---

### Task 7: Wire validated dictionary into game

**Files:**
- Modify: `src/ui/command-chat.js` (check validated/ before manifest)
- Modify: `src/life/motion-match.js` (add validated dictionary loading)

- [ ] **Step 1: Add validated dictionary loading to command-chat.js**

In `command-chat.js`, before matching against the manifest, try to load from `validated/`:

```js
// At the top of submitCommand(), before matchMotion:
// Try validated dictionary first (these have passed visual eval)
const validatedRes = await fetch(`/src/life/choreography/validated/${tokens.join('_')}.json`).catch(() => null);
if (validatedRes?.ok) {
  const program = await validatedRes.json();
  playMotion(program, { count });
  showFeedback(`${program.id} ×${count} (validated)`);
  closeChat();
  return;
}
```

- [ ] **Step 2: Test in browser**

Generate a motion via the pipeline (`node src/life/eval/generate-motion.js "do a wave"`), then in the game press Enter, type "do a wave" — should play the validated version.

- [ ] **Step 3: Commit**

```bash
git add src/ui/command-chat.js
git commit -m "feat(motion): command chat checks validated dictionary first"
```

---

### Task 8: Batch generation script for scale

**Files:**
- Create: `src/life/eval/batch-generate.js`

- [ ] **Step 1: Create batch script**

```js
// src/life/eval/batch-generate.js — Generate motions for a list of commands.
// Usage: MOTION_LLM_KEY=sk-... node src/life/eval/batch-generate.js
// Reads commands from a list, runs each through the pipeline, reports results.
import { composeChoreography } from './compose.js';
import { compilePlan } from './compile-plan.js';
import { renderStrip } from './stick-renderer.js';
import { evalMotion } from './vision-eval.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const key = process.env.MOTION_LLM_KEY;
if (!key) { console.error('Set MOTION_LLM_KEY env var'); process.exit(1); }

const rig = JSON.parse(readFileSync('src/life/rigs/humanoid.json', 'utf8'));
const poses = JSON.parse(readFileSync('src/life/choreography/poses.json', 'utf8'));
const poseSummary = poses.map(p => ({ id: p.id, desc: p.desc }));
const cfg = { key };

const validatedDir = 'src/life/choreography/validated';
const evalDir = 'src/life/choreography/evals/motions';
mkdirSync(validatedDir, { recursive: true });
mkdirSync(evalDir, { recursive: true });

// Commands to generate — the taxonomy
const COMMANDS = [
  'wave', 'bow', 'salute', 'clap', 'cheer', 'point forward', 'beckon', 'shrug',
  'nod', 'shake head', 'facepalm', 'flex muscles', 'taunt', 'wave both hands',
  'kneel', 'pray', 'curtsy', 'blow a kiss',
  'jumping jacks', 'pushup', 'situp', 'squat', 'lunge', 'plank', 'stretch arms',
  'touch toes', 'jump in place', 'crouch', 'march in place',
  'dig', 'hammer', 'chop wood', 'sweep floor', 'cast fishing line',
  'dance', 'spin around', 'moonwalk', 'tiptoe',
  'sit down', 'lie down on back', 'crawl', 'look around', 'yawn and stretch',
];

let passed = 0, failed = 0, skipped = 0;

for (const command of COMMANDS) {
  const id = command.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

  // Skip if already validated
  if (existsSync(`${validatedDir}/${id}.json`)) {
    console.log(`  SKIP ${id} (already validated)`);
    skipped++;
    continue;
  }

  console.log(`\n── ${command} ──`);
  let finalProgram = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const { plan, error } = await composeChoreography(
      attempt === 0 ? command : `${command} (fix: previous attempt was wrong)`,
      poseSummary, cfg
    );
    if (error || !plan?.steps) { console.log(`  compose error: ${error}`); continue; }

    let program;
    try { program = compilePlan(plan, poses); } catch (e) { console.log(`  compile: ${e.message}`); continue; }
    if (program.missingPoses) { console.log(`  missing poses: ${program.missingPoses.join(', ')}`); continue; }

    const frames = program.root.children.map((c, i) => ({ joints: c.joints, label: plan.steps[i]?.pose || '' }));
    const stripBuf = await renderStrip(rig, frames, { frameWidth: 200, frameHeight: 400, title: command });
    writeFileSync(`${evalDir}/${id}.png`, stripBuf);

    const { score, critique } = await evalMotion(stripBuf.toString('base64'), command, frames.length);
    console.log(`  attempt ${attempt + 1}: ${score}/5 — ${critique}`);

    if (score >= 4) { finalProgram = program; break; }
    await new Promise(r => setTimeout(r, 500));
  }

  if (finalProgram) {
    writeFileSync(`${validatedDir}/${id}.json`, JSON.stringify(finalProgram, null, 2));
    console.log(`  ✓ PASS`);
    passed++;
  } else {
    console.log(`  ✗ FAIL`);
    failed++;
  }

  await new Promise(r => setTimeout(r, 300)); // rate limit between commands
}

console.log(`\n\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped of ${COMMANDS.length} total`);
```

- [ ] **Step 2: Run batch generation**

```bash
MOTION_LLM_KEY=sk-proj-... node src/life/eval/batch-generate.js
```

This will take several minutes. Watch the output for pass/fail counts.

- [ ] **Step 3: Commit results**

```bash
git add src/life/eval/batch-generate.js src/life/choreography/validated/
git commit -m "feat(eval): batch motion generation — taxonomy of ~40 validated choreographies"
```

---

### Task 9: Close-out — tests green, cleanup

- [ ] **Step 1: Run full test suite**

```bash
node --test sim/test/*.test.js
```

All tests must pass including the new stick-renderer, pose-dictionary, vision-eval, and compose tests.

- [ ] **Step 2: Clean up temp files**

```bash
rm -f _test_rest.png
```

- [ ] **Step 3: Final commit**

```bash
git add -A sim/test/ src/life/eval/ src/life/choreography/
git commit -m "chore(eval): close-out — all tests green, eval pipeline complete"
```
