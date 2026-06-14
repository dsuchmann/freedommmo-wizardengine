// sim/world/buildings/interiors.js — Interior field system for buildings.
// Like landscape fields F0-F7 but for indoor spaces. Each building footprint
// gets dressed with floor material, wall features, furniture, objects, and
// decorative elements based on building type + race + condition.
//
// Interior Fields (I0-I6):
//   I0: Floor material     — what you walk on
//   I1: Wall features      — openings, windows, doors in the perimeter
//   I2: Structure          — stairs, pillars, room dividers, load-bearing walls
//   I3: Large furniture    — tables, beds, forges, altars, counters, chests
//   I4: Small objects      — pottery, candles, books, tools, food, keys
//   I5: Decorative         — art, tapestries, crests, rugs, flowers, curtains
//   I6: Condition overlay  — clean, dusty, damaged, bloodstained, cobwebbed
//
// Pure functions: seed + building type → complete interior layout.
// No kernel state, no side effects.

import { rand, mix } from '../../kernel/rng.js';

// ── I0: Floor materials ─────────────────────────────────────────────

export const FLOOR_MATERIALS = {
  wood_plank:   { name: 'Wood Plank',   warmth: 0.7, cost: 1 },
  stone_slab:   { name: 'Stone Slab',   warmth: 0.3, cost: 2 },
  marble:       { name: 'Marble',       warmth: 0.2, cost: 5 },
  packed_dirt:  { name: 'Packed Dirt',   warmth: 0.5, cost: 0 },
  cobblestone:  { name: 'Cobblestone',   warmth: 0.3, cost: 1 },
  tile_ceramic: { name: 'Ceramic Tile',  warmth: 0.4, cost: 3 },
  carpet_wool:  { name: 'Wool Carpet',   warmth: 0.9, cost: 3 },
  carpet_silk:  { name: 'Silk Carpet',   warmth: 0.8, cost: 6 },
  reed_mat:     { name: 'Reed Mat',      warmth: 0.6, cost: 0 },
  crystal_slab: { name: 'Crystal Slab',  warmth: 0.1, cost: 7, race: 'veylith' },
  volcanic_stone: { name: 'Volcanic Stone', warmth: 0.9, cost: 2, race: 'ignaar' },
  moss_carpet:  { name: 'Moss Carpet',   warmth: 0.8, cost: 0, race: 'grotharn' },
  living_wood:  { name: 'Living Wood',   warmth: 0.7, cost: 1, race: 'sylvari' },
  carved_stone: { name: 'Carved Stone',  warmth: 0.2, cost: 3, race: 'kaldreth' },
  sand_tile:    { name: 'Sand Tile',     warmth: 0.6, cost: 1, race: 'ashren' },
  ice_floor:    { name: 'Ice Floor',     warmth: 0.0, cost: 2, race: 'frostwyn' },
  driftwood:    { name: 'Driftwood',     warmth: 0.5, cost: 0, race: 'thalori' },
};

// ── I1: Wall features ───────────────────────────────────────────────

export const WALL_FEATURES = {
  // Openings
  door_wood:     { name: 'Wooden Door',   kind: 'door',   state: 'closed', passable: true },
  door_iron:     { name: 'Iron Door',     kind: 'door',   state: 'closed', passable: true },
  door_ornate:   { name: 'Ornate Door',   kind: 'door',   state: 'closed', passable: true },
  archway:       { name: 'Archway',       kind: 'opening', state: 'open',  passable: true },
  curtain:       { name: 'Curtain',       kind: 'opening', state: 'drawn', passable: true },
  // Windows
  window_open:   { name: 'Open Window',   kind: 'window', state: 'open',   passable: false },
  window_closed: { name: 'Closed Window', kind: 'window', state: 'closed', passable: false },
  window_barred: { name: 'Barred Window', kind: 'window', state: 'barred', passable: false },
  window_stained: { name: 'Stained Glass', kind: 'window', state: 'closed', passable: false },
  shuttered:     { name: 'Shuttered',     kind: 'window', state: 'closed', passable: false },
  // Special
  secret_door:   { name: 'Secret Door',   kind: 'secret', state: 'hidden', passable: true },
  murder_hole:   { name: 'Murder Hole',   kind: 'opening', state: 'open',  passable: false },
  arrow_slit:    { name: 'Arrow Slit',    kind: 'window', state: 'open',   passable: false },
};

