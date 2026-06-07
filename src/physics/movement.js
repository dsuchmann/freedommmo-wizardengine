export function canEnterTile(tile) {
  if (!tile?.walkable) return false;
  return true;
}

function objectBlocksPlayer(object, px, py) {
  const radius = object.kind === 'tree' ? 0.38 : object.kind === 'rock' ? 0.34 : object.kind === 'shrub' ? 0.24 : 0;
  if (!radius) return false;
  const ox = object.wx + 0.5;
  const oy = object.wy + 0.72;
  const dx = px - ox;
  const dy = py - oy;
  return dx * dx + dy * dy < radius * radius;
}

function canOccupy(chunkStore, x, y) {
  if (!canEnterTile(chunkStore.tileAt(x, y))) return false;
  const cx = Math.floor(x / 64);
  const cy = Math.floor(y / 64);
  for (let yy = cy - 1; yy <= cy + 1; yy++) {
    for (let xx = cx - 1; xx <= cx + 1; xx++) {
      const chunk = chunkStore.getIfReady?.(xx, yy) ?? chunkStore.get?.(xx, yy);
      if (!chunk?.objects) continue;
      for (const object of chunk.objects) if (objectBlocksPlayer(object, x, y)) return false;
    }
  }
  return true;
}

export function movementCost(tile) {
  let cost = tile?.movementCost ?? 1;
  const slope = tile.layers?.[7]?.slope ?? 0;
  const localStep = tile.layers?.[7]?.localStep ?? 0;
  cost *= 1 + slope * 5 + localStep * 4;
  if (tile.terrainForm === 'hillside') cost *= 1.25;
  if (tile.terrainForm === 'mountain_slope') cost *= 1.65;
  if (tile.terrainForm === 'mountain_bowl') cost *= 1.45;
  if (tile.terrainForm === 'step') cost *= 1.35;
  if (tile.terrainForm === 'ridge') cost *= 1.18;
  if (tile.terrainForm === 'valley') cost *= 0.92;
  if (tile.features?.includes('dry_riverbed')) cost *= 0.82;
  if (tile.features?.includes('natural_bridge')) cost *= 1.1;
  return cost;
}

export function resolveMovement(player, chunkStore, dx, dy) {
  const nextX = player.x + dx;
  const nextY = player.y + dy;
  if (canOccupy(chunkStore, nextX, player.y)) player.x = nextX;
  if (canOccupy(chunkStore, player.x, nextY)) player.y = nextY;
  return canOccupy(chunkStore, player.x, player.y);
}
