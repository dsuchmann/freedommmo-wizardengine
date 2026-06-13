// sim/test/chronicle.test.js — P3 L0+L2: world epochs + regional chronicle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldEpochs } from '../chronicle/epochs.js';
import { regionChronicle, settlementState, CHRONICLE_EVENTS } from '../chronicle/chronicle.js';
import { macroCellPeoples } from '../chronicle/races.js';
import { mix } from '../kernel/rng.js';

test('worldEpochs is pure f(seed)', () => {
  const a = worldEpochs(42);
  const b = worldEpochs(42);
  assert.deepEqual(a, b, 'same seed → same epochs');
  assert.ok(a.length >= 4, 'at least creation + 3 epochs');
  assert.equal(a.find(e => e.type === 'creation') != null, true, 'has creation epoch');
});

test('worldEpochs: different seeds differ', () => {
  const a = worldEpochs(42);
  const b = worldEpochs(999);
  assert.notDeepEqual(a, b, 'different seeds → different epochs');
});

test('worldEpochs: sorted by age descending', () => {
  const epochs = worldEpochs(42);
  for (let i = 1; i < epochs.length; i++) {
    assert.ok(epochs[i - 1].age >= epochs[i].age, 'age descending');
  }
});

test('regionChronicle generates typed events with deterministic IDs', () => {
  const epochs = worldEpochs(42);
  const peoples = macroCellPeoples(42, '8,0', epochs);
  const climate = { moisture: 0.6, heat: 0.5, elevation: 0.5 };
  const chronicle = regionChronicle(42, '8,0', peoples, climate);

  assert.ok(Array.isArray(chronicle), 'returns array');
  for (const ev of chronicle) {
    assert.ok(typeof ev.id === 'number', 'event has numeric id');
    assert.ok(typeof ev.type === 'string', 'event has type');
    assert.ok(CHRONICLE_EVENTS.has(ev.type), `event type "${ev.type}" in CHRONICLE_EVENTS`);
    assert.ok(typeof ev.domain === 'string', 'event has domain');
    assert.ok(typeof ev.age === 'number', 'event has age');
    assert.ok(typeof ev.severity === 'number', 'event has severity');
  }
});

test('regionChronicle is deterministic', () => {
  const epochs = worldEpochs(42);
  const peoples = macroCellPeoples(42, '8,0', epochs);
  const climate = { moisture: 0.6, heat: 0.5, elevation: 0.5 };
  const a = regionChronicle(42, '8,0', peoples, climate);
  const b = regionChronicle(42, '8,0', peoples, climate);
  assert.deepEqual(a, b, 'same inputs → same chronicle');
});

test('event IDs match mix(seed, 2, cellHash, ordinal)', () => {
  const epochs = worldEpochs(42);
  const peoples = macroCellPeoples(42, '8,0', epochs);
  const climate = { moisture: 0.6, heat: 0.5, elevation: 0.5 };
  const chronicle = regionChronicle(42, '8,0', peoples, climate);
  if (chronicle.length === 0) return; // skip if this cell has no events

  const [mx, my] = [8, 0];
  const cellHash = mix(mx, my);
  for (let i = 0; i < chronicle.length; i++) {
    const expected = mix(42, 2, cellHash, i);
    assert.equal(chronicle[i].id, expected, `event ${i} id matches mix formula`);
  }
});

test('wilderness: empty peoples → empty chronicle → wilderness state', () => {
  const climate = { moisture: 0.6, heat: 0.5, elevation: 0.5 };
  const chronicle = regionChronicle(42, '8,0', [], climate);
  assert.equal(chronicle.length, 0, 'no events for empty peoples');
  assert.equal(settlementState(chronicle), 'wilderness');
});

test('some chronicles produce abandonments (scan 200 macro-cells)', () => {
  const epochs = worldEpochs(42);
  let abandonments = 0;
  let active = 0;
  let wilderness = 0;

  for (let mx = 0; mx < 20; mx++) {
    for (let my = 0; my < 10; my++) {
      const key = `${mx},${my}`;
      const peoples = macroCellPeoples(42, key, epochs);
      const climate = { moisture: 0.3 + mx * 0.03, heat: 0.3 + my * 0.05, elevation: 0.5 };
      const chronicle = regionChronicle(42, key, peoples, climate);
      const state = settlementState(chronicle);
      if (state === 'ruined') abandonments++;
      else if (state === 'active') active++;
      else wilderness++;
    }
  }

  assert.ok(abandonments > 0, `expected some abandonments, got ${abandonments} (active=${active}, wild=${wilderness})`);
  assert.ok(active > 0, `expected some active, got ${active}`);
});

test('settlementState returns correct values', () => {
  assert.equal(settlementState([]), 'wilderness');
  assert.equal(settlementState(null), 'wilderness');
  assert.equal(settlementState([{ type: 'abandonment' }]), 'ruined');
  assert.equal(settlementState([{ type: 'ancient_founding' }]), 'active');
  assert.equal(settlementState([{ type: 'ancient_founding' }, { type: 'flourishing' }]), 'active');
  assert.equal(settlementState([{ type: 'ancient_founding' }, { type: 'abandonment' }]), 'ruined');
  assert.equal(settlementState([{ type: 'abandonment' }, { type: 'refounding' }]), 'active');
});