// ── I2: Structural elements ─────────────────────────────────────────

export const STRUCTURE = {
  stairs_up:     { name: 'Stairs Up',     direction: 'up',   passable: true, connects: 'above' },
  stairs_down:   { name: 'Stairs Down',   direction: 'down', passable: true, connects: 'below' },
  ladder_up:     { name: 'Ladder Up',     direction: 'up',   passable: true, connects: 'above' },
  ladder_down:   { name: 'Ladder Down',   direction: 'down', passable: true, connects: 'below' },
  pillar:        { name: 'Pillar',        direction: null,   passable: false },
  room_divider:  { name: 'Room Divider',  direction: null,   passable: false },
  half_wall:     { name: 'Half Wall',     direction: null,   passable: false },
  trapdoor:      { name: 'Trapdoor',      direction: 'down', passable: true, connects: 'below' },
  balcony:       { name: 'Balcony',       direction: null,   passable: true },
};

// ── I3: Large furniture ─────────────────────────────────────────────

export const LARGE_FURNITURE = {
  // Universal
  table_wood:    { name: 'Wooden Table',   size: [2, 1], category: 'furniture' },
  table_stone:   { name: 'Stone Table',    size: [2, 1], category: 'furniture' },
  table_round:   { name: 'Round Table',    size: [2, 2], category: 'furniture' },
  bench:         { name: 'Bench',          size: [2, 1], category: 'seating' },
  chair:         { name: 'Chair',          size: [1, 1], category: 'seating' },
  stool:         { name: 'Stool',          size: [1, 1], category: 'seating' },
  throne:        { name: 'Throne',         size: [1, 1], category: 'seating' },
  bed_single:    { name: 'Single Bed',     size: [1, 2], category: 'sleeping' },
  bed_double:    { name: 'Double Bed',     size: [2, 2], category: 'sleeping' },
  bed_bunk:      { name: 'Bunk Bed',       size: [1, 2], category: 'sleeping' },
  hammock:       { name: 'Hammock',        size: [1, 2], category: 'sleeping' },
  cot:           { name: 'Cot',            size: [1, 2], category: 'sleeping' },
  // Storage
  chest_wood:    { name: 'Wooden Chest',   size: [1, 1], category: 'storage' },
  chest_iron:    { name: 'Iron Chest',     size: [1, 1], category: 'storage' },
  wardrobe:      { name: 'Wardrobe',       size: [1, 2], category: 'storage' },
  barrel:        { name: 'Barrel',         size: [1, 1], category: 'storage' },
  crate:         { name: 'Crate',          size: [1, 1], category: 'storage' },
  shelf_unit:    { name: 'Shelf Unit',     size: [1, 2], category: 'storage' },
  bookcase:      { name: 'Bookcase',       size: [1, 2], category: 'storage' },
  weapon_rack:   { name: 'Weapon Rack',    size: [1, 2], category: 'storage' },
  armor_stand:   { name: 'Armor Stand',    size: [1, 1], category: 'storage' },
  display_case:  { name: 'Display Case',   size: [2, 1], category: 'storage' },
  // Craft stations
  forge:         { name: 'Forge',          size: [2, 2], category: 'craft' },
  anvil:         { name: 'Anvil',          size: [1, 1], category: 'craft' },
  workbench:     { name: 'Workbench',      size: [2, 1], category: 'craft' },
  loom:          { name: 'Loom',           size: [2, 1], category: 'craft' },
  spinning_wheel: { name: 'Spinning Wheel', size: [1, 1], category: 'craft' },
  kiln:          { name: 'Kiln',           size: [1, 1], category: 'craft' },
  potters_wheel: { name: "Potter's Wheel", size: [1, 1], category: 'craft' },
  oven:          { name: 'Oven',           size: [1, 1], category: 'craft' },
  brewing_vat:   { name: 'Brewing Vat',    size: [2, 2], category: 'craft' },
  tanning_rack:  { name: 'Tanning Rack',   size: [2, 1], category: 'craft' },
  sawbench:      { name: 'Sawbench',       size: [2, 1], category: 'craft' },
  alchemy_bench: { name: 'Alchemy Bench',  size: [2, 1], category: 'craft' },
  grinding_stone: { name: 'Grinding Stone', size: [1, 1], category: 'craft' },
  // Commerce
  counter:       { name: 'Counter',        size: [2, 1], category: 'commerce' },
  market_stall:  { name: 'Market Display', size: [2, 1], category: 'commerce' },
  scale:         { name: 'Scale',          size: [1, 1], category: 'commerce' },
  register_desk: { name: 'Register Desk',  size: [1, 1], category: 'commerce' },
  // Comfort
  hearth:        { name: 'Hearth',         size: [2, 1], category: 'comfort' },
  fireplace:     { name: 'Fireplace',      size: [2, 2], category: 'comfort' },
  brazier:       { name: 'Brazier',        size: [1, 1], category: 'comfort' },
  bathtub:       { name: 'Bathtub',        size: [2, 1], category: 'comfort' },
  wash_basin:    { name: 'Wash Basin',     size: [1, 1], category: 'comfort' },
  // Religious
  altar:         { name: 'Altar',          size: [2, 1], category: 'religious' },
  pew:           { name: 'Pew',            size: [2, 1], category: 'religious' },
  pulpit:        { name: 'Pulpit',         size: [1, 1], category: 'religious' },
  prayer_mat:    { name: 'Prayer Mat',     size: [1, 1], category: 'religious' },
  reliquary:     { name: 'Reliquary',      size: [1, 1], category: 'religious' },
  // Military
  training_dummy: { name: 'Training Dummy', size: [1, 1], category: 'military' },
  target_board:  { name: 'Target Board',   size: [1, 1], category: 'military' },
  war_table:     { name: 'War Table',      size: [2, 2], category: 'military' },
};

