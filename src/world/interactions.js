const reactionState = new Map();

export function findNearbyInteraction(player, chunkStore, radius = 2.2) {
  let best = null;
  for (const chunk of chunkStore.chunks.values()) {
    for (const object of chunk.objects) {
      const dx = object.wx - player.x;
      const dy = object.wy - player.y;
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      const interaction = interactionFor(object.kind);
      if (!interaction) continue;
      if (!best || d < best.distance) best = { object, distance: d, reaction: reactionState.get(objectKey(object)) ?? null, ...interaction };
    }
  }
  return best;
}

export function performInteraction(player, chunkStore) {
  const nearby = findNearbyInteraction(player, chunkStore);
  if (!nearby) return null;
  const key = objectKey(nearby.object);
  const current = reactionState.get(key) ?? { hits: 0, last: 0, pulse: 0 };
  const next = { hits: current.hits + 1, last: performance.now() / 1000, pulse: 1, verb: nearby.verb, target: nearby.target };
  reactionState.set(key, next);
  return { ...nearby, reaction: next };
}

export function objectReaction(object) {
  const state = reactionState.get(objectKey(object));
  if (!state) return null;
  const age = performance.now() / 1000 - state.last;
  return age > 1.2 ? null : { ...state, age, pulse: Math.max(0, 1 - age / 1.2) };
}

function objectKey(object) {
  return `${object.kind}:${object.wx},${object.wy}`;
}

function interactionFor(kind) {
  if (kind === 'tree') return { verb: 'inspect/chop/climb', target: 'tree' };
  if (kind.includes('rock')) return { verb: 'inspect/mine', target: 'stone' };
  if (kind.includes('crystal')) return { verb: 'inspect/harvest', target: 'crystal' };
  if (kind.includes('bush') || kind.includes('shrub')) return { verb: 'inspect/forage', target: 'bush' };
  return { verb: 'inspect', target: kind };
}
