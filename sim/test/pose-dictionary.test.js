import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rig = JSON.parse(readFileSync('src/life/rigs/humanoid.json', 'utf8'));
const poses = JSON.parse(readFileSync('src/life/choreography/poses.json', 'utf8'));

test('poses.json is a non-empty array of valid poses', () => {
  assert.ok(Array.isArray(poses));
  assert.ok(poses.length >= 30, `expected >= 30 poses, got ${poses.length}`);
});

test('every pose has required fields', () => {
  for (const p of poses) {
    assert.ok(p.id, `pose missing id: ${JSON.stringify(p)}`);
    assert.ok(typeof p.joints === 'object', `${p.id}: joints must be object`);
    assert.ok(p.desc, `${p.id}: missing desc`);
    assert.ok(Array.isArray(p.tags), `${p.id}: tags must be array`);
    assert.ok(p.category, `${p.id}: missing category`);
  }
});

test('every pose id is unique', () => {
  const ids = poses.map(p => p.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepStrictEqual(dupes, [], `duplicate ids: ${dupes}`);
});

test('all joint values are within rig limits', () => {
  for (const p of poses) {
    for (const [j, deg] of Object.entries(p.joints)) {
      const lim = rig.joints[j];
      assert.ok(lim, `${p.id}: unknown joint ${j}`);
      assert.ok(deg >= lim.min && deg <= lim.max, `${p.id}: ${j}=${deg} out of [${lim.min},${lim.max}]`);
    }
  }
});

test('rest pose exists with empty joints', () => {
  const rest = poses.find(p => p.id === 'rest');
  assert.ok(rest, 'rest pose must exist');
  assert.deepStrictEqual(rest.joints, {});
});