// ── I4: Small objects ───────────────────────────────────────────────

export const SMALL_OBJECTS = {
  candle:        { name: 'Candle' },
  candelabra:    { name: 'Candelabra' },
  lantern:       { name: 'Lantern' },
  torch_sconce:  { name: 'Torch Sconce' },
  oil_lamp:      { name: 'Oil Lamp' },
  book:          { name: 'Book' },
  scroll:        { name: 'Scroll' },
  ink_quill:     { name: 'Ink & Quill' },
  map:           { name: 'Map' },
  letter:        { name: 'Letter' },
  coin_pouch:    { name: 'Coin Pouch' },
  key:           { name: 'Key' },
  lockpick:      { name: 'Lockpick' },
  mug:           { name: 'Mug' },
  plate:         { name: 'Plate' },
  goblet:        { name: 'Goblet' },
  bottle:        { name: 'Bottle' },
  jug:           { name: 'Jug' },
  bowl:          { name: 'Bowl' },
  bread_loaf:    { name: 'Bread Loaf' },
  cheese_wheel:  { name: 'Cheese Wheel' },
  meat_cut:      { name: 'Meat Cut' },
  fruit_basket:  { name: 'Fruit Basket' },
  herb_bundle:   { name: 'Herb Bundle' },
  spice_jar:     { name: 'Spice Jar' },
  potion:        { name: 'Potion' },
  vial:          { name: 'Vial' },
  mortar_pestle: { name: 'Mortar & Pestle' },
  hammer:        { name: 'Hammer' },
  tongs:         { name: 'Tongs' },
  chisel:        { name: 'Chisel' },
  needle_thread: { name: 'Needle & Thread' },
  scissors:      { name: 'Scissors' },
  broom:         { name: 'Broom' },
  bucket:        { name: 'Bucket' },
  rope_coil:     { name: 'Rope Coil' },
  bell:          { name: 'Bell' },
  mirror:        { name: 'Mirror' },
  comb:          { name: 'Comb' },
  dice:          { name: 'Dice' },
  pipe:          { name: 'Smoking Pipe' },
  music_box:     { name: 'Music Box' },
};

