# Generative Motion DSL — Design Spec

**Date:** 2026-06-12
**Atlas position:** S4 Life (Body/Motion), edges to S1 Kernel (tick contract), S4 Mind (intent programs), S2 Substrate (terrain queries for footing/reach), PixelLab pipeline (sprite-piece rendering of rig poses).
**Status:** charted — implementation is Pass 4 Plan L3; Plan L2 (body system) designs its rig against this spec.
**Consumed by:** `docs/superpowers/plans/2026-06-12-pass2plus-roadmap.md` rows L2, L3, X2.

## 0. The core decision (locked by user mandate)

**NOT precomputed animations.** No per-action sprite-sheet explosion, no animation graph authored per species. Instead:

1. A **predefined body-control language** (the DSL): bones, joints, center-of-mass, reach, look-at primitives.
2. **LLM minds generate intent/choreography programs** — `{action: ...}` plans, never frames, never bone angles.
3. A **physical-sanity validator** rejects impossible programs before execution.
4. The **runtime rig** executes validated programs deterministically.
5. **Cache only if useful** — caching is a performance optimization, never a semantic dependency. The world must look identical with the cache cold.

Pipeline: **Natural Language → Action Planner → Behavior System → Animation Controller**.

This is the no-mock rule applied to motion: a creature that cannot yet move is honestly absent/static; a creature that moves does so because its body executed a program, not because a canned clip played.

## 1. Layered architecture

```
NL intent ("walk to the well, look around nervously, drink")
   │  LLM / scripted goal source — S4 Mind
   ▼
Action Planner            → ordered action list from the 18-verb vocabulary
   │                        {action:"move_to", target:[x,y], gait:"walk"}
   ▼
Behavior System           → per-tick decomposition: pathing, interrupts,
   │                        re-planning, attention (look_at while moving)
   ▼
Animation Controller      → compiles current behavior into choreography
   │                        programs of DSL primitives
   ▼
Rig Runtime (deterministic) → solves bones/joints/COM per render frame
   │
   ▼
Sprite-piece renderer     → draws rig pose using PixelLab body parts
```

Each layer only speaks to its neighbors. The LLM never emits anything below the Action Planner boundary. The rig never sees intent — only programs.

## 2. The rig model (L2 deliverable, designed here)

A **rig** is data attached to a species archetype (and per-entity scale/proportion overrides from the body system):

- **Bones**: named segments with length, parent, pivot. Minimum humanoid set: `root, spine, head, arm_l/r (upper, fore, hand), leg_l/r (thigh, shin, foot)`. Quadruped set: `root, spine, head, neck, leg_fl/fr/bl/br, tail`. Birds/fish get their own minimal sets.
- **Joints**: per-bone rotation limits (min/max angle, stiffness). These are the validator's ground truth.
- **Center of mass (COM)**: computed from bone masses; the validator and runtime use it for balance.
- **Reach envelopes**: per end-effector (hands, mouth, feet) the solvable IK volume.
- **Look-at chain**: which bones participate in gaze (head, neck, optionally spine) and their contribution weights.
- **Gaits**: named locomotion generators (`walk, run, trot, hop, swim, fly`) — procedural cycles parameterized by speed, terrain slope, load. Gaits are rig code, not assets.

Rigs are defined once per archetype in data (`src/life/rigs/*.json`), validated at load.

## 3. DSL primitives (the only things a choreography program may contain)

| Primitive | Args | Semantics |
|---|---|---|
| `pose` | bone targets (named pose or partial overrides), duration | blend toward joint targets, clamped by limits |
| `ik_reach` | effector, world target, duration | IK-solve effector to target within reach envelope |
| `look_at` | world target or entity, weight | drive look-at chain toward target |
| `locomote` | gait, speed, heading-source | run a gait generator |
| `balance` | mode (`auto`/`off`), lean | COM-keeping constraint |
| `attach`/`detach` | effector, item | bind item node to effector (picks/drops route through kernel ledger) |
| `sequence` | child programs | run children in order |
| `parallel` | child programs, sync policy | run children simultaneously (e.g. `locomote` + `look_at`) |
| `wait` | duration or predicate | hold current pose |
| `emit` | event name | signal Behavior System (footstep, contact, gesture-peak) |

