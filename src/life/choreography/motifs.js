// src/life/choreography/motifs.js — Named motion fragments (sub-trees) that
// choreographies compose from. Each motif is a function returning a DSL
// sub-tree node, parameterized by {scale, ticks}.
// Motifs are the atomic vocabulary; choreographies should use motifs rather
// than raw joint values wherever possible.

/** Create a pose node with scaled amplitudes. */
const pose = (joints, ticks) => ({ op: 'pose', joints, ticks });
const seq = (...children) => ({ op: 'sequence', children });
const par = (...children) => ({ op: 'parallel', children });
const wait = (ticks) => ({ op: 'wait', ticks });

/** Scale joint values by amplitude factor. */
function scaled(joints, amp = 1) {
  const out = {};
  for (const [k, v] of Object.entries(joints)) out[k] = Math.round(v * amp);
  return out;
}

export const MOTIFS = {
  // ── Arms ──────────────────────────────────────────────────
  raise_right_arm:  (p = {}) => pose({ arm_u_r: 150 * (p.scale ?? 1) }, p.ticks ?? 5),
  lower_right_arm:  (p = {}) => pose({ arm_u_r: 0 }, p.ticks ?? 5),
  raise_left_arm:   (p = {}) => pose({ arm_u_l: -150 * (p.scale ?? 1) }, p.ticks ?? 5),
  lower_left_arm:   (p = {}) => pose({ arm_u_l: 0 }, p.ticks ?? 5),
  raise_both_arms:  (p = {}) => pose({ arm_u_l: -150 * (p.scale ?? 1), arm_u_r: 150 * (p.scale ?? 1) }, p.ticks ?? 5),
  lower_both_arms:  (p = {}) => pose({ arm_u_l: 0, arm_u_r: 0 }, p.ticks ?? 5),
  flex_biceps:      (p = {}) => pose(scaled({ arm_u_l: -140, arm_u_r: 140, arm_f_l: -120, arm_f_r: 120 }, p.scale ?? 1), p.ticks ?? 4),
  arms_forward:     (p = {}) => pose(scaled({ arm_u_l: -90, arm_u_r: 90 }, p.scale ?? 1), p.ticks ?? 4),

  // ── Hands ─────────────────────────────────────────────────
  wave_hand_r:      (p = {}) => seq(
    pose({ arm_u_r: 150, arm_f_r: 40 }, 3), pose({ arm_u_r: 150, arm_f_r: 10 }, 2),
    pose({ arm_u_r: 150, arm_f_r: 40 }, 2), pose({ arm_u_r: 150, arm_f_r: 10 }, 2)),
  clap_once:        (p = {}) => seq(
    pose({ arm_u_l: -40, arm_u_r: 40, arm_f_l: -90, arm_f_r: 90 }, p.ticks ?? 3),
    pose({ arm_u_l: -20, arm_u_r: 20, arm_f_l: -60, arm_f_r: 60 }, 2)),

  // ── Head ──────────────────────────────────────────────────
  nod_once:         (p = {}) => seq(pose({ head: -30 * (p.scale ?? 1) }, 3), pose({ head: 0 }, 3)),
  shake_once:       (p = {}) => seq(pose({ head: 30 }, 2), pose({ head: -30 }, 3), pose({ head: 0 }, 2)),
  look_left:        (p = {}) => pose({ head: -45 * (p.scale ?? 1) }, p.ticks ?? 4),
  look_right:       (p = {}) => pose({ head: 45 * (p.scale ?? 1) }, p.ticks ?? 4),
  head_center:      (p = {}) => pose({ head: 0 }, p.ticks ?? 3),

  // ── Spine ─────────────────────────────────────────────────
  bow_forward:      (p = {}) => pose({ spine: -25 * (p.scale ?? 1) }, p.ticks ?? 5),
  straighten:       (p = {}) => pose({ spine: 0 }, p.ticks ?? 4),
  lean_back:        (p = {}) => pose({ spine: 20 * (p.scale ?? 1) }, p.ticks ?? 4),

  // ── Legs ──────────────────────────────────────────────────
  squat_down:       (p = {}) => pose(scaled({ thigh_l: -80, thigh_r: -80, shin_l: 110, shin_r: 110, spine: -15 }, p.scale ?? 1), p.ticks ?? 6),
  stand_up:         (p = {}) => pose({ thigh_l: 0, thigh_r: 0, shin_l: 0, shin_r: 0, spine: 0 }, p.ticks ?? 6),
  lunge_left:       (p = {}) => pose(scaled({ thigh_l: -90, shin_l: 120, thigh_r: -20 }, p.scale ?? 1), p.ticks ?? 5),
  lunge_right:      (p = {}) => pose(scaled({ thigh_r: -90, shin_r: 120, thigh_l: -20 }, p.scale ?? 1), p.ticks ?? 5),
  knee_lift_l:      (p = {}) => pose({ thigh_l: -70, shin_l: 90 }, p.ticks ?? 3),
  knee_lift_r:      (p = {}) => pose({ thigh_r: -70, shin_r: 90 }, p.ticks ?? 3),

  // ── Full body ─────────────────────────────────────────────
  rest:             (p = {}) => pose({}, p.ticks ?? 5),
  shrug_up:         (p = {}) => pose({ arm_u_l: -30, arm_u_r: 30, arm_f_l: -40, arm_f_r: 40 }, p.ticks ?? 3),
  jump_crouch:      (p = {}) => pose({ thigh_l: -50, thigh_r: -50, shin_l: 70, shin_r: 70 }, p.ticks ?? 3),
  jump_extend:      (p = {}) => pose({ thigh_l: 10, thigh_r: 10, foot_l: -20, foot_r: -20 }, p.ticks ?? 2),
};

/** Get a motif sub-tree by name. Returns null if unknown. */
export function buildMotif(name, params = {}) {
  const fn = MOTIFS[name];
  return fn ? fn(params) : null;
}
