# Spatial Motion System — Body-Relative Coordinate Instructions

## Goal

Replace raw joint angles with a spatial instruction language where the LLM describes motions as body-relative movements ("raise left_arm 80% over 4 ticks, draw in front") and a deterministic spatial compiler converts those to joint angles + dynamic draw order. The LLM never sees joint angles — it works in a human-readable spatial vocabulary.

## Core Problem

The current system requires the LLM to reason about joint angles (e.g., `arm_u_l: -136`) which it doesn't understand visually. The spatial system introduces an abstraction layer: the LLM describes WHERE body parts should move in 3D-relative space, and deterministic math handles the HOW.

## Coordinate System

Movements happen in body-relative pseudo-3D:
- **Y axis** (up/down) — raise/lower. Consistent regardless of facing direction.
- **Z axis** (forward/backward) — extend/retract. "Forward" means the direction the character faces. In 2D rendering, this manifests as draw order (front/behind torso) and foreshortening.
- **Joint axis** (bend/straighten) — fold at the elbow/knee/wrist. Not a spatial direction but a joint-local operation.
- **Rotation axis** (turn_in/turn_out) — rotate toward/away from body centerline.

Key insight: **joint angles don't change per direction**. The same joint values render correctly from all 8 directions because the renderer's `xProj`/`xSign`/painter-order already handles the 3D→2D projection. The spatial compiler computes joints ONCE.

## Architecture

```
LLM: "raise left_arm 80%, extend right_arm forward 60%"
         ↓
┌────────────────────────┐
│  Spatial Instruction   │  Human-readable authoring format
│  Language              │  { part, action, amount, ticks, zHint }
└────────┬───────────────┘
         ↓
┌────────────────────────┐
│  Spatial Compiler      │  Deterministic: instruction → joint angles + Z hints
│  (pure math, no LLM)  │  Maps each primitive to the bone chain's joint ranges
└────────┬───────────────┘
         ↓
┌────────────────────────┐
│  Existing DSL Program  │  { op:"pose", joints:{...}, ticks, zHints:{...} }
│  + Z Hints             │  Compatible with motion-player.js
└────────┬───────────────┘
         ↓
┌────────────────────────┐
│  Renderer              │  Uses Z hints to adjust painter order per frame
│  (humanoid-player-     │  Existing xProj/xSign handles direction projection
│   renderer.js)         │
└────────────────────────┘
```

## Layer 1: Body Part Groups

19 named groups mapping to bone chains:

| Group | Bones | Notes |
|-------|-------|-------|
| `left_shoulder` | arm_u_l | Attachment point only |
| `left_arm` | arm_u_l, arm_f_l, hand_l | Full chain |
| `left_hand` | hand_l | End effector only |
| `right_shoulder` | arm_u_r | Attachment point only |
| `right_arm` | arm_u_r, arm_f_r, hand_r | Full chain |
| `right_hand` | hand_r | End effector only |
| `left_hip` | thigh_l | Attachment point only |
| `left_leg` | thigh_l, shin_l, foot_l | Full chain |
| `left_foot` | foot_l | End effector only |
| `right_hip` | thigh_r | Attachment point only |
| `right_leg` | thigh_r, shin_r, foot_r | Full chain |
| `right_foot` | foot_r | End effector only |
| `torso` | spine | Single bone |
| `head` | head | Single bone |
| `both_arms` | both arm chains | Compound |
| `both_legs` | both leg chains | Compound |
| `both_shoulders` | arm_u_l, arm_u_r | Compound |
| `both_hips` | thigh_l, thigh_r | Compound |
| `upper_body` | spine, head, both arms | Compound |
| `lower_body` | both legs | Compound |
| `full_body` | all bones | Compound |

## Layer 2: Spatial Primitives

8 movement primitives, each mapping to specific joint behaviors:

| Primitive | What it does | Upper bone | Middle bone | End bone |
|-----------|-------------|------------|-------------|----------|
| `raise` | Move upward along body Y | Rotate toward overhead | Stays straight (0) | Stays neutral |
| `lower` | Move downward toward rest | Rotate toward rest (0) | Stays straight | Stays neutral |
| `extend` | Reach forward (body Z) | Rotate to horizontal forward | Straighten (toward 0) | Neutral |
| `retract` | Pull back behind body | Rotate backward | Fold at joint | Neutral |
| `bend` | Fold at the joint | No change | Fold (elbow/knee) | Slight follow |
| `straighten` | Unfold the joint | No change | Straighten toward 0 | Neutral |
| `turn_in` | Rotate toward centerline | Rotate inward | No change | Rotate inward |
| `turn_out` | Rotate away from center | Rotate outward | No change | Rotate outward |

### Joint Range Mapping

Each primitive maps `amount` (0.0–1.0) to a fraction of the relevant joint's range:

**Arms:**
- `raise` on left_arm: `arm_u_l = lerp(0, -170, amount)` (0 = rest, 1.0 = fully overhead)
- `raise` on right_arm: `arm_u_r = lerp(0, 170, amount)` (mirrored sign convention)
- `extend` on left_arm: `arm_u_l = lerp(0, -90, amount)` (horizontal forward)
- `bend` on left_arm: `arm_f_l = lerp(0, -140, amount)` (elbow fully bent)
- `bend` on right_arm: `arm_f_r = lerp(0, 140, amount)` (mirrored)

**Legs:**
- `raise` on left_leg: `thigh_l = lerp(0, -110, amount)` (leg lifted)
- `bend` on left_leg: `shin_l = lerp(0, 140, amount)` (knee bent)
- `extend` on left_leg: `thigh_l = lerp(0, -90, amount)` + `shin_l = 0` (leg forward, straight)

