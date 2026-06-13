// sim/test/settlement-tiers.test.js — 12 settlement tiers: homestead to world capital.
// Validates layout generation, building counts, district scaling, and tier name
// consistency across layout, genesis, chronicle, and specializations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutSettlement, clearLayoutCache, TIER_NAMES, TIER_INDEX, DISTRICT_CONFIGS } from '../world/buildings/layout.js';
import { compositionForTier } from '../world/buildings/specializations.js';
import { regionChronicle, settlementState, chronicleTier, CHRONICLE_EVENTS } from '../chronicle/chronicle.js';
import { typesForTier } from '../world/buildings/taxonomy.js';
import { mix } from '../kernel/rng.js';

const SEED = 42;
const SITE = { x: 500, y: 500 };

// ── Tier name consistency ──────────────────────────────────────────────

test('TIER_NAMES has exactly 12 entries', () => {
  assert.equal(TIER_NAMES.length, 12);
});

test('TIER_INDEX maps every name to 1-based index', () => {
  for (let i = 0; i < TIER_NAMES.length; i++) {
    assert.equal(TIER_INDEX[TIER_NAMES[i]], i + 1);
  }
});

test('DISTRICT_CONFIGS has an entry for every tier', () => {
  for (const tier of TIER_NAMES) {
    assert.ok(DISTRICT_CONFIGS[tier], `DISTRICT_CONFIGS missing ${tier}`);
    assert.ok(DISTRICT_CONFIGS[tier].length > 0, `${tier} has no district configs`);
  }
});

test('compositionForTier returns values for all 12 tiers', () => {
  for (const tier of TIER_NAMES) {
    const comp = compositionForTier(tier);
    assert.ok(comp, `compositionForTier missing ${tier}`);
    assert.ok(comp.residential > 0, `${tier} has no residential`);
  }
});

test('typesForTier returns types for all 12 tiers', () => {
  for (const tier of TIER_NAMES) {
    const types = typesForTier(tier);
    assert.ok(types.length > 0, `typesForTier(${tier}) returned empty`);
  }
});

// ── Layout generation for all 12 tiers ─────────────────────────────────

test('all 12 tiers produce valid layouts with buildings', () => {
  clearLayoutCache();
  for (const tier of TIER_NAMES) {
    const layout = layoutSettlement(SEED, SITE, tier, 'human', 'grassland');
    assert.ok(layout, `layout for ${tier}`);
    assert.ok(layout.buildings.length > 0, `${tier} has buildings`);
    assert.ok(layout.districts.length > 0, `${tier} has districts`);
    assert.ok(layout.spines.length > 0, `${tier} has road spines`);
    assert.equal(layout.tier, tier);
  }
});

// ── Building count ranges ──────────────────────────────────────────────

test('tier 1 (homestead) has 2-6 buildings', () => {
  clearLayoutCache();
  const layout = layoutSettlement(SEED, SITE, 'homestead', 'human', 'grassland');
  assert.ok(layout.buildings.length >= 2, `homestead has ${layout.buildings.length} buildings (min 2)`);
  assert.ok(layout.buildings.length <= 6, `homestead has ${layout.buildings.length} buildings (max 6)`);
});

test('tier 7 (city) has 30+ buildings', () => {
  clearLayoutCache();
  const layout = layoutSettlement(SEED, SITE, 'city', 'human', 'grassland');
  assert.ok(layout.buildings.length >= 30, `city has ${layout.buildings.length} buildings (need 30+)`);
});

test('building counts increase with tier', () => {
  clearLayoutCache();
  let prevCount = 0;
  for (const tier of TIER_NAMES) {
    const layout = layoutSettlement(SEED, { x: 1000, y: 1000 }, tier, 'human', 'grassland');
    assert.ok(layout.buildings.length >= prevCount,
      `${tier} (${layout.buildings.length}) should have >= ${prevCount} buildings from previous tier`);
    prevCount = layout.buildings.length;
  }
});

// ── District counts scale with tier ────────────────────────────────────

test('higher tiers have more district configs', () => {
  const homesteadDistricts = DISTRICT_CONFIGS.homestead.length;
  const cityDistricts = DISTRICT_CONFIGS.city.length;
  const capitalDistricts = DISTRICT_CONFIGS.capital.length;
  assert.ok(homesteadDistricts <= cityDistricts, 'homestead <= city districts');
  assert.ok(cityDistricts <= capitalDistricts, 'city <= capital districts');
});

test('homestead has 1 district config (residential only)', () => {
  assert.equal(DISTRICT_CONFIGS.homestead.length, 1);
  assert.equal(DISTRICT_CONFIGS.homestead[0].kind, 'residential');
});

// ── Chronicle tier derivation ──────────────────────────────────────────

test('chronicleTier returns valid tier names', () => {
  // Generate chronicles for many macro-cells and verify all derived tiers are valid
  const peoples = [{ raceId: 'human', name: 'Human', presence: 0.8 }];
  const climate = { moisture: 0.7, heat: 0.5, elevation: 0.3 };
  const validTiers = new Set(TIER_NAMES);

  for (let mx = 0; mx < 100; mx++) {
    const mk = `${mx},0`;
    const chronicle = regionChronicle(SEED, mk, peoples, climate);
    if (chronicle.length === 0) continue;
    const tier = chronicleTier(chronicle, SEED, mk);
    assert.ok(validTiers.has(tier), `chronicleTier returned invalid tier: ${tier}`);
  }
});

test('chronicle tier distribution: small settlements dominate', () => {
  const peoples = [
    { raceId: 'human', name: 'Human', presence: 0.8 },
    { raceId: 'ignaar', name: 'Ignaar', presence: 0.2 },
  ];
  const climate = { moisture: 0.6, heat: 0.5, elevation: 0.3 };
  const tierCounts = {};

  for (let mx = -500; mx < 500; mx++) {
    for (let my = -5; my < 5; my++) {
      const mk = `${mx},${my}`;
      const chronicle = regionChronicle(SEED, mk, peoples, climate);
      const state = settlementState(chronicle);
      if (state !== 'active') continue;
      const tier = chronicleTier(chronicle, SEED, mk);
      tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
    }
  }

  // Small tiers should be more common than large tiers
  const small = (tierCounts.homestead ?? 0) + (tierCounts.hamlet ?? 0) + (tierCounts.village ?? 0) + (tierCounts.township ?? 0);
  const large = (tierCounts.capital ?? 0) + (tierCounts.metropolis ?? 0) + (tierCounts.megacity ?? 0) + (tierCounts.world_capital ?? 0);
  assert.ok(small > large, `small (${small}) should outnumber large (${large})`);
});

// ── Summary: building counts per tier ──────────────────────────────────

test('summary: building counts per tier', () => {
  clearLayoutCache();
  const summary = [];
  for (const tier of TIER_NAMES) {
    const layout = layoutSettlement(SEED, { x: 2000, y: 2000 }, tier, 'human', 'grassland');
    summary.push({ tier, buildings: layout.buildings.length, districts: layout.districts.length });
  }
  // Log for visibility
  for (const s of summary) {
    assert.ok(s.buildings > 0, `${s.tier}: ${s.buildings} buildings, ${s.districts} districts`);
  }
});
