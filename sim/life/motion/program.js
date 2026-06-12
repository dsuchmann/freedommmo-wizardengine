// sim/life/motion/program.js — choreography program format (motion-DSL spec §4).
// Programs are AUTHORED ONCE into src/life/choreography/ and replayed with
// deterministic variant noise (feedback_motion_one_time_authoring.md). Nothing
// here generates programs at runtime.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rand } from '../../kernel/rng.js';

const CHOREO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'life', 'choreography');

export const VARIANT_TIME_SALT = 4500;
export const VARIANT_AMPLITUDE_SALT = 4501;
export const GAIT_PHASE_SALT = 4510;

/** Spec §4 primitive ops → required arg names (structural contract only). */
export const PRIMITIVES = {
  pose:     ['joints', 'ticks'],
  ik_reach: ['effector', 'target'],
  look_at:  ['target'],
  locomote: ['target', 'gait', 'duration'],   // duration added vs spec sketch — record as deviation
  balance:  ['on'],
  attach:   ['entity', 'effector'],
  detach:   ['effector'],
  sequence: ['children'],
  parallel: ['children'],
  wait:     ['ticks'],
  emit:     ['event'],
};

/** Structural validation. Returns [] when valid, else violation strings with node paths. */
export function validateProgram(program) {
  const v = [];
  if (!program?.id) v.push('missing id');
  if (!program?.kind) v.push('missing kind');
  const vt = program?.variant;
  if (vt) {
    for (const k of ['time', 'amplitude']) {
      const r = vt[k];
      if (!Array.isArray(r) || r.length !== 2 || !(r[0] <= r[1]) || !(r[0] > 0)) v.push(`variant.${k}: bad range`);
    }
  }
  if (!program?.root) { v.push('missing root'); return v; }
  walk(program.root, 'root');
  return v;

  function walk(node, path) {
    const req = PRIMITIVES[node?.op];
    if (!req) { v.push(`${path}: unknown op ${node?.op}`); return; }
    for (const arg of req) {
      if (node[arg] === undefined) v.push(`${path}: ${node.op} missing ${arg}`);
    }
    if (node.op === 'pose') {
      if (node.joints && typeof node.joints !== 'object') v.push(`${path}: joints must be object`);
      if (node.ticks !== undefined && !(node.ticks > 0)) v.push(`${path}: ticks must be > 0`);
    }
    if (node.op === 'wait' && node.ticks !== undefined && !(node.ticks > 0)) v.push(`${path}: ticks must be > 0`);
    if ((node.op === 'sequence' || node.op === 'parallel')) {
      if (!Array.isArray(node.children) || node.children.length === 0) v.push(`${path}: children must be non-empty array`);
      else node.children.forEach((c, i) => walk(c, `${path}.children[${i}]`));
    }
  }
}

/** Deterministic JSON: keys sorted at every level (arrays keep order). */
export function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** FNV-1a 32-bit over the stable serialization. */
export function hashProgram(program) {
  const s = stableStringify(program);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic per-(entity, program) replay noise within the program's authored bounds. */
export function variantOf(seed, entityId, program) {
  const h = hashProgram(program);
  const vt = program.variant ?? { time: [1, 1], amplitude: [1, 1] };
  const lerp = (r, t) => r[0] + (r[1] - r[0]) * t;
  return {
    timeScale: lerp(vt.time, rand(seed, entityId, VARIANT_TIME_SALT, h)),
    amplitudeScale: lerp(vt.amplitude, rand(seed, entityId, VARIANT_AMPLITUDE_SALT, h)),
  };
}

/** Load an authored program from the one-time library; throws on invalid. */
export function loadProgram(id) {
  const p = JSON.parse(readFileSync(join(CHOREO_DIR, `${id}.json`), 'utf8'));
  const violations = validateProgram(p);
  if (violations.length) throw new Error(`program ${id} invalid: ${violations.join('; ')}`);
  return p;
}
