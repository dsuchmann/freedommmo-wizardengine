export function paintTerrainFeatures(ctx, tile, sx, sy, size, sun) {
  return;
}

function paintValley(ctx, sx, sy, size) {
  ctx.fillStyle = 'rgba(30,70,38,.20)';
  ctx.fillRect(sx, sy + size * 0.55, size, Math.max(1, size * 0.25));
}

function paintRidge(ctx, sx, sy, size) {
  ctx.fillStyle = 'rgba(235,225,170,.22)';
  ctx.fillRect(sx, sy + size * 0.20, size, Math.max(1, size * 0.16));
  ctx.fillStyle = 'rgba(20,20,20,.14)';
  ctx.fillRect(sx, sy + size * 0.42, size, Math.max(1, size * 0.12));
}

function paintCliff(ctx, tile, sx, sy, size, sun) {
  const alpha = Math.min(0.5, 0.20 + tile.layers[7].slope * 2.2);
  ctx.fillStyle = `rgba(18,16,14,${alpha})`;
  ctx.fillRect(sx, sy + size * 0.45, size, size * 0.55);
  ctx.fillStyle = `rgba(235,230,205,${0.12 + sun.height * 0.08})`;
  ctx.fillRect(sx, sy, size, Math.max(1, size * 0.18));
}

function paintMountainStrata(ctx, sx, sy, size) {
  ctx.fillStyle = 'rgba(255,255,255,.13)';
  ctx.fillRect(sx, sy + size * 0.18, size, 1);
  ctx.fillStyle = 'rgba(70,64,56,.18)';
  ctx.fillRect(sx, sy + size * 0.64, size, 1);
}

function paintDryRiverbed(ctx, sx, sy, size) {
  ctx.fillStyle = 'rgba(111,83,48,.48)';
  ctx.beginPath();
  ctx.moveTo(sx, sy + size * 0.35);
  ctx.lineTo(sx + size * 0.34, sy + size * 0.55);
  ctx.lineTo(sx + size, sy + size * 0.46);
  ctx.lineTo(sx + size, sy + size * 0.68);
  ctx.lineTo(sx + size * 0.36, sy + size * 0.76);
  ctx.lineTo(sx, sy + size * 0.58);
  ctx.closePath();
  ctx.fill();
}

function paintOverhang(ctx, sx, sy, size) {
  ctx.fillStyle = 'rgba(5,4,3,.32)';
  ctx.fillRect(sx, sy + size * 0.56, size, size * 0.34);
}

function paintBridge(ctx, sx, sy, size) {
  ctx.fillStyle = 'rgba(130,104,64,.78)';
  ctx.fillRect(sx, sy + size * 0.40, size, size * 0.22);
  ctx.fillStyle = 'rgba(235,210,140,.30)';
  ctx.fillRect(sx, sy + size * 0.40, size, 1);
}

function paintCaveEntrance(ctx, sx, sy, size) {
  ctx.fillStyle = 'rgba(38,34,32,.82)';
  ctx.beginPath();
  ctx.ellipse(sx + size * 0.5, sy + size * 0.58, size * 0.35, size * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(120,105,85,.60)';
  ctx.fillRect(sx + size * 0.22, sy + size * 0.36, size * 0.56, size * 0.08);
}
