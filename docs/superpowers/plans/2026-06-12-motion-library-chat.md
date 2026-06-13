# Motion Library Bootstrap + Command Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A large validated animation library over the L3 motion DSL, a chat input where the player commands the avatar, instant dictionary selection, and real-time LLM generation of new programs when no match exists.

**Architecture:** Animations stay one-time-authored DSL programs (user-confirmed: bundles of primitives — exactly the L3 design). Bootstrap ~50 choreographies validated against the rig; bind the executor's joint tracks into the humanoid part renderer; chat UI parses counts + fuzzy-matches the library; misses go to a provider-configurable LLM that emits a DSL program, validated with a repair loop, cached into the dictionary. Honest absence: no API key → selection-only, chat says so.

**Tech Stack:** L3 DSL (`sim/life/motion/program.js` 11 primitives, `validator.js`, `executor.js solveProgramTrack`), `src/life/pose.js` (renderer-safe FK), existing choreography JSON format (`src/life/choreography/wave.json` is the reference shape).

**Key facts for implementers:**
- Program shape: `{ id, kind, variant:{time,amplitude}, root:{op,children|joints|ticks...} }`. New: add `tags: []` and `desc: ""` metadata fields (loader ignores unknown fields today — verify `loadProgram`).
- Validator ground truth: `validateChoreography(rig, program)` — joint limits from `src/life/rigs/humanoid.json`, ≤30°/tick continuity, balance checks. Programs that lie down / invert MUST include `{op:'balance', on:false}` before leaving standing support.
- DSL ticks are sim ticks; renderer maps them at 10 ticks/sec wall time.
- Renderer joints override: `drawHumanoidPlayer` currently derives joints from `jointsFor(frame, animation)`; add an optional active-motion track consulted first.

---

### Task 1: Choreography library bootstrap (~50 programs)

**Files:** Create `src/life/choreography/<id>.json` (one per program); Create `src/life/choreography/manifest.js` (exports `MOTION_MANIFEST = [{id, tags, desc, kind}]`); Test: `sim/test/choreography-library.test.js`.

- [ ] Write the failing test: load every manifest entry's JSON, run `validateProgram` + `validateChoreography(rig, program)` — assert zero violations for ALL entries; assert manifest ids unique and every JSON file is in the manifest.
- [ ] Author the library. Coverage targets (one JSON each, tags generous for matching): jumping_jacks, handstand, headstand, cartwheel_prep, pushup, situp, squat, lunge, plank, stretch_arms, toe_touch, bow, curtsy, salute, clap, cheer, point_forward, beckon, shrug, nod, shake_head, facepalm, flex, taunt, wave_both, kneel, pray, sit_down (exists), lie_down_back, lie_down_belly, crawl, roll_over, jump_in_place, hop_left, hop_right, spin_around, moonwalk, march_in_place, tiptoe, crouch, look_around, yawn_stretch, dig, hammer, chop_motion, sweep, fish_cast, dance_improvised (exists), wave (exists), nervous_glance (exists). Lying/inverted programs start with `{op:'balance', on:false}` and restore `on:true` at the end.
- [ ] Run the test; fix every validator violation (arithmetic: max joint delta per pose step = 30° × ticks).
- [ ] Commit.

### Task 2: Renderer motion binding

**Files:** Create `src/render/motion-player.js`; Modify `src/render/humanoid-player-renderer.js`.

- [ ] motion-player: `playMotion(program, {count=1})` → builds the joint track via `solveProgramTrack(rig, program, {seed, entityId:0, startTick:0})`, repeated `count` times; `currentJoints(nowMs)` maps wall time → tick → joints (10 ticks/sec, lerp between ticks); `stopMotion()`; auto-stop at track end.
- [ ] humanoid renderer: if a motion is active, use its joints instead of `jointsFor` (walking input calls `stopMotion()` — moving cancels the performance).
- [ ] Manual browser check: trigger `playMotion(wave)` from console, see the arm wave.
- [ ] Commit.

### Task 3: Command chat UI + matcher

**Files:** Create `src/ui/command-chat.js`; Create `src/life/motion-match.js`; Modify `src/main.js` (Enter opens chat, input suppressed while open); Test: `sim/test/motion-match.test.js`.

- [ ] motion-match: `parseCommand(text)` → `{count, tokens}` (digits + number words one..twenty); `matchMotion(tokens, manifest)` → best entry by token overlap on id/tags/desc, normalized score; return null below 0.45.
- [ ] Tests: "do five jumping jacks" → {count:5, id:'jumping_jacks'}; "do a handstand" → handstand; "fly to the moon" → null.
- [ ] chat UI: fixed bottom input (Enter opens/sends, Esc closes); on match → playMotion + feedback line "jumping_jacks ×5"; on null → hand off to Task 4 generator (or honest "no LLM configured — closest: <best guess>").
- [ ] Commit.

### Task 4: Runtime LLM generation + cache

**Files:** Create `src/life/motion-llm.js`; Modify `src/ui/command-chat.js`.

- [ ] Config: `localStorage 'motion_llm'` JSON `{url, model, key}` (default url Anthropic messages API, model claude-haiku-4-5); never committed anywhere.
- [ ] Prompt: DSL cheat-sheet (PRIMITIVES table, joint names + min/max from rig JSON, 30°/tick rule, balance rule, 2 example programs) + the user command → "respond with ONLY the program JSON".
- [ ] On response: parse → `validateProgram` + `validateChoreography`; violations → one repair round-trip (feed violations back); still failing → chat shows the violations honestly.
- [ ] Success → cache program in-memory + `localStorage 'motion_cache'` keyed by id; manifest entry appended at runtime (tags from command tokens) so repeats are instant dictionary hits; play it.
- [ ] Commit.

### Task 5: Close-out

- [ ] Full suite green; roadmap/memory note; browser-verify: "do five jumping jacks" instant, novel command generates (with key) or refuses honestly (without).