// ── I5: Decorative elements ─────────────────────────────────────────

export const DECORATIVE = {
  painting:       { name: 'Painting',       placement: 'wall' },
  tapestry:       { name: 'Tapestry',       placement: 'wall' },
  banner:         { name: 'Banner',         placement: 'wall' },
  crest:          { name: 'Family Crest',   placement: 'wall' },
  mounted_head:   { name: 'Mounted Head',   placement: 'wall' },
  shield_display: { name: 'Shield Display', placement: 'wall' },
  clock:          { name: 'Clock',          placement: 'wall' },
  sconce:         { name: 'Wall Sconce',    placement: 'wall' },
  rug_small:      { name: 'Small Rug',      placement: 'floor' },
  rug_large:      { name: 'Large Rug',      placement: 'floor' },
  potted_plant:   { name: 'Potted Plant',    placement: 'floor' },
  flower_vase:    { name: 'Flower Vase',     placement: 'surface' },
  statue_small:   { name: 'Small Statue',    placement: 'floor' },
  statue_large:   { name: 'Large Statue',    placement: 'floor' },
  fountain_indoor: { name: 'Indoor Fountain', placement: 'floor' },
  chandelier:     { name: 'Chandelier',      placement: 'ceiling' },
  hanging_herbs:  { name: 'Hanging Herbs',   placement: 'ceiling' },
  wind_chimes:    { name: 'Wind Chimes',     placement: 'ceiling' },
  curtain_deco:   { name: 'Decorative Curtain', placement: 'wall' },
  garland:        { name: 'Garland',         placement: 'wall' },
};

// ── I6: Condition modifiers ─────────────────────────────────────────

export const CONDITION = {
  pristine:    { name: 'Pristine',    decay: 0.0, desc: 'immaculate, freshly maintained' },
  clean:       { name: 'Clean',       decay: 0.1, desc: 'well-kept, minimal wear' },
  lived_in:    { name: 'Lived In',    decay: 0.3, desc: 'comfortable signs of daily use' },
  worn:        { name: 'Worn',        decay: 0.5, desc: 'visible wear, scratches, faded colors' },
  dusty:       { name: 'Dusty',       decay: 0.6, desc: 'thin layer of dust, cobwebs in corners' },
  neglected:   { name: 'Neglected',   decay: 0.7, desc: 'peeling paint, loose boards, grime' },
  damaged:     { name: 'Damaged',     decay: 0.8, desc: 'broken items, cracked walls, missing tiles' },
  ruined:      { name: 'Ruined',      decay: 1.0, desc: 'collapsed sections, rubble, overgrown' },
};

// ── Interior templates per building type ────────────────────────────
// Each template declares what goes in each field layer for that building type.
// The generator uses this as a recipe, seeding specific instances.

