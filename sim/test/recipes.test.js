// sim/test/recipes.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { canonicalizeRecipe, recipeNodeOf, knowsRecipe, teachRecipe } from '../matter/recipes.js';

const makeKernel = () => new Kernel({ seed: 7, phi: 4, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });

test('first success creates ONE canonical recipe node with event provenance', () => {
  const k = makeKernel();
  const evId = k.ledger.emit({ tick: 0, type: 'combine', actor: 1, targets: [], magnitude: 0 });
  const id = canonicalizeRecipe(k, 'log+log', 'composite:cellulose+lignin', 1, evId, 0);
  const node = k.graph.nodes.get(id);
  assert.equal(node.type, 'recipe');
  assert.equal(node.createdByEvent, evId);   // provenance §5.4 — graph.js sets createdByEvent from causeEventId
  assert.deepEqual(node.attrs, { signature: 'log+log', form: 'composite:cellulose+lignin', knownBy: [1], noFlux: true });
  // Re-discovery by someone else: SAME node, knownBy grows, no duplicate
  const evId2 = k.ledger.emit({ tick: 5, type: 'combine', actor: 2, targets: [], magnitude: 0 });
  const id2 = canonicalizeRecipe(k, 'log+log', 'composite:cellulose+lignin', 2, evId2, 5);
  assert.equal(id2, id);
  assert.deepEqual(k.graph.nodes.get(id).attrs.knownBy, [1, 2]);
  assert.equal([...k.graph.nodes.values()].filter(n => n.type === 'recipe').length, 1);
});

test('recipeNodeOf finds by signature; knowsRecipe is owner-scoped', () => {
  const k = makeKernel();
  const evId = k.ledger.emit({ tick: 0, type: 'combine', actor: 1, targets: [], magnitude: 0 });
  canonicalizeRecipe(k, 'log+log', 'composite:cellulose+lignin', 1, evId, 0);
  assert.ok(recipeNodeOf(k, 'log+log'));
  assert.equal(recipeNodeOf(k, 'stone+stone'), null);
  assert.equal(knowsRecipe(k, 1, 'log+log'), true);
  assert.equal(knowsRecipe(k, 2, 'log+log'), false);   // no telepathy
});

test('teachRecipe moves knowledge through an explicit event; teacher must know it', () => {
  const k = makeKernel();
  const evId = k.ledger.emit({ tick: 0, type: 'combine', actor: 1, targets: [], magnitude: 0 });
  canonicalizeRecipe(k, 'log+log', 'composite:cellulose+lignin', 1, evId, 0);
  assert.equal(teachRecipe(k, 2, 3, 'log+log', 10), false, 'non-knower cannot teach');
  assert.equal(teachRecipe(k, 1, 2, 'log+log', 10), true);
  assert.equal(knowsRecipe(k, 2, 'log+log'), true);
  const ev = k.ledger.events.at(-1);
  assert.equal(ev.type, 'teach');
  assert.deepEqual([ev.actor, ev.targets], [1, [2]]);
  assert.equal(teachRecipe(k, 1, 2, 'log+log', 11), true, 'idempotent re-teach ok');
  assert.deepEqual(recipeNodeOf(k, 'log+log').attrs.knownBy, [1, 2], 'no duplicates');
});
