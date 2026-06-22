// src/render/facade-archetypes.js — maps every building typeId to a façade-block ARCHETYPE
// (a PixelLab-generated whole-building sprite family). The renderer (building-facade.js) uses
// this map to pick which sprite to draw for a building, then picks a VARIANT by rendezvous hash.
//
// A null mapping = "no façade block for this type" → the renderer returns false and the caller
// falls back to the preserved procedural wall+roof path (honest absence). Most null types are
// genuinely open-air / object-like (fountain, well, bridge, garden, monument…) — they are not
// solid walled buildings and should not be faked as one.
//
// Keep this in sync with the generated archetype folders under
// assets/pixelab/buildings/facade/<biome>/<archetype>/ and facade-manifest.json.

export const ARCHETYPES = [
  'cottage', 'house', 'shopfront', 'workshop', 'barn', 'chapel',
  'civic_hall', 'manor', 'temple', 'round_tower', 'apartment', 'market_stall',
];

// Full on-screen height of each archetype's sprite, in WORLD TILES (wall stack + roof). The sprite
// is scaled so its content height maps to this many tiles, preserving the art's aspect (no stretch),
// then centered on the footprint with its base on the south edge. This decouples the building's
// visual size from the (generous, ×1.5) footprint width — the building sits in its lot with yard
// around it, at realistic proportions. Tune live via window._facadeFit.heightScale.
export const HEIGHT_TILES = {
  // house/manor/civic_hall/market_stall verified in-game. The taller unverified archetypes use
  // conservative values (better slightly small than grotesquely large) — tune live via
  // window._facadeFit.heightScale, then bake the per-archetype values back here.
  cottage: 8, house: 12, shopfront: 10, workshop: 9, barn: 11, chapel: 13,
  civic_hall: 12, manor: 13, temple: 12, round_tower: 14, apartment: 14, market_stall: 7,
};
export function heightTilesFor(arch) { return HEIGHT_TILES[arch] || 10; }

// typeId → archetype (or null for honest-absence fallback).
export const ARCHETYPE_FOR = {
  // residential
  hut: 'cottage', cottage: 'cottage', house: 'house', longhouse: 'house',
  manor: 'manor', villa: 'manor', apartment: 'apartment',
  // commercial
  market_stall: 'market_stall', shop: 'shopfront', warehouse: 'barn',
  trading_post: 'shopfront', inn: 'shopfront', tavern: 'shopfront', bazaar: 'market_stall',
  // craft
  blacksmith: 'workshop', tannery: 'workshop', bakery: 'workshop', pottery: 'workshop',
  weaver: 'workshop', carpenter: 'workshop', alchemist: 'workshop', jeweler: 'shopfront',
  glassblower: 'workshop', dyer: 'workshop', brewer: 'workshop',
  // agricultural
  barn: 'barn', silo: 'round_tower', mill: 'barn', granary: 'barn', greenhouse: 'house',
  stable: 'barn', coop: 'cottage', apiary: 'cottage', vineyard_press: 'workshop',
  // civic
  town_hall: 'civic_hall', courthouse: 'civic_hall', library: 'civic_hall', school: 'civic_hall',
  bathhouse: 'civic_hall', fountain: null, well: null, monument: null, prison: 'civic_hall',
  // religious
  shrine: 'chapel', chapel: 'chapel', temple: 'temple', monastery: 'temple',
  altar: null, oracle_chamber: 'round_tower', burial_ground: null,
  // military
  watchtower: 'round_tower', barracks: 'civic_hall', armory: 'workshop',
  training_ground: null, gate: null, siege_workshop: 'workshop',
  // infrastructure
  bridge: null, dock: null, lighthouse: 'round_tower', road_station: 'cottage',
  waystone: null, cistern: 'round_tower', aqueduct: null,
  // entertainment
  theater: 'civic_hall', arena: null, garden: null, park: null, feast_hall: 'civic_hall',
  // race_specific
  crystal_nexus: 'round_tower', ember_forge: 'workshop', root_hall: 'barn',
  stone_sanctuary: 'civic_hall', tide_lodge: 'house', moss_den: 'cottage',
  sand_pavilion: 'market_stall', frost_hall: 'civic_hall',
};

// Category fallback when a typeId isn't in the map above (new/unknown types).
export const ARCHETYPE_BY_CATEGORY = {
  residential: 'house', commercial: 'shopfront', craft: 'workshop',
  agricultural: 'barn', civic: 'civic_hall', religious: 'chapel',
  military: 'civic_hall', infrastructure: null, entertainment: 'civic_hall',
  race_specific: 'house',
};

// Is this building's type KNOWN to the façade system (mapped to an archetype OR explicitly to null
// as an open/object type)? Mapped-to-null means "intentionally no walled façade" (well, fountain,
// monument, bridge…) → the renderer suppresses the old tile walls and draws nothing (honest
// absence), rather than faking it as a brown walled box. Only truly UNKNOWN types fall back.
export function isMappedType(b) {
  const fp = b && b.footprint;
  if (!fp) return false;
  return (fp.typeId && Object.prototype.hasOwnProperty.call(ARCHETYPE_FOR, fp.typeId))
    || (fp.category && Object.prototype.hasOwnProperty.call(ARCHETYPE_BY_CATEGORY, fp.category));
}

// Resolve a building's archetype from its footprint (typeId first, then category). null → fallback.
export function archetypeForBuilding(b) {
  const fp = b && b.footprint;
  if (!fp) return null;
  const t = fp.typeId;
  if (t && Object.prototype.hasOwnProperty.call(ARCHETYPE_FOR, t)) return ARCHETYPE_FOR[t];
  if (fp.category && Object.prototype.hasOwnProperty.call(ARCHETYPE_BY_CATEGORY, fp.category)) return ARCHETYPE_BY_CATEGORY[fp.category];
  return null;
}
