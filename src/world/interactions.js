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
      if (!best || d < best.distance) best = { object, distance: d, ...interaction };
    }
  }
  return best;
}

function interactionFor(kind) {
  if (kind === 'tree') return { verb: 'inspect/chop/climb', target: 'tree' };
  if (kind.includes('rock')) return { verb: 'inspect/mine', target: 'stone' };
  if (kind.includes('crystal')) return { verb: 'inspect/harvest', target: 'crystal' };
  if (kind.includes('bush') || kind.includes('shrub')) return { verb: 'inspect/forage', target: 'bush' };
  return { verb: 'inspect', target: kind };
}
