import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';

// The cache builds offscreen canvases via OffscreenCanvas — shim it onto @napi-rs so it runs headless.
globalThis.OffscreenCanvas = class OffscreenCanvas { constructor(w, h) { return createCanvas(w, h); } };

const {
  getBuildingSprite, spriteKey, alphaBBox, bumpSpriteFrame, invalidateBuildingSprites,
} = await import('../src/render/building-sprite-cache.js');

// A fake building: 3×2-tile footprint anchored at (x,y).
function fakeB(x, y, w = 3, h = 2) { return { x, y, footprint: { boundingBox: { w, h } } }; }

// A fake renderer that paints a solid block exactly over the footprint at its camera-relative position.
// Mirrors drawBuildingTextured's signature. Counts calls so we can prove cache hits skip the rebuild.
function makeFakeRender(counter) {
  return (ctx, b, camX, camY, tilePx) => {
    counter.n++;
    ctx.fillStyle = 'rgb(200,40,40)';
    const sx = b.x * tilePx - camX, sy = b.y * tilePx - camY;
    ctx.fillRect(sx, sy, b.footprint.boundingBox.w * tilePx, b.footprint.boundingBox.h * tilePx);
    return true;
  };
}

test('alphaBBox finds the tight box of a painted region', () => {
  const c = createCanvas(10, 10); const x = c.getContext('2d');
  x.fillStyle = 'red'; x.fillRect(3, 4, 2, 2); // pixels [3..4]×[4..5]
  const box = alphaBBox(x.getImageData(0, 0, 10, 10).data, 10, 10);
  assert.deepEqual(box, { minX: 3, minY: 4, maxX: 4, maxY: 5 });
});

test('alphaBBox returns null for a fully transparent buffer', () => {
  const c = createCanvas(4, 4);
  assert.equal(alphaBBox(c.getContext('2d').getImageData(0, 0, 4, 4).data, 4, 4), null);
});

test('spriteKey is per-anchor and ZOOM-INDEPENDENT (one entry per building across all zooms)', () => {
  assert.equal(spriteKey(fakeB(5, 7)), '5,7');
  assert.equal(spriteKey(fakeB(5, 7)), spriteKey(fakeB(5, 7))); // same building, any zoom → same key
  assert.notEqual(spriteKey(fakeB(5, 7)), spriteKey(fakeB(6, 7)));
});

test('miss builds once; subsequent calls are cache hits (no rebuild)', () => {
  invalidateBuildingSprites();
  const counter = { n: 0 };
  const render = makeFakeRender(counter);
  const b = fakeB(100, 100);
  bumpSpriteFrame();
  const first = getBuildingSprite(b, 32, render);
  assert.ok(first, 'first call returns a sprite');
  assert.equal(first.builtTilePx, 32);
  assert.equal(counter.n, 1, 'renderFn ran on the miss');
  for (let i = 0; i < 5; i++) { bumpSpriteFrame(); assert.ok(getBuildingSprite(b, 32, render)); }
  assert.equal(counter.n, 1, 'renderFn did NOT run again — all cache hits');
});

test('REGRESSION: a continuous zoom SWEEP builds EXACTLY ONCE (no rebuild storm, no settle re-bake)', () => {
  invalidateBuildingSprites();
  const counter = { n: 0 };
  const render = makeFakeRender(counter);
  const b = fakeB(150, 150);
  // simulate an easing zoom AND then settling: in NO case may a second synchronous build occur (that was
  // the ~0.5s spike frame that froze animations). Baked once at first sighting, scaled forever after.
  for (let tp = 32; tp <= 80; tp++) { bumpSpriteFrame(); getBuildingSprite(b, tp, render); }
  for (let i = 0; i < 30; i++) { bumpSpriteFrame(); getBuildingSprite(b, 80, render); } // settle at 80
  assert.equal(counter.n, 1, 'built exactly once — never re-bakes, even after zoom settles');
});

test('sprite is cropped tight to the footprint; anchor offsets place it correctly', () => {
  invalidateBuildingSprites();
  const tilePx = 32;
  const b = fakeB(10, 10, 3, 2); // footprint-only block (no roof above the anchor)
  bumpSpriteFrame(tilePx);
  const spr = getBuildingSprite(b, tilePx, makeFakeRender({ n: 0 }));
  assert.equal(spr.w, 3 * tilePx, 'cropped width == footprint width');
  assert.equal(spr.h, 2 * tilePx, 'cropped height == footprint height');
  assert.equal(spr.ax, 0, 'anchor x offset is 0 (block top-left == anchor)');
  assert.equal(spr.ay, 0, 'anchor y offset is 0');
});

