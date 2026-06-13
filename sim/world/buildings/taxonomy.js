// sim/world/buildings/taxonomy.js — World Compiler Phase A: building taxonomy.
// Pure data — 10 categories, 80+ building types with footprint constraints,
// pattern lists, feature inventories, and tier gates.  Race-specific types
// carry a `race` field.  Open-air buildings carry `open: true`.
// No kernel state, no side effects.

export const CATEGORIES = [
  'residential', 'commercial', 'craft', 'agricultural',
  'civic', 'religious', 'military', 'infrastructure',
  'entertainment', 'race_specific',
];

// ── helpers ────────────────────────────────────────────────────────────
function t(category, name, patterns, minW, minH, maxW, maxH, features, tier, extra) {
  return { category, name, patterns, minW, minH, maxW, maxH, features, tier, ...extra };
}
function feat(type, required = false) { return { type, required }; }

// ── building types ─────────────────────────────────────────────────────
export const BUILDING_TYPES = {
  // ── residential ────────────────────────────────────────────────────
  hut:        t('residential', 'Hut',        ['rect'],                  4, 4, 6, 5,
    [feat('hearth', true), feat('bed', true)], 'village'),
  cottage:    t('residential', 'Cottage',    ['rect', 'L'],             5, 5, 8, 7,
    [feat('hearth', true), feat('bed', true), feat('table'), feat('storage')], 'village'),
  house:      t('residential', 'House',      ['rect', 'L', 'T'],       6, 5, 10, 8,
    [feat('hearth', true), feat('bed', true), feat('table'), feat('storage'), feat('chair')], 'town'),
  longhouse:  t('residential', 'Longhouse',  ['rect'],                  10, 5, 16, 7,
    [feat('hearth', true), feat('bed', true), feat('bed'), feat('table'), feat('storage'), feat('bench')], 'village'),
  manor:      t('residential', 'Manor',      ['L', 'T', 'courtyard', 'winged'], 10, 8, 16, 14,
    [feat('hearth', true), feat('bed', true), feat('throne'), feat('table'), feat('storage'), feat('chair'), feat('bookshelf')], 'city'),
  villa:      t('residential', 'Villa',      ['courtyard', 'winged'],   12, 10, 18, 16,
    [feat('hearth', true), feat('bed', true), feat('bed'), feat('table'), feat('fountain'), feat('storage')], 'city'),
  apartment:  t('residential', 'Apartment',  ['rect', 'L'],             8, 8, 14, 12,
    [feat('bed', true), feat('hearth'), feat('storage')], 'city'),

  // ── commercial ─────────────────────────────────────────────────────
  market_stall: t('commercial', 'Market Stall', ['rect'],               3, 3, 5, 4,
    [feat('counter', true)], 'village', { open: true }),
  shop:       t('commercial', 'Shop',        ['rect'],                  5, 5, 8, 7,
    [feat('counter', true), feat('storage'), feat('shelf')], 'town'),
  warehouse:  t('commercial', 'Warehouse',   ['rect', 'L'],             8, 6, 14, 10,
    [feat('storage', true), feat('storage'), feat('storage')], 'town'),
  trading_post: t('commercial', 'Trading Post', ['rect', 'L'],          6, 5, 10, 8,
    [feat('counter', true), feat('storage'), feat('table')], 'village'),
  inn:        t('commercial', 'Inn',         ['rect', 'L', 'T'],        8, 6, 12, 10,
    [feat('hearth', true), feat('bed', true), feat('bed'), feat('table'), feat('counter'), feat('storage')], 'town'),
  tavern:     t('commercial', 'Tavern',      ['rect', 'L'],             6, 5, 10, 8,
    [feat('hearth', true), feat('counter', true), feat('table'), feat('bench'), feat('barrel')], 'village'),
  bazaar:     t('commercial', 'Bazaar',      ['courtyard', 'compound'], 12, 10, 18, 16,
    [feat('counter', true), feat('counter'), feat('storage'), feat('fountain')], 'city', { open: true }),

  // ── craft ──────────────────────────────────────────────────────────
  blacksmith: t('craft', 'Blacksmith',       ['rect', 'L'],             6, 5, 9, 7,
    [feat('forge', true), feat('anvil', true), feat('workbench'), feat('storage')], 'village'),
  tannery:    t('craft', 'Tannery',          ['rect', 'L'],             6, 5, 9, 7,
    [feat('workbench', true), feat('vat', true), feat('storage')], 'village'),
  bakery:     t('craft', 'Bakery',           ['rect'],                  5, 5, 8, 7,
    [feat('oven', true), feat('workbench', true), feat('counter'), feat('storage')], 'village'),
  pottery:    t('craft', 'Pottery',          ['rect'],                  5, 5, 8, 7,
    [feat('kiln', true), feat('workbench', true), feat('storage')], 'town'),
  weaver:     t('craft', 'Weaver',           ['rect', 'L'],             5, 5, 8, 7,
    [feat('loom', true), feat('workbench'), feat('storage')], 'village'),
  carpenter:  t('craft', 'Carpenter',        ['rect', 'L'],             6, 5, 10, 8,
    [feat('workbench', true), feat('storage'), feat('sawbuck')], 'village'),
  alchemist:  t('craft', 'Alchemist',        ['rect'],                  5, 5, 8, 7,
    [feat('workbench', true), feat('cauldron', true), feat('shelf'), feat('storage')], 'town'),
  jeweler:    t('craft', 'Jeweler',           ['rect'],                  5, 5, 7, 6,
    [feat('workbench', true), feat('storage'), feat('counter')], 'town'),
  glassblower: t('craft', 'Glassblower',      ['rect'],                  6, 5, 8, 7,
    [feat('furnace', true), feat('workbench', true), feat('storage')], 'town'),
  dyer:       t('craft', 'Dyer',             ['rect', 'L'],             5, 5, 8, 7,
    [feat('vat', true), feat('workbench'), feat('storage')], 'town'),
  brewer:     t('craft', 'Brewer',           ['rect', 'L'],             6, 5, 10, 8,
    [feat('vat', true), feat('barrel', true), feat('storage'), feat('workbench')], 'village'),

  // ── agricultural ───────────────────────────────────────────────────
  barn:       t('agricultural', 'Barn',      ['rect'],                  8, 6, 14, 10,
    [feat('storage', true), feat('storage')], 'village'),
  silo:       t('agricultural', 'Silo',      ['round'],                 4, 4, 6, 6,
    [feat('storage', true)], 'village'),
  mill:       t('agricultural', 'Mill',      ['rect', 'L'],             6, 6, 10, 10,
    [feat('millstone', true), feat('storage')], 'village'),
  granary:    t('agricultural', 'Granary',   ['rect'],                  6, 5, 10, 8,
    [feat('storage', true), feat('storage')], 'town'),
  greenhouse: t('agricultural', 'Greenhouse', ['rect'],                 6, 5, 10, 8,
    [feat('planter', true), feat('planter')], 'town'),
  stable:     t('agricultural', 'Stable',    ['rect', 'L'],             8, 5, 12, 8,
    [feat('trough', true), feat('storage')], 'village'),
  coop:       t('agricultural', 'Coop',      ['rect'],                  3, 3, 5, 5,
    [feat('trough', true)], 'village'),
  apiary:     t('agricultural', 'Apiary',    ['rect'],                  4, 3, 6, 5,
    [feat('hive', true), feat('hive')], 'village', { open: true }),
  vineyard_press: t('agricultural', 'Vineyard Press', ['rect', 'L'],   6, 5, 10, 8,
    [feat('press', true), feat('barrel'), feat('storage')], 'town'),

  // ── civic ──────────────────────────────────────────────────────────
  town_hall:  t('civic', 'Town Hall',        ['rect', 'L', 'T', 'courtyard'], 8, 7, 14, 12,
    [feat('throne', true), feat('table', true), feat('chair'), feat('bookshelf'), feat('storage')], 'town'),
  courthouse: t('civic', 'Courthouse',       ['rect', 'T'],             8, 7, 12, 10,
    [feat('throne', true), feat('table'), feat('chair'), feat('bookshelf')], 'city'),
  library:    t('civic', 'Library',          ['rect', 'L'],             7, 6, 12, 10,
    [feat('bookshelf', true), feat('bookshelf'), feat('table'), feat('chair')], 'town'),
  school:     t('civic', 'School',           ['rect', 'L'],             7, 6, 10, 8,
    [feat('table', true), feat('chair', true), feat('bookshelf')], 'town'),
  bathhouse:  t('civic', 'Bathhouse',        ['rect', 'courtyard'],     8, 7, 14, 12,
    [feat('pool', true), feat('bench')], 'city'),
  fountain:   t('civic', 'Fountain',         ['round'],                 3, 3, 5, 5,
    [feat('fountain', true)], 'village', { open: true }),
  well:       t('civic', 'Well',             ['rect'],                  2, 2, 3, 3,
    [feat('well', true)], 'village', { open: true }),
  monument:   t('civic', 'Monument',         ['rect', 'round'],         3, 3, 6, 6,
    [feat('statue', true)], 'town', { open: true }),
  prison:     t('civic', 'Prison',           ['rect', 'L'],             6, 6, 10, 10,
    [feat('cell', true), feat('cell'), feat('table')], 'city'),

  // ── religious ──────────────────────────────────────────────────────
  shrine:     t('religious', 'Shrine',       ['rect'],                  3, 3, 5, 5,
    [feat('altar', true)], 'village'),
  chapel:     t('religious', 'Chapel',       ['rect', 'T'],             6, 5, 9, 8,
    [feat('altar', true), feat('bench'), feat('candelabra')], 'village'),
  temple:     t('religious', 'Temple',       ['T', 'courtyard', 'winged'], 10, 8, 16, 14,
    [feat('altar', true), feat('statue'), feat('bench'), feat('candelabra'), feat('fountain')], 'city'),
  monastery:  t('religious', 'Monastery',    ['courtyard', 'compound'], 12, 10, 18, 16,
    [feat('altar', true), feat('bed'), feat('bed'), feat('bookshelf'), feat('table'), feat('garden_bed')], 'city'),
  altar:      t('religious', 'Altar',        ['rect'],                  2, 2, 4, 4,
    [feat('altar', true)], 'village', { open: true }),
  oracle_chamber: t('religious', 'Oracle Chamber', ['round', 'rect'],  5, 5, 8, 8,
    [feat('altar', true), feat('candelabra'), feat('pool')], 'town'),
  burial_ground: t('religious', 'Burial Ground', ['rect'],             8, 6, 14, 12,
    [feat('headstone', true), feat('headstone'), feat('headstone')], 'village', { open: true }),

  // ── military ───────────────────────────────────────────────────────
  watchtower: t('military', 'Watchtower',    ['rect', 'round'],         4, 4, 6, 6,
    [feat('ladder', true)], 'village'),
  barracks:   t('military', 'Barracks',      ['rect', 'L'],             8, 6, 14, 10,
    [feat('bed', true), feat('bed'), feat('bed'), feat('storage'), feat('table')], 'town'),
  armory:     t('military', 'Armory',        ['rect'],                  6, 5, 10, 8,
    [feat('storage', true), feat('storage'), feat('rack')], 'town'),
  training_ground: t('military', 'Training Ground', ['rect', 'compound'], 10, 8, 16, 14,
    [feat('target', true), feat('rack')], 'town', { open: true }),
  gate:       t('military', 'Gate',          ['rect'],                  4, 3, 8, 5,
    [feat('portcullis', true)], 'village'),
  siege_workshop: t('military', 'Siege Workshop', ['rect', 'L', 'compound'], 8, 7, 14, 12,
    [feat('workbench', true), feat('storage'), feat('anvil')], 'city'),

  // ── infrastructure ─────────────────────────────────────────────────
  bridge:     t('infrastructure', 'Bridge',  ['rect'],                  6, 3, 12, 4,
    [], 'village', { open: true }),
  dock:       t('infrastructure', 'Dock',    ['rect', 'L'],             6, 4, 12, 6,
    [feat('storage'), feat('bollard')], 'town', { open: true }),
  lighthouse: t('infrastructure', 'Lighthouse', ['round'],              4, 4, 6, 6,
    [feat('lamp', true), feat('ladder')], 'town'),
  road_station: t('infrastructure', 'Road Station', ['rect'],           5, 4, 8, 6,
    [feat('bench'), feat('storage')], 'village'),
  waystone:   t('infrastructure', 'Waystone', ['rect'],                 2, 2, 3, 3,
    [feat('waystone', true)], 'village', { open: true }),
  cistern:    t('infrastructure', 'Cistern',  ['rect', 'round'],        4, 4, 8, 8,
    [feat('reservoir', true)], 'town'),
  aqueduct:   t('infrastructure', 'Aqueduct', ['rect'],                 10, 3, 20, 4,
    [], 'city', { open: true }),

  // ── entertainment ──────────────────────────────────────────────────
  theater:    t('entertainment', 'Theater',  ['T', 'courtyard'],        10, 8, 16, 14,
    [feat('stage', true), feat('bench'), feat('bench')], 'city'),
  arena:      t('entertainment', 'Arena',    ['courtyard', 'round'],    12, 10, 20, 18,
    [feat('gate', true), feat('bench'), feat('bench')], 'city', { open: true }),
  garden:     t('entertainment', 'Garden',   ['rect', 'L'],             6, 5, 12, 10,
    [feat('garden_bed', true), feat('garden_bed'), feat('bench')], 'town', { open: true }),
  park:       t('entertainment', 'Park',     ['rect', 'compound'],      8, 6, 16, 14,
    [feat('bench'), feat('fountain'), feat('garden_bed')], 'town', { open: true }),
  feast_hall: t('entertainment', 'Feast Hall', ['rect', 'winged'],      10, 7, 16, 12,
    [feat('hearth', true), feat('table', true), feat('table'), feat('bench'), feat('barrel')], 'town'),

  // ── race-specific ──────────────────────────────────────────────────
  crystal_nexus:   t('race_specific', 'Crystal Nexus',     ['round', 'rect'],        6, 6, 10, 10,
    [feat('crystal', true), feat('altar')], 'village', { race: 'veylith' }),
  ember_forge:     t('race_specific', 'Ember Forge',       ['rect', 'L'],             7, 6, 12, 10,
    [feat('forge', true), feat('anvil', true), feat('lava_channel')], 'village', { race: 'ignaar' }),
  root_hall:       t('race_specific', 'Root Hall',         ['L', 'T', 'winged'],      8, 6, 14, 12,
    [feat('hearth', true), feat('root_throne'), feat('table')], 'village', { race: 'sylvari' }),
  stone_sanctuary: t('race_specific', 'Stone Sanctuary',   ['rect', 'courtyard'],     8, 7, 14, 12,
    [feat('altar', true), feat('statue'), feat('candelabra')], 'village', { race: 'kaldreth' }),
  tide_lodge:      t('race_specific', 'Tide Lodge',        ['rect', 'L'],             7, 5, 12, 9,
    [feat('pool', true), feat('bed'), feat('storage')], 'village', { race: 'thalori' }),
  moss_den:        t('race_specific', 'Moss Den',          ['round', 'rect'],         5, 5, 9, 8,
    [feat('bed', true), feat('hearth'), feat('storage')], 'village', { race: 'grotharn' }),
  sand_pavilion:   t('race_specific', 'Sand Pavilion',     ['rect', 'courtyard'],     8, 6, 14, 12,
    [feat('counter', true), feat('bench'), feat('fountain')], 'village', { race: 'ashren', open: true }),
  frost_hall:      t('race_specific', 'Frost Hall',        ['rect', 'winged'],        8, 6, 14, 12,
    [feat('hearth', true), feat('bed'), feat('storage'), feat('fur_rack')], 'village', { race: 'frostwyn' }),
};

// ── queries ────────────────────────────────────────────────────────────

/** All types in a category, each decorated with its id. */
export function typesInCategory(cat) {
  const out = [];
  for (const [id, type] of Object.entries(BUILDING_TYPES)) {
    if (type.category === cat) out.push({ id, ...type });
  }
  return out;
}

/** Look up a single type by id. Returns the type object or null. */
export function typeById(id) {
  return BUILDING_TYPES[id] ?? null;
}

/** All types available at a given tier (village ⊂ town ⊂ city). */
export function typesForTier(tier) {
  const allowed = tier === 'city' ? ['village', 'town', 'city']
                : tier === 'town' ? ['village', 'town']
                : ['village'];
  const out = [];
  for (const [id, type] of Object.entries(BUILDING_TYPES)) {
    if (allowed.includes(type.tier)) out.push({ id, ...type });
  }
  return out;
}
