import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPECIES, CHANNEL_EFF, materialize, transfer, DAY } from '../time/metabolism.js';
import { Ledger } from '../store/ledger.js';

function livingNode(over = {}) {
  return { id: 1, type: 'grass', R: 100, r: 0.2, lastTick: 0, ver: 0,
    attrs: { species: 'grass', body: 50, bodyRate: 0.1 }, ...over };
}

test('species table has the Plan A species with required fields', () => {
  for (const s of ['grass', 'berry_bush', 'grazer']) {
    const sp = SPECIES[s];
    for (const f of ['demand','burn','growFrac','maxBody','stages','senescence','seed','embodiedDecayDays'])
      assert.ok(f in sp, `${s}.${f} missing`);
  }
});

test('materialize advances R and body linearly and is idempotent at same tick', () => {
  const l = new Ledger();
  const n = livingNode();
  materialize(n, 1000, l);
  assert.equal(n.R, 100 + 0.2 * 1000);
  assert.equal(n.attrs.body, 50 + 0.1 * 1000);
  assert.equal(n.lastTick, 1000);
  const r1 = n.R;
  materialize(n, 1000, l);
  assert.equal(n.R, r1);
});

test('corpse materialization decays E exponentially and counts decayed', () => {
  const l = new Ledger();
  const c = { id: 2, type: 'corpse', R: null, r: 0, lastTick: 0, ver: 0,
    attrs: { E: 80, decayHalflifeTicks: 10 * DAY } };
  materialize(c, 10 * DAY, l);
  assert.ok(Math.abs(c.attrs.E - 40) < 1e-9);
  assert.ok(Math.abs(l.totals.decayed - 40) < 1e-9);
});

test('transfer moves tu at channel efficiency, loss counted', () => {
  const l = new Ledger();
  const got = transfer(20, 'harvest', l);   // 50% channel
  assert.equal(got, 20 * CHANNEL_EFF.harvest);
  assert.ok(Math.abs(l.totals.transferLoss - 10) < 1e-9);
});