export const INTERIOR_TEMPLATES = {
  // ── Residential ───────────────────────────────────────────────────
  hut: {
    floor: ['packed_dirt', 'reed_mat'],
    wallMaterial: 'wood',
    walls: { windows: 1, doors: 1 },
    structure: [],
    furniture: ['bed_single', 'stool', 'chest_wood'],
    objects: ['candle', 'bowl', 'bucket'],
    decorative: [],
    condition: ['lived_in', 'worn'],
  },
  cottage: {
    floor: ['wood_plank'],
    walls: { windows: 2, doors: 1 },
    structure: [],
    furniture: ['bed_single', 'table_wood', 'chair', 'chest_wood', 'hearth'],
    objects: ['candle', 'plate', 'mug', 'bread_loaf', 'broom'],
    decorative: ['rug_small', 'potted_plant'],
    condition: ['clean', 'lived_in'],
  },
  house: {
    floor: ['wood_plank', 'stone_slab'],
    walls: { windows: 3, doors: 2, archways: 1 },
    structure: ['stairs_up'],
    furniture: ['bed_double', 'table_wood', 'chair', 'chair', 'wardrobe', 'bookcase', 'hearth'],
    objects: ['candle', 'candle', 'plate', 'goblet', 'book', 'mirror'],
    decorative: ['rug_large', 'painting', 'potted_plant', 'curtain_deco'],
    condition: ['clean', 'lived_in'],
  },
  manor: {
    floor: ['marble', 'wood_plank', 'carpet_wool'],
    walls: { windows: 6, doors: 4, archways: 2 },
    structure: ['stairs_up', 'stairs_up', 'pillar', 'pillar'],
    furniture: ['bed_double', 'bed_double', 'table_round', 'throne', 'bookcase', 'bookcase', 'wardrobe', 'fireplace', 'bathtub', 'display_case'],
    objects: ['candelabra', 'goblet', 'book', 'scroll', 'ink_quill', 'mirror', 'music_box'],
    decorative: ['rug_large', 'rug_large', 'painting', 'painting', 'tapestry', 'crest', 'statue_small', 'chandelier'],
    condition: ['pristine', 'clean'],
  },
  villa: {
    floor: ['marble', 'tile_ceramic', 'carpet_silk'],
    walls: { windows: 8, doors: 5, archways: 3, stained_glass: 2 },
    structure: ['stairs_up', 'stairs_up', 'pillar', 'pillar', 'pillar', 'pillar', 'balcony'],
    furniture: ['bed_double', 'bed_double', 'bed_double', 'table_round', 'throne', 'bookcase', 'bookcase', 'bookcase', 'wardrobe', 'wardrobe', 'fireplace', 'fireplace', 'bathtub', 'bathtub', 'display_case', 'display_case'],
    objects: ['candelabra', 'candelabra', 'goblet', 'goblet', 'book', 'book', 'scroll', 'ink_quill', 'mirror', 'music_box', 'coin_pouch'],
    decorative: ['rug_large', 'rug_large', 'painting', 'painting', 'painting', 'tapestry', 'tapestry', 'crest', 'statue_large', 'fountain_indoor', 'chandelier', 'chandelier'],
    condition: ['pristine'],
  },

  // ── Craft ─────────────────────────────────────────────────────────
  blacksmith: {
    floor: ['stone_slab', 'cobblestone'],
    walls: { windows: 2, doors: 2 },
    structure: [],
    furniture: ['forge', 'anvil', 'workbench', 'barrel', 'barrel', 'weapon_rack', 'tanning_rack'],
    objects: ['hammer', 'tongs', 'bucket', 'rope_coil'],
    decorative: ['shield_display'],
    condition: ['worn', 'lived_in'],
  },
  bakery: {
    floor: ['stone_slab', 'tile_ceramic'],
    walls: { windows: 2, doors: 1 },
    structure: [],
    furniture: ['oven', 'counter', 'table_wood', 'shelf_unit', 'barrel'],
    objects: ['bread_loaf', 'bread_loaf', 'bread_loaf', 'plate', 'bowl', 'spice_jar', 'broom'],
    decorative: ['hanging_herbs'],
    condition: ['lived_in', 'clean'],
  },
  alchemist: {
    floor: ['stone_slab'],
    walls: { windows: 1, doors: 1 },
    structure: [],
    furniture: ['alchemy_bench', 'shelf_unit', 'shelf_unit', 'chest_iron', 'stool'],
    objects: ['potion', 'potion', 'vial', 'vial', 'mortar_pestle', 'herb_bundle', 'book', 'scroll', 'candle'],
    decorative: ['hanging_herbs', 'hanging_herbs'],
    condition: ['dusty', 'lived_in'],
  },

  // ── Commercial ────────────────────────────────────────────────────
  tavern: {
    floor: ['wood_plank'],
    walls: { windows: 3, doors: 2 },
    structure: ['stairs_up'],
    furniture: ['counter', 'table_wood', 'table_wood', 'table_round', 'bench', 'bench', 'stool', 'stool', 'barrel', 'barrel', 'barrel', 'hearth'],
    objects: ['mug', 'mug', 'mug', 'goblet', 'bottle', 'bottle', 'plate', 'bread_loaf', 'cheese_wheel', 'dice', 'candle', 'candle'],
    decorative: ['mounted_head', 'banner', 'rug_small'],
    condition: ['worn', 'lived_in'],
  },
  inn: {
    floor: ['wood_plank'],
    walls: { windows: 4, doors: 3, archways: 1 },
    structure: ['stairs_up'],
    furniture: ['counter', 'table_wood', 'table_wood', 'bench', 'bed_single', 'bed_single', 'bed_single', 'bed_double', 'wardrobe', 'chest_wood', 'hearth'],
    objects: ['candle', 'candle', 'lantern', 'key', 'key', 'mug', 'goblet', 'plate', 'book'],
    decorative: ['rug_large', 'painting', 'banner'],
    condition: ['lived_in', 'clean'],
  },
  shop: {
    floor: ['wood_plank', 'stone_slab'],
    walls: { windows: 2, doors: 1 },
    structure: [],
    furniture: ['counter', 'shelf_unit', 'shelf_unit', 'display_case', 'chest_wood', 'stool'],
    objects: ['scale', 'coin_pouch', 'candle', 'book'],
    decorative: ['potted_plant'],
    condition: ['clean'],
  },

  // ── Religious ─────────────────────────────────────────────────────
  chapel: {
    floor: ['stone_slab'],
    walls: { windows: 4, doors: 1, stained_glass: 2 },
    structure: ['pillar', 'pillar'],
    furniture: ['altar', 'pew', 'pew', 'pew', 'pulpit', 'brazier'],
    objects: ['candle', 'candle', 'candle', 'book', 'bell'],
    decorative: ['banner', 'crest', 'statue_small'],
    condition: ['clean', 'pristine'],
  },
  temple: {
    floor: ['marble', 'stone_slab'],
    walls: { windows: 6, doors: 2, archways: 2, stained_glass: 4 },
    structure: ['pillar', 'pillar', 'pillar', 'pillar', 'stairs_down'],
    furniture: ['altar', 'pew', 'pew', 'pew', 'pew', 'pew', 'pulpit', 'brazier', 'brazier', 'reliquary', 'bookcase'],
    objects: ['candelabra', 'candelabra', 'candle', 'candle', 'book', 'scroll', 'bell'],
    decorative: ['tapestry', 'tapestry', 'statue_large', 'crest', 'chandelier', 'garland'],
    condition: ['pristine'],
  },

  // ── Military ──────────────────────────────────────────────────────
  barracks: {
    floor: ['stone_slab'],
    walls: { windows: 2, doors: 2, arrow_slits: 4 },
    structure: ['stairs_up'],
    furniture: ['bed_bunk', 'bed_bunk', 'bed_bunk', 'bed_bunk', 'weapon_rack', 'weapon_rack', 'armor_stand', 'armor_stand', 'chest_iron', 'table_wood', 'bench'],
    objects: ['lantern', 'lantern', 'bucket', 'rope_coil'],
    decorative: ['banner', 'banner'],
    condition: ['worn', 'lived_in'],
  },

  // ── Civic ─────────────────────────────────────────────────────────
  town_hall: {
    floor: ['marble', 'wood_plank', 'carpet_wool'],
    wallMaterial: 'stone_brick',
    walls: { windows: 6, doors: 3, archways: 2 },
    structure: ['stairs_up', 'pillar', 'pillar'],
    furniture: ['throne', 'war_table', 'bookcase', 'bookcase', 'display_case', 'chest_iron', 'chair', 'chair', 'chair'],
    objects: ['candelabra', 'ink_quill', 'scroll', 'scroll', 'map', 'book', 'bell', 'coin_pouch'],
    decorative: ['tapestry', 'crest', 'painting', 'statue_small', 'chandelier', 'rug_large'],
    condition: ['pristine', 'clean'],
  },
  library: {
    floor: ['wood_plank', 'carpet_wool'],
    walls: { windows: 4, doors: 1 },
    structure: ['stairs_up', 'pillar'],
    furniture: ['bookcase', 'bookcase', 'bookcase', 'bookcase', 'bookcase', 'bookcase', 'table_wood', 'table_wood', 'chair', 'chair', 'chair', 'chair'],
    objects: ['book', 'book', 'book', 'book', 'scroll', 'scroll', 'ink_quill', 'ink_quill', 'candle', 'candle', 'candle'],
    decorative: ['rug_large', 'painting', 'potted_plant'],
    condition: ['clean', 'pristine'],
  },
};

