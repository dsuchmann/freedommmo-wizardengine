// sim/life/motion/validator.js — choreography validator (motion-DSL spec §5).
// Walks a program tree with simulated joint state; first violation wins.
// Verdicts: OK | OUT_OF_REACH | UNBALANCED | LIMIT_VIOLATION | WORLD_REJECTED.
import { solvePose, comAt, supportOf, ikReach2, MAX_DEG_PER_TICK } from '../../../src/life/pose.js';

const BALANCE_EXEMPT_KINDS = ['jump', 'sit', 'sleep'];

/** worldCtx (optional): { takeable(entityId)→bool, inRange(entityId)→bool }.
 *  Returns { verdict, path } — path null when OK. */
export function validateChoreography(rig, program, worldCtx = null) {
  const ampHi = program.variant?.amplitude?.[1] ?? 1;
  const state = {};                                   // current joint degrees
  let balanceOn = !BALANCE_EXEMPT_KINDS.includes(program.kind);
  let fail = null;

  walk(program.root, 'root');
  return fail ?? { verdict: 'OK', path: null };

  function bail(verdict, path) { if (!fail) fail = { verdict, path }; }

  function applyJoints(targets, ticks, path) {
    for (const [j, raw] of Object.entries(targets)) {
      const a = raw * ampHi;                           // worst-case variant amplitude
      const lim = rig.joints[j];
      if (!lim) return bail('LIMIT_VIOLATION', path);
      if (a < lim.min - 1e-9 || a > lim.max + 1e-9) return bail('LIMIT_VIOLATION', path);
      const rate = Math.abs(a - (state[j] ?? 0)) / Math.max(1, ticks ?? 1);
      if (rate > MAX_DEG_PER_TICK + 1e-9) return bail('LIMIT_VIOLATION', path);
      state[j] = a;
    }
    if (balanceOn) {
      const solved = solvePose(rig, state);
      const com = comAt(rig, solved), sup = supportOf(rig, solved);
      if (com.x < sup.minX || com.x > sup.maxX) return bail('UNBALANCED', path);
    }
  }

  function walk(node, path) {
    if (fail) return;
    switch (node.op) {
      case 'pose':
        applyJoints(node.joints, node.ticks, path);
        break;
      case 'ik_reach': {
        const angles = ikReach2(rig, node.effector, node.target);
        if (!angles) return bail('OUT_OF_REACH', path);
        applyJoints(angles, node.ticks ?? 4, path);   // IK transitions get a default glide
        break;
      }
      case 'balance':
        balanceOn = !!node.on;
        break;
      case 'attach':
        if (!worldCtx) return bail('WORLD_REJECTED', path);
        if (!worldCtx.takeable(node.entity)) return bail('WORLD_REJECTED', path);
        if (!worldCtx.inRange(node.entity)) return bail('WORLD_REJECTED', path);
        break;
      case 'sequence':
        for (let i = 0; i < node.children.length; i++) walk(node.children[i], `${path}.children[${i}]`);
        break;
      case 'parallel': {
        // children share the entry state; merged exit state (later child wins per joint)
        const entry = { ...state };
        const exits = [];
        for (let i = 0; i < node.children.length; i++) {
          Object.keys(state).forEach(k => delete state[k]);
          Object.assign(state, entry);
          walk(node.children[i], `${path}.children[${i}]`);
          exits.push({ ...state });
        }
        Object.keys(state).forEach(k => delete state[k]);
        Object.assign(state, entry, ...exits);
        break;
      }
      case 'look_at': case 'locomote': case 'wait': case 'detach': case 'emit':
        break;                                        // structurally checked by validateProgram
      default:
        bail('LIMIT_VIOLATION', path);                // unknown op should never reach here
    }
  }
}
