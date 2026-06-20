# Canonical Humanoid Rig — Design Spec

> **Status:** Draft for review (2026-06-19). Sub-project 1 of the unified generative-animation effort.
> **Atlas placement:** S4 · Life, layer **L2 (Body Substrate)** — an *evolution* of the existing locked rig (`src/life/rigs/humanoid.json`).
> **Relationship to prior specs:** This spec **evolves**, and does **not** duplicate, the locked authorities `docs/superpowers/specs/2026-06-12-generative-motion-dsl-design.md` (11 motion primitives, validator) and `2026-06-12-motion-taxonomy.md` (postures/gaits/choreographies). It changes only the **rig data contract** those systems stand on, additively.

---

## 1. Why this exists

The game already ships a generative motion system: a 15-bone 2D FK rig, an 11-primitive Motion DSL with ~944 authored choreography programs, a 27-slot equipment system, an 8-direction sprite renderer that already projects depth (`xProj`/`xSign`), and a PixelLab body-part pipeline (south pilot). Separately, the `skeleton-viewer/` **PSCH** system generates mocap-derived locomotion in 3D.

The user's vision — *generate body parts / clothing / armor / weapons / items independently as 8-direction PixelLab sprites and assemble them onto one skeleton, animated generatively across all body points* — requires one skeleton that serves **two jobs at once**: the **motion rig** (things that move) and the **attachment graph** (where worn/held items hang). The current 15-bone rig is adequate for forward walk/run but, per the rig audit (`wf_d5081e7a-4fe`, 10 agents), is **structurally short** for the full vision (no neck, no clavicle, single spine, no toe, no pelvis DOF, no grip socket, no per-entity proportions). This spec defines the **canonical rig** we evolve toward.

Decisions locked with the user (2026-06-19): **canonical-rig-first**; **commit to 2.5D now**; **per-entity proportion vector**; **one unified skeleton** (no second rig, no retarget); **PixelLab 2D sprites, 8 directions per part — and that's the directional budget**.

## 2. Atlas placement & edges

- **Node:** S4 · Life · L2 Body Substrate (the rig is pure derived data, like building blueprints in M4).
- **Reads:** Identity (race/age/bodyType → proportion vector), M5 Items & Equipment (what is worn/held → sockets), M4 Blueprints (the rig is itself a nested blueprint: entity → skeleton → bone), S1 Kernel (determinism/tick contract), S2 Substrate (terrain for foot/hand IK).
- **Writes:** S2 Rendering (per-frame bone transforms → the projector), S1 Kernel (attach/detach + motion event intents).
- **Honest absence:** if a body/rig is absent, the entity does not render as a humanoid (no fake stand-in); if a *bone* is present but undriven, it renders at its rest pose (never faked into motion).

## 3. The two-job principle: bones vs. sockets

- **Bone** — a segment that moves relative to its parent and drives animation. Has parent, rest offset/length, rest orientation, joint limits, mass.
- **Socket** — a named attachment anchor (offset **+ rotation**) parented to a bone. Rides the bone's transform; is **not** an independently-animated joint. A bone may carry several sockets.

This split is what lets one skeleton hold pauldrons, a backpack, and a swung weapon without inflating the joint count.

## 4. The canonical skeleton (bones)

Additive over today's 15 bones — **existing names are preserved** so the 944 choreographies keep resolving. New bones are inserted as intermediates/leaves with rest-pose compensation (see §8).

