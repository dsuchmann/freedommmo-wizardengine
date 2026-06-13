# Motion Taxonomy — the combinatorial space of body movement (S4 Life)

Status: SPEC (2026-06-12). Companion to the L3 motion DSL (`sim/life/motion/`) and plan
`2026-06-12-motion-library-chat.md`. This document enumerates the movement space and the
composition algebra that reduces it to primitives, so the runtime LLM assembles instructions
instead of inventing joint curves.

## Layer model

```
L0 DSL primitives   pose / ik_reach / look_at / locomote / balance / attach / detach /
                    sequence / parallel / wait / emit                      (exists, L3)
L1 Motifs           named reusable fragments with {scale, ticks} params — raw joints live HERE
L2 Postures         validated single poses; every program declares from/to postures
L3 Choreographies   motif assemblies = the dictionary entries (solo or duet roles)
L4 Performance      count × speed × amplitude variants, idle layering, posture-graph chaining,
                    duet binding (actor/partner), reaction interrupts
```

The LLM contract (runtime generation): given the motif catalog + posture graph + a command,
emit `{from, to, steps:[{motif|pose, params}]}` — small, fast, validator-gated.

## Narrative phase structure (user directive 2026-06-12)

Every expressive animation has a mini narrative arc: **initiation → performance → (climax) → finish**.
A wave raises the arm, waves some open-ended number of beats, then lowers it.

Program schema: `phases: { enter?, loop, exit?, climax? }` — each phase a program sub-tree.
- `enter`/`exit` are the wind-up/wind-down (bounded, played once).
- `loop` is the repeatable core. Validation adds a **cycle-continuity check**: last tick → first
  tick of `loop` must satisfy the same ≤30°/tick rule, so it can repeat indefinitely.
- `climax` is an optional one-shot phase between loop and exit (tackle impact, orgasm, dance dip).
- A program without `phases` is treated as `loop` with identity enter/exit (backward compatible —
  the bootstrap library stays valid).

**Duration is decided ABOVE the motion layer.** The executor never knows how long `loop` runs:
- Solo + command: count ("five jumping jacks") or default beats.
- Solo + NPC: its mind decides (L6) — boredom, goal change, interruption.
- Duets: a **shared phase machine** — both roles' phase programs are keyed by the same phase id;
  transitions are events negotiated at the social layer (internal state: arousal, fatigue, fun;
  communication; consent). Dance has no fixed end; sex transitions to climax from entity internal
  state; tackle's impact is an event that crosses entities (attacker climax = victim reaction).
- Stop requests are graceful: finish the current loop cycle, then play `exit` — never snap to rest.
- Interrupts (hit mid-wave): preempt to `exit` or replace with a reaction program whose `enter`
  starts at the interrupted pose (validator-checked at runtime chain time).

Honest absence: until L6 minds exist, NPC/duet phase transitions come only from explicit commands,
timers, or player input — never from faked inner state.

## L2 Postures (14)

stand, stand_relaxed, sit_ground, sit_chair, kneel, crouch, squat_hold, lie_back, lie_belly,
lie_side, all_fours, handstand, headstand, hang

## Posture graph — transitions (edges, ~26)

sit_down/stand_up (×ground/chair), kneel_down/kneel_up, crouch_down/crouch_up,
lie_down_back/lie_down_belly/lie_down_side + get_up_(back|belly|side), to_all_fours/from_all_fours,
roll_over (back↔belly), kick_up_handstand/handstand_down, tuck_headstand/headstand_down,
jump_in_place, leap_forward, dive_forward, fall_forward, fall_backward, collapse (any→lie, limp),
trip_recover, vault. Runtime chains shortest path between current posture and a program's `from`.

## Gaits (parameter rows, not programs) (12)

saunter, walk, power_walk, jog, run, sprint, tiptoe, march, skip, moonwalk, crawl (all_fours), limp
— params: cadence, stride, bob, lean, armSwing. Extends `rig.gaits`.

## Idle layers (loop in `parallel` over any posture) (10)

