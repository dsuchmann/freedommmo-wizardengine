// sim/test/choreography-library.test.js — validates every authored program against the rig.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOTION_MANIFEST } from '../../src/life/choreography/manifest.js';
import { loadRig } from '../../src/life/rig.js';
import { loadProgram } from '../life/motion/program.js';
import { validateProgram } from '../life/motion/program.js';
import { validateChoreography } from '../life/motion/validator.js';

const CHOREO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'life', 'choreography');
const rig = loadRig('humanoid');

// Collect all *.json files except manifest.js (it's .js not .json)
const jsonFiles = readdirSync(CHOREO_DIR)
  .filter(f => f.endsWith('.json'))
  .map(f => f.replace(/\.json$/, ''));

test('manifest ids are unique', () => {
  const ids = MOTION_MANIFEST.map(e => e.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, `duplicate manifest ids: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
});

test('every JSON file id appears in the manifest and vice versa', () => {
  const manifestIds = new Set(MOTION_MANIFEST.map(e => e.id));
  const fileIds = new Set(jsonFiles);

  for (const id of fileIds) {
    assert.ok(manifestIds.has(id), `JSON file "${id}.json" has no manifest entry`);
  }
  for (const id of manifestIds) {
    assert.ok(fileIds.has(id), `manifest entry "${id}" has no corresponding JSON file`);
  }
});

test('every manifest entry loads, passes validateProgram, and passes validateChoreography', () => {
  for (const entry of MOTION_MANIFEST) {
    const p = loadProgram(entry.id);
    const structViolations = validateProgram(p);
    assert.deepEqual(structViolations, [], `${entry.id}: validateProgram violations: ${structViolations.join('; ')}`);

    const result = validateChoreography(rig, p);
    assert.deepEqual(
      result,
      { verdict: 'OK', path: null },
      `${entry.id}: validateChoreography => verdict=${result.verdict} path=${result.path}`
    );
  }
});
