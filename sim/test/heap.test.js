import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventHeap } from '../kernel/heap.js';

test('pops in tick order', () => {
  const h = new EventHeap();
  h.push({ tick: 30, nodeId: 1, kind: 'a', ver: 0 });
  h.push({ tick: 10, nodeId: 2, kind: 'a', ver: 0 });
  h.push({ tick: 20, nodeId: 3, kind: 'a', ver: 0 });
  assert.equal(h.pop().tick, 10);
  assert.equal(h.pop().tick, 20);
  assert.equal(h.pop().tick, 30);
  assert.equal(h.pop(), undefined);
});

test('ties break by nodeId then kind, regardless of insert order', () => {
  const mk = () => {
    const h = new EventHeap();
    return h;
  };
  const items = [
    { tick: 5, nodeId: 9, kind: 'b', ver: 0 },
    { tick: 5, nodeId: 2, kind: 'z', ver: 0 },
    { tick: 5, nodeId: 9, kind: 'a', ver: 0 },
  ];
  for (const perm of [[0,1,2],[2,1,0],[1,2,0]]) {
    const h = mk();
    for (const i of perm) h.push(items[i]);
    assert.deepEqual(
      [h.pop(), h.pop(), h.pop()].map(e => [e.nodeId, e.kind]),
      [[2,'z'],[9,'a'],[9,'b']]
    );
  }
});

test('peek does not remove', () => {
  const h = new EventHeap();
  h.push({ tick: 1, nodeId: 1, kind: 'a', ver: 0 });
  assert.equal(h.peek().tick, 1);
  assert.equal(h.size, 1);
});
