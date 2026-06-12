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
import { SLOTS } from '../items/equipment.js';

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

// ——— layer composition (consumed by the L2b renderer; pure data here) ———

/** equipment slot → the body part it anchors to (draws relative to). */
export const SLOT_ANCHOR = {
  head: 'head', face: 'head', ears: 'head', eyes: 'head',
  neck: 'torso', shoulders: 'torso', back: 'torso', chest: 'torso',
  torso_under: 'torso', waist: 'torso', tattoo: 'torso', implant: 'torso',
  arms: 'arm_upper_r', wrist_left: 'arm_fore_l', wrist_right: 'arm_fore_r',
  hands: 'hand_r',
  finger_left_1: 'hand_l', finger_left_2: 'hand_l',
  finger_right_1: 'hand_r', finger_right_2: 'hand_r',
  legs: 'thigh_r', legs_under: 'thigh_r',
  ankle_left: 'shin_l', ankle_right: 'shin_r', feet: 'foot_r',
  hand_main: 'hand_r', hand_off: 'hand_l',
};

/** Base z per part per facing direction. Gaps of 100 leave room for worn layers. */
const PART_Z = (() => {
  // painter orders, far → near, per facing; each array = exactly the 14 PARTS once
  const south = ['arm_upper_l', 'arm_fore_l', 'hand_l', 'thigh_l', 'shin_l', 'foot_l',
    'thigh_r', 'shin_r', 'foot_r', 'torso', 'arm_upper_r', 'arm_fore_r', 'hand_r', 'head'];
  const northOrder = ['arm_upper_r', 'arm_fore_r', 'hand_r', 'arm_upper_l', 'arm_fore_l', 'hand_l',
    'head', 'torso', 'thigh_l', 'shin_l', 'foot_l', 'thigh_r', 'shin_r', 'foot_r'];
  const eastOrder = ['arm_upper_l', 'arm_fore_l', 'hand_l', 'thigh_l', 'shin_l', 'foot_l',
    'torso', 'head', 'thigh_r', 'shin_r', 'foot_r', 'arm_upper_r', 'arm_fore_r', 'hand_r'];
  const westOrder = ['arm_upper_r', 'arm_fore_r', 'hand_r', 'thigh_r', 'shin_r', 'foot_r',
    'torso', 'head', 'thigh_l', 'shin_l', 'foot_l', 'arm_upper_l', 'arm_fore_l', 'hand_l'];
  const table = {};
  for (const [dir, order] of [['s', south], ['n', northOrder], ['e', eastOrder], ['w', westOrder]]) {
    table[dir] = Object.fromEntries(order.map((p, i) => [p, (i + 1) * 100]));
  }
  return table;
})();

/**
 * Compose a body plan + worn equipment map (node.attrs.equipment shape:
 * { <slot>: item }) into an ordered draw list for one facing direction.
 * Returns [{ z, part?, slot?, item?, key?, scale }] sorted ascending by z.
 * Worn layers: z = anchor part z + SLOTS[slot].layer (layer ints are < 100,
 * so items always sit between their anchor and the next part).
 */
export function composeLayers(plan, equipment, direction) {
  const zTable = PART_Z[direction];
  const out = [];
  for (const p of PARTS) {
    out.push({
      z: zTable[p], part: p, scale: plan.parts[p].scale,
      key: partKey(plan.race, plan.bodyType, plan.ageBand, p, direction),
    });
  }
  for (const [slot, item] of Object.entries(equipment ?? {})) {
    if (!item || !(slot in SLOTS)) continue;
    const anchor = SLOT_ANCHOR[slot];
    out.push({
      z: zTable[anchor] + SLOTS[slot].layer, slot, item: item.id,
      archetype: item.attrs?.archetype ?? null, scale: plan.parts[anchor].scale,
    });
  }
  out.sort((a, b) => a.z - b.z);
  return out;
}