// ── Interior generation ─────────────────────────────────────────────

/** Generate a complete interior for a building. Pure f(seed, typeId, race, tier).
 *  Returns { floor, walls, structure, furniture, objects, decorative, condition }
 *  with specific items placed at positions within the footprint. */
export function generateInterior(seed, typeId, race, tier, footprint) {
  const template = INTERIOR_TEMPLATES[typeId];
  if (!template) {
    // Default minimal interior for types without templates
    return {
      floor: { material: 'wood_plank', name: 'Wood Plank' },
      walls: [],
      structure: [],
      furniture: [],
      objects: [],
      decorative: [],
      condition: { id: 'lived_in', name: 'Lived In', decay: 0.3 },
    };
  }

  const h = mix(seed, typeId.length, 0xE001);

  // I0: Floor — pick material, prefer race-specific if available
  let floorId = template.floor[Math.floor(rand(h, 0xE010) * template.floor.length)];
  if (race) {
    const raceMat = Object.entries(FLOOR_MATERIALS).find(([, m]) => m.race === race);
    if (raceMat && rand(h, 0xE011) < 0.6) floorId = raceMat[0];
  }
  const floor = { material: floorId, name: FLOOR_MATERIALS[floorId]?.name ?? floorId };

  // Wall material: from template or default by tier
  const WALL_DEFAULTS = { village: 'wood', town: 'stone_brick', city: 'stone_brick' };
  const wallMaterial = template.wallMaterial ?? WALL_DEFAULTS[tier] ?? 'wood';

  // I1: Wall features — place on perimeter tiles
  const wallFeatures = [];
  const wallSpec = template.walls;
  for (let i = 0; i < (wallSpec.windows ?? 0); i++) {
    const wtype = rand(h, 0xE020, i) < 0.3 ? 'window_open' : 'window_closed';
    wallFeatures.push({ ...WALL_FEATURES[wtype], id: wtype });
  }
  for (let i = 0; i < (wallSpec.doors ?? 0); i++) {
    wallFeatures.push({ ...WALL_FEATURES.door_wood, id: 'door_wood' });
  }
  for (let i = 0; i < (wallSpec.archways ?? 0); i++) {
    wallFeatures.push({ ...WALL_FEATURES.archway, id: 'archway' });
  }
  for (let i = 0; i < (wallSpec.stained_glass ?? 0); i++) {
    wallFeatures.push({ ...WALL_FEATURES.window_stained, id: 'window_stained' });
  }
  if (rand(h, 0xE025) < 0.05) {
    wallFeatures.push({ ...WALL_FEATURES.secret_door, id: 'secret_door' });
  }

  // I2: Structure
  const structure = template.structure.map((id, i) => ({
    id, ...(STRUCTURE[id] ?? { name: id }), placed: i,
  }));

  // I3: Large furniture — instantiate from template list
  const furniture = template.furniture.map((id, i) => ({
    id, ...(LARGE_FURNITURE[id] ?? { name: id, size: [1, 1], category: 'misc' }),
  }));

  // I4: Small objects
  const objects = template.objects.map((id, i) => ({
    id, ...(SMALL_OBJECTS[id] ?? { name: id }),
  }));

  // I5: Decorative
  const decorative = template.decorative.map((id, i) => ({
    id, ...(DECORATIVE[id] ?? { name: id, placement: 'floor' }),
  }));

  // I6: Condition
  const condId = template.condition[Math.floor(rand(h, 0xE060) * template.condition.length)];
  const condition = { id: condId, ...(CONDITION[condId] ?? CONDITION.lived_in) };

  return { floor, wallMaterial, walls: wallFeatures, structure, furniture, objects, decorative, condition };
}

/** All interior field layer names. */
export const INTERIOR_FIELDS = ['I0_floor', 'I1_walls', 'I2_structure', 'I3_furniture', 'I4_objects', 'I5_decorative', 'I6_condition'];
