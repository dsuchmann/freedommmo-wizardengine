// sim/test/settlements.test.js — P3: founding (provenance + reason codes), territory
// overlap refusal, district zoning, plot ownership primitives, assignment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer } from '../world/actions.js';
import { createGroup } from '../society/groups.js';
import { foundSettlement, assignPlot, TERRITORY_W, TERRITORY_H } from '../society/settlements.js';
import { scoreSite } from '../society/suitability.js';

const MIXED = { x0: 926, y0: 0, w: 28, h: 14 };

function world() {
  const k = new Kernel({ seed: 7, bounds: MIXED });
  const g = createGroup(k, 0, { x: 940, y: 8 });
  return { k, g };
}

test('P3 foundSettlement: settlement node + districts + plots, all provenanced to one event with reason codes', () => {
  const { k, g } = world();
  const stocksBefore = k.stocks(0);
  const s = foundSettlement(k, g.id, { x: 940, y: 8 }, 0);
  assert.ok(s, 'founded');
  assert.equal(s.type, 'settlement');
  assert.equal(s.attrs.tier, 'village');
  assert.equal(s.attrs.founderGroup, g.id);
  // reason codes recomputed at founding — must match an independent rescore
  const independent = scoreSite(k, 940, 8);
  // (trade may differ: founding created the settlement itself — exclude it; assert the static components)
  for (const c of ['water', 'fertility', 'defensibility'])
    assert.deepEqual(s.attrs.reasons[c], independent.reasons[c], `reason ${c} matches independent rescore`);
  // territory centered on site, clipped to bounds
  const t = s.attrs.territory;
  assert.ok(t.w > 0 && t.h > 0 && t.w <= TERRITORY_W && t.h <= TERRITORY_H);
  assert.ok(t.x0 <= 940 && 940 < t.x0 + t.w && t.y0 <= 8 && 8 < t.y0 + t.h, 'site inside territory');
  // districts partition territory (no overlap, full cover), each with kind + reason
  const ds = s.attrs.districts;
  assert.ok(ds.length >= 2, 'at least residential + craft');
  const area = ds.reduce((a, d) => a + d.rect.w * d.rect.h, 0);
  assert.equal(area, t.w * t.h, 'districts exactly cover territory');
  for (const d of ds) { assert.ok(d.kind); assert.ok(d.reason, 'zoning reason code'); }
  // plots: ownership primitives in the residential district, owned by the founder group
  const plots = [...k.graph.nodes.values()].filter(n => n.type === 'plot');
  assert.ok(plots.length >= 1, 'at least one plot');
  for (const p of plots) {
    assert.equal(p.attrs.owner, g.id, 'founder group owns plots initially');
    assert.equal(p.attrs.settlement, s.id);
    assert.ok(p.createdByEvent != null, 'plot provenanced');
  }
  // one founding event targets settlement + all plots
  const ev = k.ledger.events.find(e => e.type === 'settlement_founded');
  assert.ok(ev, 'settlement_founded event');
  assert.equal(ev.actor, g.id, 'no town without a founder');
  assert.equal(ev.targets.length, 1 + plots.length, 'event targets settlement + every plot');
  assert.ok(ev.attrs.reasons, 'reason codes on the event');
  // founding is a declaration: zero time moved
  assert.equal(k.stocks(0), stocksBefore, 'founding conserves exactly (no time moved)');
});

test('P3 foundSettlement refusals: missing group, water site, overlapping territory — side-effect-free', () => {
  const { k, g } = world();
  const evCount0 = k.ledger.events.length;
  assert.equal(foundSettlement(k, 99999, { x: 940, y: 8 }, 0), null, 'missing group');
  assert.equal(foundSettlement(k, g.id, { x: 930, y: 0 }, 0), null, 'water site refused');
  assert.equal(k.ledger.events.length, evCount0, 'no events on refusal');
  assert.equal([...k.graph.nodes.values()].filter(n => n.type === 'settlement').length, 0);
  // found one for real, then refuse the overlap
  const s = foundSettlement(k, g.id, { x: 940, y: 8 }, 0);
  assert.ok(s);
  const evCount1 = k.ledger.events.length;
  assert.equal(foundSettlement(k, g.id, { x: 941, y: 8 }, 0), null, 'overlapping territory refused');
  assert.equal(k.ledger.events.length, evCount1, 'no events on overlap refusal');
});

test('P3 assignPlot: founder group deeds a plot to a member; refusals side-effect-free', () => {
  const { k, g } = world();
  const p = createPlayer(k, 0, { x: 940, y: 8 });
  const s = foundSettlement(k, g.id, { x: 940, y: 8 }, 0);
  const plot = [...k.graph.nodes.values()].find(n => n.type === 'plot');
  assert.equal(assignPlot(k, g.id, plot.id, p.id, 0), true);
  assert.equal(plot.attrs.owner, p.id, 'member now owns the plot');
  assert.ok(k.ledger.events.some(e => e.type === 'plot_assigned'), 'assignment is a ledger event');
  const evCount = k.ledger.events.length;
  assert.equal(assignPlot(k, g.id, plot.id, p.id, 0), false, 'group no longer owns it — refused');
  assert.equal(assignPlot(k, g.id, 99999, p.id, 0), false, 'missing plot');
  assert.equal(assignPlot(k, 99999, plot.id, p.id, 0), false, 'missing group');
  assert.equal(k.ledger.events.length, evCount, 'no events on refusals');
  assert.equal(plot.attrs.owner, p.id, 'owner unchanged by refusals');
});