| Bone | Status | Parent | Role |
|---|---|---|---|
| `root` | exist (gains DOF) | — | pelvis/hips; **add rotational DOF** (yaw/tilt) so weight-shift is real, not faked |
| `spine` | exist | root | lower spine / abdomen (belt anchor; the bone the 944 programs already drive) |
| `chest` | **new** | spine | upper spine / thorax; arms + neck re-parent here for torso counter-rotation |
| `neck` | **new** | chest | skull-base pivot for head turn/look-at |
| `head` | exist | neck (was spine) | head; face + hair are **sockets**, not bones |
| `clavicle_l` / `clavicle_r` | **new** | chest | shoulder girdle; carries pauldron sockets + shrug/scapular motion; recovers Mixamo clavicle data |
| `arm_u_l` / `arm_u_r` | exist | clavicle_* (was spine) | upper arm |
| `arm_f_l` / `arm_f_r` | exist | arm_u_* | forearm |
| `hand_l` / `hand_r` | exist | arm_f_* | hand; **grip socket** holds items (no finger bones) |
| `thigh_l` / `thigh_r` | exist | root | upper leg |
| `shin_l` / `shin_r` | exist | thigh_* | lower leg |
| `foot_l` / `foot_r` | exist | shin_* | foot (ankle = the shin→foot joint) |
| `toe_l` / `toe_r` | **new** | foot_* | ball/toe; toe-off, heel-strike, tiptoe, true ground contact |

**~21 bones.** Deliberately **not** bones (per user's calls): fingers (grip socket + discrete hand-state sprites instead), separate ankle bone (it's the shin→foot joint), hair/face (sockets/layers on `head`), facial bones (sprite-state layer — §7).

## 5. Transform & 2.5D model

Each bone's local transform becomes a **full 3D transform** (translation + orientation), superseding the current single 2D angle:

- **In-plane bend** (the existing per-bone angle the 944 programs author) maps to the bone's **primary screen-plane rotation** — unchanged semantics.
- **Depth (`z`)** and **yaw/twist** become **new optional channels**, defaulting to rest (0) so legacy programs are unaffected.
- **Per-entity proportions** (§6) scale bone offsets/lengths at solve time.

**Rendering = projection, not a second rig.** The existing renderer already projects depth per facing (`xProj` 1/0.75/0.25) and mirrors (`xSign`); we **generalize** that to a real 3D→screen projection: for the entity's facing (snapped to one of 8), project each bone transform to screen, then **place / 2D-rotate / depth-sort / foreshorten** that direction's part-sprites + socketed item-sprites — all composited into the **GL sprite pipeline** (non-negotiable; never a 2D top-pass).

**What 2.5D + flat 8-dir sprites buys (and its boundary):** real depth-sort, foreshortening, body-facing twist, and 2D limb rotation. A single limb's *axial roll* (forearm pronation, a blade changing edge mid-swing) cannot be shown by a flat sprite; it is **approximated** via facing selection + foreshortening + discrete hand-state sprites. This is the accepted pixel-art tradeoff and the only thing that would ever need more than 8 sprites — a deliberate, documented boundary.

## 6. Per-entity proportion vector

Today race/age/bodyType scale only the *sprites*, while the skeleton stays fixed — causing sprite/skeleton drift and foot-line slip. The canonical rig carries a **per-entity proportion vector**: per-bone length scalars + overall hip height, derived from Identity (race × bodyType × ageBand, reusing the existing factor in `body.js`). The solver scales bone offsets by it so a child/giant/heavyset animates on correct proportions **and** the same factor drives sprite scale, keeping feet grounded. Default vector = identity (current behavior).

## 7. Socket model (the attachment graph)

A socket is `{ name, bone, offset:[x,y,z], rot }`. Sockets **map onto the existing 27 equipment slots** (`sim/items/equipment.js` SLOTS + `body.js` SLOT_ANCHOR) — most already exist; the change is re-anchoring them to the richer bones and giving them a real offset+rotation instead of sprite-center placement.

| Socket(s) | Rides | Items |
|---|---|---|
| `crown`, `face` | head | hair, hats, **helmets**, masks, glasses |
| `collar` (neck slot) | neck | necklaces, scarves, gorgets, hoods |
| `pauldron_l/r` (shoulders) | clavicle_l/r | pauldrons (separate per side) |
| `chest`, `back` | chest | chestplate/shirt; **backpacks, bags, capes, sheathed weapons** |
| `belt` (waist) | spine | belts, pouches, holsters, skirts |
| `vambrace_l/r` (wrist) | arm_f_l/r | bracers, **shields** |
| `grip_l/r` (hand_main/off) | hand_l/r | **held weapons/tools/items** — carries rotation so items orient & swing |
| `hip_l/r` | root | hip-sheathed/holstered weapons |
| `thigh_l/r`, `greave_l/r` | thigh / shin | leg armor, shin guards |
| `boot_l/r` | foot | boots, anklets |

