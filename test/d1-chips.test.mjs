import { test } from 'node:test';
import assert from 'node:assert/strict';

// d1-chips imports building-tiles (which pulls render deps); we only test the PURE helpers, so import the
// module and exercise chipDecision/isTimberSlug. No canvas needed.
const { chipDecision, isTimberSlug, D1_CHIPS } = await import('../src/render/dressing/d1-chips.js');

test('isTimberSlug: plank/board/timber families are timber; stone/cob/adobe are not', () => {
  for (const s of ['timber_frame', 'hewn_plank', 'log_cabin', 'weathered_plank', 'wattle_daub', 'wood_shingle'])
    assert.equal(isTimberSlug(s), true, `${s} should be timber`);
  for (const s of ['fieldstone', 'cob', 'adobe', 'sandstone', 'mudbrick', 'amethyst_ashlar', ''])
    assert.equal(isTimberSlug(s), false, `${s} should NOT be timber`);
});

test('chipDecision: high wear + timber → plank gap; high wear + stone → nothing (monolithic)', () => {
  assert.equal(chipDecision(0.8, true), 'd1_plank_gap');
  assert.equal(chipDecision(0.8, false), null, 'a stone wall does not lose planks (decay is coverage)');
});

test('chipDecision: moderate wear → a repair (board patch on timber, daub fill on stone)', () => {
  assert.equal(chipDecision(0.4, true), 'd1_board_patch');
  assert.equal(chipDecision(0.4, false), 'daub_fill');
});

test('chipDecision: clean buildings get no chip', () => {
  assert.equal(chipDecision(0.1, true), null);
  assert.equal(chipDecision(0.1, false), null);
  assert.equal(chipDecision(0, true), null);
});

test('chipDecision: thresholds honor the live config (so the tuner can widen/narrow prevalence)', () => {
  const cfg = { ...D1_CHIPS, gapThresh: 0.9, patchThresh: 0.5 };
  assert.equal(chipDecision(0.8, true, cfg), 'd1_board_patch', 'raising gapThresh demotes 0.8 to a patch');
  assert.equal(chipDecision(0.4, true, cfg), null, 'raising patchThresh leaves 0.4 clean');
});
