import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { move } from '../world/actions.js';
import { foundSettlement } from '../society/settlements.js';
import { findSettlementSite } from '../society/suitability.js';
import { tileCost } from '../world/routing.js';

function landRectNear(x0, y0, w = 64, h = 64) {
  for (let oy = 0; oy < 4000; oy += h) {
    let land = 0;
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4)
      if (tileCost(x0 + x, y0 + oy + y) !== Infinity) land++;
    if (land / (Math.ceil(w / 4) * Math.ceil(h / 4)) >= 0.8) return { x0, y0: y0 + oy, w, h };
  }
  return null;
}

test('move, founding work 50k tiles from origin with no bounds', () => {
  const kernel = new Kernel({ seed: 42 });
  const rect = landRectNear(50_000, 50_000);
  assert.ok(rect, 'land rect found far from origin');
  let group, actor;
  kernel.graph.boot(() => {
    group = kernel.graph.createNode({ type: 'group', tick: 0, x: rect.x0, y: rect.y0, R: 1e6, attrs: { noFlux: true } });
    actor = kernel.graph.createNode({ type: 'player', tick: 0, x: rect.x0 + 2, y: rect.y0 + 2, R: 0, attrs: { noFlux: true } });
  });
  const site = findSettlementSite(kernel, rect);
  assert.ok(site, 'suitability finds a site in the far rect');
  const s = foundSettlement(kernel, group.id, site, 0);
  assert.ok(s, 'settlement founded far from origin');
  assert.equal(move(kernel, actor.id, 1, 0, 1), true);
});
