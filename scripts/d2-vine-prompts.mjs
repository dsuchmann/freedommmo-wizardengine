// scripts/d2-vine-prompts.mjs — per-biome D2 WALL-ACCRETION prompt generator (the generalized "vine").
//
// NOT always a vine (user 2026-06-26): each biome expresses a different climbing/accreting thing, with its own
// FORM — both a SHAPE (placement engine: src/render/dressing/vine-index.js SHAPE_PROFILES) and ART (here):
//   • vine    — leafy climber (ivy / liana / creeper)            grassland, forest, swamp, …
//   • crystal — crystalline tendrils + crystal clusters           mystic, arctic, tundra
//   • column  — basalt / lava PILLARS rising from the base        volcanic
//   • spire   — jagged mineral spires (stalagmite/flowstone)      mountains
//   • mound   — a sand-drift BUILDUP hugging the wall base        desert
// Keep the biome→form map in sync with vine-index.js BIOME_FORM.
//
// Kit SLOTS are biome-invariant (the renderer reads these per biome): vine_root_base / vine_segment / vine_fork
// / vine_leaf_cluster. vine_leaf_cluster is the "tip"/showy piece — a leaf tuft for vines, a crystal cluster, a
// column crown, a spire point, a sand crest. The ART per slot expresses the form. Output:
//   { biome: { slot: { px, kind, tag, prompt } } }.   Usage: node scripts/d2-vine-prompts.mjs [biome]

const A_BG = 'on a FULLY TRANSPARENT background — the growth ONLY, no wall, no ground, nothing else';
const A_VIEW = 'front-facing flat orthographic SIDESCROLLER view, clinging flat to a vertical wall, even lighting';
const A_PIX = 'crisp pixel-art, clean alpha edges, render NO legible text';
const A_TILE = 'designed to connect SEAMLESSLY when stacked end-to-end';

// piece templates per FORM. b = the biome skin object (fields vary by form).
const FORMS = {
  vine: {
    vine_root_base:    (b) => `The rooted BASE of ${b.plant} at the foot of a wall: a thicker woody base where ${b.stem} emerges from the ground, a few ${b.leaf} low down, a small soft ground-contact shadow.${b.glow} ${A_BG}. ${A_VIEW}. ${A_PIX}.`,
    vine_segment:      (b) => `A short vertical section of ${b.plant} clinging to a wall: ${b.stem} with small clusters of ${b.leaf} along it, ${A_TILE} vertically.${b.glow} ${A_BG}. ${A_VIEW}. ${A_PIX}.`,
    vine_fork:         (b) => `A Y-branch junction of ${b.plant}: ${b.stem} splitting into two leafy shoots diverging upward, each with ${b.leaf}.${b.glow} ${A_BG}. ${A_VIEW}. ${A_PIX}.`,
    vine_leaf_cluster: (b) => `A small dense cluster of ${b.leaf} — the leafy growth tip of ${b.plant}.${b.glow} ${A_BG}. ${A_VIEW}. ${A_PIX}.`,
  },
  crystal: {
    vine_root_base:    (b) => `The BASE of ${b.crystal} growing up a wall: a thick angular cluster of ${b.crystal} sprouting from the wall foot where ${b.tendril} begins, a small ground-contact shadow.${b.glow} ${A_BG}. ${A_VIEW}. ${A_PIX}.`,
    vine_segment:      (b) => `A short vertical section of ${b.tendril} creeping up a wall, studded with small ${b.crystal}, ${A_TILE} vertically.${b.glow} ${A_BG}. ${A_VIEW}. ${A_PIX}.`,
    vine_fork:         (b) => `A junction where ${b.tendril} splits into two, each carrying small ${b.crystal}.${b.glow} ${A_BG}. ${A_VIEW}. ${A_PIX}.`,
    vine_leaf_cluster: (b) => `A showy faceted cluster of sharp angular ${b.crystal} — the growth tip catching light.${b.glow} ${A_BG}. ${A_VIEW}. ${A_PIX}.`,
  },
  column: {
    vine_root_base:    (b) => `The BASE of a ${b.material} pillar rising against a wall: a thick rough ${b.material} mass at the wall foot${b.core}, a small ground-contact shadow.${b.glow} ${A_BG}. ${A_VIEW}. ${A_PIX}.`,
    vine_segment:      (b) => `A short vertical section of a ${b.material} pillar climbing a wall — rough hexagonal-jointed ${b.material}${b.core}, ${A_TILE} vertically into one continuous column.${b.glow} ${A_BG}. ${A_VIEW}. ${A_PIX}.`,
    vine_fork:         (b) => `A point where a ${b.material} pillar buds a smaller offshoot column to one side${b.core}.${b.glow} ${A_BG}. ${A_VIEW}. ${A_PIX}.`,
    vine_leaf_cluster: (b) => `The craggy CROWN/top of a ${b.material} pillar${b.core}.${b.glow} ${A_BG}. ${A_VIEW}. ${A_PIX}.`,
  },
  spire: {
    vine_root_base:    (b) => `The thick BASE of a jagged ${b.mineral} spire rising from the wall foot like a stalagmite, banded mineral, a small ground-contact shadow. ${A_BG}. ${A_VIEW}. ${A_PIX}.`,
    vine_segment:      (b) => `A short vertical section of a jagged ${b.mineral} spire climbing a wall — angular banded ${b.mineral}, ${A_TILE} vertically. ${A_BG}. ${A_VIEW}. ${A_PIX}.`,
    vine_fork:         (b) => `A jagged ${b.mineral} spire splitting into two sharp points. ${A_BG}. ${A_VIEW}. ${A_PIX}.`,
    vine_leaf_cluster: (b) => `The sharp POINTED TIP of a ${b.mineral} spire — a small clustered cap of mineral points. ${A_BG}. ${A_VIEW}. ${A_PIX}.`,
  },
  mound: {
    vine_root_base:    (b) => `A low BUILDUP of ${b.grain} drifted against the foot of a wall — a soft wind-piled mound, rippled, with a small ground-contact shadow. ${A_BG}. ${A_VIEW}. ${A_PIX}.`,
    vine_segment:      (b) => `A short low section of ${b.grain} drift along the base of a wall — rippled wind-piled grains, ${A_TILE} HORIZONTALLY. ${A_BG}. ${A_VIEW}. ${A_PIX}.`,
    vine_fork:         (b) => `A low lobe of ${b.grain} drift branching to one side at the wall base. ${A_BG}. ${A_VIEW}. ${A_PIX}.`,
    vine_leaf_cluster: (b) => `A small wind-blown CREST of ${b.grain} at the top of a base drift. ${A_BG}. ${A_VIEW}. ${A_PIX}.`,
  },
};
const SLOTS = ['vine_root_base', 'vine_segment', 'vine_fork', 'vine_leaf_cluster'];

