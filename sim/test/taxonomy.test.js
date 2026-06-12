// sim/test/taxonomy.test.js — the taxonomy module must agree with the kernel's species tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPINE, CORE_VISUAL, SPINE_TO_VISUAL, CONDITION, AXES, FIELD_SHEETS,
  spineStateOf, visualStateOf,
} from '../../src/world/asset-state-taxonomy.js';
import { SPECIES, stageAt, DAY } from '../time/metabolism.js';

test('spine is complete and maps totally onto the visual vocabulary', () => {
  assert.deepEqual(SPINE, ['seedling', 'growing', 'mature', 'flourishing', 'wilting', 'senescent', 'dead', 'decaying', 'gone']);
  for (const s of SPINE) assert.ok(s in SPINE_TO_VISUAL, `${s} mapped`);
  for (const [s, v] of Object.entries(SPINE_TO_VISUAL)) {
    assert.ok(v === null || CORE_VISUAL.includes(v), `${s}→${v} legal`);
  }
  assert.equal(SPINE_TO_VISUAL.gone, null);
});

test('every renderable kernel species stage name is spine vocabulary', () => {
  const { UNRENDERED } = FIELD_SHEETS._meta;
  for (const [name, sp] of Object.entries(SPECIES)) {
    if (UNRENDERED.includes(name)) continue; // humanoids: no bodies until L2 (honest absence)
    for (let d = 0; d <= 2 * (sp.senescence.start / DAY); d += 5) {
      const stage = stageAt(name, d * DAY)[0];
      assert.ok(['seedling', 'growing', 'mature'].includes(stage), `${name}@${d}d: ${stage}`);
    }
  }
});

test('spineStateOf derives condition and senescence from kernel truth', () => {
  const base = { stage: 'mature', ageTicks: 0, senescenceStartTicks: 1e12 };
  assert.equal(spineStateOf({ ...base, bufferDays: 5 }), 'mature');
  assert.equal(spineStateOf({ ...base, bufferDays: CONDITION.flourishAboveDays + 1 }), 'flourishing');
  assert.equal(spineStateOf({ ...base, bufferDays: CONDITION.wiltBelowDays - 1 }), 'wilting');
  // senescence overrides flourishing, wilting overrides senescence
  const old = { stage: 'mature', ageTicks: 100, senescenceStartTicks: 50 };
  assert.equal(spineStateOf({ ...old, bufferDays: 99 }), 'senescent');
  assert.equal(spineStateOf({ ...old, bufferDays: 0 }), 'wilting');
  // pre-mature stages pass through; corpse is decaying; unknown buffer (null) never wilts
  assert.equal(spineStateOf({ stage: 'seedling', ageTicks: 0, senescenceStartTicks: 1e12, bufferDays: 0 }), 'seedling');
  assert.equal(spineStateOf({ stage: 'corpse' }), 'decaying');
  assert.equal(spineStateOf({ ...base, bufferDays: null }), 'mature');
});

test('visualStateOf composes core with the 1:1 map', () => {
  assert.equal(visualStateOf('flourishing'), 'normal');
  assert.equal(visualStateOf('senescent'), 'wilting');
  assert.equal(visualStateOf('decaying'), 'dead');
  assert.equal(visualStateOf('gone'), null);
});

test('field sheets: quantizations and legal vocabularies', () => {
  const sheets = Object.entries(FIELD_SHEETS).filter(([f]) => f !== '_meta');
  const px = Object.fromEntries(sheets.map(([f, s]) => [f, s.px]));
  assert.deepEqual(px, { F2: 32, F3: 32, F4: 64, F5: 96, F6: 192, F7: 192, fauna: 64 });
  // 'growing' is admitted for F6 only: trees get a dedicated sapling sprite (spec doc §6 F6 sheet).
  const legal = new Set([...CORE_VISUAL, ...AXES.yield, ...AXES.damage, ...AXES.dress, 'base', 'growing']);
  for (const [field, sheet] of sheets) {
    for (const [state, mark] of Object.entries(sheet.states)) {
      assert.ok(legal.has(state), `${field}.${state} in legal vocabulary`);
      assert.ok(['E', 'R', 'T', 'F'].includes(mark), `${field}.${state} mark ${mark}`);
    }
  }
});

test('kernel species all bind to an archetype class with a sheet, or are declared unrendered', () => {
  const { SPECIES_CLASS, UNRENDERED } = FIELD_SHEETS._meta;
  for (const name of Object.keys(SPECIES)) {
    if (UNRENDERED.includes(name)) {
      assert.ok(!SPECIES_CLASS[name], `${name} is unrendered (L2 honest absence) — must not also bind a sheet`);
      continue;
    }
    const cls = SPECIES_CLASS[name];
    assert.ok(cls && FIELD_SHEETS[cls], `${name} → ${cls}`);
  }
});
