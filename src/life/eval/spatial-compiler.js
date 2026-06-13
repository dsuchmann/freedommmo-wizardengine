/**
 * Spatial Compiler — deterministic conversion of spatial instructions
 * (body part + primitive + amount) into joint angles + Z hints.
 * No LLM involved — pure math.
 *
 * DIRECTION-AWARE: extend/retract scale joint rotation by viewing angle.
 * Front views (south): forward = into screen → minimal rotation + Z hint.
 * Profile views (east/west): forward = across screen → full rotation.
 */

import { resolveBones, expandCompound, isCompound, BODY_GROUPS } from './spatial-groups.js';

// How much of the "forward/backward" axis maps to the rig's 2D X plane
// per facing direction. Profile = 1 (forward IS sideways), front = 0 (forward is depth).
export const DIR_DEPTH_FACTOR = {
  s: 0.15, n: 0.15,              // front/back: forward is almost entirely depth
  e: 1.0,  w: 1.0,               // profile: forward is fully in-plane
  se: 0.55, sw: 0.55,            // diagonal: partial
  ne: 0.55, nw: 0.55,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

/**
 * Classify a bone by its role in the chain: 'upper', 'middle', or 'end'.
 * Works for both arms and legs.
 */
function boneRole(boneName) {
  if (/^(arm_u_|thigh_)/.test(boneName)) return 'upper';
  if (/^(arm_f_|shin_)/.test(boneName))  return 'middle';
  if (/^(hand_|foot_)/.test(boneName))   return 'end';
  if (boneName === 'spine') return 'torso';
  if (boneName === 'head')  return 'head';
  return 'unknown';
}

/** Returns 'left', 'right', 'none' for a bone name. */
function boneSide(boneName) {
  if (/_l$/.test(boneName)) return 'left';
  if (/_r$/.test(boneName)) return 'right';
  return 'none';
}

/** Returns 'arm', 'leg', 'torso', 'head', or 'unknown' for a bone. */
function boneFamily(boneName) {
  if (/^arm_/.test(boneName) || /^hand_/.test(boneName)) return 'arm';
  if (/^thigh_|^shin_|^foot_/.test(boneName))           return 'leg';
  if (boneName === 'spine') return 'torso';
  if (boneName === 'head')  return 'head';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Per-bone angle computation
// ---------------------------------------------------------------------------

/**
 * Compute the angle delta for a single bone given an action + amount.
 * depthFactor: 0–1, how much extend/retract maps to the rig's 2D plane.
 *   1.0 = profile view (forward IS the rig plane), 0.15 = front view (forward is depth).
 * Returns the angle value, or null if this bone is unaffected by the action.
 */
function computeBoneAngle(boneName, action, amount, currentAngles, depthFactor = 1.0) {
  const role   = boneRole(boneName);
  const side   = boneSide(boneName);
  const family = boneFamily(boneName);

  // ---------- ARM ----------
  if (family === 'arm') {
    const isLeft = side === 'left';

    if (role === 'upper') {
      switch (action) {
        case 'raise':
          return lerp(0, isLeft ? -170 : 170, amount);
        case 'lower':
          return lerp(currentAngles[boneName] ?? 0, 0, amount);
        case 'extend':
          // Scale by depthFactor: profile=full rotation, front=minimal (forward is into screen)
          return lerp(0, (isLeft ? -90 : 90) * depthFactor, amount);
        case 'retract':
          return lerp(0, (isLeft ? 50 : -50) * depthFactor, amount);
        default:
          return null; // bend/straighten/turn_in/turn_out don't touch upper
      }
    }

    if (role === 'middle') {
      switch (action) {
        case 'extend':
          return 0;
        case 'retract':
          // max bend: arm_f_l min=-140, arm_f_r max=140
          return lerp(0, isLeft ? -140 : 140, amount);
        case 'bend':
          return lerp(0, isLeft ? -140 : 140, amount);
        case 'straighten':
          return 0;
        default:
          return null;
      }
    }

    if (role === 'end') {
      switch (action) {
        case 'turn_in':
          return lerp(0, isLeft ? 45 : -45, amount);
        case 'turn_out':
          return lerp(0, isLeft ? -45 : 45, amount);
        default:
          return null;
      }
    }
  }

  // ---------- LEG ----------
  if (family === 'leg') {
    if (role === 'upper') {
      switch (action) {
        case 'raise':
          return lerp(0, -110, amount);
        case 'lower':
          return lerp(currentAngles[boneName] ?? 0, 0, amount);
        case 'extend':
          return lerp(0, -90 * depthFactor, amount);
        case 'retract':
          return lerp(0, 30 * depthFactor, amount);
        default:
          return null;
      }
    }

    if (role === 'middle') {
      switch (action) {
        case 'extend':
          return 0;
        case 'retract':
          return lerp(0, 140, amount);
        case 'bend':
          return lerp(0, 140, amount);
        case 'straighten':
          return 0;
        default:
          return null;
      }
    }

    if (role === 'end') {
      switch (action) {
        case 'turn_in':
          return lerp(0, 30, amount);
        case 'turn_out':
          return lerp(0, -30, amount);
        default:
          return null;
      }
    }
  }

  // ---------- TORSO (spine) ----------
  if (family === 'torso') {
    switch (action) {
      case 'raise':
      case 'retract':
        return lerp(0, 30, amount);
      case 'lower':
      case 'extend':
      case 'bend':
        return lerp(0, -30, amount);
      default:
        return null;
    }
  }

  // ---------- HEAD ----------
  if (family === 'head') {
    switch (action) {
      case 'raise':
        return lerp(0, 60, amount);
      case 'lower':
        return lerp(0, -60, amount);
      case 'turn_in':
        return lerp(0, -60, amount);
      case 'turn_out':
        return lerp(0, 60, amount);
      default:
        return null;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compile a single spatial instruction into joint angles + zHints.
 *
 * instruction = { part, action, amount, ticks?, zHint? }
 * Returns { joints: {boneName: angle}, zHints: {groupName: "front"|"behind"} }
 *
 * @param {{ part: string, action: string, amount: number, ticks?: number, zHint?: string }} instruction
 * @param {object} rig  Parsed humanoid.json
 * @param {object} [currentAngles={}]  Current joint angles for 'lower' actions
 * @param {string} [direction='e']  Facing direction (s/n/e/w/se/sw/ne/nw). Affects extend/retract depth.
 * @returns {{ joints: Record<string, number>, zHints: Record<string, string> }}
 */
export function compileInstruction(instruction, rig, currentAngles = {}, direction = 'e') {
  const { part, action, amount, zHint } = instruction;
  const depthFactor = DIR_DEPTH_FACTOR[direction] ?? 1.0;

  const joints  = {};
  const zHints  = {};

  // Expand compound groups so each individual group gets processed
  const individualGroups = expandCompound(part);

  // For extend/retract on front-facing views, auto-add zHint if not specified
  const autoZ = (action === 'extend' && !zHint && depthFactor < 0.5) ? 'front'
    : (action === 'retract' && !zHint && depthFactor < 0.5) ? 'behind'
    : null;

  for (const groupName of individualGroups) {
    const bones = BODY_GROUPS[groupName];
    for (const boneName of bones) {
      const angle = computeBoneAngle(boneName, action, amount, currentAngles, depthFactor);
      if (angle !== null) {
        joints[boneName] = angle;
      }
    }

    // Carry zHint on each expanded group (explicit > auto)
    const effectiveZ = zHint ?? autoZ;
    if (effectiveZ) {
      zHints[groupName] = effectiveZ;
    }
  }

  // Also attach zHint to the original part name (covers non-compound pass-through)
  const effectiveZTop = zHint ?? autoZ;
  if (effectiveZTop) {
    zHints[part] = effectiveZTop;
  }

  return { joints, zHints };
}

/**
 * Walk a step (or array of steps) and produce DSL nodes.
 * @param {object|object[]} step
 * @param {object} rig
 * @returns {object}  DSL node
 */
function compileStep(step, rig, direction) {
  // Single instruction
  if (step.part && step.action) {
    const { joints, zHints } = compileInstruction(step, rig, {}, direction);
    return {
      op: 'pose',
      joints,
      ticks: step.ticks ?? 1,
      zHints,
    };
  }

  // Sequence or parallel container
  if (step.type === 'sequence' || step.type === 'parallel') {
    return {
      op: step.type,
      children: (step.steps ?? []).map(s => compileStep(s, rig, direction)),
    };
  }

  throw new Error(`Unknown step format: ${JSON.stringify(step)}`);
}

/**
 * Compile a full spatial choreography into a standard DSL program.
 *
 * choreography = { id, kind?, steps: [instruction | {type:"sequence"|"parallel", steps:[...]}] }
 * Returns { id, kind, variant, root: {op:"sequence", children:[{op:"pose", joints, ticks, zHints}]} }
 *
 * @param {{ id: string, kind?: string, steps: object[] }} choreography
 * @param {object} rig  Parsed humanoid.json
 * @param {string} [direction='e']  Facing direction — affects extend/retract depth mapping
 * @returns {{ id: string, kind: string, variant: string, root: object }}
 */
export function compileSpatialProgram(choreography, rig, direction = 'e') {
  const { id, kind = 'action', steps = [] } = choreography;

  const children = steps.map(step => compileStep(step, rig, direction));

  return {
    id,
    kind,
    variant: 'spatial',
    root: {
      op: 'sequence',
      children,
    },
  };
}
