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
import { clearPlot } from '../society/growth.js';
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
