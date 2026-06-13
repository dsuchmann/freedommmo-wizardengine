// sim/test/chronicle-genesis.test.js — P3: chronicle-driven genesis integration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { ensureGenesisSettlements, macroKeyOf, MACRO } from '../world/genesis.js';
import { REGION } from '../lod/aggregate.js';

function makeKernel(seed = 42) {
  return new Kernel({ seed });
}

// Known-good macro-cells from empirical scan: seed=42
// 9,-2: active+candidate, 12,0: active+candidate, 13,1: active+candidate
// 9,1: ruined+candidate, 12,1: ruined+candidate
// Use specific region keys that map to these macro-cells.

test('chronicle genesis produces settlements at known-good cells', () => {
  const k = makeKernel();
  // These macro-cells are known to have active+candidate at seed=42
  const macroKeys = ['9,-2', '12,0', '13,1', '13,2'];
  for (const mk of macroKeys) {
    const [mx, my] = mk.split(',').map(Number);
    const regionKey = `${mx * MACRO},${my * MACRO}`;
    ensureGenesisSettlements(k, regionKey, 0);
  }
  const settlements = [...k.graph.nodes.values()].filter(n => n.type === 'settlement');
  assert.ok(settlements.length > 0, `expected settlements, got ${settlements.length}`);
  // Active settlements have founder groups
  const active = settlements.filter(s => s.attrs.state === 'active');
  for (const s of active) {
    assert.ok(s.attrs.founderGroup, 'active settlement has founder group');
  }
});

test('chronicle events recorded in kernel ledger', () => {
  const k = makeKernel();
  // A few cells with known chronicle events
  const macroKeys = ['9,-2', '12,0', '9,1'];
  for (const mk of macroKeys) {
    const [mx, my] = mk.split(',').map(Number);
    ensureGenesisSettlements(k, `${mx * MACRO},${my * MACRO}`, 0);
  }
  const chronicleEvents = k.ledger.events.filter(e => e.type.startsWith('chronicle_'));
  assert.ok(chronicleEvents.length > 0, `expected chronicle events, got ${chronicleEvents.length}`);
  for (const ev of chronicleEvents) {
    assert.ok(typeof ev.attrs.chronicleId === 'number', 'chronicle event has chronicleId');
    assert.ok(typeof ev.attrs.domain === 'string', 'chronicle event has domain');
  }
});

test('ruins have causal event references', () => {
  const k = makeKernel();
  // Known ruined+candidate cells: 9,1 and 12,1 at seed=42
  const macroKeys = ['9,1', '12,1', '13,-3', '14,-3'];
  for (const mk of macroKeys) {
    const [mx, my] = mk.split(',').map(Number);
    ensureGenesisSettlements(k, `${mx * MACRO},${my * MACRO}`, 0);
  }
  const ruins = [...k.graph.nodes.values()].filter(n => n.type === 'settlement' && n.attrs.state === 'ruined');
  if (ruins.length > 0) {
    for (const r of ruins) {
      assert.ok(r.createdByEvent, 'ruin has causal event');
      assert.ok(r.attrs.chronicle, 'ruin has chronicle IDs');
      assert.ok(Array.isArray(r.attrs.chronicle), 'chronicle is array');
    }
  }
  const all = [...k.graph.nodes.values()].filter(n => n.type === 'settlement');
  console.log(`  chronicle-genesis: ${all.filter(s => s.attrs.state === 'active').length} active, ${ruins.length} ruined`);
});

test('exactly-once: second call to same macro-cell is a no-op', () => {
  const k = makeKernel();
  const key = `${9 * MACRO},${-2 * MACRO}`;
  ensureGenesisSettlements(k, key, 0);
  const countBefore = k.graph.nodes.size;
  const eventsBefore = k.ledger.events.length;
  ensureGenesisSettlements(k, key, 0);
  // Also call with a different region key that maps to the same macro-cell
  ensureGenesisSettlements(k, `${9 * MACRO + 1},${-2 * MACRO + 1}`, 0);
  assert.equal(k.graph.nodes.size, countBefore, 'no new nodes from repeat calls');
  assert.equal(k.ledger.events.length, eventsBefore, 'no new events');
});