Facial expression is **not** bones: it is a sprite-state layer on the `head` socket set (`face`/`eyes`), driven by a small expression enum — consistent with the existing "gestures are rig poses + hand states, never animation assets" rule and with the fact that the mocap corpus carries no facial bones.

## 8. Data contract (`humanoid.json` v2)

Versioned; the loader handles v1→v2. Shape (additive over v1):
```jsonc
{
  "id": "humanoid", "version": 2,
  "bones": { "<id>": { "parent": "<id|null>", "offset": [x,y,z], "length": n,
                       "pivot": [x,y], "restRot": [yaw,pitch,roll], "mass": n } },
  "joints": { "<id>": { "bend": {"min":-30,"max":30}, "twist": {"min":0,"max":0},
                        "stiffness": 0.8 } },        // twist range 0 until 2.5D twist is authored
  "sockets": { "<name>": { "bone": "<id>", "offset": [x,y,z], "rot": 0 } },
  "proportions": { "axes": ["race","bodyType","ageBand"], "default": "identity" },
  "effectors": { "hand_l": {...}, "foot_l": {...}, ... },   // extended to toe tips for support
  "lookAt": [["head",0.5],["neck",0.35],["spine",0.15]],    // re-weighted for the new neck
  "gaits": { "walk": {...}, "run": {...} }                   // unchanged; PSCH supersedes generation
}
```
`humanoid.json` remains the single rig authority cited by the motion-DSL spec; v2 is a superset.

## 9. Migration surface

**Additive-safe (no change needed):** the ~944 choreography programs (generic `pose.js` solve), the validator's structural checks, the equipment slot *names*.

**Must update (flagged tasks, mostly small):**
- **Re-parenting compensation:** `arm_u_*` (spine→clavicle), `head` (spine→neck) shift their resolution frame. Bake **rest offsets** so existing joint angles produce identical world poses at rest; spot-fix the handful of programs that visibly differ. *This is the one non-trivial migration risk and must have a regression: render every program before/after and diff.*
- `lookAt` re-weighting (add neck); `IK_CHAINS` (clavicle is a posed-offset bone, keep 2-bone IK from `arm_u` — zero IK-solver change); `supportOf` (use toe tips when present); gait code (drive ankle/toe; pelvis bob via the new DOF).
- `SLOT_ANCHOR` re-anchoring to new bones; renderer socket placement (offset+rotation, not sprite-center); a **held-item render path** in the FK renderer (currently absent).
- PixelLab: new directional sprites only where a new bone needs its own art (toe, clavicle/pauldron region); much is socket-only items, not new body parts.

**Out of scope — each its own later spec:** the renderer 2.5D/projection migration; PSCH → `locomote` integration (+ PSCH rotation channels); the 8-direction PixelLab asset rollout; combat-twist realization; two-actor contact rig; LOD/simplified rig for distant NPCs.

## 10. Acceptance

- Loader reads v1 and v2; v2 is a strict superset.
- **Regression:** every existing choreography renders within tolerance of its v1 output (the re-parenting guard).
- New bones with no driving channel render at rest (honest absence).
- Proportion vector scales skeleton + sprites together; lowest foot stays grounded across body types.
- Each socket round-trips: an item at a socket inherits the bone transform (position **and** rotation).
- Machine checks are machine checks (loader, regression diff, grounding); "reads right" is the human gate.

## 11. Open questions for review

1. **Spine naming:** keep `spine` = lower + add `chest` = upper (chosen above, minimizes program churn) vs. rename to `spine_lower`/`spine_upper` (cleaner, more churn). Recommend the former.
2. **Re-parenting vs. flat-add:** accept the arm/head re-parent (richer, needs the rest-offset guard) vs. add clavicle/neck as pure sockets and leave arms/head on spine (zero churn, weaker shoulder/neck motion). Recommend re-parent + guard.
3. **Toe now or deferred:** include `toe_*` in v2 (better ground contact, small art cost) vs. defer to the combat/locomotion-quality pass. Recommend include.
