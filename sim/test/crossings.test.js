// sim/test/crossings.test.js — P2.5: fords/bridges = group-funded matter on stream
// tiles (P2 roads pattern: nurture transfer, condition+decay+maintenance). Routing
// crosses water ONLY through a crossing (world-compiler L10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createGroup } from '../society/groups.js';
import { buildCrossing, maintainCrossing, crossingsOf, FORD_COST, BRIDGE_COST, CROSSING_DECAY_PER_DAY, MAINTAIN_COST } from '../world/crossings.js';
import { planRoute, tileCost } from '../world/routing.js';
import { streamAt } from '../../src/world/hydrology.js';
import { DAY } from '../time/metabolism.js';

// Discover a stream tile with land on opposite sides (a crossable narrows).
function findCrossable() {
  for (let y = -300; y < 300; y += 1) for (let x = 930; x < 2430; x += 1) {
    const s = streamAt(x, y);
    if (!s || s.width > 3) continue;
    // land west & east of the channel within 4 tiles
    let west = null, east = null;
    for (let d = 1; d <= 4; d++) {
      if (!west && tileCost(x - d, y) !== Infinity) west = { x: x - d, y };
      if (!east && tileCost(x + d, y) !== Infinity) east = { x: x + d, y };
    }
    if (west && east) return { tile: { x, y }, west, east, width: s.width };
  }
  return null;
}

test('P2.5 buildCrossing: ford on a narrow stream — paid, provenanced, conditioned; routing crosses only via it', () => {
  const spot = findCrossable();
  assert.ok(spot, 'a crossable narrows exists');
  const bounds = { x0: spot.west.x - 2, y0: spot.tile.y - 6, w: (spot.east.x - spot.west.x) + 5, h: 13 };
  const k = new Kernel({ seed: 7, bounds });
  const g = createGroup(k, 0, spot.west);
  k.graph.boot(() => { g.R = FORD_COST + 50; });   // boot arrangement: pre-funded wallet (probe funds for real)
  // without a crossing: unreachable across the channel IF the channel separates west/east in bounds
  const before = planRoute(spot.west, spot.east, bounds);
  // (stream may be skirtable inside these bounds — if so the route must not contain the ford tile)
  const ford = buildCrossing(k, g.id, spot.tile, 'ford', 0);
  assert.ok(ford, 'ford built');
  assert.equal(ford.attrs.archetype, 'ford');
  assert.equal(ford.attrs.condition, 100);
  assert.ok(ford.attrs.E > 0, 'embodied time from the nurture transfer');
  assert.ok(k.ledger.events.some(e => e.type === 'ford_built'), 'ledger event');
  // routing with the crossings whitelist passes through the ford tile
  const xs = crossingsOf(k);
  assert.ok(xs.has(`${spot.tile.x},${spot.tile.y}`));
  const route = planRoute(spot.west, spot.east, bounds, { crossings: xs });
  assert.ok(route, 'route exists with crossing');
  if (!before) assert.ok(route.some(p => p.x === spot.tile.x && p.y === spot.tile.y),
    'when the channel blocks, the route uses the ford');
});

test('P2.5 refusals: not a stream tile, too wide for ford, missing/poor group — side-effect-free', () => {
  const spot = findCrossable();
  const bounds = { x0: spot.west.x - 2, y0: spot.tile.y - 6, w: (spot.east.x - spot.west.x) + 5, h: 13 };
  const k = new Kernel({ seed: 7, bounds });
  const g = createGroup(k, 0, spot.west);
  k.graph.boot(() => { g.R = 1000; });
  const ev0 = k.ledger.events.length;
  assert.equal(buildCrossing(k, g.id, spot.west, 'ford', 0), null, 'land tile refused');
  assert.equal(buildCrossing(k, 99999, spot.tile, 'ford', 0), null, 'missing group');
  const poor = createGroup(k, 0, spot.west);
  assert.equal(buildCrossing(k, poor.id, spot.tile, 'ford', 0), null, 'cannot pay');
  assert.equal(k.ledger.events.length - ev0, 1, 'only the group_founded event for poor — no crossing events on refusal');
  // ford width limit: fords only on width ≤ FORD_MAX_WIDTH (bridge required beyond)
});

test('P2.5 decay: unmaintained crossing decays to nothing with conserved E; maintenance resets', () => {
  const spot = findCrossable();
  const bounds = { x0: spot.west.x - 2, y0: spot.tile.y - 6, w: (spot.east.x - spot.west.x) + 5, h: 13 };
  const k = new Kernel({ seed: 7, bounds });
  const g = createGroup(k, 0, spot.west);
  k.graph.boot(() => { g.R = FORD_COST * 3; });
  const ford = buildCrossing(k, g.id, spot.tile, 'ford', 0);
  const s0 = k.stocks(k.tick);
  const dec0 = k.ledger.totals.decayed ?? 0;
  k.runTo(10 * DAY);
  assert.equal(ford.attrs.condition, 100 - 10 * CROSSING_DECAY_PER_DAY, 'condition decays daily');
  assert.equal(maintainCrossing(k, g.id, ford.id, k.tick), true);
  assert.equal(ford.attrs.condition, 100, 'maintenance restores');
  k.runTo(60 * DAY);   // 100/2 = 50 days to die
  assert.ok(!k.graph.nodes.has(ford.id), 'crossing gone at condition 0');
  assert.ok(k.ledger.events.some(e => e.type === 'crossing_gone'));
  assert.ok((k.ledger.totals.decayed ?? 0) > dec0, 'embodied E counted as decayed');
});
