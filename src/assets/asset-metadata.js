export const DIRECTIONS_8 = Object.freeze(['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW']);
export const DIRECTION_OMNI = Object.freeze(['OMNI']);

export function staticAnimation({ frames = 1, fps = 1, directions = DIRECTION_OMNI, layers = [] } = {}) {
  return { frames, fps, loop: false, directions, layers, events: [] };
}

export function idleAnimation({ frames = 4, fps = 3, directions = DIRECTIONS_8, layers = [] } = {}) {
  return { frames, fps, loop: true, directions, layers, events: [] };
}

export function stateAnimation(frames, fps, loop, directions, layers, events = []) {
  return { frames, fps, loop, directions, layers, events };
}

export function defaultPhysics({ body = 'static', material = 'organic', mass = 1, blocksMovement = false, blocksProjectiles = false, climbable = false } = {}) {
  return { body, material, mass, blocksMovement, blocksProjectiles, climbable };
}

export function defaultRender({ drawLayer = 'object', sort = 'elevationThenY', blend = 'normal', castsShadow = true, receivesLight = true, occluder = false, heightClass = 'body' } = {}) {
  return { drawLayer, sort, blend, castsShadow, receivesLight, occluder, heightClass };
}

export function rectCollision(x, y, w, h, kind = 'solid') {
  return { type: 'rect', kind, x, y, w, h };
}

export function circleCollision(cx, cy, r, kind = 'solid') {
  return { type: 'circle', kind, cx, cy, r };
}
