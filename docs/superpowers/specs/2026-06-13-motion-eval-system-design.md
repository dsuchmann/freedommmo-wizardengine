# Motion Eval System — Infinite Puppeting with Automated Visual QA

## Goal

A system where any motion can be generated on demand via LLM, visually evaluated without human involvement, and stored permanently in a validated dictionary reusable by any entity (player or NPC). The 50 hand-authored choreographies are disposable scaffolding — what matters is the system for infinitely building them and the evals that ensure they look right.

## Core Problem

The current choreography programs produce nonsensical body movements because the LLM (or subagent) doesn't understand what raw joint angles look like on screen. `arm_u_r: 150` is meaningless without visual grounding. The fix is three-fold: better abstractions (verified pose atoms), automated visual feedback (stick figure rendering + vision model eval), and permanent storage (validated dictionary).

## Architecture

Three layers, each with a clear responsibility:

```
Command: "do a cartwheel"
         ↓
┌────────────────────────┐
│  Choreography Composer │  LLM picks poses + timing from dictionary
│  (never invents raw    │  Output: sequence of pose refs + tick counts
│   joint angles)        │
└────────┬───────────────┘
         ↓
┌────────────────────────┐
│  Stick Figure Renderer │  FK solve → draw skeleton → frame strip image
│  (Node.js headless OR  │  ~400×600px per frame, bones color-coded
│   browser canvas)      │
└────────┬───────────────┘
         ↓
┌────────────────────────┐
│  Automated Eval        │  Pre-checks (structural) + vision model judge
│  Pipeline              │  Pass → validated dictionary
│                        │  Fail → critique → re-compose (max 3 attempts)
└────────┬───────────────┘
         ↓
┌────────────────────────┐
│  Validated Dictionary  │  Permanent JSON files, tagged, reusable
│  (poses + motions)     │  Any entity can play them
└────────────────────────┘
```

## Layer 1: Verified Pose Dictionary

### What It Is

A library of ~100+ named body positions, each visually confirmed via the stick figure pipeline. A pose is the atomic unit — the LLM composes choreographies from poses, never from raw joint angles.

### Pose Shape

```json
{
  "id": "right_arm_overhead",
  "joints": { "arm_u_r": 150 },
  "desc": "Right arm raised straight overhead, other limbs at rest",
  "tags": ["arm", "raise", "right", "up", "overhead"],
  "category": "arms",
  "verified": true
}
```

File: `src/life/choreography/poses.json` — single file, array of all verified poses.

### Categories

| Category | Count | Examples |
|----------|-------|---------|
| Arms | ~20 | rest, one/both raised, forward, crossed, on hips, behind back, flexed |
| Legs | ~15 | rest, squat depths, lunge L/R, kneel, knee raised L/R, tiptoe |
| Spine | ~8 | upright, forward bow 15°/30°, lean back, twist |
| Head | ~8 | center, look L/R, look up/down, tilt L/R |
| Full body | ~15 | sit, lie back/belly, crawl, plank, handstand, headstand |
| Compound | ~30 | bow (spine+head+arms), shrug, crouch, ready stance, surrender |

### Pose Authoring (New Pose Creation)

When a choreography needs a pose that doesn't exist in the dictionary:

1. LLM generates raw joint angles with a description of the intended pose
2. Stick figure renderer produces the image
3. Vision model evaluates: "This is supposed to show: '{description}'. Does it match? What's wrong?"
4. Pass (score ≥ 4/5) → add to poses.json with `verified: true`
5. Fail → critique fed back to LLM → regenerate (max 3 attempts)

This is the ONLY path where raw joint angles are invented. Once verified, the pose is trusted forever.

## Layer 2: Choreography Composer

### What the LLM Produces

Instead of raw joint programs, the LLM outputs a choreography plan — a sequence of pose references with timing:

```json
{
  "id": "wave",
  "kind": "gesture",
  "steps": [
    { "pose": "right_arm_overhead", "ticks": 6 },
    { "pose": "right_forearm_bent_out", "ticks": 3 },
    { "pose": "right_forearm_straight_out", "ticks": 2 },
    { "pose": "right_forearm_bent_out", "ticks": 2 },
    { "pose": "right_forearm_straight_out", "ticks": 2 },
    { "pose": "rest", "ticks": 6 }
  ],
  "variant": { "time": [0.9, 1.15], "amplitude": [0.85, 1.1] }
}
```

### Compilation

A compiler expands pose refs into the existing DSL program format:

```
steps[i].pose → look up joints in poses.json → emit {op:"pose", joints, ticks}
```

