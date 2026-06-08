# Shadow System Design

**Date:** 2026-06-07
**Status:** Spec ready for implementation
**Scope:** Per-object silhouette shadows cast from sun/moon direction, anchored to object bases, sized by object height.

## Overview

Every visible object casts a shadow that reflects its shape. Shadow direction and length are driven by the sun/moon position from the lighting system. Tall objects (trees) cast long, recognizable silhouettes. Small objects (grass, flowers) cast subtle diffuse shadows. The player casts a player-shaped shadow.

## Current State

The renderer currently draws simple rectangular shadows:
```js
// canvas-renderer.js line ~272
ctx.fillStyle = `rgba(42,46,43,${0.20 * (1 - sun.height)})`;
ctx.fillRect(sx + sun.shadowX * 12 * zoom, sy + sun.shadowY * 12 * zoom + 10 * zoom, 12 * zoom, 5 * zoom);
```

This is a generic dark rectangle offset by sun direction. No shape, no height awareness.

## Design

### Shadow Rendering Approach

Shadows are drawn as **darkened, squashed, skewed copies of the object sprite**. This gives shape-accurate silhouettes without needing separate shadow assets.

```js
function drawShadow(ctx, sprite, sx, sy, sw, sh, baseX, baseY, sun, zoom, objectHeight) {
  if (sun.sunHeight < 0.02) return; // No shadow in deep night
  
  var shadowAlpha = 0.25 * sun.sunHeight; // Stronger at noon, fades at dawn/dusk
  var length = sun.shadowLength * objectHeight; // Taller objects = longer shadows
  
  ctx.save();
  ctx.globalAlpha = shadowAlpha;
  ctx.globalCompositeOperation = 'multiply';
  
  // Transform: anchor at base, skew in sun direction, squash vertically
  ctx.translate(baseX, baseY);
  ctx.transform(
    1,                              // scaleX
    0,                              // skewY  
    sun.shadowX * length,           // skewX (horizontal stretch by sun direction)
    0.3,                            // scaleY (squash to 30% height)
    sun.shadowX * 8 * zoom * length, // translateX (offset from base)
    sun.shadowY * 4 * zoom * length  // translateY
  );
  ctx.translate(-baseX, -baseY);
  
  // Draw the sprite as a solid dark silhouette
  // First draw the sprite, then composite to black
  ctx.drawImage(sprite, sx, sy, sw, sh);
  
  ctx.restore();
}
```

### Alternative: Canvas Filter Approach (simpler)

Since we can't easily turn a sprite into a black silhouette with just canvas transforms, use a simpler approach — draw the sprite with heavy darkness:

```js
function drawObjectShadow(ctx, drawFn, baseX, baseY, sun, zoom, height) {
  if (sun.sunHeight < 0.02) return;
  
  var alpha = 0.20 + sun.sunHeight * 0.15; // 0.20-0.35
  var len = sun.shadowLength * height;
  var offX = sun.shadowX * 16 * zoom * len;
  var offY = sun.shadowY * 8 * zoom * len + 4 * zoom;
  
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(offX, offY);
  // Squash vertically to create ground-plane effect
  ctx.translate(baseX, baseY);
  ctx.scale(1.0 + len * 0.3, 0.3);
  ctx.translate(-baseX, -baseY);
  
  // Draw sprite darkened
  ctx.filter = 'brightness(0)'; // Makes sprite pure black silhouette
  drawFn(); // Call the same draw function used for the actual object
  ctx.filter = 'none';
  ctx.restore();
}
```

**Note:** `ctx.filter = 'brightness(0)'` is supported in all modern browsers and is the simplest way to turn any sprite into a black silhouette. If performance is a concern (filter per object), we can use an offscreen canvas to pre-render shadow versions.

### Object Height Categories

Objects need a height value to determine shadow length:

```js
var OBJECT_HEIGHTS = {
  tree: 3.0,        // Tall — long, tree-shaped shadow
  rock: 0.8,        // Short — small shadow
  basalt_rock: 1.0,
  ice_rock: 0.9,
  shrub: 0.5,       // Low — minimal shadow
  bush: 0.4,
  reed: 0.6,
  flower: 0.2,      // Tiny — barely visible shadow
  grass_tuft: 0.15, // Almost no shadow
  shell: 0.1,
  crystal: 1.2,     // Medium
  pillar: 2.0,      // Tall
  log: 0.6,
  mushroom: 0.3,
};
```

Objects with height < 0.2 skip shadow rendering entirely (not worth the cost).

### Shadow Base Anchoring

Shadows must be anchored to the BASE of the object, not the center of the sprite:

```js
// For trees: base is at bottom-center of sprite (trunk position)
var baseX = spriteScreenX + spriteWidth * 0.5;
var baseY = spriteScreenY + spriteHeight; // Bottom of sprite = ground level

// For rocks: base is at bottom-center
// Same formula works for all objects since sprites are drawn with bottom = ground
```

The existing rendering code already positions sprites with their bottom edge at ground level (offset calculations in drawObject). The shadow base = sprite bottom center.

### Player Shadow

The player is drawn procedurally (not from a sprite atlas). The existing ellipse shadow at `sy + 8 * zoom` is replaced with:

```js
// In drawPlayerAt:
// 1. Save state
ctx.save();
ctx.globalAlpha = 0.25 * sun.sunHeight;
var len = sun.shadowLength * 1.5; // Player height ~1.5
var offX = sun.shadowX * 12 * zoom * len;
var offY = sun.shadowY * 6 * zoom * len;

// 2. Transform for ground-plane shadow
ctx.translate(px + offX, sy + offY + 4 * zoom);
ctx.scale(1.0 + len * 0.2, 0.25);
ctx.translate(-(px + offX), -(sy + offY + 4 * zoom));

// 3. Draw player as dark silhouette at shadow position
ctx.filter = 'brightness(0)';
drawModularPlayer(ctx, px + offX, sy + offY, zoom, frame, animation);
ctx.filter = 'none';
ctx.restore();

// 4. Then draw the actual player (existing code)
drawModularPlayer(ctx, px, py, zoom, frame, animation);
```

### Shadow During Night

At night, the moon provides faint shadow casting:
- Shadow direction is from moon (opposite of sun)
- Shadow alpha is much lower: `0.06 * moonHeight`
- Only large objects (height > 1.5) cast visible moon shadows

```js
if (!sun.isDaytime && sun.moonHeight > 0.1) {
  var moonShadowX = -Math.cos(sun.moonAngle) * (1.5 - sun.moonHeight * 1.2);
  var moonShadowY = 0.4 + (1 - sun.moonHeight) * 0.8;
  // Draw faint moon shadow for large objects only
}
```

## Integration Points

### In large-object-renderer.js

The `drawLargeObjects` function iterates visible objects and draws them. Shadow drawing goes BEFORE the actual sprite draw (so shadow is behind):

```js
// For each object:
var height = OBJECT_HEIGHTS[object.kind] || 0.5;
if (height >= 0.2) {
  drawObjectShadow(ctx, () => {
    // Same drawImage call as the real object
    ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh,
                  drawX, drawY, drawSize, drawSize);
  }, baseX, baseY, sun, zoom, height);
}
// Then draw the actual object
ctx.drawImage(frame.image, ...);
```

### In canvas-renderer.js

- Remove the existing rectangular shadow code
- Pass `sun` data (with new shadowLength, sunHeight) to object rendering
- Player shadow is drawn in `drawPlayerAt`

## Files to Modify

- `src/render/canvas-renderer.js` — Player shadow, remove old rect shadow
- `src/render/large-object-renderer.js` — Object shadow before each sprite draw

## Files to Create

None — shadow logic lives in the rendering files where objects are drawn.

## Performance Budget

- Shadow = 1 extra drawImage + filter per visible object
- `brightness(0)` filter is GPU-accelerated in modern browsers
- Skip objects with height < 0.2 (~60% of small objects)
- Budget: ~0.5ms for ~50 visible objects with shadows
- If performance is an issue, only shadow objects within 20 tiles of player