test('content ABOVE the anchor (roof/tall walls) yields a positive ay so placement lifts it', () => {
  invalidateBuildingSprites();
  const tilePx = 32;
  const b = fakeB(10, 10, 3, 2);
  const render = (ctx, bb, camX, camY, tp) => {
    const sx = bb.x * tp - camX, sy = bb.y * tp - camY;
    ctx.fillStyle = 'blue';
    ctx.fillRect(sx, sy - tp, bb.footprint.boundingBox.w * tp, (bb.footprint.boundingBox.h + 1) * tp);
    return true;
  };
  bumpSpriteFrame(tilePx);
  const spr = getBuildingSprite(b, tilePx, render);
  assert.equal(spr.ay, tilePx, 'ay == 1 tile: the sprite extends one tile above the anchor');
  assert.equal(spr.h, 3 * tilePx, 'height includes the extra north tile');
});

test('zoom is reflected only by SCALING (builtTilePx stays the first-sighting zoom), never a re-bake', () => {
  invalidateBuildingSprites();
  const counter = { n: 0 };
  const render = makeFakeRender(counter);
  const b = fakeB(250, 250);
  bumpSpriteFrame(); const a = getBuildingSprite(b, 32, render);       // first seen at zoom→tilePx 32
  bumpSpriteFrame(); const c = getBuildingSprite(b, 64, render);       // later viewed at 64
  assert.equal(counter.n, 1, 'never re-baked');
  assert.equal(a.builtTilePx, 32);
  assert.equal(c.builtTilePx, 32, 'still baked at first-sighting size — caller scales by tilePx/builtTilePx');
});

test('BUILD BUDGET: at most a few NEW bakes per frame; the rest defer and bake on later frames', () => {
  invalidateBuildingSprites();
  const counter = { n: 0 };
  const render = makeFakeRender(counter);
  const blds = Array.from({ length: 10 }, (_, i) => fakeB(600 + i, 600));
  // one frame: 10 buildings want to appear at once → only BUILD_BUDGET (3) may bake; rest return null.
  bumpSpriteFrame();
  const got1 = blds.map((b) => getBuildingSprite(b, 32, render)).filter(Boolean);
  assert.equal(got1.length, 3, 'only the per-frame budget baked this frame');
  assert.equal(counter.n, 3);
  // next frame: 3 more bake (the first 3 are now cache hits and free).
  bumpSpriteFrame();
  const got2 = blds.map((b) => getBuildingSprite(b, 32, render)).filter(Boolean);
  assert.equal(got2.length, 6, '3 cached hits + 3 newly baked');
  assert.equal(counter.n, 6);
});

test('a renderer that is not ready (returns false) does not cache and returns null', () => {
  invalidateBuildingSprites();
  const b = fakeB(200, 200);
  bumpSpriteFrame();
  assert.equal(getBuildingSprite(b, 32, () => false), null, 'not-ready → null');
  const counter = { n: 0 };
  bumpSpriteFrame();
  assert.ok(getBuildingSprite(b, 32, makeFakeRender(counter)));
  assert.equal(counter.n, 1);
});

test('REGRESSION: an INCOMPLETE bake re-bakes every frame until complete, then freezes (no walls-only freeze)', () => {
  // The bug: a building bakes ONCE on first sight — but its tiles + roof load async, so the first drawable
  // frame is walls-only, and that froze forever (eviction only fires when size>384, so a small town never
  // recovers → permanent missing roofs/windows/doors). Fix: re-bake while bakeState.complete is false.
  invalidateBuildingSprites();
  const counter = { n: 0 };
  const render = makeFakeRender(counter);
  const b = fakeB(700, 700);
  let ready = false;                                   // simulate the building's tiles/roof still loading
  const bakeState = () => ({ complete: ready, sig: '' });
  for (let i = 0; i < 3; i++) { bumpSpriteFrame(); assert.ok(getBuildingSprite(b, 32, render, bakeState)); }
  assert.equal(counter.n, 3, 'an incomplete sprite re-bakes every frame so late assets can still appear');
  ready = true;                                        // assets finish loading → next bake is the complete one
  bumpSpriteFrame(); getBuildingSprite(b, 32, render, bakeState);
  assert.equal(counter.n, 4, 'baked once more, now structurally complete');
  for (let i = 0; i < 5; i++) { bumpSpriteFrame(); getBuildingSprite(b, 32, render, bakeState); }
  assert.equal(counter.n, 4, 'complete sprite is now a cache hit — no further re-bakes (perf win preserved)');
});

