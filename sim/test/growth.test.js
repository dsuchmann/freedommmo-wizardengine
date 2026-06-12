// sim/test/growth.test.js — P5: scheduled, rule-based settlement growth.
// The group acts as a DECLARED collective laborer (no NPC bodies until Pass 4 Life):
// clearing uses the real chop/take verbs with the group as actor — fully conserving
// (chopped corpses stay on the tile ledgered, taken matter sits in group inventory
// which stocks() counts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, pick } from '../world/actions.js';
import { createGroup, contribute } from '../society/groups.js';
import { foundSettlement } from '../society/settlements.js';
import { findSettlementSite } from '../society/suitability.js';
import { materializeRect } from '../world/wire.js';
import { clearPlot, enableGrowth, GROWTH_INTERVAL_DAYS, RESERVE_FLOOR } from '../society/growth.js';
import { DAY } from '../time/metabolism.js';

const RECT = { x0: 926, y0: 0, w: 28, h: 14 };

/** Boot a funded settlement: bush → players pick → contribute to group → found. */
export function growthScenario(fund = 2600) {
  const k = new Kernel({ seed: 7, bounds: RECT });
  let bush;
  k.graph.boot(() => {
    bush = k.addLiving({ species: 'berry_bush', x: 941, y: 1,
                         R: 60000, body: 80000, tick: 0, age: 400 * DAY });
    materializeRect(k, RECT, 0);
  });
  const p = createPlayer(k, 0, { x: 941, y: 1 });
  const pl = k.graph.nodes.get(p.id);
  const g = createGroup(k, 0, { x: 941, y: 0 });
  while (pl.R < fund) { if (pick(k, p.id, bush.id, 0) <= 0) break; }
  assert.ok(pl.R >= fund, `player holds ≥${fund}`);
  assert.equal(contribute(k, p.id, g.id, fund, 0), true);
  const site = findSettlementSite(k, RECT);
  const s = foundSettlement(k, g.id, site, 0);
  assert.ok(s, 'settlement founded');
  return { k, p, g, s, bush };
}

function plotsOf(k, s) {
  return [...k.graph.nodes.values()]
    .filter(n => n.type === 'plot' && n.attrs.settlement === s.id)
    .sort((a, b) => a.id - b.id);
}

function placementsIn(k, rect) {
  return [...k.graph.nodes.values()].filter(n =>
    n.attrs?.placement &&
    n.x >= rect.x0 && n.x < rect.x0 + rect.w &&
    n.y >= rect.y0 && n.y < rect.y0 + rect.h);
}

test('clearPlot: group clears a deeded plot with real verbs, conserving time', () => {
  const { k, g, s } = growthScenario();
  const plot = plotsOf(k, s)[0];
  assert.ok(placementsIn(k, plot.attrs.rect).length > 0, 'seed-7 plot starts dirty');
  const stocks0 = k.stocks(0);
  const tl0 = k.ledger.totals.transferLoss;
  const n = clearPlot(k, g.id, plot.id, 0);
  assert.ok(n > 0, 'clearing did real work');
  assert.equal(placementsIn(k, plot.attrs.rect).length, 0, 'plot is clear');
  // chop conserves into corpses; take conserves into group inventory — zero drift.
  const drift = (k.stocks(0) - stocks0) + (k.ledger.totals.transferLoss - tl0);
  assert.ok(Math.abs(drift) < 1e-6, `conservation drift ${drift}`);
  assert.ok((k.graph.nodes.get(g.id).attrs.inventory ?? []).length > 0,
    'salvaged matter sits in the group inventory (counted by stocks)');
});

test('clearPlot refuses, side-effect-free, on bad group / unowned plot', () => {
  const { k, p, g, s } = growthScenario();
  const plot = plotsOf(k, s)[0];
  const events0 = k.ledger.events.length;
  assert.equal(clearPlot(k, p.id, plot.id, 0), null);        // not a group
  assert.equal(clearPlot(k, g.id, 999999, 0), null);         // no such plot
  plot.attrs.owner = p.id;                                   // deeded away
  assert.equal(clearPlot(k, g.id, plot.id, 0), null);        // group no longer owns
  plot.attrs.owner = g.id;
  assert.equal(k.ledger.events.length, events0, 'refusals emitted nothing');
});

function decisions(k) {
  return k.ledger.events.filter(e => e.type === 'growth_decision')
    .map(e => e.attrs.decision);
}

test('growth loop: scheduled decisions clear then build huts while surplus lasts', () => {
  const { k, g, s } = growthScenario(2600);   // ≈2340 in wallet after gift loss
  assert.equal(enableGrowth(k, s.id, 0), true);
  k.runTo(GROWTH_INTERVAL_DAYS * DAY * 6);
  const d = decisions(k);
  // Priority order is observable: first interval clears plot 1, second builds on it,
  // then the next plot, until surplus (cost 610 + floor 200) runs out.
  assert.equal(d[0], 'clear', 'first decision clears the first dirty plot');
  assert.equal(d[1], 'build_hut', 'second decision builds on the cleared plot');
  const built = [...k.graph.nodes.values()].filter(n => n.type === 'building');
  assert.ok(built.length >= 1, 'at least one hut stands');
  assert.ok(built.length <= plotsOf(k, s).length, 'never more huts than plots');
  for (const e of k.ledger.events.filter(e => e.type === 'growth_decision')) {
    assert.ok(typeof e.attrs.reason === 'string' && e.attrs.reason.length > 0,
      'every decision carries a reason code');
    assert.equal(e.actor, g.id, 'decisions are the founder group acting');
  }
});

test('growth loop: maintenance outranks construction', () => {
  const { k, g, s } = growthScenario(2600);
  assert.equal(enableGrowth(k, s.id, 0), true);
  k.runTo(GROWTH_INTERVAL_DAYS * DAY * 2);     // clear + build first hut
  const hut = [...k.graph.nodes.values()].find(n => n.type === 'building');
  assert.ok(hut);
  hut.attrs.condition = 30;                    // below MAINTAIN_AT
  k.runTo(GROWTH_INTERVAL_DAYS * DAY * 3);
  const d = decisions(k);
  assert.equal(d[2], 'maintain', 'third decision repairs instead of building');
  // Adaptation (logged): maintainBuilding sets condition=100, but building_decay
  // runs daily and may fire once more within the same runTo window (condition→99).
  // The maintain rule fired and restored the hut — 99 is within one decay tick of 100.
  assert.ok(hut.attrs.condition >= 99, `hut restored to near-full condition: ${hut.attrs.condition}`);
});

test('growth loop: underfunded group idles (no construction below floor)', () => {
  const { k, g, s } = growthScenario(2600);
  const group = k.graph.nodes.get(g.id);
  group.R = RESERVE_FLOOR + 10;                // can't afford hut + floor
  assert.equal(enableGrowth(k, s.id, 0), true);
  k.runTo(GROWTH_INTERVAL_DAYS * DAY * 2);
  const d = decisions(k);
  // clearing is free labor → still happens; construction must not.
  assert.ok(!d.includes('build_hut'), 'no hut built below the reserve floor');
  assert.equal([...k.graph.nodes.values()].filter(n => n.type === 'building').length, 0);
});

test('enableGrowth refuses non-settlements and double-enable', () => {
  const { k, g, s } = growthScenario();
  assert.equal(enableGrowth(k, g.id, 0), false);
  assert.equal(enableGrowth(k, s.id, 0), true);
  assert.equal(enableGrowth(k, s.id, 0), false, 'already enabled');
});