A **choreography program** is a JSON tree of these primitives. Programs are pure data: serializable, hashable (for the cache), and deterministic given (rig, program, tick stream).

## 4. Action vocabulary (Action Planner output — the 18 verbs)

`move_to, follow, face, gesture, look_at, pick_up, drop, use, investigate, sit, sleep, attack, talk, trade, emote, dance, jump, run, wait`

Each verb has a fixed schema, e.g.:

```json
{"action":"move_to","target":[x,y],"gait":"walk","urgency":0.3}
{"action":"pick_up","entity":"<id>","hand":"auto"}
{"action":"emote","kind":"nervous_glance","intensity":0.7}
{"action":"dance","style":"improvised","beat_source":"<music entity or none>"}
```

The Behavior System owns the verb→primitive compilation (e.g. `pick_up` = `sequence[locomote-to-range, balance(lean), ik_reach(hand, item), attach, pose(recover)]`). New verbs require a schema + compiler entry; the LLM's surface never changes shape.

## 5. Physical-sanity validator

Runs on every program before execution (and on every LLM-emitted action list before compilation):

- **Joint limits**: no pose/IK target outside joint ranges.
- **Reach**: `ik_reach` targets inside the effector's envelope (else the Behavior System must move the body first — validator returns `OUT_OF_REACH`, not a fudged stretch).
- **Balance**: COM stays inside support polygon unless airborne (`jump`) or supported (`sit`, `sleep`).
- **Continuity**: max joint angular velocity per tick; no teleporting bones.
- **World consistency**: `attach` only to entities the kernel says are takeable and in range — motion can never fabricate matter (S3 edge).

Validator verdicts: `OK | OUT_OF_REACH | UNBALANCED | LIMIT_VIOLATION | WORLD_REJECTED`, each with the offending node path. Rejected programs go back to the Behavior System for re-planning; they never half-execute.

## 6. Determinism & time contract (S1 edge)

- Rig solving runs on the **render clock**, but all world-visible consequences (`attach`, position changes from `locomote`, event emissions) are kernel intents/deltas on the **sim tick** — replay of the intent log reproduces identical world state regardless of frame rate.
- Gait phase is seeded from (entity id, tick), so two clients render the same walk.
- LLM nondeterminism is quarantined above the Action Planner: the chosen action list is recorded in the ledger (the decision, not the prose), so replay re-executes recorded actions without re-querying the mind.

## 7. Caching (only if useful)

Key = hash(rig id, program, quantized params). Value = solved pose track. Rules:
- Cache is read-through and evictable; cold cache = identical visuals, just more CPU.
- Never cache anything containing world-relative IK targets unsolved (those resolve per-instance).
- Measure first: if gait generators are cheap enough live (expected), ship no cache.

## 8. LOD behavior (S1 §4.2 edge)

- **Full tier (attention bubble)**: rig solved per frame.
- **Procedural tier**: verbs execute positionally (entity slides along path, no rig); pose snapshots only at promotion.
- **Statistical tier**: motion absent; aggregate nodes carry no rigs. Promotion synthesizes a neutral pose — honest, not a replayed clip.

## 9. Honest absence

Until L3 ships: entities render in taxonomy lifecycle states only (static sprites). No fake walk cycles, no slid sprites pretending to step. Fauna may translate position (kernel movement is real) while visibly unanimated — the absence of motion rendering is declared, not papered over.

## 10. Probe (continuous testability)

**Probe M (Pass 4):** headless — feed NL "pick the berry and eat it" to the planner with a fixed seed; assert the action list, the compiled program, validator OK, and that the resulting ledger deltas equal the hand-written pick+eat intent from Pass 1 probe 6 (motion adds presentation, never new physics). In-game leg: watch a fauna entity walk to a bush, reach, and the berry count drop.

## 11. Asset demand (→ pixellab manifest)

The rig renders **body parts**, not whole-body animation sheets: per-species part sets (head, torso, limbs segments) at 64px quantization, drawn per-direction. Counts and species list live in `docs/superpowers/plans/2026-06-12-pixellab-asset-manifest.md`.