test('REGRESSION: a warmup-FROZEN partial UPGRADES (re-bakes once) when its assets finally load', () => {
  // The disk-starved-load bug: when a tile loads slower than MAX_WARMUP (900 frames) — e.g. heavy disk I/O —
  // the cache's backstop froze the walls-only partial AS-IS and latched `complete=true`, so the window/roof
  // NEVER appeared even after the tile finished loading (frozen for the whole session). Fix: a warmup-freeze
  // is PROVISIONAL (forcedComplete) — once bakeState.complete flips true, it re-bakes EXACTLY ONCE to pick up
  // the late assets, then freezes genuinely.
  invalidateBuildingSprites();
  const counter = { n: 0 };
  const render = makeFakeRender(counter);
  const b = fakeB(900, 900);
  let ready = false;                                   // window/roof tile still loading (slow disk)
  const bakeState = () => ({ complete: ready, sig: '' });
  // Drive past MAX_WARMUP (900) so the still-incomplete partial gets force-frozen. Budget is 3/frame but a
  // single building bakes every frame it's incomplete (budget only bites with many buildings).
  for (let i = 0; i < 905; i++) { bumpSpriteFrame(); getBuildingSprite(b, 32, render, bakeState); }
  const bakesAtFreeze = counter.n;
  assert.ok(bakesAtFreeze > 1, 'kept re-baking while incomplete');
  // Now it is frozen. While assets are STILL not ready, it must be a pure cache hit (no thrash).
  for (let i = 0; i < 5; i++) { bumpSpriteFrame(); getBuildingSprite(b, 32, render, bakeState); }
  assert.equal(counter.n, bakesAtFreeze, 'warmup-frozen partial is reused (no re-bake) while assets remain absent');
  // Assets finish loading → the provisional freeze upgrades with EXACTLY ONE more bake.
  ready = true;
  bumpSpriteFrame(); getBuildingSprite(b, 32, render, bakeState);
  assert.equal(counter.n, bakesAtFreeze + 1, 'upgraded: re-baked once now that the late window/roof is ready');
  // Genuinely complete now → reused forever (perf win restored, no permanent walls-only sprite).
  for (let i = 0; i < 5; i++) { bumpSpriteFrame(); getBuildingSprite(b, 32, render, bakeState); }
  assert.equal(counter.n, bakesAtFreeze + 1, 'after the upgrade it is a stable cache hit again');
});

test('DOOR ANIM: a complete sprite re-bakes when its sig (door frame) changes, then freezes when stable', () => {
  // The door swing is baked INTO the sprite (so it inherits weathering/scale/depth — an external overlay can't
  // match those). The cache re-bakes ONLY when the door-frame sig changes (the ~8 steps of an approach), then
  // freezes again when the player stops/leaves — so a resting town pays nothing.
  invalidateBuildingSprites();
  const counter = { n: 0 };
  const render = makeFakeRender(counter);
  const b = fakeB(800, 800);
  let frame = 0;                                       // door closed
  const bakeState = () => ({ complete: true, sig: 'd' + frame });
  bumpSpriteFrame(); getBuildingSprite(b, 32, render, bakeState);
  assert.equal(counter.n, 1, 'first bake (closed)');
  for (let i = 0; i < 4; i++) { bumpSpriteFrame(); getBuildingSprite(b, 32, render, bakeState); }
  assert.equal(counter.n, 1, 'closed door + far → sig stable → reused, no re-bake (perf win)');
  for (frame = 1; frame <= 8; frame++) { bumpSpriteFrame(); getBuildingSprite(b, 32, render, bakeState); } // door opens
  assert.equal(counter.n, 9, 'one re-bake per frame-step as the door swings open (8 steps)');
  frame = 8;                                            // door held fully open at its last-baked frame
  for (let i = 0; i < 5; i++) { bumpSpriteFrame(); getBuildingSprite(b, 32, render, bakeState); }
  assert.equal(counter.n, 9, 'door fully open + held → sig stable again → frozen, no further re-bakes');
});

test('invalidateBuildingSprites clears the cache (forces a rebuild)', () => {
  invalidateBuildingSprites();
  const counter = { n: 0 };
  const render = makeFakeRender(counter);
  const b = fakeB(400, 400);
  bumpSpriteFrame(); getBuildingSprite(b, 32, render);
  invalidateBuildingSprites();
  bumpSpriteFrame(); getBuildingSprite(b, 32, render);
  assert.equal(counter.n, 2, 'rebuilt after invalidation');
});