breathe, breathe_heavy, weight_shift, look_around, fidget_hands, neck_stretch, shiver, pant,
drunk_sway, scratch_head

## L1 Motif catalog (~32 — raw joints allowed ONLY here)

arm_raise_(l|r|both), arm_lower, arm_swing, forearm_curl, hand_wave_beat, palm_show, fist,
point_arm, reach_toward (ik), pull_back, push_out, torso_bend_fwd, torso_lean_back,
torso_twist_(l|r), shoulder_shrug_beat, head_nod_beat, head_shake_beat, head_turn_(l|r),
head_tilt, look_up/down, hip_sway, leg_raise_(l|r), knee_bend_both, step_beat_(l|r), stomp,
kick_out_(l|r), squat_dip, jump_pulse, spin_quarter, clap_beat, balance_off/on

## L3 Choreography catalog by category (~190 dictionary ids)

**Communication / gesture (meaning → movement) (40):** greet_wave, wave_both, blow_kiss, beckon,
stop_palm, point_forward, point_down, yes_nod, no_shake, maybe_wobble, shrug, thumbs_up,
thumbs_down, bow, curtsy, salute, clap, slow_clap, cheer, facepalm, think_chin, laugh, cry,
threaten_fist, taunt, rude_gesture, quiet_finger, listen_ear, whisper_cup, plead, surrender,
flex, dust_off, wipe_brow, heart_hands, count_three, come_here_urgent, shoo_away, pray, nervous_glance

**Solo exercise / acrobatics / play (22):** jumping_jacks, pushup, situp, squat_reps, lunge, plank,
toe_touch, stretch_arms, yawn_stretch, cartwheel_prep, handspring_prep, spin_around, hop_(l|r),
march_in_place, shadowbox_punch, shadowbox_kick, kata_flow, juggle_mime, skip_rope_mime,
hopscotch, dance_improvised, dance_steps

**Work / object motions (26):** dig, chop_motion, hammer, saw, sweep, scrub, fish_cast, sow_seeds,
harvest_pull, carry_heavy, lift_ground, set_down, push_object, pull_object, throw, catch, drink,
eat_bite, stir_pot, knead, pour, milk, churn, write_mime, paint_mime, light_fire

**Reactions (15):** flinch, hit_react_head, hit_react_torso, stagger, knockback, knockdown, trip,
startle, faint, wake_up, sneeze, cough, shiver_cold, celebrate_fist, dodge_lean

**Duets — roles {actor, partner}, attach-synchronized (30):** handshake, high_five, fist_bump,
hug, hug_long, kiss_cheek, kiss_lips, kiss_deep, hold_hands, dance_partner_close,
dance_partner_swing, help_up, carry_bridal, carry_piggyback, pat_back, pat_head, arm_wrestle,
shove, grapple, punch_at, kick_at, tackle, block, parry, comfort_embrace, whisper_to,
sex_embrace, sex_missionary, sex_from_behind, oral_give — duet programs are posture-gated for
BOTH roles (e.g. sex_missionary requires partner lie_back) and consent-gated at the social layer
(L6 minds decide; the motion layer only executes). Solo intimate: masturbate (posture-gated,
solo category).

**Postures + transitions + idles + gaits** (above) are also dictionary entries (~62).

## Honest absences

- Ragdoll/physical falling is PHYSICS, not choreography — authored fall_* programs approximate
  until a physics pass; no faked "dynamic" reactions.
- Finger articulation: hands are single bones — hand-state swaps (L2b layer system), not joints.
- Facial expression: no face bones; expression = head motion + (future) face layer swaps.
- Quadruped motion: separate rigs (fauna art lane), same DSL.
- Duets need a second rendered humanoid — NPCs render at L5; until then duets validate headless
  and bind to player+NPC later.

## Validation invariants (unchanged)

Every L1–L3 entry passes `validateChoreography`: joint min/max, ≤30°/tick continuity, balance
checks (programs leaving standing support carry `balance off/on`). Variants never touch world
state; programs are presentation-only — world truth flows ONLY through real actions (L3 rule).
