export const DRAW_LAYER_ORDER = Object.freeze({
  terrain: 0,
  decal: 10,
  object: 20,
  canopy: 30,
  entity: 40,
  effect: 50,
  lighting: 60
});

export function drawSortKey(render, wy = 0, elevation = 0) {
  const layer = DRAW_LAYER_ORDER[render?.drawLayer ?? 'object'] ?? 20;
  if (render?.sort === 'fixed') return layer * 1000000;
  if (render?.sort === 'elevationThenY') return layer * 1000000 + elevation * 10000 + wy;
  return layer * 1000000 + wy;
}

export function applyBlend(ctx, render) {
  const blend = render?.blend ?? 'normal';
  ctx.globalCompositeOperation = blend === 'add' ? 'lighter' : blend === 'multiply' ? 'multiply' : blend === 'screen' ? 'screen' : blend === 'overlay' ? 'overlay' : 'source-over';
}