**Torso:**
- `raise` (lean back): `spine = lerp(0, 30, amount)`
- `lower` (lean forward): `spine = lerp(0, -30, amount)`
- `extend` (lean forward): same as lower
- `retract` (lean back): same as raise

**Head:**
- `raise` (look up): `head = lerp(0, 60, amount)`
- `lower` (look down): `head = lerp(0, -60, amount)`
- `turn_in`/`turn_out`: `head = lerp(0, ±60, amount)`

## Layer 3: Spatial Instruction Format

A single instruction:
```json
{
  "part": "left_arm",
  "action": "raise",
  "amount": 0.8,
  "ticks": 4,
  "zHint": "front"
}
```

A choreography:
```json
{
  "id": "point_forward",
  "kind": "gesture",
  "steps": [
    { "type": "parallel", "steps": [
      { "part": "right_arm", "action": "extend", "amount": 0.6, "ticks": 4, "zHint": "front" },
      { "part": "torso", "action": "extend", "amount": 0.2, "ticks": 4 }
    ]},
    { "part": "right_hand", "action": "turn_out", "amount": 0.5, "ticks": 2 },
    { "type": "parallel", "steps": [
      { "part": "right_arm", "action": "lower", "amount": 1.0, "ticks": 4 },
      { "part": "torso", "action": "raise", "amount": 0.0, "ticks": 4 }
    ]}
  ]
}
```

## Layer 4: Spatial Compiler

Pure deterministic function: `compileSpatial(instruction, rig) → { joints, zHints }`

For each instruction:
1. Resolve body part group → list of bones
2. Look up the primitive → which bones in the chain change, in which direction
3. Map `amount` (0–1) to joint angle via `lerp(restAngle, targetAngle, amount)`
4. Emit `zHint` for the renderer

For compound groups (`both_arms`, `upper_body`, etc.), apply to each constituent group.

For sequential/parallel composition, emit standard DSL nodes (`{op:"sequence"}`, `{op:"parallel"}`), each child being `{op:"pose", joints:{...}, ticks, zHints:{...}}`.

Output is a standard DSL program compatible with the existing motion-player.js, augmented with `zHints` on each pose node.

## Layer 5: Dynamic Draw Order (Z Hints)

Each pose node can carry `zHints`:
```json
{
  "op": "pose",
  "joints": { "arm_u_r": 90, "arm_f_r": 0 },
  "ticks": 4,
  "zHints": { "right_arm": "front" }
}
```

The renderer's `composeLayers` function currently returns a static painter order per direction. With Z hints:
1. Start with the static direction-based order
2. For any body part with `zHint: "front"`, move its bones AFTER (on top of) the torso in the draw list
3. For `zHint: "behind"`, move its bones BEFORE (under) the torso
4. `"default"` or absent = use the static order

This is a per-frame adjustment — each pose in a motion can have different Z hints.

## Layer 6: LLM Integration

The LLM prompt includes:
- The list of body part groups with descriptions
- The 8 spatial primitives with plain-English descriptions
- The instruction format
- 3-4 example choreographies
- Any learned rules from the QA workbench

The LLM's job:
1. Decompose a command ("somersault") into a sequence of spatial instructions
2. Pick the right body parts and primitives
3. Set reasonable amounts and timing
4. Add Z hints when a body part moves in front of or behind the torso

The LLM NEVER outputs joint angles. The spatial compiler handles that deterministically.

## Layer 7: QA Workbench Integration

The workbench updates to:
- Show spatial instructions alongside the stick figure (not raw joints)
- Let the user critique in spatial terms ("the arm should be higher") which maps to adjusting `amount`
- The critique LLM adjusts spatial instructions, not joint angles
- Generated choreographies are stored in spatial format
- The compiler runs on display to produce joints for the stick figure

## Motion Categories (phased)

**Phase 1 (this spec): Solo actions** — the character performs alone. Wave, bow, jump, somersault, sit, etc. All spatial instructions reference only the character's own body parts.

**Phase 2 (future): Entity-object interactions** — pick up, hold, open, swing. Adds an `object` field to instructions and IK targets for hand placement.

**Phase 3 (future): Entity-entity interactions** — handshake, dance, fight. Adds synchronization protocol between two spatial instruction streams and shared phase negotiation.

## File Structure

| File | Responsibility |
|------|---------------|
| `src/life/eval/spatial-groups.js` | Body part group definitions + bone chain lookups |
| `src/life/eval/spatial-compiler.js` | Primitive → joint angle mapping + Z hint emission |
| `src/life/eval/spatial-compose.js` | LLM prompt building for spatial instructions |
| `src/render/humanoid-player-renderer.js` | Modified: dynamic draw order from Z hints |
| `src/render/motion-player.js` | Modified: pass Z hints through to renderer |
| `tools/motion-qa.html` | Modified: show/edit spatial instructions, spatial critique |
| `sim/test/spatial-compiler.test.js` | Deterministic compiler tests |

## Key Design Decisions

1. **Joint angles are NEVER in the LLM's vocabulary.** The spatial language is the only authoring interface. Joint angles are an implementation detail computed by the compiler.

2. **The compiler is deterministic.** Same spatial instruction always produces the same joint angles. No LLM in the compilation step. This makes the system testable and predictable.

3. **Z hints are per-pose, not per-bone.** The hint says "right_arm is in front" and the renderer adjusts all three bones (upper arm, forearm, hand) in the draw order. Simpler than per-bone Z.

4. **Amount is normalized 0–1.** The compiler knows joint limits from the rig. The LLM doesn't need to know that "raise left_arm" maps to `arm_u_l: [-170, 0]` — it just says amount 0.8 and gets 80% of the range.

5. **Direction-independent.** The same spatial instruction produces the same joints regardless of facing direction. The renderer handles the 3D→2D projection per direction.
