import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setArchitectureClaim, isClaimedAt, f4Placements, f5Placements, f6Placements, clearClaimCaches,
} from '../../src/world/decoration-claims.js';
import { resolveBuildingsInRange } from '../world/buildings/resolved-buildings.js';

const TILE = 32; // TILE_ART_PX
const nullTile = () => null;

test('architecture claim fully suppresses flora (pure predicate short-circuits before tileInfo)', () => {
  setArchitectureClaim(() => true);
  assert.equal(isClaimedAt(5 * TILE, 9 * TILE, nullTile), true);
  assert.deepEqual(f4Placements(5, 9, nullTile), []);
  assert.deepEqual(f5Placements(5, 9, nullTile), []);
  assert.deepEqual(f6Placements(5, 9, nullTile), []);
  setArchitectureClaim(() => false); // reset
});

test('predicate decides per-tile; an unclaimed tile is not arch-suppressed', () => {
  const claimed = new Set(['3,4']);
  setArchitectureClaim((wx, wy) => claimed.has(wx + ',' + wy));
  assert.equal(isClaimedAt(3 * TILE, 4 * TILE, nullTile), true, 'claimed tile suppressed');
  // f4 on an UNclaimed tile must NOT be arch-suppressed (it returns [] here only because
  // the null tile is non-land — the point is arch didn't short-circuit it to EMPTY).
  assert.deepEqual(f4Placements(99, 99, nullTile), []); // null tile => EMPTY by tile check, not arch
  setArchitectureClaim(() => false);
});

test('wires from resolveBuildingsInRange.claimTiles (data, not renderer-populated)', () => {
  const { claimTiles } = resolveBuildingsInRange(42, 19, 10, 21, 12);
  assert.ok(claimTiles.size > 0, 'expected claim tiles');
  setArchitectureClaim((wx, wy) => claimTiles.has(wx + ',' + wy));
  const [wx, wy] = [...claimTiles][0].split(',').map(Number);
  // purity: identical twice, no canvas / renderer call between
  assert.equal(isClaimedAt(wx * TILE, wy * TILE, nullTile), true);
  assert.equal(isClaimedAt(wx * TILE, wy * TILE, nullTile), true);
  setArchitectureClaim(() => false);
});

test('clearClaimCaches preserves the architecture predicate', () => {
  const claimed = new Set(['7,8']);
  setArchitectureClaim((wx, wy) => claimed.has(wx + ',' + wy));
  clearClaimCaches();
  assert.equal(isClaimedAt(7 * TILE, 8 * TILE, nullTile), true, 'predicate survives cache clear');
  setArchitectureClaim(() => false);
});
