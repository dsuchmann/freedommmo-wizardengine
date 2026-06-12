// src/life/pose.js — Pass 4 L3: pose math over L2a rigs (motion-DSL spec §5).
// Pure geometry: FK solve, center of mass, support polygon, analytic 2-bone IK.
// No kernel imports — consumed by the validator, executor, and (later) renderer.

export const REST_UP = ['spine', 'head'];          // bones whose rest direction is +y
export const MAX_DEG_PER_TICK = 30;                // continuity limit (validator ground truth)

const DEG = Math.PI / 180;
const rot = (a, x, y) => {                          // CCW rotation by a degrees
  const c = Math.cos(a * DEG), s = Math.sin(a * DEG);
  return { x: c * x - s * y, y: s * x + c * y };
};

/** Forward kinematics. joints = {boneName: degrees} (missing → 0).
 *  Returns {bone: {origin:{x,y}, tip:{x,y}, worldDeg}} for every bone. */
export function solvePose(rig, joints) {
  const out = {};
  const solve = (name) => {
    if (out[name]) return out[name];
    const bone = rig.bones[name];
    let origin, parentDeg = 0;
    if (bone.parent === null) {
      origin = { x: bone.pivot[0], y: bone.pivot[1] };
    } else {
      const p = solve(bone.parent);
      parentDeg = p.worldDeg;
      const off = rot(parentDeg, bone.pivot[0], bone.pivot[1]);
      origin = { x: p.origin.x + off.x, y: p.origin.y + off.y };
    }
    const worldDeg = parentDeg + (joints[name] ?? 0);
    const restY = REST_UP.includes(name) ? 1 : -1;
    const dir = rot(worldDeg, 0, restY);
    const tip = { x: origin.x + dir.x * bone.length, y: origin.y + dir.y * bone.length };
    return (out[name] = { origin, tip, worldDeg });
  };
  for (const name of Object.keys(rig.bones)) solve(name);
  return out;
}

/** Mass-weighted COM of a SOLVED pose (segment midpoints). */
export function comAt(rig, solved) {
  let mx = 0, my = 0, m = 0;
  for (const [name, bone] of Object.entries(rig.bones)) {
    if (bone.mass === 0) continue;
    const s = solved[name];
    mx += ((s.origin.x + s.tip.x) / 2) * bone.mass;
    my += ((s.origin.y + s.tip.y) / 2) * bone.mass;
    m += bone.mass;
  }
  return { x: mx / m, y: my / m, mass: m };
}

export const SUPPORT_MARGIN = 1.5;

/** Support polygon (2D side-view: an x-interval) from foot tips, widened by margin. */
export function supportOf(rig, solved) {
  const xs = ['foot_l', 'foot_r'].map(f => solved[f].tip.x);
  return { minX: Math.min(...xs) - SUPPORT_MARGIN, maxX: Math.max(...xs) + SUPPORT_MARGIN };
}

/** 2-bone IK chains per effector (proximal, distal). Hand/foot bones ride as end caps. */
export const IK_CHAINS = {
  hand_l: ['arm_u_l', 'arm_f_l'],
  hand_r: ['arm_u_r', 'arm_f_r'],
  foot_l: ['thigh_l', 'shin_l'],
  foot_r: ['thigh_r', 'shin_r'],
};

/** Analytic 2-bone IK in rig space. target = desired DISTAL BONE TIP position
 *  (the hand/foot cap keeps joint angle 0, so chain tip == distal tip when the
 *  cap pivot is colinear — pivots here are (0,-len) so this holds).
 *  Returns {proximalJoint: deg, distalJoint: deg} or null when out of reach
 *  or outside joint limits. Both elbow solutions are tried; first in-limits wins.
 *  NOTE for implementer: the round-trip test is ground truth — if it fails,
 *  flip the sign convention of alpha/elbow below rather than changing the test. */
export function ikReach2(rig, effector, target) {
  const chain = IK_CHAINS[effector];
  if (!chain) return null;
  const [prox, dist] = chain;
  const base = baseOrigin(rig, prox);                 // chain base in rig space (parents at rest)
  const l1 = rig.bones[prox].length, l2 = rig.bones[dist].length;
  const dx = target.x - base.x, dy = target.y - base.y;
  const d = Math.hypot(dx, dy);
  if (d > l1 + l2 || d < Math.abs(l1 - l2) || d < 1e-9) return null;
  // CCW rotation taking rest dir (0,-1) onto target dir: rot(θ)(0,-1) = (sinθ, -cosθ)
  // ⇒ sinθ = dx/d, cosθ = -dy/d ⇒ θ = atan2(dx, -dy).
  const phi = Math.atan2(dx, -dy) / DEG;
  const cosElbow = (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2);
  const elbow = 180 - Math.acos(Math.min(1, Math.max(-1, cosElbow))) / DEG;  // interior → joint deg
  const cosAlpha = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const alpha = Math.acos(Math.min(1, Math.max(-1, cosAlpha))) / DEG;
  // Both elbow solutions × ±360 normalizations (joint limits live on the raw
  // degree line, e.g. −210 ≡ +150 must be tried as +150). Numeric FK verify
  // rejects any wrong-sign candidate, so only true solutions are returned.
  for (const sign of [1, -1]) {
    const p = phi + sign * alpha, e = -sign * elbow;
    for (const dp of [0, 360, -360]) {
      for (const de of [0, 360, -360]) {
        const angles = { [prox]: p + dp, [dist]: e + de };
        if (!withinLimits(rig, angles)) continue;
        const tip = solvePose(rig, angles)[dist].tip;
        if (Math.hypot(tip.x - target.x, tip.y - target.y) < 1e-6) return angles;
      }
    }
  }
  return null;
}

function baseOrigin(rig, boneName) {
  let x = 0, y = 0;
  for (let cur = boneName; cur !== null; cur = rig.bones[cur].parent) {
    x += rig.bones[cur].pivot[0]; y += rig.bones[cur].pivot[1];
  }
  return { x, y };
}

function withinLimits(rig, angles) {
  for (const [j, a] of Object.entries(angles)) {
    const lim = rig.joints[j];
    if (!lim || a < lim.min - 1e-9 || a > lim.max + 1e-9) return false;
  }
  return true;
}
