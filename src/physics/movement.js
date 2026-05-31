export function canEnterTile(tile) {
  if (!tile?.walkable) return false;
  if (tile.terrainForm === 'cliff' && !tile.features.includes('natural_bridge')) return false;
  if (tile.layers?.[6]?.slope > 0.13 && !tile.features.includes('natural_bridge')) return false;
  return true;
}

export function movementCost(tile) {
  let cost = tile?.movementCost ?? 1;
  const slope = tile.layers?.[6]?.slope ?? 0;
  cost *= 1 + slope * 5;
  if (tile.terrainForm === 'hillside') cost *= 1.25;
  if (tile.terrainForm === 'mountain_slope') cost *= 1.65;
  if (tile.features?.includes('dry_riverbed')) cost *= 0.82;
  if (tile.features?.includes('natural_bridge')) cost *= 1.1;
  return cost;
}

export function resolveMovement(player, chunkStore, dx, dy) {
  const nextX = player.x + dx;
  const nextY = player.y + dy;
  const tileX = chunkStore.tileAt(nextX, player.y);
  const tileY = chunkStore.tileAt(player.x, nextY);
  const tileBoth = chunkStore.tileAt(nextX, nextY);
  if (canEnterTile(tileX)) player.x = nextX;
  if (canEnterTile(tileY)) player.y = nextY;
  if (!canEnterTile(tileBoth)) return false;
  return true;
}
