// scripts/d2-vine-prompts.mjs — deterministic D2 climbing-plant (vine) prompt generator for the all-biomes
// burst. Encodes each biome's PLANT SKIN (from the D2 manifest d2_ivy_vines.biomeSkins + d2_climbing_roots) ×
// the 4 spline-kit pieces. The kit STRUCTURE + the placement engine (vine-index.js) are biome-INVARIANT — this
// only varies the ART per biome, so "the climbing plant that fits the biome" rather than ivy everywhere.
//
// Three skin KINDS:
//   • leafy  — ivy / liana / creeper / glow-tendril: all 4 pieces (segment, root_base, fork, leaf_cluster).
//   • roots  — woody, LEAFLESS climbing roots (arid/frozen, where a leafy vine doesn't belong): NO leaf_cluster.
//   • (dropped) — water biomes on stilts: no wall-base to root → honest absence, generate nothing.
//
// Output: JSON { biome: { piece: { px, tag, prompt, kind } } }. Pieces are create_1_direction_object
// (sidescroller, 64px). Usage: node scripts/d2-vine-prompts.mjs [biome]  → pipe into the fire/track loop.

// ---- always-keep clauses ----
const A_BG = 'on a FULLY TRANSPARENT background — the plant ONLY, no wall, no ground, nothing else';
const A_VIEW = 'front-facing flat orthographic SIDESCROLLER view, as clinging flat to a vertical wall, even lighting';
const A_PIX = 'crisp pixel-art, clean alpha edges, render NO legible text';
const A_TILE = 'designed so the stem connects SEAMLESSLY top-to-bottom when stacked vertically';

// ---- per-biome plant skin profiles ----
// kind: 'leafy' | 'roots'. plant = the species phrase; stem = the woody stem look; leaf = the foliage look
// (leafy only); glow = optional in-engine-emissive note; fork = 'dense' for canopy-formers. Water biomes are
// OMITTED entirely (dropped — honest absence).
const BIOMES = {
  grassland:       { kind:'leafy', plant:'green English ivy', stem:'a thin woody brown stem with little clinging rootlets', leaf:'small glossy dark-green ivy leaves', glow:'' },
  forest:          { kind:'leafy', plant:'woodland green ivy', stem:'a woody brown stem', leaf:'green ivy leaves', glow:'' },
  hills:           { kind:'leafy', plant:'hardy green ivy', stem:'a wiry woody stem', leaf:'small green ivy leaves', glow:'' },
  lake:            { kind:'leafy', plant:'lush damp ivy', stem:'a moist woody stem', leaf:'lush green leaves', glow:'' },
  river:           { kind:'leafy', plant:'lush damp ivy', stem:'a moist woody stem', leaf:'lush green leaves', glow:'' },
  dense_forest:    { kind:'leafy', plant:'dark mossy creeper', stem:'a moss-furred dark stem', leaf:'dark serrated mossy leaves', glow:'' },
  tropical_forest: { kind:'leafy', plant:'thick jungle liana', stem:'a thick woody liana with hanging aerial roots', leaf:'broad glossy tropical leaves', glow:'', fork:'dense' },
  swamp:           { kind:'leafy', plant:'swamp mangrove liana', stem:'a thick woody liana with dangling aerial roots', leaf:'broad waxy swamp leaves', glow:'', fork:'dense' },
  mystic:          { kind:'leafy', plant:'enchanted glowing wardvine', stem:'a pale silvery tendril', leaf:'faintly luminous blue-violet foliage', glow:' Add a SUBTLE cool blue-violet emissive sheen to the leaves (the in-engine glow is separate; do NOT bake a large halo).' },
  savanna:         { kind:'leafy', plant:'sparse dry creeper', stem:'a dry pale-brown stem', leaf:'sparse small sun-dried leaves', glow:'' },
  steppe:          { kind:'leafy', plant:'sparse dry creeper', stem:'a dry wiry stem', leaf:'sparse small grey-green leaves', glow:'' },
  mountains:       { kind:'leafy', plant:'hardy alpine creeper', stem:'a tough lichen-streaked woody stem', leaf:'small leathery alpine leaves', glow:'' },
  taiga:           { kind:'leafy', plant:'hardy boreal creeper', stem:'a tough dark stem', leaf:'small dark needled leaves', glow:'' },
  beach:           { kind:'leafy', plant:'salt-tolerant beach creeper', stem:'a pale fleshy stem', leaf:'small waxy sea-green leaves', glow:'' },
  // ---- roots skins (leafless woody climbers, arid/frozen) ----
  desert:          { kind:'roots', plant:'dry woody desert climbing roots', stem:'pale sun-bleached woody tendrils hugging the wall crevices', leaf:'', glow:'' },
  volcanic:        { kind:'roots', plant:'charred blackened climbing roots', stem:'charred woody tendrils gripping the wall', leaf:'', glow:' Add a SUBTLE warm ember glow to the lower tendrils (the in-engine glow is separate; do NOT bake a large halo).' },
  arctic:          { kind:'roots', plant:'frost-killed bare woody vine', stem:'pale frost-rimed dead tendrils', leaf:'', glow:'' },
  tundra:          { kind:'roots', plant:'frost-killed bare woody vine', stem:'pale frost-rimed dead tendrils', leaf:'', glow:'' },
  // ocean / deep_ocean / shallow_water — DROPPED (stilts over water, no wall-base to root): omitted on purpose.
};

