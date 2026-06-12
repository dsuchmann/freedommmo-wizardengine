// sim/life/body.js — Pass 4 L2a: body plans. PURE DERIVATION (M1/L1 precedent):
// per-entity proportions are f(worldSeed, nodeId, race, stage, attributes) —
// nothing stored, zero save/load surface, bit-deterministic.
// PRIVACY NOTE: girth derives from attributes (sim-private). The body plan as a
// WHOLE is observable (you can see a body) — when L2b ships, the wire carries
// the derived plan (or the client derives from name-visible facts), never the
// underlying attribute numbers. Until then nothing here crosses the wire.
// HONEST ABSENCES: no sprites/rendering (L2b, pilot-gated), no motion (L3),
// no hair/face/genital layers (L2b art, demand-driven), body variation does
// not yet feed metabolism.
import { rand } from '../kernel/rng.js';
import { stageAt } from '../time/metabolism.js';
import { RACES, attributesOf } from './identity.js';

/** The 14 manifest sprite parts (pixellab-asset-manifest §3 enumeration). */
export const PARTS = [
  'head', 'torso',
  'arm_upper_l', 'arm_upper_r', 'arm_fore_l', 'arm_fore_r', 'hand_l', 'hand_r',
  'thigh_l', 'thigh_r', 'shin_l', 'shin_r', 'foot_l', 'foot_r',
];

/** part → rig bone (src/life/rigs/humanoid.json vocabulary). torso rides spine. */
export const PART_BONE = {
  head: 'head', torso: 'spine',
  arm_upper_l: 'arm_u_l', arm_upper_r: 'arm_u_r',
  arm_fore_l: 'arm_f_l', arm_fore_r: 'arm_f_r',
  hand_l: 'hand_l', hand_r: 'hand_r',
  thigh_l: 'thigh_l', thigh_r: 'thigh_r',
  shin_l: 'shin_l', shin_r: 'shin_r',
  foot_l: 'foot_l', foot_r: 'foot_r',
};

export const BODY_TYPES = ['slim', 'average', 'heavy'];
export const AGE_BANDS = ['child', 'adult', 'elder'];   // manifest skin bands

const BODY_TYPE_SALT = 4400;   // identity owns 4100/4200/4300; lifecycle 101/102/200/303

/** Stage → manifest age band (skin band, not a new stage system). */
export function ageBandOf(stage) {
  if (['infant', 'toddler', 'child'].includes(stage)) return 'child';
  if (['senior', 'elderly'].includes(stage)) return 'elder';
  return 'adult';
}

const RACE_HEIGHT = { human: 1.0, elf: 1.05, dwarf: 0.78, orc: 1.12 };
const STAGE_HEIGHT = {
  infant: 0.35, toddler: 0.45, child: 0.6, adolescent: 0.85,
  young_adult: 1.0, adult: 1.0, middle_aged: 1.0, senior: 0.97, elderly: 0.94,
};

/**
 * Derived body plan for a humanoid node, or null (flora/fauna have no body
 * plan until L4 generalizes rigs). { race, stage, ageBand, bodyType,
 * scale: {height, girth}, parts: { <part>: {scale} } }
 */
export function bodyPlanOf(kernel, node) {
  const race = node.attrs?.species;
  if (!RACES.includes(race)) return null;
  const stage = stageAt(race, kernel.tick - node.attrs.birthTick)[0];
  const a = attributesOf(kernel.seed, node.id, race);
  const bodyType = BODY_TYPES[Math.floor(rand(kernel.seed, node.id, BODY_TYPE_SALT) * BODY_TYPES.length)];
  const height = RACE_HEIGHT[race] * STAGE_HEIGHT[stage];
  // girth: bounded blend of strength+constitution, [0.9, 1.3]
  const girth = 0.9 + 0.4 * (a.strength + a.constitution) / 2;
  const limb = bodyType === 'heavy' ? 1.1 : bodyType === 'slim' ? 0.92 : 1.0;
  const parts = {};
  for (const p of PARTS) {
    const isLimb = p !== 'head' && p !== 'torso';
    parts[p] = { scale: +(height * (isLimb ? limb : 1)).toFixed(4) };
  }
  return { race, stage, ageBand: ageBandOf(stage), bodyType, scale: { height, girth }, parts };
}

/** Asset address the L2b wave satisfies: race/bodyType/ageBand/part/direction. */
export function partKey(race, bodyType, ageBand, part, direction) {
  return `${race}/${bodyType}/${ageBand}/${part}/${direction}`;
}
