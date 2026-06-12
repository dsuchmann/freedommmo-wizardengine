// sim/life/motion/behavior.js — verb → choreography program compiler (spec §6→§4).
// Authored library verbs load one-time programs; manipulation verbs build small
// canonical trees; attack/talk/trade/sleep return null (consuming systems absent).
import { loadProgram } from './program.js';
import { validateAction } from './vocabulary.js';

const NO_VARIANT = { time: [1, 1], amplitude: [1, 1] };

/** Canonical rig-space reach target for ground-level pick-ups: from the right
 *  shoulder (6,36) to (12,24) is √(36+144)=13.4 ≤ arm reach 15 — verified reachable. */
const PICK_TARGET = { x: 12, y: 24 };
/** Hand-to-mouth target. VERIFIED reachable WITHIN right-arm joint limits:
 *  prox 150° (≤170), elbow 120° (≤140) puts the hand tip-of-forearm at
 *  (3, 42.93) — beside the head ((0,38)→(0,48)). Targets nearer the centerline
 *  (e.g. (0,42)) are provably outside arm_u_r/arm_f_r limits — don't "fix" by
 *  widening limits. */
const MOUTH_TARGET = { x: 3, y: 42.93 };

export function compileAction(action) {
  if (validateAction(action).length) return null;
  switch (action.verb) {
    case 'attack': case 'talk': case 'trade': case 'sleep':
      return null;                                   // honest absence: no combat/dialogue/trade/rest systems
    case 'gesture': return loadProgram(action.name);
    case 'emote':   return loadProgram(action.name);
    case 'dance':   return loadProgram('dance_improvised');
    case 'sit':     return loadProgram('sit_down');
    case 'move_to': case 'run':
      return prog(action.verb, action.verb === 'run' ? 'run' : 'walk', {
        op: 'locomote', target: { x: action.x, y: action.y },
        gait: action.verb === 'run' ? 'run' : 'walk', duration: null });
    case 'follow':
      return prog('follow', 'follow',
        { op: 'locomote', target: { entity: action.target }, gait: 'walk', duration: null });
    case 'face': case 'look_at':
      return prog(action.verb, action.verb, { op: 'look_at', target: { entity: action.target } });
    case 'wait':
      return prog('wait', 'wait', { op: 'wait', ticks: action.ticks });
    case 'jump':
      return { id: 'jump', kind: 'jump', variant: { time: [0.95, 1.1], amplitude: [1, 1] },
        root: { op: 'sequence', children: [
          { op: 'balance', on: false },
          { op: 'pose', joints: { thigh_l: -50, thigh_r: -50, shin_l: 70, shin_r: 70, spine: -15 }, ticks: 3 },
          { op: 'pose', joints: { thigh_l: 0, thigh_r: 0, shin_l: 0, shin_r: 0, spine: 0 }, ticks: 3 },
        ] } };
    case 'drop':
      return prog('drop', 'drop', { op: 'sequence', children: [
        { op: 'ik_reach', effector: 'hand_r', target: PICK_TARGET, ticks: 4 },
        { op: 'detach', effector: 'hand_r' },
        { op: 'pose', joints: { arm_u_r: 0, arm_f_r: 0 }, ticks: 4 },
      ] });
    case 'investigate':
      return prog('investigate', 'investigate', { op: 'sequence', children: [
        { op: 'locomote', target: { x: action.x, y: action.y }, gait: 'walk', duration: null },
        { op: 'look_at', target: { entity: action.target } },
        { op: 'wait', ticks: 6 },
      ] });
    case 'pick_up':
      return prog('pick_up', 'pick_up', { op: 'sequence', children: [
        { op: 'locomote', target: { x: action.x, y: action.y }, gait: 'walk', duration: null },
        { op: 'pose', joints: { spine: -20 }, ticks: 4 },
        { op: 'ik_reach', effector: 'hand_r', target: PICK_TARGET, ticks: 4 },
        { op: 'attach', entity: action.target, effector: 'hand_r' },
        { op: 'pose', joints: { spine: 0, arm_u_r: 0, arm_f_r: 0 }, ticks: 4 },
      ] });
    case 'use':
      if (action.mode !== 'eat') return null;        // only consumption exists today
      // ticks 6 both ways: IK lands prox≈150° — 150/6 = 25°/tick ≤ 30 continuity
      // limit; 4 or 5 ticks would violate it (37.5 / 30.0 borderline).
      return prog('use_eat', 'use', { op: 'sequence', children: [
        { op: 'ik_reach', effector: 'hand_r', target: MOUTH_TARGET, ticks: 6 },
        { op: 'emit', event: 'consume' },
        { op: 'pose', joints: { arm_u_r: 0, arm_f_r: 0 }, ticks: 6 },
      ] });
    default: return null;
  }
}

function prog(id, kind, root) {
  return { id, kind, variant: NO_VARIANT, root };
}
