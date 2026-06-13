// sim/test/specializations.test.js — vendor specialization taxonomy tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPECIALIZATIONS, BRAND_PARTS, specializeBuilding, generateBrand,
         generateInventory, compositionForTier } from '../world/buildings/specializations.js';
import { BUILDING_TYPES } from '../world/buildings/taxonomy.js';
import { mix } from '../kernel/rng.js';

// ── Catalog completeness ────────────────────────────────────────────────

const CRAFT_COMMERCIAL_TYPES = Object.entries(BUILDING_TYPES)
  .filter(([, t]) => ['craft', 'commercial'].includes(t.category))
  .map(([id]) => id);

test('every craft and commercial type has specializations', () => {
  for (const typeId of CRAFT_COMMERCIAL_TYPES) {
    const specs = SPECIALIZATIONS[typeId];
    assert.ok(specs, `missing specializations for ${typeId}`);
    assert.ok(specs.length >= 5, `${typeId} has only ${specs.length} specializations (need 5+)`);
  }
});

test('every specialization has required fields', () => {
  for (const [typeId, specs] of Object.entries(SPECIALIZATIONS)) {
    for (const s of specs) {
      assert.ok(s.id, `${typeId}: missing id`);
      assert.ok(s.name, `${typeId}/${s.id}: missing name`);
      assert.ok(s.desc, `${typeId}/${s.id}: missing desc`);
      assert.ok(Array.isArray(s.baseItems), `${typeId}/${s.id}: baseItems not array`);
      assert.ok(Array.isArray(s.specialtyItems), `${typeId}/${s.id}: specialtyItems not array`);
    }
  }
});

test('no duplicate specialization ids within a type', () => {
  for (const [typeId, specs] of Object.entries(SPECIALIZATIONS)) {
    const ids = specs.map(s => s.id);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, `${typeId} has duplicate spec ids`);
  }
});

test('BRAND_PARTS has 50+ prefixes and 50+ suffixes', () => {
  assert.ok(BRAND_PARTS.prefixes.length >= 50, `only ${BRAND_PARTS.prefixes.length} prefixes`);
  assert.ok(BRAND_PARTS.suffixes.length >= 50, `only ${BRAND_PARTS.suffixes.length} suffixes`);
});

// ── specializeBuilding ──────────────────────────────────────────────────

test('specializeBuilding returns valid specialization for craft type', () => {
  const community = new Set();
  const result = specializeBuilding(42, 'blacksmith', 'village', community);
  assert.ok(result.specialization, 'no specialization returned');
  assert.ok(result.brand.name, 'no brand name');
  assert.ok(result.owner, 'no owner');
  assert.ok(result.inventory.base.length > 0 || result.inventory.specialty.length > 0, 'empty inventory');
  // Verify the spec is actually from the blacksmith catalog
  const validIds = SPECIALIZATIONS.blacksmith.map(s => s.id);
  assert.ok(validIds.includes(result.specialization.id), `${result.specialization.id} not in blacksmith specs`);
});

test('specializeBuilding returns null specialization for residential type', () => {
  const community = new Set();
  const result = specializeBuilding(42, 'cottage', 'village', community);
  assert.equal(result.specialization, null);
  assert.ok(result.brand.name, 'residential still gets a brand');
});

test('no duplicate specializations in a village', () => {
  const community = new Set();
  const assigned = [];
  // Place 8 blacksmiths in a village — should exhaust then overlap
  for (let i = 0; i < 8; i++) {
    const result = specializeBuilding(mix(42, i), 'blacksmith', 'village', community);
    assigned.push(result.specialization.id);
  }
  // First N (up to catalog size) should all be unique
  const catalogSize = SPECIALIZATIONS.blacksmith.length;
  const firstBatch = assigned.slice(0, catalogSize);
  const unique = new Set(firstBatch);
  assert.equal(firstBatch.length, unique.size,
    `duplicates in first ${catalogSize}: ${JSON.stringify(firstBatch)}`);
});