The output is a standard program JSON compatible with the existing motion-player, executor, and validator. The pose-ref format is the authoring format; the joint-angle format is the runtime format.

### LLM Prompt Design

The composer LLM receives:
- The full pose dictionary (names + descriptions + tags, NOT the joint angles)
- The command text
- 2-3 examples of good choreography plans
- Rules: start and end at rest, use 2-6 ticks per step, 10 ticks = 1 second

The LLM's job is dramaturgy — what body positions, what order, what rhythm. It never needs to understand biomechanics because every pose it references is already verified.

If the LLM needs a pose not in the dictionary, it returns a `{"pose": "NEW:description of desired pose"}` entry. The pipeline detects the `NEW:` prefix, enters pose authoring mode (Layer 1) to create and verify the pose, adds it to the dictionary, then resumes choreography compilation. This keeps the composer LLM's output clean — it either references an existing pose or requests a new one, never emits raw joint angles.

## Layer 3: Stick Figure Renderer

### Purpose

The visual "eyes" of the eval system. Renders the humanoid rig as a color-coded skeleton at readable scale.

### Visual Design

- **Bones as lines:** spine/head white, arms blue, legs green — 3px stroke width
- **Joints as circles:** 5px radius at each joint origin, filled with bone color
- **Ground line:** horizontal gray line at foot level
- **Scale:** ~400×600px per frame — large enough for vision models to read every limb position
- **Background:** dark gray (#1a1a1a)

### Output Modes

| Mode | Use | Output |
|------|-----|--------|
| Single pose | Pose verification | One 400×600 image |
| Frame strip | Motion verification | N keyframes side by side, ~(400×N)×600 |
| Annotated strip | Vision model input | Frame strip + command text header + tick labels between frames |

### Implementation

File: `src/life/eval/stick-renderer.js`

Pure function: `renderPose(rig, joints, width, height) → ImageData/Canvas`

Uses `solvePose` from `src/life/pose.js` (already browser-safe) for FK. Draws lines between `bone.origin` → `bone.tip` for each bone in the solved pose. Runs in:
- **Node.js** via `@napi-rs/canvas` (headless eval pipeline)
- **Browser** via native Canvas 2D (QA workbench)

The drawing code is identical in both contexts — only the canvas creation differs.

## Layer 4: Automated Eval Pipeline

### Pipeline Steps

```
Input: command text + choreography plan (pose refs + timing)
  ↓
[Pre-checks] — structural validation, no vision model needed
  • Joint limits (existing validateProgram)
  • Continuity: max 30°/tick between consecutive poses
  • Balance: COM over support polygon (unless balance:off)
  • Self-intersection: geometric check — do any bone segments cross?
  • Return-to-rest: last step should be "rest" or a declared terminal pose
  ↓ (fail any pre-check → reject immediately with specific violation)
  ↓
[Render] — compile plan → program → solvePose per frame → stick figure strip
  ↓
[Vision Eval] — send annotated strip + command to vision model
  Prompt: "This stick figure sequence is supposed to show a person
           performing: '{command}'.
           Frame 1 is the starting pose, frame N is the ending pose.
           Score the motion 1-5:
           5 = clearly matches the command, natural movement
           4 = recognizable, minor issues
           3 = somewhat matches but awkward
           2 = wrong movement or confusing
           1 = nonsensical
           Explain what's wrong if score < 5."
  ↓
[Gate]
  Score ≥ 4 → PASS → store compiled program in validated dictionary
  Score < 4 → extract critique → feed back to composer → retry
  3 failures → mark FAILED, log for human review queue
```

### Vision Model

Uses the same provider system as motion-llm.js (OpenAI or Anthropic). For OpenAI: `gpt-4o-mini` with image input. For Anthropic: `claude-haiku-4-5` with image input. The image is base64-encoded in the message.

### Eval File

Each eval run produces a record:

```json
{
  "command": "do a cartwheel",
  "id": "do_a_cartwheel",
  "attempts": [
    {
      "plan": [...],
      "precheck": "pass",
      "score": 2,
      "critique": "Arms don't go overhead, legs stay on ground",
      "strip_path": "evals/do_a_cartwheel_attempt1.png"
    },
    {
      "plan": [...],
      "precheck": "pass",
      "score": 4,
      "critique": "Good arc but landing is abrupt",
      "strip_path": "evals/do_a_cartwheel_attempt2.png"
    }
  ],
  "verdict": "pass",
  "final_score": 4
}
```

Stored in `src/life/choreography/evals/` for debugging and improvement.

## Layer 5: Validated Motion Dictionary

### Storage

Validated motions live as JSON files in `src/life/choreography/validated/`:

```
src/life/choreography/validated/
  wave.json
  jumping_jacks.json
  do_a_cartwheel.json
  ...
```

Each file is a standard program JSON (the compiled output, not the pose-ref plan). The manifest (`manifest.js`) is auto-generated from the directory contents.

### Metadata

Each validated motion includes:

```json
{
  "id": "wave",
  "kind": "gesture",
  "tags": ["wave", "hello", "goodbye", "greet"],
  "desc": "Wave the right hand in greeting",
  "eval_score": 5,
  "source": "generated",
  "root": { ... }
}
```

### Reuse

Any entity — player, NPC, scripted cutscene — plays a validated motion by ID. The motion-player.js (already built) handles playback. The command-chat.js (already built) handles lookup. No per-entity authoring; motions are universal body animations.

## Layer 6: QA Workbench

### What It Is

A separate HTML page at `tools/motion-qa.html`, served by the dev server alongside the game. A developer tool, not an in-game overlay.

### Layout

```
┌─────────────────────────────────────────────────────────┐
│ Motion QA Workbench                      [Generate New] │
├──────────┬──────────────────────────┬───────────────────┤
│ Library  │                          │ Program JSON      │
│          │   Stick Figure Canvas    │ (editable)        │
│ ☑ wave   │   with playback          │                   │
│ ☑ bow    │                          │ ──────────────    │
│ ☒ jump   │   [⏮ ▶ ⏭ 🔁] [1x ▾]   │ Eval Results      │
│ ⬜ new1  │                          │ Score: 4/5        │
│          │                          │ "Arms good but    │
│ Filter:  │                          │  head should      │
│ [______] │                          │  tilt during bow" │
├──────────┴──────────────────────────┴───────────────────┤
│ Command: [type any motion command...          ] [Enter] │
└─────────────────────────────────────────────────────────┘
```

### Features

- **Library panel:** all poses and motions, color-coded (green=pass, red=fail, gray=untested), filterable by tags/category
- **Canvas:** large stick figure rendering with playback controls — play/pause, step forward/back, speed control, loop toggle
- **JSON panel:** the compiled program JSON, live-editable — changes re-render immediately
- **Eval panel:** latest eval score, critique text, attempt history
- **Command bar:** type anything → triggers the full generate→eval loop with live progress
- **Re-eval button:** re-run the vision eval on the current motion (useful after manual JSON edits)
- **Approve/Reject:** manual override for edge cases the automated eval gets wrong

## Migration Path

### Phase 1: Stick Figure Renderer + Pose Bootstrap
Build the renderer. Manually verify ~30 essential poses by rendering them, eyeballing the stick figure, and adding to poses.json. These seed the dictionary.

### Phase 2: Automated Pose Verification
Wire up the vision model eval for single poses. Run every pose through it. Fix any that fail. This validates the initial dictionary and proves the eval works.

### Phase 3: Choreography Composer + Motion Eval
Build the pose-ref choreography format and compiler. Build the motion eval pipeline (render strip → vision judge). Regenerate all 50 library motions using the new system. Delete the old hand-authored JSONs.

### Phase 4: QA Workbench
Build the HTML tool. Sweep the full library visually. Fix outliers.

### Phase 5: Scale
Generate the taxonomy (~190 motions) through the automated pipeline. Each motion goes through compose → render → eval → store. No human in the loop except spot-checking the workbench.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Stick figure renderer | Canvas 2D (pure JS, browser + Node) |
| FK solver | Existing `solvePose` from `src/life/pose.js` |
| Node canvas | `@napi-rs/canvas` (fast, no native deps on Windows) |
| Vision model | OpenAI gpt-4o / gpt-4o-mini (image input) or Anthropic Claude with vision |
| Choreography LLM | Same provider as vision (text-only for composition) |
| QA workbench | Static HTML + ES modules, served by dev server |
| Storage | JSON files in `src/life/choreography/` |

## Key Design Decisions

1. **Poses are atoms, choreographies are molecules.** The LLM never invents joint angles for choreography — only for pose authoring, which has its own eval gate.

2. **Stick figure over pixel art for eval.** The game avatar is ~80px tall pixel art. A 400px stick figure is far more legible for a vision model and renders in microseconds without a browser.

3. **No human in the eval loop.** The system must scale to hundreds of motions. Humans spot-check via the workbench but aren't gating.

4. **Validated = permanent.** Once a motion passes eval, it's in the dictionary forever. Any entity can play it. The dictionary only grows.

5. **Provider-agnostic.** OpenAI and Anthropic both supported for both text (composition) and vision (eval). Key stored in localStorage, never committed.
