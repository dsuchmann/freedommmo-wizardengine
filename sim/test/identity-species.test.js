import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPECIES, stageAt, YEAR } from '../time/metabolism.js';
import { Kernel } from '../kernel/kernel.js';

const RACES = ['human', 'elf', 'dwarf', 'orc'];

test('L1: four humanoid races exist as full species rows', () => {
  for (const r of RACES) {
    const sp = SPECIES[r];
    assert.ok(sp, r);
    assert.equal(sp.stages.length, 9, `${r} has 9 life stages (fetus = L5 gestation, honest absence)`);
    assert.equal(sp.stages[0][0], 'infant');
    assert.equal(sp.stages[8][0], 'elderly');
    assert.ok(sp.senescence && sp.senescence.burnGrowth === 1.15, 'TIME_SYSTEM death scaling 1.15x/step');
    assert.ok(!sp.seed, 'no reproduction until L5');
    assert.ok(sp.graze, 'foraging instinct (graze machinery)');
  }
});

test('L1: human stage boundaries and burn multipliers match TIME_SYSTEM', () => {
  // [name, startAge(years), burnFactor]
  const expected = [
    ['infant', 0, 0.2], ['toddler', 2, 0.3], ['child', 4, 0.4],
    ['adolescent', 12, 0.6], ['young_adult', 18, 0.8], ['adult', 30, 1.0],
    ['middle_aged', 50, 1.2], ['senior', 65, 1.5], ['elderly', 80, 2.0],
  ];
  for (const [name, years, burnF] of expected) {
    const st = stageAt('human', years * YEAR);
    assert.equal(st[0], name);
    assert.equal(st[3], burnF);
  }
});

test('L1: race lifespans scale the same stage curve (elf 5x, dwarf 2.5x, orc 0.7x)', () => {
  assert.equal(stageAt('elf', 40 * YEAR)[0], 'child');        // 40y elf ~ 8y human
  assert.equal(stageAt('dwarf', 40 * YEAR)[0], 'adolescent'); // 40y dwarf ~ 16y human (young_adult starts 45y)
  assert.equal(stageAt('orc', 40 * YEAR)[0], 'middle_aged');  // 40y orc ~ 57y human
  assert.equal(stageAt('elf', 410 * YEAR)[0], 'elderly');
  // exact boundary identity: stage starts are startAge(years) * lifespan * YEAR
  assert.equal(SPECIES.elf.stages[5][1], 30 * 5 * YEAR);
  assert.equal(SPECIES.dwarf.stages[5][1], 30 * 2.5 * YEAR);
  assert.equal(SPECIES.orc.stages[5][1], Math.round(30 * 0.7 * YEAR));
});

test('L1: a spawned human lives on ambient + foraging and dies of senescence eventually', () => {
  const k = new Kernel({ seed: 7, phi: 4, bounds: { x0: 0, y0: 0, w: 12, h: 12 } });
  let h;
  k.graph.boot(() => {
    for (let x = 1; x < 11; x += 2) for (let y = 1; y < 11; y += 2)
      k.addLiving({ species: 'grass', x, y, R: 2000, body: 100, tick: 0 });
    h = k.addLiving({ species: 'human', x: 5, y: 5, R: 200000, body: 15000, tick: 0, age: 82 * YEAR });
  });
  k.runTo(30 * YEAR);   // senescence 1.15x/year from ~70y must kill well before 108y
  assert.ok(!k.graph.nodes.has(h.id), 'elderly human died of compounding burn');
  assert.ok(k.ledger.events.some(e => e.type === 'death' && e.actor === h.id));
});
