import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Graph } from '../store/graph.js';
import { openDb } from '../store/db.js';

test('provenance rule: caused nodes require an event, baseline only in boot scope', () => {
  const g = new Graph();
  assert.throws(() => g.createNode({ type: 'chest', tick: 5 }), /provenance/);
  const n1 = g.createNode({ type: 'chest', tick: 5, causeEventId: 77 });
  assert.equal(n1.createdByEvent, 77);
  let n2;
  g.boot(() => { n2 = g.createNode({ type: 'tree', tick: 0, x: 3, y: 4 }); });
  assert.equal(n2.createdByEvent, null);
  assert.throws(() => g.createNode({ type: 'tree', tick: 0 }), /provenance/);
});

test('nodes get sequential ids and live in spatial index', () => {
  const g = new Graph();
  g.boot(() => {
    const a = g.createNode({ type: 'grass', tick: 0, x: 10, y: 10 });
    const b = g.createNode({ type: 'grass', tick: 0, x: 10.4, y: 10.4 });
    g.createNode({ type: 'grass', tick: 0, x: 500, y: 500 });
    assert.equal(b.id, a.id + 1);
  });
  const near = g.nodesNear(10, 10, 2);
  assert.equal(near.length, 2);
});

test('edges connect members with roles', () => {
  const g = new Graph();
  let a, b, e;
  g.boot(() => {
    a = g.createNode({ type: 'bush', tick: 0, x: 0, y: 0 });
    b = g.createNode({ type: 'bush', tick: 0, x: 1, y: 0 });
    e = g.createEdge({ type: 'kin', tick: 0, members: [[a.id, 'parent'], [b.id, 'child']] });
  });
  assert.deepEqual(g.edgesOf(a.id).map(x => x.id), [e.id]);
  assert.deepEqual(g.edgesOf(b.id).map(x => x.id), [e.id]);
});

test('flush persists nodes/edges to SQLite and removeNode drops them', () => {
  const g = new Graph();
  let a;
  g.boot(() => {
    a = g.createNode({ type: 'grass', tick: 0, x: 1, y: 1, R: 50, r: 0.1, attrs: { body: 5 } });
    g.createNode({ type: 'grass', tick: 0, x: 2, y: 1 });
  });
  g.removeNode(a.id);
  const db = openDb(':memory:');
  g.flush(db);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM nodes').get().c, 1);
  // meta.tick is no longer written by graph.flush — it is the checkpoint commit marker,
  // written last by checkpoint() only after all flushes complete.
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='tick'").get(), undefined);
  db.close();
});

test('removeNode purges the edge from surviving members', () => {
  const g = new Graph();
  let a, b;
  g.boot(() => {
    a = g.createNode({ type: 'bush', tick: 0, x: 0, y: 0 });
    b = g.createNode({ type: 'bush', tick: 0, x: 1, y: 0 });
    g.createEdge({ type: 'kin', tick: 0, members: [[a.id, 'parent'], [b.id, 'child']] });
  });
  g.removeNode(a.id);
  assert.deepEqual(g.edgesOf(b.id), []);
});
