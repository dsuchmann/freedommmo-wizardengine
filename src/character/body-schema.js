export const BODY_PARTS = Object.freeze([
  'shadow', 'back_hair', 'back_equipment', 'rear_upper_arm', 'rear_forearm', 'rear_hand',
  'rear_thigh', 'rear_shin', 'rear_foot', 'hips', 'torso', 'neck', 'head', 'face',
  'front_thigh', 'front_shin', 'front_foot', 'front_upper_arm', 'front_forearm', 'front_hand',
  'front_hair', 'clothing_torso', 'clothing_legs', 'armor', 'held_item', 'equipment_effect', 'lighting_mask'
]);

export const BODY_DIRECTIONS = Object.freeze(['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW']);

export const BODY_ANIMATIONS = Object.freeze([
  'idle', 'walk', 'sprint', 'jump_start', 'jump_air', 'land', 'climb', 'climb_idle',
  'glide_start', 'glide_loop', 'glide_land', 'dodge_roll', 'attack', 'cast', 'gather', 'carry', 'hurt'
]);

export function bodyFrameId(part, direction, animation) {
  return `humanoid_${part}_${direction}_${animation}`;
}
