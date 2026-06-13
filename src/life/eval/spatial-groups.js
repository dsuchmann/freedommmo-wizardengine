/**
 * Body part groups — named collections of bone chains in the humanoid rig.
 * Individual groups map directly to bone names; compound groups expand to
 * multiple individual groups.
 */

export const BODY_GROUPS = {
  // Individual
  left_shoulder:  ['arm_u_l'],
  right_shoulder: ['arm_u_r'],
  left_arm:       ['arm_u_l', 'arm_f_l', 'hand_l'],
  right_arm:      ['arm_u_r', 'arm_f_r', 'hand_r'],
  left_hand:      ['hand_l'],
  right_hand:     ['hand_r'],
  left_hip:       ['thigh_l'],
  right_hip:      ['thigh_r'],
  left_leg:       ['thigh_l', 'shin_l', 'foot_l'],
  right_leg:      ['thigh_r', 'shin_r', 'foot_r'],
  left_foot:      ['foot_l'],
  right_foot:     ['foot_r'],
  torso:          ['spine'],
  head:           ['head'],
};

// Compound groups expand to multiple individual groups
export const COMPOUND_GROUPS = {
  both_arms:      ['left_arm', 'right_arm'],
  both_legs:      ['left_leg', 'right_leg'],
  both_shoulders: ['left_shoulder', 'right_shoulder'],
  both_hips:      ['left_hip', 'right_hip'],
  upper_body:     ['torso', 'head', 'left_arm', 'right_arm'],
  lower_body:     ['left_leg', 'right_leg'],
  full_body:      ['torso', 'head', 'left_arm', 'right_arm', 'left_leg', 'right_leg'],
};

/**
 * Returns a flat, deduplicated list of bone names for any group name
 * (individual or compound). Throws if the group name is unknown.
 * @param {string} groupName
 * @returns {string[]}
 */
export function resolveBones(groupName) {
  if (BODY_GROUPS[groupName]) {
    return [...BODY_GROUPS[groupName]];
  }
  if (COMPOUND_GROUPS[groupName]) {
    const seen = new Set();
    const bones = [];
    for (const individual of COMPOUND_GROUPS[groupName]) {
      for (const bone of BODY_GROUPS[individual]) {
        if (!seen.has(bone)) {
          seen.add(bone);
          bones.push(bone);
        }
      }
    }
    return bones;
  }
  throw new Error(`Unknown body group: "${groupName}"`);
}

/**
 * If compound, returns the list of individual group names it expands to.
 * If already individual, returns [groupName].
 * Throws if unknown.
 * @param {string} groupName
 * @returns {string[]}
 */
export function expandCompound(groupName) {
  if (COMPOUND_GROUPS[groupName]) {
    return [...COMPOUND_GROUPS[groupName]];
  }
  if (BODY_GROUPS[groupName]) {
    return [groupName];
  }
  throw new Error(`Unknown body group: "${groupName}"`);
}

/**
 * Returns true if groupName is a compound group, false if individual.
 * Does not throw on unknown names — returns false.
 * @param {string} groupName
 * @returns {boolean}
 */
export function isCompound(groupName) {
  return Object.prototype.hasOwnProperty.call(COMPOUND_GROUPS, groupName);
}
