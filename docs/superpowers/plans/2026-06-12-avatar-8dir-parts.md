# Avatar 8-Direction Parts Implementation Plan

> **For agentic workers:** Art-lane plan — PixelLab generation is driven by the controller
> session directly (candidate review needs judgment, per the L2b pilot). Code tasks may be
> delegated. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The player avatar assembles from directional part sprites for all 8 walk directions instead of being locked to the south view.

**Architecture:** Reuse the L2b pilot pipeline (create_1_direction_object size 64 → 16-candidate review → select_object_frames → shared 64-color quantization → measured-bbox pivot meta). Generate only what a cylinder-limbed rig actually needs: a full east profile set, back-view head+torso for north, 3/4 head+torso for the two right-facing diagonals. West/SW/NW are horizontal mirrors saved as flipped PNGs (pilot convention). The renderer picks direction from `player.character` 8-way facing and projects rig x by a per-direction depth factor.

**Tech Stack:** PixelLab MCP, PIL (meta generation), existing `composeLayers`/`solvePose` renderer.

---

### Direction → asset map (canonical)

| dir | head | torso | arm_u/arm_f/hand | thigh/shin/foot | painter order |
|-----|------|-------|------------------|-----------------|---------------|
| s   | pilot | pilot | pilot | pilot | exists |
| n   | NEW back | NEW back | reuse s (cylinders) | reuse s | exists |
| e   | NEW profile | NEW profile | NEW profile (one gen, drawn l+r) | NEW profile | exists |
| w   | flip e | flip e | flip e | flip e | exists |
| se  | NEW 3/4 | NEW 3/4 | reuse s | reuse s | NEW (s-biased) |
| sw  | flip se | flip se | reuse s | reuse s | NEW |
| ne  | NEW 3/4 back | NEW 3/4 back | reuse s | reuse s | NEW (n-biased) |
| nw  | flip ne | flip ne | reuse s | reuse s | NEW |

Rig x projection factor (renderer): s/n = 1, e/w = 0.25, diagonals = 0.75. East/west mirror sign: w flips x; n un-mirrors (anatomical left on viewer's left from behind).

Unique generations: e set 8 (head, torso, arm_upper, arm_fore, hand, thigh, shin, foot) + n 2 + se 2 + ne 2 = **14**.

### Task 1: Generate east profile set (controller, PixelLab)

- [ ] Generate 8 east parts with geometry-first prompts (pilot lesson — e.g. thigh: "isolated single severed mannequin piece, ONE narrow vertical cylinder wrapped in plain brown fabric, side profile view, no second leg, no body"). Size 64, review 16 candidates, promote via select_object_frames.
- [ ] Quantize all to the existing shared 64-color palette (same script/post-process as pilot).
- [ ] Save to `assets/pixelab/body_parts/human/average/adult/<part>/e.png`; l/r pairs are the SAME file copied (side view shares art), e.g. `arm_upper_l/e.png` = `arm_upper_r/e.png`.

### Task 2: Generate n/se/ne head+torso (controller, PixelLab)

- [ ] n: back of head (hair, no face), back torso. se: 3/4 front-right head + torso. ne: 3/4 back-right head + torso. Same pipeline.
- [ ] Save as `<part>/n.png`, `<part>/se.png`, `<part>/ne.png`. Copy south limb PNGs to n/se/ne filenames for reused parts (real files keep partKey resolution uniform).
- [ ] Mirrors: save flipped copies for w/sw/nw (PIL transpose, like pilot hand/arm flips).

### Task 3: Pivot meta per direction

**Files:** Create `src/life/rigs/humanoid-parts-{n,e,w,se,sw,ne,nw}.json`; extend `scripts/body_pilot_probe.py` meta-generation approach into `scripts/body_parts_meta.py`.

- [ ] Measure bboxes per PNG; ppu = bbox-height / bone-length; pivot at bone origin (pilot convention; hands per-side when flipped).
- [ ] Run assembly probe per direction (composite at rest, seam coverage ≥ 0.35, palette union ≤ 96). Exit non-zero on FAIL.

### Task 4: Renderer direction wiring

**Files:** Modify `src/render/humanoid-player-renderer.js`; Modify `sim/life/body.js` (PART_Z diagonals).

- [ ] Add se/sw/ne/nw painter orders to PART_Z (se/sw = south order with near-side limbs last; ne/nw = north order analog). Keep "exactly 14 parts once" invariant — taxonomy-style test asserts it.
- [ ] Renderer: read 8-way facing from `player.character` (set by `setMotion({direction})` — verify property name), map to dir code, hold last facing when idle.
- [ ] Load images + meta lazily PER DIRECTION (Map keyed `part|dir`); fall back to south set until a direction's assets are ready (honest absence, never invisible).
- [ ] Apply rig x projection factor per direction; flip sign for w/sw/nw/n per table above.
- [ ] Test in-browser (localhost:8123): walk all 8 directions, verify facing + no seam blowouts.

### Task 5: Commit + close-out

- [ ] Probe reports green for all 8 directions; commit code + meta (NEVER stage `assets/`); update roadmap row / memory.
