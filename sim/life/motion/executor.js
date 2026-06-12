// sim/life/motion/executor.js — spec §3 Animation Controller (pure track) +
// the kernel adapter. World truth moves ONLY through existing real verbs
// (sim/world/actions.js); frames are presentation and never enter the ledger.
import { rand } from '../../kernel/rng.js';
import { variantOf, GAIT_PHASE_SALT } from './program.js';
import { ikReach2 } from '../../../src/life/pose.js';
import { compileAction } from './behavior.js';
import { validateChoreography } from './validator.js';
import { loadRig } from '../../../src/life/rig.js';
import { move, harvest, eat } from '../../world/actions.js';

/** PURE: program → {frames:[{tick,joints}], intents:[{tick,kind,...}], events:[{tick,event}]}.
 *  Deterministic in (rig, program, seed, entityId, startTick). */
export function solveProgramTrack(rig, program, { seed, entityId, startTick }) {
  const { timeScale, amplitudeScale } = variantOf(seed, entityId, program);
  const phase = rand(seed, entityId, GAIT_PHASE_SALT, startTick);
  const frames = [], intents = [], events = [];
  const state = {};
  let t = startTick;

  walk(program.root);
  return { frames, intents, events, phase, timeScale, amplitudeScale };

  function scaledTicks(ticks) { return Math.max(1, Math.round((ticks ?? 1) * timeScale)); }

  function glideTo(targets, ticks) {
    const n = scaledTicks(ticks);
    const from = { ...state };
    for (let i = 1; i <= n; i++) {
      const f = i / n, joints = {};
      for (const j of new Set([...Object.keys(from), ...Object.keys(targets)])) {
        const a = from[j] ?? 0;
        const b = (targets[j] !== undefined ? targets[j] * amplitudeScale : a);
        joints[j] = a + (b - a) * f;
        state[j] = joints[j];
      }
      frames.push({ tick: t + i, joints });
    }
    t += n;
  }

  function walk(node) {
    switch (node.op) {
      case 'pose': glideTo(node.joints, node.ticks); break;
      case 'ik_reach': {
        const angles = ikReach2(rig, node.effector, node.target);
        if (angles) glideTo(scaleInvert(angles), node.ticks ?? 4);   // see note below
        break;
      }
      case 'wait': {
        const n = scaledTicks(node.ticks);
        for (let i = 1; i <= n; i++) frames.push({ tick: t + i, joints: { ...state } });
        t += n;
        break;
      }
      case 'locomote': {
        const gait = rig.gaits[node.gait] ?? rig.gaits.walk;
        intents.push({ tick: t, kind: 'locomote', target: node.target, gait: node.gait });
        // gait bob frames: one cycle as presentation placeholder-free motion —
        // real per-step frames are produced when the adapter knows the route length
        const cyc = Math.max(2, Math.round(gait.cycleTicks * timeScale));
        for (let i = 1; i <= cyc; i++) {
          const ph = (phase + i / cyc) * 2 * Math.PI;
          const swing = Math.sin(ph) * 25 * gait.strideFactor * amplitudeScale;
          const joints = { ...state, thigh_l: -swing, thigh_r: swing,
            arm_u_l: swing * 0.6, arm_u_r: -swing * 0.6 };
          Object.assign(state, joints);
          frames.push({ tick: t + i, joints });
        }
        t += cyc;
        break;
      }
      case 'balance': break;                          // validator concern; no frames
      case 'look_at':
        intents.push({ tick: t, kind: 'look_at', target: node.target });
        break;
      case 'attach':
        intents.push({ tick: t, kind: 'attach', entity: node.entity, effector: node.effector });
        break;
      case 'detach':
        intents.push({ tick: t, kind: 'detach', effector: node.effector });
        break;
      case 'emit':
        events.push({ tick: t, event: node.event });
        break;
      case 'sequence': for (const c of node.children) walk(c); break;
      case 'parallel': {
        const t0 = t; let tMax = t;
        for (const c of node.children) { t = t0; walk(c); tMax = Math.max(tMax, t); }
        t = tMax;
        break;
      }
    }
  }

  // IK angles are exact geometry — variant amplitude must NOT scale them
  // (a scaled reach misses the target). glideTo multiplies by amplitudeScale,
  // so pre-divide to cancel.
  function scaleInvert(angles) {
    const out = {};
    for (const [j, a] of Object.entries(angles)) out[j] = a / amplitudeScale;
    return out;
  }
}

/** Adapter: run an action against a REAL kernel via existing verbs only.
 *  `lastItem` threading resolves the '$last' placeholder (vocabulary note).
 *  Returns { ok, verdict, items, tick, track } — tick = tick after completion. */
export function performAction(kernel, entityId, action, tick, lastItem = null) {
  const rig = loadRig('humanoid');
  const resolved = action.item === '$last' ? { ...action, item: lastItem?.id } : action;
  const program = compileAction(resolved);
  if (!program) return { ok: false, verdict: 'NO_PROGRAM', items: [], tick, track: null };
  const actor = kernel.graph.nodes.get(entityId);
  const worldCtx = {
    takeable: id => kernel.graph.nodes.get(id) != null,
    inRange: id => {
      const n = kernel.graph.nodes.get(id);
      return n && Math.max(Math.abs(n.x - actor.x), Math.abs(n.y - actor.y)) <= 1;
    },
  };
  // World-consequence application FIRST (movement may bring targets into range),
  // then validation against the post-locomotion world, per spec §5 world checks.
  const items = [];
  let t = tick;
  const track = solveProgramTrack(rig, program, { seed: kernel.seed, entityId, startTick: tick });
  for (const intent of track.intents) {
    if (intent.kind === 'locomote' && intent.target.x != null) {
      // greedy one-tile steps via the real move() verb until adjacent or blocked
      let guard = 1000;
      while (guard-- > 0) {
        const dx = Math.sign(intent.target.x - actor.x), dy = Math.sign(intent.target.y - actor.y);
        if (Math.max(Math.abs(intent.target.x - actor.x), Math.abs(intent.target.y - actor.y)) <= 1) break;
        if (!move(kernel, entityId, dx, dy, t)) break;
        t += 1;
      }
    } else if (intent.kind === 'attach') {
      const verdict = validateChoreography(rig, program, worldCtx);
      if (verdict.verdict !== 'OK') return { ok: false, verdict: verdict.verdict, items, tick: t, track };
      const item = harvest(kernel, entityId, intent.entity, t);
      if (item) items.push(item);
      t += 1;
    }
  }
  for (const ev of track.events) {
    if (ev.event === 'consume') {
      const target = resolved.item ?? items[items.length - 1]?.id;
      if (target != null) { eat(kernel, entityId, target, t); t += 1; }
    }
  }
  return { ok: true, verdict: 'OK', items, tick: t, track };
}
