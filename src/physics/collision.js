export function collisionWorldBounds(asset, wx, wy, tileSize = 32) {
  const shapes = asset?.collision ?? [];
  return shapes.map(shape => localShapeToWorld(shape, wx, wy, tileSize));
}

export function blocksMovement(asset) {
  return Boolean(asset?.physics?.blocksMovement);
}

export function blocksLight(asset) {
  return Boolean(asset?.render?.occluder);
}

export function localShapeToWorld(shape, wx, wy, tileSize) {
  const ox = wx * tileSize;
  const oy = wy * tileSize;
  if (shape.type === 'rect') return { ...shape, x: ox + shape.x, y: oy + shape.y };
  if (shape.type === 'circle') return { ...shape, cx: ox + shape.cx, cy: oy + shape.cy };
  if (shape.type === 'polygon') return { ...shape, points: shape.points.map(([x, y]) => [ox + x, oy + y]) };
  return shape;
}