// per-biome FORM + skin object (fields match the form's template needs).
const BIOMES = {
  // ---- vine (leafy climbers) ----
  grassland:       { form: 'vine', skin: { plant: 'green English ivy', stem: 'a thin woody brown stem', leaf: 'small glossy dark-green ivy leaves', glow: '' } },
  forest:          { form: 'vine', skin: { plant: 'woodland green ivy', stem: 'a woody brown stem', leaf: 'green ivy leaves', glow: '' } },
  hills:           { form: 'vine', skin: { plant: 'hardy green ivy', stem: 'a wiry woody stem', leaf: 'small green ivy leaves', glow: '' } },
  lake:            { form: 'vine', skin: { plant: 'lush damp ivy', stem: 'a moist woody stem', leaf: 'lush green leaves', glow: '' } },
  river:           { form: 'vine', skin: { plant: 'lush damp ivy', stem: 'a moist woody stem', leaf: 'lush green leaves', glow: '' } },
  dense_forest:    { form: 'vine', skin: { plant: 'dark mossy creeper', stem: 'a moss-furred dark stem', leaf: 'dark serrated mossy leaves', glow: '' } },
  tropical_forest: { form: 'vine', skin: { plant: 'thick jungle liana', stem: 'a thick woody liana with hanging aerial roots', leaf: 'broad glossy tropical leaves', glow: '' } },
  swamp:           { form: 'vine', skin: { plant: 'swamp mangrove liana', stem: 'a thick woody liana with dangling aerial roots', leaf: 'broad waxy swamp leaves', glow: '' } },
  savanna:         { form: 'vine', skin: { plant: 'sparse dry creeper', stem: 'a dry pale-brown stem', leaf: 'sparse small sun-dried leaves', glow: '' } },
  steppe:          { form: 'vine', skin: { plant: 'sparse dry creeper', stem: 'a dry wiry stem', leaf: 'sparse small grey-green leaves', glow: '' } },
  taiga:           { form: 'vine', skin: { plant: 'hardy boreal creeper', stem: 'a tough dark stem', leaf: 'small dark needled leaves', glow: '' } },
  beach:           { form: 'vine', skin: { plant: 'salt-tolerant beach creeper', stem: 'a pale fleshy stem', leaf: 'small waxy sea-green leaves', glow: '' } },
  // ---- crystal (tendrils + crystal clusters) ----
  mystic:          { form: 'crystal', skin: { crystal: 'glowing blue-violet astral crystals', tendril: 'a pale silvery crystalline tendril', glow: ' Add a SUBTLE cool blue-violet emissive sheen (the in-engine glow is separate; do NOT bake a large halo).' } },
  arctic:          { form: 'crystal', skin: { crystal: 'clear pale-blue ICE crystals', tendril: 'a frosted icy tendril', glow: '' } },
  tundra:          { form: 'crystal', skin: { crystal: 'frost-rimed pale ice crystals', tendril: 'a frost-crusted tendril', glow: '' } },
  // ---- column (basalt / lava pillars) ----
  volcanic:        { form: 'column', skin: { material: 'black basalt', core: ' threaded with glowing red-orange molten lava in the seams', glow: ' Add a SUBTLE warm ember glow in the lava cracks (the in-engine glow is separate; do NOT bake a large halo).' } },
  // ---- spire (jagged mineral) ----
  mountains:       { form: 'spire', skin: { mineral: 'grey-brown banded flowstone' } },
  // ---- mound (basal sand drift) ----
  desert:          { form: 'mound', skin: { grain: 'pale golden sand' } },
  // ocean / deep_ocean / shallow_water — no wall-base growth (stilts over water): omitted.
};

const biomeArg = process.argv[2];
const out = {};
for (const [biome, def] of Object.entries(BIOMES)) {
  if (biomeArg && biome !== biomeArg) continue;
  const tpl = FORMS[def.form];
  out[biome] = {};
  for (const slot of SLOTS) {
    out[biome][slot] = { px: 64, kind: def.form, tag: `d2_${slot}_${biome}`, prompt: tpl[slot]({ ...def.skin }) };
  }
}
console.log(JSON.stringify(out, null, 1));
