// sim/life/identity.js — Pass 4 L1: Identity. PURE DERIVATION, nothing stored
// (M1 derived-composition precedent): name, personality traits, and attributes
// are f(worldSeed, nodeId) via the order-independent rng — bit-deterministic,
// zero save/load surface. Future trait drift (L8 Mind) layers stored deltas
// over this derived baseline; until then identity is fixed at birth.
// PRIVACY (locked decision 3): traits/attributes are sim-side ONLY and must
// never cross the wire — minds are private. The NAME is observable (wire-safe).
// HONEST ABSENCES: no behavior from traits (L6 Agency), no bodies (L2), no
// fetus stage (L5 gestation), attribute roster trimmed to 6 (rest land when
// something consumes them).
import { rand } from '../kernel/rng.js';
import { stageAt } from '../time/metabolism.js';

export const RACES = ['human', 'elf', 'dwarf', 'orc'];

// TIME_SYSTEM personality vocabulary (10 traits, signed [-1,1]).
export const TRAITS = [
  'empathy', 'sociopathy', 'leadership', 'aggression', 'curiosity',
  'loyalty', 'greed', 'fear', 'courage', 'patience',
];

// Classic six (consumers: L2 body, L6 agency). [0,1] after race modifier + clamp.
export const ATTRIBUTES = [
  'strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma',
];

export const RACE_ATTR_MODIFIERS = {
  human: {},
  elf:   { dexterity: 0.15, wisdom: 0.10, constitution: -0.10 },
  dwarf: { constitution: 0.15, strength: 0.10, dexterity: -0.10 },
  orc:   { strength: 0.20, constitution: 0.10, intelligence: -0.15 },
};

// rng salts — unique per derived quantity (lifecycle.js owns 101/102/200/303).
const TRAIT_SALT = 4100;
const ATTR_SALT = 4200;
const NAME_SALT = 4300;

export function traitsOf(seed, nodeId) {
  const out = {};
  TRAITS.forEach((t, i) => { out[t] = rand(seed, nodeId, TRAIT_SALT + i) * 2 - 1; });
  return out;
}

export function attributesOf(seed, nodeId, race) {
  const mods = RACE_ATTR_MODIFIERS[race] ?? {};
  const out = {};
  ATTRIBUTES.forEach((a, i) => {
    const base = 0.2 + rand(seed, nodeId, ATTR_SALT + i) * 0.6;   // [0.2, 0.8)
    out[a] = Math.min(1, Math.max(0, base + (mods[a] ?? 0)));
  });
  return out;
}

const NAME_PARTS = {
  human: {
    first: ['Al', 'Ber', 'Cor', 'Dun', 'Ed', 'Fay', 'Gil', 'Hal', 'Isa', 'Jon',
            'Kat', 'Lor', 'Mar', 'Nor', 'Os', 'Per', 'Quin', 'Ros', 'Tam', 'Wil'],
    second: ['da', 'den', 'fred', 'la', 'lin', 'mund', 'na', 'ric', 'son', 'ton', 'win', 'wyn'],
  },
  elf: {
    first: ['Ae', 'Cael', 'Elo', 'Fae', 'Gala', 'Ila', 'Lua', 'Nim', 'Sylv', 'Thal'],
    second: ['driel', 'lien', 'lor', 'mir', 'nor', 'rian', 'thiel', 'wen'],
  },
  dwarf: {
    first: ['Bal', 'Dur', 'Gim', 'Gro', 'Khar', 'Mor', 'Thra', 'Thor', 'Ulf', 'Vor'],
    second: ['din', 'grim', 'li', 'nar', 'rik', 'run', 'und', 'zad'],
  },
  orc: {
    first: ['Az', 'Bol', 'Dru', 'Gar', 'Ghor', 'Krag', 'Mok', 'Rok', 'Thok', 'Urz'],
    second: ['ash', 'dak', 'gar', 'gha', 'mok', 'nak', 'rok', 'zug'],
  },
};

export function nameOf(seed, nodeId, race) {
  const parts = NAME_PARTS[race];
  if (!parts) return null;
  const f = parts.first[Math.floor(rand(seed, nodeId, NAME_SALT) * parts.first.length)];
  const s = parts.second[Math.floor(rand(seed, nodeId, NAME_SALT + 1) * parts.second.length)];
  return f + s;
}

/** Full derived identity for a humanoid node, or null (flora/fauna have no personhood). */
export function identityOf(kernel, node) {
  const race = node.attrs?.species;
  if (!RACES.includes(race)) return null;
  const age = kernel.tick - node.attrs.birthTick;
  return {
    name: nameOf(kernel.seed, node.id, race),
    race,
    stage: stageAt(race, age)[0],
    traits: traitsOf(kernel.seed, node.id),
    attributes: attributesOf(kernel.seed, node.id, race),
  };
}
