// sim/test/buildings.test.js — P4: runtime building construction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, pick, move, take, chop } from '../world/actions.js';
import { createGroup, contribute } from '../society/groups.js';
import { foundSettlement } from '../society/settlements.js';
import { findSettlementSite } from '../society/suitability.js';
import { materializeRect } from '../world/wire.js';
import { constructBuilding, maintainBuilding, buildingStampAt, wallTiles,
         BUILD_E_PER_STAMP, BUILDING_CONDITION_MAX, BUILDING_DECAY_PER_DAY,
         MAINTAIN_COST } from '../world/buildings.js';
import { FEATURE_E } from '../world/construct.js';
import { DAY } from '../time/metabolism.js';

const RECT = { x0: 926, y0: 0, w: 28, h: 14 };

/** Boot a funded scenario: settlement founded, group g holds `fund` tu. Returns helpers. */
function scenario(fund = 2000) {
  const k = new Kernel({ seed: 7, bounds: RECT });
  let bush;
  k.graph.boot(() => {
    bush = k.addLiving({ species: 'berry_bush', x: 941, y: 1,
                         R: 40000, body: 60000, tick: 0, age: 400 * DAY });
    materializeRect(k, RECT, 0);
  });
  const p = createPlayer(k, 0, { x: 941, y: 1 });
  const g = createGroup(k, 0, { x: 941, y: 0 });
  const player = k.graph.nodes.get(p.id);
  while (player.R < fund / 0.9 + 300) {
    if (pick(k, p.id, bush.id, 0) <= 0) break;
  }
  assert.equal(contribute(k, p.id, g.id, Math.ceil(fund / 0.9), 0), true, 'funding contribute');
  const group = k.graph.nodes.get(g.id);
  assert.ok(group.R >= fund, `group must hold ≥${fund}, has ${group.R}`);
  const site = findSettlementSite(k, RECT);
  const s = foundSettlement(k, g.id, site, 0);
  assert.ok(s, 'settlement founded');
  return { k, p, g, s };
}

/** Clear every materialized placement node in rect with real verbs: take matter, chop living. */
function clearSite(k, playerId, rect) {
  for (const n of [...k.graph.nodes.values()]) {
    if (!n.attrs?.placement) continue;
    if (n.x < rect.x0 || n.x >= rect.x0 + rect.w || n.y < rect.y0 || n.y >= rect.y0 + rect.h) continue;
    if (n.type === 'matter') take(k, playerId, n.id, 0);
    else chop(k, playerId, n.id, 0);
  }
  // chop leaves corpses/products that are NOT placements; constructBuilding only refuses
  // materialized placements, so also take non-placement matter in the rect.
  for (const n of [...k.graph.nodes.values()]) {
    if (n.type !== 'matter' || n.attrs?.placement) continue;
    if (n.x < rect.x0 || n.x >= rect.x0 + rect.w || n.y < rect.y0 || n.y >= rect.y0 + rect.h) continue;
    take(k, playerId, n.id, 0);
  }
}

/** First plot of settlement `s` whose rect contains NO materialized placement nodes.
 *  ADAPTATION (seed-7 concern): seed-7 geography places flora on all deeded plots, so
 *  clearPlot clears the first plot with real take/chop verbs before returning it.
 *  This matches the plan's probe task pattern (never hardcoded coords, never weakened assertions). */
function clearPlot(k, s, playerId) {
  const plots = [...k.graph.nodes.values()].filter(
    n => n.type === 'plot' && n.attrs.settlement === s.id);
  assert.ok(plots.length >= 1, 'settlement has plots');
  // First try to find a naturally clear plot.
  outer: for (const plot of plots) {
    const r = plot.attrs.rect;
    for (const n of k.graph.nodes.values()) {
      if (n.attrs?.placement &&
          n.x >= r.x0 && n.x < r.x0 + r.w && n.y >= r.y0 && n.y < r.y0 + r.h) continue outer;
    }
    return plot;
  }
  // Seed-7 concern: no naturally-clear plot. Clear the first plot with real verbs.
  const plot = plots[0];
  clearSite(k, playerId, plot.attrs.rect);
  return plot;
}

