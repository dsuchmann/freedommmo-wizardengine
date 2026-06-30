import assert from 'node:assert';
import { wangSlotKey } from '../src/render/wang-atlas.js';
// A slot key uniquely identifies one 32x32 tile: biome-asset, wang level, corner mask 0..63.
const a = wangSlotKey('grassland', 'wang', 0);
const b = wangSlotKey('grassland', 'wang', 0);
const c = wangSlotKey('grassland', 'wang_50', 0);
const d = wangSlotKey('grassland', 'wang', 63);
assert.strictEqual(a, b, 'deterministic');
assert.notStrictEqual(a, c, 'level matters');
assert.notStrictEqual(a, d, 'mask matters');
console.log('PASS wang-atlas-slot');
