// src/world/asset-state-taxonomy.js — machine form of docs/superpowers/specs/2026-06-11-asset-state-taxonomy.md.
// Pure data + two pure functions. No imports: consumed by both renderer and sim tests.

export const SPINE = ['seedling', 'growing', 'mature', 'flourishing', 'wilting', 'senescent', 'dead', 'decaying', 'gone'];

export const CORE_VISUAL = ['seedling', 'normal', 'wilting', 'dead'];

export const SPINE_TO_VISUAL = {
  seedling: 'seedling', growing: 'normal', mature: 'normal', flourishing: 'normal',
  wilting: 'wilting', senescent: 'wilting', dead: 'dead', decaying: 'dead', gone: null,
};

/** Reserve-buffer thresholds (days of burn covered by R). Taxonomy constants, not species knobs. */
export const CONDITION = { wiltBelowDays: 2, flourishAboveDays: 10 };

export const AXES = {
  yield: ['budding', 'fruiting', 'harvested'],
  damage: ['crushed', 'cut', 'broken', 'cracked', 'destroyed', 'stump', 'snag'],
  dress: ['burned', 'frozen', 'enchanted', 'mossy_overgrown', 'decayed'],
};

/** Kernel truth → spine state. bufferDays = R / dailyBurn (null when unknown: never wilt on ignorance). */
export function spineStateOf({ stage, ageTicks = 0, senescenceStartTicks = Infinity, bufferDays = null }) {
  if (stage === 'corpse') return 'decaying';
  if (stage !== 'mature') return stage;                       // seedling | growing pass through
  if (bufferDays != null && bufferDays < CONDITION.wiltBelowDays) return 'wilting';
  if (ageTicks >= senescenceStartTicks) return 'senescent';
  if (bufferDays != null && bufferDays > CONDITION.flourishAboveDays) return 'flourishing';
  return 'mature';
}

/** Spine state → on-disk visual state (null = render nothing). */
export function visualStateOf(spineState) {
  return SPINE_TO_VISUAL[spineState] ?? null;
}

/** Requirement sheets. Marks: E exists on disk, R required (existing pipeline), T renderer transform, F future pass.
 *  `states` use the core-visual + axes vocabulary ('base' = the unstated base sprite for matter;
 *  'growing' admitted for F6's dedicated sapling sprite — sheet overrides the default map, spec doc §2). */
export const FIELD_SHEETS = {
  _meta: {
    marks: { E: 'exists', R: 'required', T: 'transform', F: 'future' },
    SPECIES_CLASS: { grass: 'F2', berry_bush: 'F4', tree: 'F6', grazer: 'fauna', rabbit: 'fauna', deer: 'fauna', wolf: 'fauna' },
    // Pass 4 L1: humanoid races live in the sim but have NO bodies until L2 —
    // honest absence: they are not rendered at all (no placeholder capsules),
    // so they bind to no sheet and their life stages (infant…elderly) are not
    // spine vocabulary. L2 body assembly replaces entries here with real classes.
    UNRENDERED: ['human', 'elf', 'dwarf', 'orc'],
  },
  F2: { px: 32, kind: 'life', diskDir: 'small_flora',
    states: { normal: 'E', seedling: 'T', wilting: 'R', dead: 'R', frozen: 'F', enchanted: 'F' } },
  F3: { px: 32, kind: 'matter', diskDir: 'small_scatter',
    layout: 'flat',   // _states/<biome>/<archetype>/files named *__state__<name>.png (not subdirs)
    states: { base: 'E', decayed: 'E', cracked: 'E', destroyed: 'E', burned: 'E', frozen: 'E', enchanted: 'E' } },
  F4: { px: 64, kind: 'life', diskDir: 'medium_flora',
    states: { normal: 'E', seedling: 'E', wilting: 'E', dead: 'E', crushed: 'E', burned: 'E', frozen: 'E', enchanted: 'E' } },
  F5: { px: 96, kind: 'matter', diskDir: 'medium_objects',
    states: { base: 'E', cracked: 'R', destroyed: 'R', mossy_overgrown: 'R', burned: 'R', frozen: 'R', enchanted: 'R' } },
  F6: { px: 192, kind: 'life', diskDir: 'large_objects',
    states: { seedling: 'R', growing: 'R', normal: 'R', wilting: 'R', dead: 'R', stump: 'R', snag: 'R', burned: 'R',
              budding: 'R', fruiting: 'R', harvested: 'R', frozen: 'F', enchanted: 'F' } },
  F7: { px: 192, kind: 'life', diskDir: 'canopy',
    states: { normal: 'R', wilting: 'R' } },
  fauna: { px: 64, kind: 'life', diskDir: null,
    states: { seedling: 'F', normal: 'F', wilting: 'F', dead: 'F' } },
};