test('constructBuilding: hut on an owned clear plot — paid, evented, conserved', () => {
  const { k, p, g, s } = scenario();
  const plot = clearPlot(k, s, p.id);
  assert.ok(plot, 'a clear plot exists in this geography (seed 7)');
  const group = k.graph.nodes.get(g.id);
  const rBefore = group.R;
  const stocksBefore = k.stocks(0);
  const tlBefore = k.ledger.totals.transferLoss;

  const b = constructBuilding(k, g.id, { plotId: plot.id }, 'hut', 0);
  assert.ok(b, 'construction succeeded');
  assert.equal(b.type, 'building');

  // Cost: 20 stamps × BUILD_E_PER_STAMP + hearth + bedroll.
  const cost = 20 * BUILD_E_PER_STAMP + FEATURE_E.hearth + FEATURE_E.bedroll;
  assert.equal(group.R, rBefore - cost, 'group paid exactly the declared cost');

  // Stamps: 5×4 footprint, perimeter walls, one south door, 6 interior floors.
  assert.equal(b.attrs.stamps.length, 20);
  assert.equal(b.attrs.stamps.filter(st => st.piece === 'door').length, 1);
  assert.equal(b.attrs.stamps.filter(st => st.piece === 'floor').length, 6);
  assert.equal(b.attrs.stamps.filter(st => st.piece === 'wall').length, 13);

  // Features: matter nodes with provenance, E paid through nurture.
  const feats = [...k.graph.nodes.values()].filter(n => n.attrs?.building === b.id);
  assert.equal(feats.length, 2);
  for (const f of feats) {
    assert.equal(f.type, 'matter');
    assert.ok(f.createdByEvent != null, 'feature has causal provenance');
  }

  // NPC slots resolved to tiles (Agency landing pad).
  assert.equal(b.attrs.npcSlots.length, 1);
  assert.equal(b.attrs.npcSlots[0].role, 'resident');
  assert.equal(b.attrs.npcSlots[0].workTile, null);
  const bedroll = feats.find(f => f.attrs.archetype === 'bedroll');
  assert.deepEqual(b.attrs.npcSlots[0].sleepTile, { x: bedroll.x, y: bedroll.y });

  // Ledger event with backpatched targets (building + 2 features).
  const ev = k.ledger.events.find(e => e.type === 'building_constructed');
  assert.ok(ev, 'building_constructed event emitted');
  assert.equal(ev.targets.length, 3);

  // Conservation: Δstocks == −ΔtransferLoss (nurture 0.95 losses only).
  const tlDelta = k.ledger.totals.transferLoss - tlBefore;
  assert.ok(Math.abs((k.stocks(0) - stocksBefore) + tlDelta) < 1e-6,
    'construction conserves time up to channel loss');
});

test('constructBuilding refusals are side-effect-free', () => {
  const { k, p, g, s } = scenario();
  const plot = clearPlot(k, s, p.id);
  const group = k.graph.nodes.get(g.id);
  const before = { R: group.R, nodes: k.graph.nodes.size, events: k.ledger.events.length,
                   deltas: k.deltas.list.length };
  // unknown template / compound (non-leaf) / missing group / unowned plot / underfunded
  assert.equal(constructBuilding(k, g.id, { plotId: plot.id }, 'nope', 0), null);
  assert.equal(constructBuilding(k, g.id, { plotId: plot.id }, 'compound', 0), null);
  assert.equal(constructBuilding(k, 999999, { plotId: plot.id }, 'hut', 0), null);
  const stolen = { ...plot.attrs }; plot.attrs.owner = 424242;
  assert.equal(constructBuilding(k, g.id, { plotId: plot.id }, 'hut', 0), null);
  plot.attrs.owner = stolen.owner;
  const saved = group.R; group.R = 1;
  assert.equal(constructBuilding(k, g.id, { plotId: plot.id }, 'hut', 0), null);
  group.R = saved;
  assert.deepEqual(
    { R: group.R, nodes: k.graph.nodes.size, events: k.ledger.events.length,
      deltas: k.deltas.list.length }, before, 'no refusal left a trace');
});

test('constructBuilding refuses an uncleared site and double-build', () => {
  const { k, p, g, s } = scenario();
  // Uncleared: a plot that has a materialized placement node inside it.
  const plots = [...k.graph.nodes.values()].filter(
    n => n.type === 'plot' && n.attrs.settlement === s.id);
  const dirty = plots.find(plot => {
    const r = plot.attrs.rect;
    return [...k.graph.nodes.values()].some(n => n.attrs?.placement &&
      n.x >= r.x0 && n.x < r.x0 + r.w && n.y >= r.y0 && n.y < r.y0 + r.h);
  });
  if (dirty) {
    assert.equal(constructBuilding(k, g.id, { plotId: dirty.id }, 'hut', 0), null,
      'occupied site must be cleared first (take/chop are the clearing verbs)');
  }
  // Double-build: same plot twice.
  const plot = clearPlot(k, s, p.id);
  assert.ok(constructBuilding(k, g.id, { plotId: plot.id }, 'hut', 0));
  assert.equal(constructBuilding(k, g.id, { plotId: plot.id }, 'hut', 0), null,
    'footprint overlap refused');
});

test('claimed suppression deltas keep the footprint bare across reboot', () => {
  const { k, p, g, s } = scenario();
  const plot = clearPlot(k, s, p.id);
  const b = constructBuilding(k, g.id, { plotId: plot.id }, 'hut', 0);
  assert.ok(b);
  // Reboot: world = f(seed, deltas). Claimed placements must not re-materialize.
  const k2 = new Kernel({ seed: 7, bounds: RECT });
  for (const d of k.deltas.list) k2.deltas.push({ ...d });
  k2.graph.boot(() => { materializeRect(k2, RECT, 0); });
  const fp = b.attrs.footprint;
  for (const n of k2.graph.nodes.values()) {
    if (!n.attrs?.placement) continue;
    assert.ok(!(n.x >= fp.x0 && n.x < fp.x0 + fp.w && n.y >= fp.y0 && n.y < fp.y0 + fp.h),
      `placement ${n.attrs.placement} re-materialized under the building`);
  }
});
