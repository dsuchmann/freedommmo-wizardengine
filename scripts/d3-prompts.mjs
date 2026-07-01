// scripts/d3-prompts.mjs — deterministic D3 prop prompt generator for the all-biomes scale-out.
// Encodes each biome's skin profile (crossBiomeNotes rules: host-swap / climate-default / flora-reskin /
// lit-multiplier / magical-variant) × the 13 HERO (placed) prop templates with the manifest's always-keep
// clauses. Output: JSON { biome: { object_id: { px, tag, prompt } } }. Props are create_1_direction_object
// objects (sidescroller). Placement is biome-agnostic (d3-props.js) — this only varies the ART per biome.

// ---- biome skin profiles (the 11 biomes that have a building tile-corpus) ----
const BIOMES = {
  desert:       { wood:'sun-bleached pale driftwood timber', cloth:'sun-faded ochre and sand canvas', iron:'sun-worn black iron', clime:'sun-bleached, sun_faded paint', blooms:'desert blooms (orange bougainvillea, red cactus flowers)', glow:'' },
  mystic:       { wood:'pale enchanted silver-grey timber', cloth:'shimmering enchanted weave', iron:'polished wardmetal silver', clime:'faintly luminous', blooms:'glowing astral flora (blue-white luminous blossoms)', glow:' Add a SUBTLE cool blue-violet magical emissive sheen to the body (the in-engine glow is separate; do not bake a large halo).' },
  dense_forest: { wood:'mossy weathered oak timber', cloth:'forest-green and moss linen', iron:'green-patinaed iron', clime:'damp, faint moss', blooms:'woodland blooms (ferns, foxglove, toadstools)', glow:'' },
  forest:       { wood:'carved pine and birch timber', cloth:'woodland green and warm brown cloth', iron:'plain dark iron', clime:'clean', blooms:'woodland wildflowers (bluebells, daisies)', glow:'' },
  hills:        { wood:'honest oak timber', cloth:'earthy wool cloth', iron:'plain wrought iron', clime:'clean', blooms:'meadow blooms (heather, buttercups)', glow:'' },
  mountains:    { wood:'rugged pine timber', cloth:'heavy grey wool, snow-dusted upper fold', iron:'cold rusted iron', clime:'snow_capped, frost-glassed', blooms:'alpine blooms (edelweiss, gentian)', glow:'' },
  savanna:      { wood:'dry acacia timber', cloth:'sun-faded earthen ochre cloth', iron:'plain dark iron', clime:'sun-baked, sun_faded', blooms:'dry-grassland blooms (aloe flower, protea)', glow:'' },
  steppe:       { wood:'weathered grey timber', cloth:'felted earthen wool', iron:'plain iron', clime:'wind-worn', blooms:'steppe blooms (wild tulip, feather-grass tufts)', glow:'' },
  taiga:        { wood:'spruce and pine timber', cloth:'oiled heavy canvas, snow-frosted', iron:'cold dark iron', clime:'snow_frosted', blooms:'hardy boreal blooms (fireweed, lingonberry)', glow:'' },
  tundra:       { wood:'pale driftwood and bone timber', cloth:'heavy oiled hide cloth, snow-capped', iron:'frost-rimed iron', clime:'snow_capped, frost', blooms:'tiny tundra blooms (arctic poppy, moss campion)', glow:'' },
  volcanic:     { wood:'charred blackened timber', cloth:'ash-grey scorched canvas', iron:'blackened heat-tempered iron', clime:'ash-dusted, scorched edges', blooms:'ember-tolerant flora (red-hot poker, ash lily)', glow:' Add a SUBTLE warm ember glow to the lower edges (the in-engine glow is separate; do not bake a large halo).' },
};

// ---- always-keep clauses ----
const A_BG = 'on a FULLY TRANSPARENT background — the prop ONLY, no wall, no ground, nothing else';
const A_VIEW = 'front-facing flat orthographic SIDESCROLLER view, as mounted on a vertical wall, even lighting';
const A_PIX = 'crisp pixel-art, consistent scale, clean alpha edges, render NO legible text';
const A_LIT = 'the BODY only — the glow is added in-engine; do NOT bake a large light halo or bloom';
const A_CLOTH = 'hanging at rest with a natural drape; sway is added in-engine';

