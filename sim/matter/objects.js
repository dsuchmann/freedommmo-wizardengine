// sim/matter/objects.js — Object definition registry (M2).
// Durability stages, typed resistances, break-product graph (closed).
// Design constants from 2026-06-12-pass2-m2-object-system.md.

/**
 * Terminal classes: no durability, no def, strike returns false.
 * @type {Set<string>}
 */
export const TERMINAL = new Set(['stone_dust', 'wood_scrap']);

/**
 * Object definition catalog keyed by archetype class.
 * Shape: { maxHp?, resist?, breakProducts?, onChop? }
 *   resist: { blunt, sharp, fire, frost } — fraction of damage TAKEN
 *   breakProducts: [{ class, count: [lo, hi], eFrac }]
 *   onChop: [{ class, count: [lo, hi], eFrac }]  (living objects only, no maxHp)
 */
export const OBJECT_DEFS = {
  boulder: {
    maxHp: 100,
    resist: { blunt: 0.5, sharp: 0.2, fire: 0.05, frost: 0.3 },
    breakProducts: [
      { class: 'rock_chunk', count: [2, 4], eFrac: 0.18 },
      { class: 'pebble',     count: [5, 12], eFrac: 0.015 },
      { class: 'stone_dust', count: [1, 1], eFrac: 0 },  // remainder
    ],
  },
  rock: {
    maxHp: 40,
    resist: { blunt: 0.6, sharp: 0.25, fire: 0.05, frost: 0.3 },
    breakProducts: [
      { class: 'pebble',     count: [3, 6], eFrac: 0.12 },
      { class: 'stone_dust', count: [1, 1], eFrac: 0 },  // remainder
    ],
  },
  rock_chunk: {
    maxHp: 40,
    resist: { blunt: 0.6, sharp: 0.25, fire: 0.05, frost: 0.3 },
    breakProducts: [
      { class: 'pebble',     count: [3, 6], eFrac: 0.12 },
      { class: 'stone_dust', count: [1, 1], eFrac: 0 },  // remainder
    ],
  },
  stone: {
    maxHp: 25,
    resist: { blunt: 0.6, sharp: 0.3, fire: 0.05, frost: 0.3 },
    breakProducts: [
      { class: 'pebble',     count: [2, 4], eFrac: 0.15 },
      { class: 'stone_dust', count: [1, 1], eFrac: 0 },  // remainder
    ],
  },
  pebble: {
    maxHp: 10,
    resist: { blunt: 0.7, sharp: 0.4, fire: 0.05, frost: 0.4 },
    breakProducts: [
      { class: 'stone_dust', count: [1, 1], eFrac: 0 },  // remainder
    ],
  },
  log: {
    maxHp: 60,
    resist: { blunt: 0.4, sharp: 0.8, fire: 0.9, frost: 0.2 },
    breakProducts: [
      { class: 'branch',     count: [2, 4], eFrac: 0.15 },
      { class: 'wood_scrap', count: [1, 1], eFrac: 0 },  // remainder
    ],
  },
  branch: {
    maxHp: 20,
    resist: { blunt: 0.5, sharp: 0.9, fire: 0.95, frost: 0.2 },
    breakProducts: [
      { class: 'wood_scrap', count: [1, 1], eFrac: 0 },  // remainder
    ],
  },
  stump: {
    maxHp: 80,
    resist: { blunt: 0.4, sharp: 0.7, fire: 0.9, frost: 0.2 },
    breakProducts: [
      { class: 'wood_scrap', count: [3, 6], eFrac: 0.12 },  // remainder-to-last
    ],
  },
  // Living tree: onChop only, no maxHp (no durability damage on living things in M2)
  tree: {
    onChop: [
      { class: 'log',    count: [1, 2], eFrac: 0.18 },
      { class: 'branch', count: [2, 4], eFrac: 0.04 },
    ],
  },
};

/**
 * Resolve archetype string to its def via longest-prefix matching over OBJECT_DEFS keys.
 * Returns null for terminal classes and unknown archetypes.
 * @param {string} archetype
 * @returns {object|null}
 */
export function defOf(archetype) {
  const s = String(archetype ?? '');
  // Terminal classes have no def
  if (TERMINAL.has(s)) return null;
  // Sort by key length descending for longest-prefix match
  const keys = Object.keys(OBJECT_DEFS).sort((a, b) => b.length - a.length);
  const key = keys.find(k => s.startsWith(k));
  return key != null ? OBJECT_DEFS[key] : null;
}

/**
 * Derive the durability stage from current hp and maxHp.
 * Thresholds (per 1.0 of maxHp):
 *   intact    hp > 0.75 * maxHp
 *   cracked   hp > 0.40 * maxHp
 *   fractured hp > 0.10 * maxHp
 *   shattered hp <= 0.10 * maxHp
 * @param {number} hp
 * @param {number} maxHp
 * @returns {'intact'|'cracked'|'fractured'|'shattered'}
 */
export function stageFor(hp, maxHp) {
  if (hp > 0.75 * maxHp) return 'intact';
  if (hp > 0.40 * maxHp) return 'cracked';
  if (hp > 0.10 * maxHp) return 'fractured';
  return 'shattered';
}

/**
 * Compute damage actually taken after applying typed resistance.
 * Unknown damage type: returns 0 (honest no-op, not an error).
 * @param {object} def  — object def with resist map
 * @param {string} type — damage type ('blunt'|'sharp'|'fire'|'frost')
 * @param {number} amount — raw damage before resistance
 * @returns {number}
 */
export function damageTaken(def, type, amount) {
  const resist = def.resist?.[type];
  if (resist == null) return 0;
  return amount * resist;
}
