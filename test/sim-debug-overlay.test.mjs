import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDebugDrawables, accumulateEvents } from '../src/render/sim-debug-overlay.js';

const fakeSim = () => ({
  tick: 120,
  entities: new Map([
    ['p1', { id: 'p1', type: 'path', x: 10, y: 11, wear: 4 }],
    ['p2', { id: 'p2', type: 'path', x: 10, y: 12, wear: 0 }],
    ['r1', { id: 'r1', type: 'matter', archetype: 'road_segment', x: 20, y: 21 }],
    ['m1', { id: 'm1', type: 'matter', archetype: 'boulder', x: 30, y: 31 }],
    ['n1', { id: 'n1', type: 'npc', x: 40, y: 41 }],
  ]),
  deltas: [
    { id: 1, tick: 90, x: 10, y: 11, target: 'p1', kind: 'worn', attrs: {} },
    { id: 2, tick: 95, x: 20, y: 21, target: 'r1', kind: 'paved', attrs: {} },
  ],
});

test('collector extracts paths with wear, road segments, and deltas — nothing else', () => {
  const d = collectDebugDrawables(fakeSim());
  assert.deepEqual(d.paths, [{ x: 10, y: 11, wear: 4 }, { x: 10, y: 12, wear: 0 }]);
  assert.deepEqual(d.roads, [{ x: 20, y: 21 }]);
  assert.deepEqual(d.deltas, [{ x: 10, y: 11, kind: 'worn' }, { x: 20, y: 21, kind: 'paved' }]);
});

test('collector is null-safe before the sim connects', () => {
  assert.deepEqual(collectDebugDrawables(null),
    { paths: [], roads: [], deltas: [], settlements: [], plots: [], buildings: [], crossings: [], tick: -1 });
  assert.deepEqual(collectDebugDrawables({ entities: new Map(), deltas: null, tick: 3 }).deltas, []);
});

const structureSim = () => ({
  tick: 200,
  entities: new Map([
    ['s1', { id: 's1', type: 'settlement', x: 935, y: 4, tier: 'village',
             territory: { x0: 930, y0: 0, w: 12, h: 10 },
             districts: [{ kind: 'residential', rect: { x0: 935, y0: 0, w: 6, h: 10 } },
                         { kind: 'craft', rect: { x0: 930, y0: 0, w: 5, h: 10 } }] }],
    ['pl1', { id: 'pl1', type: 'plot', x: 935, y: 4,
              rect: { x0: 935, y0: 4, w: 5, h: 4 }, district: 'residential', owner: 3, settlement: 's1' }],
    ['b1', { id: 'b1', type: 'building', x: 935, y: 4, template: 'hut',
             footprint: { x0: 935, y0: 4, w: 5, h: 4 },
             stamps: [{ x: 935, y: 4, piece: 'wall', walkable: false },
                      { x: 936, y: 7, piece: 'door', walkable: true },
                      { x: 936, y: 5, piece: 'floor', walkable: true }] }],
    ['c1', { id: 'c1', type: 'matter', archetype: 'ford', x: 931, y: 2 }],
    ['c2', { id: 'c2', type: 'matter', archetype: 'bridge', x: 931, y: 3 }],
  ]),
  deltas: [],
});

test('collector extracts settlements, plots, buildings, and crossings', () => {
  const d = collectDebugDrawables(structureSim());
  assert.deepEqual(d.settlements, [{ x: 935, y: 4, tier: 'village',
    territory: { x0: 930, y0: 0, w: 12, h: 10 },
    districts: [{ kind: 'residential', rect: { x0: 935, y0: 0, w: 6, h: 10 } },
                { kind: 'craft', rect: { x0: 930, y0: 0, w: 5, h: 10 } }] }]);
  assert.deepEqual(d.plots, [{ rect: { x0: 935, y0: 4, w: 5, h: 4 }, owner: 3, district: 'residential' }]);
  assert.deepEqual(d.buildings, [{ template: 'hut', footprint: { x0: 935, y0: 4, w: 5, h: 4 },
    stamps: [{ x: 935, y: 4, piece: 'wall', walkable: false },
             { x: 936, y: 7, piece: 'door', walkable: true },
             { x: 936, y: 5, piece: 'floor', walkable: true }] }]);
  assert.deepEqual(d.crossings, [{ x: 931, y: 2, kind: 'ford' }, { x: 931, y: 3, kind: 'bridge' }]);
});

test('collector stays null-safe and backwards-compatible with the new keys', () => {
  const d = collectDebugDrawables(null);
  assert.deepEqual(d.settlements, []);
  assert.deepEqual(d.plots, []);
  assert.deepEqual(d.buildings, []);
  assert.deepEqual(d.crossings, []);
});

test('event accumulator keeps a capped, deduped ledger across replaced batches', () => {
  const seen = [];
  accumulateEvents(seen, [{ id: 1, tick: 10, type: 'settlement_founded' }, { id: 2, tick: 10, type: 'trade' }]);
  accumulateEvents(seen, [{ id: 2, tick: 10, type: 'trade' }, { id: 3, tick: 11, type: 'road_funded' }]);
  assert.deepEqual(seen.map(e => e.id), [1, 2, 3]); // deduped by id, order kept
  for (let i = 0; i < 80; i++) accumulateEvents(seen, [{ id: 100 + i, tick: 12 + i, type: 'x' }]);
  assert.equal(seen.length, 50);                    // capped at 50, oldest dropped
  assert.equal(seen[0].id, 130); // 83 unique events total (1,2,3,100..179) minus 33 oldest
});
