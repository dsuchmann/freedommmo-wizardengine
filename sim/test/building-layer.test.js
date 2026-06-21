// sim/test/building-layer.test.js — pure partition of buildings into behind/in-front of the player.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitBuildingsByPlayer } from '../../src/render/building-layer.js';

// Minimal fake building: south baseline = y + footprint.boundingBox.h.
function b(id, y, h) { return { id, y, footprint: { boundingBox: { w: 4, h } } }; }

test('partitions by south baseline vs player Y', () => {
  const north = b('north', 10, 4);  // baseline 14 — well north of player
  const onLine = b('online', 18, 2); // baseline 20 — exactly player Y → in front
  const south = b('south', 22, 4);  // baseline 26 — south of player
  const { behind, front } = splitBuildingsByPlayer([south, north, onLine], 20);
  assert.deepEqual(behind.map(x => x.id), ['north']);
  assert.deepEqual(front.map(x => x.id), ['online', 'south']);
});

test('each set is south-sorted (farther first)', () => {
  const a = b('a', 30, 4); // baseline 34
  const c = b('c', 40, 4); // baseline 44
  const { front } = splitBuildingsByPlayer([c, a], 10);
  assert.deepEqual(front.map(x => x.id), ['a', 'c']); // 34 before 44
});

test('skips buildings without a bounding box', () => {
  const ok = b('ok', 30, 4);
  const bad = { id: 'bad', y: 30, footprint: {} };
  const { behind, front } = splitBuildingsByPlayer([ok, bad], 10);
  assert.equal(behind.length + front.length, 1);
  assert.equal(front[0].id, 'ok');
});
