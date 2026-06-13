// sim/test/narrator.test.js — P4 Task 1: causal chain walker + context assembler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { ensureGenesisSettlements, MACRO } from '../world/genesis.js';
import { traceHistory, assembleContext, narrate } from '../story/narrator.js';

/** Boot a kernel with known-good macro-cells that produce settlements at seed=42. */
function bootWithSettlements() {
  const k = new Kernel({ seed: 42 });
  // Known-good macro-cells from chronicle-genesis.test.js:
  // Active: 9,-2  12,0  13,1  13,2
  // Ruined: 9,1  12,1
  const macroKeys = ['9,-2', '12,0', '13,1', '13,2', '9,1', '12,1', '13,-3', '14,-3'];
  for (const mk of macroKeys) {
    const [mx, my] = mk.split(',').map(Number);
    ensureGenesisSettlements(k, `${mx * MACRO},${my * MACRO}`, 0);
  }
  return k;
}

test('traceHistory walks chain from settlement to causal events', () => {
  const k = bootWithSettlements();
  const settlements = [...k.graph.nodes.values()].filter(n => n.type === 'settlement');
  assert.ok(settlements.length > 0, 'need at least one settlement');
  const s = settlements[0];
  const chain = traceHistory(k, s.id);
  assert.ok(chain.length > 0, `settlement #${s.id} should have causal chain, got ${chain.length}`);
  // Chain is root-first: first event ID <= last event ID
  assert.ok(chain[0].id <= chain[chain.length - 1].id, 'chain should be root-first');
  // Last event in chain should be the settlement's createdByEvent
  assert.equal(chain[chain.length - 1].id, s.createdByEvent);
});

test('traceHistory returns empty for boot-scope nodes', () => {
  const k = new Kernel({ seed: 42 });
  // Boot-scope node: no createdByEvent
  k.graph.boot(() => {
    k.graph.createNode({ type: 'test_node', tick: 0, x: 0, y: 0, attrs: {} });
  });
  const bootNode = [...k.graph.nodes.values()].find(n => n.type === 'test_node');
  assert.ok(bootNode, 'boot node exists');
  const chain = traceHistory(k, bootNode.id);
  assert.deepEqual(chain, [], 'boot-scope node has empty chain');
});

test('assembleContext produces structured narrative', () => {
  const k = bootWithSettlements();
  const s = [...k.graph.nodes.values()].find(n => n.type === 'settlement');
  assert.ok(s, 'need a settlement');
  const ctx = assembleContext(k, s.id);
  assert.ok(ctx, 'context should not be null');
  assert.equal(ctx.node.id, s.id);
  assert.equal(ctx.node.type, 'settlement');
  assert.ok(typeof ctx.summary === 'string', 'summary is a string');
  assert.ok(ctx.summary.length > 0, 'summary is non-empty');
  assert.ok(Array.isArray(ctx.events), 'events is an array');
  assert.ok(ctx.events.length > 0, 'events is non-empty');
  for (const ev of ctx.events) {
    assert.ok(ev.eventId, 'event has eventId');
    assert.ok(ev.type, 'event has type');
    assert.ok(typeof ev.domain === 'string', 'event has domain');
    assert.ok(typeof ev.summary === 'string', 'event has summary');
  }
});

test('assembleContext for ruins mentions abandonment', () => {
  const k = bootWithSettlements();
  const ruin = [...k.graph.nodes.values()].find(n => n.type === 'settlement' && n.attrs.state === 'ruined');
  if (!ruin) {
    console.log('  (no ruins found in sweep — skipping ruin-specific assertions)');
    return;
  }
  const ctx = assembleContext(k, ruin.id);
  assert.ok(ctx, 'context should not be null');
  assert.ok(ctx.summary.includes('ruins') || ctx.summary.includes('ruin'),
    `summary should mention ruins: "${ctx.summary}"`);
  // Should have chronicle events including abandonment
  const hasAbandonment = ctx.events.some(e => e.type.includes('abandonment'));
  assert.ok(hasAbandonment, 'ruins context should reference abandonment');
});

test('narrate returns null for nonexistent nodes', () => {
  const k = new Kernel({ seed: 42 });
  const result = narrate(k, 999999);
  assert.equal(result, null, 'narrate should return null for missing node');
});
