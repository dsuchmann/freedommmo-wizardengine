/**
 * Spatial Compiler — deterministic conversion of spatial instructions
 * (body part + primitive + amount) into joint angles + Z hints.
 * No LLM involved — pure math.
 */

import { resolveBones, expandCompound, isCompound, BODY_GROUPS } from './spatial-groups.js';

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
 * Returns the angle value, or null if this bone is unaffected by the action.
 */
function computeBoneAngle(boneName, action, amount, currentAngles) {
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
          return lerp(0, isLeft ? -90 : 90, amount);
        case 'retract':
          return lerp(0, isLeft ? 50 : -50, amount);
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
          return lerp(0, -90, amount);
        case 'retract':
          return lerp(0, 30, amount);
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
 * @returns {{ joints: Record<string, number>, zHints: Record<string, string> }}
 */
export function compileInstruction(instruction, rig, currentAngles = {}) {
  const { part, action, amount, zHint } = instruction;

  const joints  = {};
  const zHints  = {};

  // Expand compound groups so each individual group gets processed
  const individualGroups = expandCompound(part);

  for (const groupName of individualGroups) {
    const bones = BODY_GROUPS[groupName];
    for (const boneName of bones) {
      const angle = computeBoneAngle(boneName, action, amount, currentAngles);
      if (angle !== null) {
        joints[boneName] = angle;
      }
    }

    // Carry zHint on each expanded group
    if (zHint !== undefined) {
      zHints[groupName] = zHint;
    }
  }

  // Also attach zHint to the original part name (covers non-compound pass-through)
  if (zHint !== undefined) {
    zHints[part] = zHint;
  }

  return { joints, zHints };
}

/**
 * Walk a step (or array of steps) and produce DSL nodes.
 * @param {object|object[]} step
 * @param {object} rig
 * @returns {object}  DSL node
 */
function compileStep(step, rig) {
  // Single instruction
  if (step.part && step.action) {
    const { joints, zHints } = compileInstruction(step, rig);
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
      children: (step.steps ?? []).map(s => compileStep(s, rig)),
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
 * @returns {{ id: string, kind: string, variant: string, root: object }}
 */
export function compileSpatialProgram(choreography, rig) {
  const { id, kind = 'action', steps = [] } = choreography;

  const children = steps.map(step => compileStep(step, rig));

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