// ---- kit-piece templates. b = biome skin. leaf pieces only emitted for kind==='leafy'. ----
const PIECES = {
  vine_root_base: { px:64, kinds:['leafy','roots'], f:(b)=>`The rooted BASE of ${b.plant} at the foot of a wall: a thicker woody base where ${b.stem} emerges from the ground${b.kind==='leafy'?`, a few ${b.leaf} low down`:''}, with a small soft ground-contact shadow at its foot so it reads as rooted.${b.glow} ${A_BG}. ${A_VIEW}. ${A_PIX}.` },
  vine_segment:   { px:64, kinds:['leafy','roots'], f:(b)=>`A short vertical section of ${b.plant} clinging to a wall: ${b.stem} running top-to-bottom${b.kind==='leafy'?` with small clusters of ${b.leaf} along it`:''}, ${A_TILE}.${b.glow} ${A_BG}. ${A_VIEW}. ${A_PIX}.` },
  vine_fork:      { px:64, kinds:['leafy','roots'], f:(b)=>`A Y-branch junction of ${b.plant}: ${b.stem} splitting into two shoots that diverge upward${b.kind==='leafy'?`, each carrying ${b.leaf}`:''}.${b.glow} ${A_BG}. ${A_VIEW}. ${A_PIX}.` },
  vine_leaf_cluster: { px:64, kinds:['leafy'], f:(b)=>`A small dense cluster of ${b.leaf} — the leafy growth tip of ${b.plant}, a few loose overlapping leaves on a short bit of ${b.stem}.${b.glow} ${A_BG}. ${A_VIEW}. ${A_PIX}.` },
};

const PIECE_ORDER = ['vine_root_base', 'vine_segment', 'vine_fork', 'vine_leaf_cluster'];

const biomeArg = process.argv[2];
const out = {};
for (const [biome, prof] of Object.entries(BIOMES)) {
  if (biomeArg && biome !== biomeArg) continue;
  out[biome] = {};
  for (const piece of PIECE_ORDER) {
    const tpl = PIECES[piece];
    if (!tpl.kinds.includes(prof.kind)) continue; // e.g. leaf_cluster skipped for roots skins
    out[biome][piece] = { px: tpl.px, kind: prof.kind, tag: `d2vine_${piece}_${biome}`, prompt: tpl.f({ ...prof }) };
  }
}
console.log(JSON.stringify(out, null, 1));
