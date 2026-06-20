// src/life/rig.js — Pass 4 L2a: the rig model (motion-DSL spec §2, the design
// authority). A rig is DATA attached to a species archetype: bones, joint
// limits (the L3 validator's ground truth), COM from bone masses, reach
// envelopes, look-at chain, gait PARAMETERS. Gait generators (code) and pose
// solving are L3 — honest absence: nothing here moves anything.
// Loaded from src/life/rigs/<id>.json, validated at load.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIG_DIR = join(dirname(fileURLToPath(import.meta.url)), 'rigs');

/** X2 spec §2 minimum humanoid bone set (root, spine, head, arms, legs). */
export const HUMANOID_BONES = [
  'root', 'spine', 'head',
  'arm_u_l', 'arm_f_l', 'hand_l', 'arm_u_r', 'arm_f_r', 'hand_r',
  'thigh_l', 'shin_l', 'foot_l', 'thigh_r', 'shin_r', 'foot_r',
];

export function loadRig(id) {
  const rig = JSON.parse(readFileSync(join(RIG_DIR, `${id}.json`), 'utf8'));
  const violations = validateRig(rig);
  if (violations.length) throw new Error(`rig ${id} invalid: ${violations.join('; ')}`);
  return rig;
}

/** Returns [] when valid, else human-readable violation strings (never throws). */
export function validateRig(rig) {
  const v = [];
  if (!rig.id) v.push('missing id');
  const bones = rig.bones ?? {};
  const roots = Object.entries(bones).filter(([, b]) => b.parent === null);
  if (roots.length !== 1) v.push(`expected exactly 1 root bone, got ${roots.length}`);
  for (const [name, b] of Object.entries(bones)) {
    if (b.parent !== null && !bones[b.parent]) v.push(`bone ${name}: unknown parent ${b.parent}`);
    if (!(b.length >= 0)) v.push(`bone ${name}: bad length`);
    if (!(b.mass >= 0)) v.push(`bone ${name}: bad mass`);
    // cycle check
    let p = b.parent, hops = 0;
    while (p != null && bones[p]) { p = bones[p].parent; if (++hops > 50) { v.push(`bone ${name}: cycle`); break; } }
  }
  for (const [name, j] of Object.entries(rig.joints ?? {})) {
    if (!bones[name]) v.push(`joint ${name}: no such bone`);
    if (!(j.min < j.max)) v.push(`joint ${name}: min >= max`);
    if (!(j.stiffness > 0 && j.stiffness <= 1)) v.push(`joint ${name}: stiffness out of (0,1]`);
    if (j.twist && !(j.twist.min <= j.twist.max)) v.push(`joint ${name}: twist min > max`);
  }
  for (const name of Object.keys(bones)) {
    if (name !== 'root' && !(rig.joints ?? {})[name]) v.push(`bone ${name}: missing joint limits`);
  }
  for (const [eff, e] of Object.entries(rig.effectors ?? {})) {
    if (!bones[e.bone]) v.push(`effector ${eff}: unknown bone ${e.bone}`);
    if (!(e.reach > 0)) v.push(`effector ${eff}: reach must be positive`);
  }
  const lw = (rig.lookAt ?? []).reduce((s, [b, w]) => {
    if (!bones[b]) v.push(`lookAt: unknown bone ${b}`);
    return s + w;
  }, 0);
  if (rig.lookAt && Math.abs(lw - 1) > 1e-9) v.push(`lookAt weights sum ${lw}, expected 1`);
  for (const [g, p] of Object.entries(rig.gaits ?? {})) {
    if (!(p.cycleTicks > 0)) v.push(`gait ${g}: cycleTicks must be positive`);
  }
  for (const [s, sk] of Object.entries(rig.sockets ?? {})) {
    if (!bones[sk.bone]) v.push(`socket ${s}: unknown bone ${sk.bone}`);
    if (!Array.isArray(sk.offset) || sk.offset.length < 2) v.push(`socket ${s}: bad offset`);
  }
  if (rig.proportions && !Array.isArray(rig.proportions.axes)) v.push('proportions.axes must be an array');
  return v;
}

/** World-space rest position of a bone's origin (chain of pivots from root). */
export function restPos(rig, boneName) {
  let x = 0, y = 0, b = rig.bones[boneName];
  for (let cur = boneName; cur !== null; cur = rig.bones[cur].parent) {
    x += rig.bones[cur].pivot[0]; y += rig.bones[cur].pivot[1];
  }
  return { x, y, _len: b.length };
}

/** Static rest-pose center of mass from bone masses (motion-DSL §2). */
export function comOf(rig) {
  let mx = 0, my = 0, m = 0;
  for (const name of Object.keys(rig.bones)) {
    const bone = rig.bones[name];
    if (bone.mass === 0) continue;
    const p = restPos(rig, name);
    // bone mass acts at its segment midpoint (vertical segments point down except spine/head)
    const mid = bone.length / 2;
    const cy = ['spine', 'head'].includes(name) ? p.y + mid : p.y - mid;
    mx += p.x * bone.mass; my += cy * bone.mass; m += bone.mass;
  }
  return { x: mx / m, y: my / m, mass: m };
}
