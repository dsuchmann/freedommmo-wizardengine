# Spatial Motion System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A spatial instruction language where the LLM describes motions as body-relative movements, a deterministic compiler converts to joint angles + Z hints, and the renderer supports dynamic draw order.

**Architecture:** Body part groups → spatial primitives → deterministic compiler → existing DSL + Z hints → renderer with dynamic painter order.

**Tech Stack:** Existing `solvePose`, `humanoid.json` rig, `motion-player.js`, `humanoid-player-renderer.js`.

---

### Task 1: Body part groups module

**Files:**
- Create: `src/life/eval/spatial-groups.js`
- Test: `sim/test/spatial-groups.test.js`

- [ ] Write test: every group resolves to valid bone names from the rig, compound groups expand correctly, unknown group throws.
- [ ] Implement: `BODY_GROUPS` map, `resolveBones(groupName)` → `string[]`, `expandCompound(groupName)` → individual group names.
- [ ] Verify tests pass.
- [ ] Commit.

### Task 2: Spatial compiler — primitives to joint angles

**Files:**
- Create: `src/life/eval/spatial-compiler.js`
- Test: `sim/test/spatial-compiler.test.js`

- [ ] Write tests: `raise left_arm 1.0` → `arm_u_l: -170`, `raise right_arm 0.5` → `arm_u_r: 85`, `bend left_leg 1.0` → `shin_l: 140`, `extend right_arm 0.6` → correct angles, compound groups expand correctly, zHint passes through.
- [ ] Implement: `compileInstruction(instruction, rig)` → `{ joints: {}, zHints: {} }`. Mapping tables per primitive per bone role (upper/middle/end). `lerp(rest, target, amount)` with rig joint limits.
- [ ] Implement: `compileSpatialProgram(choreography, rig)` → standard DSL program `{id, kind, root: {op:"sequence", children:[{op:"pose", joints, ticks, zHints}]}}`. Handles sequential and parallel composition.
- [ ] Verify tests pass.
- [ ] Commit.

### Task 3: Dynamic draw order in renderer

**Files:**
- Modify: `sim/life/body.js` (composeLayers accepts zHints)
- Modify: `src/render/humanoid-player-renderer.js` (pass zHints, reorder layers)
- Modify: `src/render/motion-player.js` (carry zHints on frames)

- [ ] Modify `composeLayers` to accept optional `zHints` parameter. When a body part has `zHint: "front"`, move its bones after torso in the draw order. When `"behind"`, move before.
- [ ] Modify motion-player to store `zHints` per frame alongside joints, expose via `currentZHints()`.
- [ ] Modify humanoid renderer to read current Z hints and pass to composeLayers.
- [ ] Test: compose with zHint "front" on right_arm puts arm bones after torso regardless of direction.
- [ ] Commit.

### Task 4: Spatial LLM composer

**Files:**
- Create: `src/life/eval/spatial-compose.js`

- [ ] Build prompt listing body part groups + primitives + format + 3 examples (wave, bow, point_forward in spatial format).
- [ ] `composeSpatial(command, cfg)` → calls LLM → returns spatial choreography JSON.
- [ ] Commit.

### Task 5: Wire into QA workbench

**Files:**
- Modify: `tools/motion-qa.html`

- [ ] Generate button uses spatial composer → spatial compiler → stick figure display.
- [ ] Detail panel shows spatial instructions instead of raw joints.
- [ ] Critique sends spatial instructions to LLM for adjustment (not joint angles).
- [ ] Commit.

### Task 6: Wire into game command chat

**Files:**
- Modify: `src/ui/command-chat.js`
- Modify: `src/life/motion-llm.js`

- [ ] When no dictionary match, use spatial composer → compiler → playMotion.
- [ ] Commit.

### Task 7: Tests + close-out

- [ ] Run full test suite, all green.
- [ ] Commit.