// ---- the 13 hero prop templates. b = biome profile. ----
const PROPS = {
  iron_candle_lantern:   { px:64,  f:b=>`A SINGLE iron-and-glass candle lantern to flank a doorway, centered, ${A_BG}. ${b.iron} frame, four clear glass panes, a lit warm candle inside giving a soft amber core — ${A_LIT}.${b.glow} ${A_VIEW}. ${A_PIX}.` },
  wall_oil_lamp:         { px:64,  f:b=>`A SINGLE brass bracket wall oil lamp, centered, ${A_BG}. ${b.iron==='polished wardmetal silver'?'wardmetal':'brass'} bracket and a clear glass font with a small warm flame — ${A_LIT}.${b.glow} ${A_VIEW}. ${A_PIX}.` },
  swinging_trade_sign:   { px:96,  f:b=>`A SINGLE hanging wooden trade-shop sign on an iron hook-and-eye bracket, centered, ${A_BG}. Board of ${b.wood}, ${b.clime}, with a simple painted trade device (a generic shape, NOT words). ${A_CLOTH}. ${A_VIEW}. ${A_PIX}.` },
  projecting_board_sign: { px:96,  f:b=>`A SINGLE rigid trade-shop board sign projecting flat from a wall on a short arm, centered, ${A_BG}. Board of ${b.wood}, ${b.clime}, a simple painted trade device (a shape, NOT words). ${A_VIEW}. ${A_PIX}.` },
  wrought_iron_silhouette_sign: { px:96, f:b=>`A SINGLE forged ${b.iron} silhouette trade sign (an openwork iron shape of a trade device) hanging from a scrollwork bracket, centered, ${A_BG}.${b.glow} ${A_VIEW}. ${A_PIX}.` },
  heraldic_banner:       { px:128, f:b=>`A SINGLE long vertical heraldic banner hanging from a top crossbar, centered, ${A_BG}. ${b.cloth}, a bold heraldic device/tincture (a shape, NOT words). ${A_CLOTH}.${b.glow} ${A_VIEW}. ${A_PIX}.` },
  // AWNINGS — corrected construction (user 2026-06-25 + believable-placement review): a PROJECTING canopy/hood
  // whose LOWER HALF is EMPTY so the doorway stays open; NO back wall, NO side curtains, NO legs/posts to the
  // ground (those cover the door). Reviewed over a real door via scripts/dressing-review.mjs before bursting.
  cloth_market_awning:   { px:128, f:b=>`A SINGLE shop door-awning: a WIDE, SHALLOW striped ${b.cloth} canopy that PROJECTS OUT over a doorway — ONLY the slanted canopy top plus a short scalloped front valance. The canopy fills only the UPPER portion; the LOWER HALF of the image is EMPTY and transparent (the doorway underneath stays OPEN and uncovered). NO back wall, NO side curtains, NO legs or posts, NO fabric draping over the entrance. ${b.clime}. ${A_BG}. ${A_VIEW}. ${A_PIX}.` },
  wood_slat_awning:      { px:128, f:b=>`A SINGLE wooden pent-roof door-hood that PROJECTS OUT over a doorway on two short iron wall-brackets — a small slatted ${b.wood} lean-to roof, slats running front-to-back. ONLY the slanted roof and its two brackets; the LOWER HALF of the image is EMPTY and transparent (the doorway stays OPEN below). NO back panel, NO posts reaching the ground. ${b.clime}. ${A_BG}. ${A_VIEW}. ${A_PIX}.` },
  fringed_shop_canopy:   { px:128, f:b=>`A SINGLE shop door-canopy: a WIDE, SHALLOW ${b.cloth} canopy that PROJECTS OUT over a doorway with a short hanging fringe along its front edge — ONLY the slanted canopy top + the fringe. The canopy fills only the UPPER portion; the LOWER HALF of the image is EMPTY and transparent (the doorway stays OPEN below). NO back wall, NO side curtains, NO LEGS OR POSTS reaching down over the entrance. ${A_BG}. ${A_VIEW}. ${A_PIX}.` },
  timber_flower_box:     { px:64,  f:b=>`A SINGLE window-sill flower box planted with ${b.blooms}, centered, ${A_BG}. Box of ${b.wood}; the BLOOMS will sway in wind while the box stays planted. ${A_VIEW}. ${A_PIX}.` },
  strung_festival_lights:{ px:64,  f:b=>`A SINGLE small glowing paper lantern node for a strung festoon (ONE lantern only; it is tiled along a line in-engine), centered, ${A_BG}. Warm-glowing paper lantern — ${A_LIT}.${b.glow} ${A_VIEW}. ${A_PIX}.` },
  triangle_bunting:      { px:64,  f:b=>`A SINGLE triangular cloth pennant for strung bunting (ONE pennant only; tiled along a line in-engine), centered, ${A_BG}. ${b.cloth} in festive colours. ${A_CLOTH}. ${A_VIEW}. ${A_PIX}.` },
  festoon_garland:       { px:64,  f:b=>`A SINGLE draped garland swag segment (ONE swag only; tiled along a line in-engine), centered, ${A_BG}. Woven ${b.blooms} and foliage. ${A_CLOTH}. ${A_VIEW}. ${A_PIX}.` },
};

const ORDER = {
  A: ['iron_candle_lantern','wall_oil_lamp','timber_flower_box','swinging_trade_sign','heraldic_banner'],
  B: ['projecting_board_sign','wrought_iron_silhouette_sign','cloth_market_awning','wood_slat_awning','fringed_shop_canopy'],
  C: ['strung_festival_lights','triangle_bunting','festoon_garland'],
};

const tierArg = process.argv[2]; // 'A'|'B'|'C' or biome name
const biomeArg = process.argv[3];
const out = {};
for (const [biome, prof] of Object.entries(BIOMES)) {
  if (biomeArg && biome !== biomeArg) continue;
  out[biome] = {};
  const keys = tierArg && ORDER[tierArg] ? ORDER[tierArg] : Object.keys(PROPS);
  for (const k of keys) {
    out[biome][k] = { px: PROPS[k].px, tag: `d3_${k}_${biome}`, prompt: PROPS[k].f(prof) };
  }
}
console.log(JSON.stringify(out, null, 1));