test('different seeds produce different brands', () => {
  const names = new Set();
  for (let seed = 0; seed < 20; seed++) {
    const brand = generateBrand(seed, 'blacksmith', 'weaponsmith');
    names.add(brand.name);
  }
  // At least 5 distinct names out of 20 seeds
  assert.ok(names.size >= 5, `only ${names.size} distinct brands from 20 seeds`);
});

test('brand names are deterministic', () => {
  const a = generateBrand(999, 'bakery', 'bread_baker');
  const b = generateBrand(999, 'bakery', 'bread_baker');
  assert.equal(a.name, b.name);
  assert.equal(a.owner, b.owner);
});

// ── generateInventory ───────────────────────────────────────────────────

test('generateInventory returns base and specialty items', () => {
  const spec = SPECIALIZATIONS.blacksmith[0];
  const inv = generateInventory(42, spec);
  assert.ok(inv.base.length > 0, 'no base items');
  assert.ok(inv.specialty.length >= 2, 'fewer than 2 specialty items');
  assert.ok(inv.specialty.length <= 4, 'more than 4 specialty items');
  // All specialty items come from the spec
  for (const item of inv.specialty) {
    assert.ok(spec.specialtyItems.includes(item), `${item} not in specialty catalog`);
  }
});

// ── compositionForTier ──────────────────────────────────────────────────

test('compositionForTier returns reasonable counts', () => {
  const village = compositionForTier('village');
  const town = compositionForTier('town');
  const city = compositionForTier('city');

  const sum = obj => Object.values(obj).reduce((a, b) => a + b, 0);

  const vTotal = sum(village);
  const tTotal = sum(town);
  const cTotal = sum(city);

  assert.ok(vTotal >= 8 && vTotal <= 15, `village total ${vTotal} out of range 8-15`);
  assert.ok(tTotal >= 25 && tTotal <= 45, `town total ${tTotal} out of range 25-45`);
  assert.ok(cTotal >= 80 && cTotal <= 120, `city total ${cTotal} out of range 80-120`);

  // Each tier is strictly larger than the previous
  assert.ok(tTotal > vTotal, 'town not larger than village');
  assert.ok(cTotal > tTotal, 'city not larger than town');
});

test('compositionForTier is a fresh copy each call', () => {
  const a = compositionForTier('village');
  const b = compositionForTier('village');
  a.residential = 999;
  assert.notEqual(b.residential, 999);
});

// ── Integration: layout produces specialized buildings ──────────────────

test('layout buildings carry specialization and brand fields', async () => {
  const { layoutSettlement, clearLayoutCache } = await import('../world/buildings/layout.js');
  clearLayoutCache();
  const layout = layoutSettlement(42, { x: 500, y: 500 }, 'village', 'human', 'grassland');
  assert.ok(layout.buildings.length > 0, 'no buildings placed');
  for (const b of layout.buildings) {
    assert.ok(b.brand, `building at ${b.x},${b.y} missing brand`);
    assert.ok(b.brand.name, `building at ${b.x},${b.y} missing brand name`);
    assert.ok(b.owner, `building at ${b.x},${b.y} missing owner`);
    // specialization may be null for residential types, that's ok
  }
  // At least one building should have a non-null specialization (craft/commercial anchor)
  const specialized = layout.buildings.filter(b => b.specialization);
  assert.ok(specialized.length > 0, 'no specialized buildings in layout');
});

// ── Religious and military types have specializations ────────────────────

test('religious types have specializations', () => {
  const religious = ['shrine', 'chapel', 'temple', 'monastery', 'oracle_chamber'];
  for (const typeId of religious) {
    const specs = SPECIALIZATIONS[typeId];
    assert.ok(specs, `missing specializations for ${typeId}`);
    assert.ok(specs.length >= 5, `${typeId} has only ${specs.length} specializations (need 5+)`);
  }
});

test('military types have specializations', () => {
  const military = ['barracks', 'armory', 'training_ground'];
  for (const typeId of military) {
    const specs = SPECIALIZATIONS[typeId];
    assert.ok(specs, `missing specializations for ${typeId}`);
    assert.ok(specs.length >= 5, `${typeId} has only ${specs.length} specializations (need 5+)`);
  }
});
