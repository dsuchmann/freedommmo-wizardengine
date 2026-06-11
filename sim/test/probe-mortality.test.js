import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { DAY, YEAR } from '../time/metabolism.js';

test('PROBE 2: 1000 uncrowded grass — senescence yields a plausible lifespan distribution', () => {
  const k = new Kernel({ seed: 1, phi: 4, bounds: { x0: 0, y0: 0, w: 40, h: 25 } });
  k.graph.boot(() => {
    // one per tile: no rationing at start, original deaths driven by senescence
    for (let i = 0; i < 1000; i++) {
      k.addLiving({ species: 'grass', x: i % 40, y: Math.floor(i / 40), R: 800, body: 20, tick: 0 });
    }
  });
  k.runTo(1 * YEAR);
  // offspring exist (seeding) — count deaths of the ORIGINAL 1000 only (ids 1..1000)
  const deaths = k.ledger.events.filter(e => e.type === 'death' && e.actor <= 1000);
  assert.equal(deaths.length, 1000, 'every original grass eventually dies');
  const lifespans = deaths.map(e => e.tick / DAY);
  lifespans.sort((a, b) => a - b);
  const median = lifespans[500];
  assert.ok(median > 60 && median < 400, `median lifespan ${median} days plausible`);
  const spread = lifespans[900] - lifespans[100];
  assert.ok(spread > 10, `distribution has spread (${spread} days), not a synchronized cliff`);
  // corpses decay: mass returns to ambient
  const corpses = [...k.graph.nodes.values()].filter(n => n.type === 'corpse');
  for (const c of corpses) assert.ok(c.attrs.E < 1000, 'corpses are decaying');
});
