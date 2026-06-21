// sim/world/buildings/blueprint-node.js — the lazy nested-blueprint tree (spec
// 2026-06-18 §4, plan S2.5). A BlueprintNode is a pure, lazily-materialized node in
// the building→floor→unit→room hierarchy. Each node:
//   • has a path-tuple id and a seed derived purely from (worldSeed, path),
//   • computes its payload ONCE, on first access (memoized),
//   • enumerates its children's KEYS in O(1) (a 100-floor tower costs nothing until
//     a floor is touched), and materializes a child only on demand (cached by key),
//   • receives a CLOSED ancestorContext — ancestor-derived data only, never a sibling
//     reference — so generation stays deterministic and visit-order independent.
//
// Kinds are registered below: building pulls shape (S2.1) + floors (S2.2) + cores
// (S2.3); a floor partitions into units (S2.4); a unit holds exactly one deterministic
// room (user decision: one room, same every time); a room is the leaf baseline interior.

import { mix } from '../../kernel/rng.js';
import { resolveShape, realizeFootprintFromShape } from './shapes.js';
import { floorCount, floorStackPlan } from './building-floors.js';
import { selectStairCores, reserveLift } from './vertical.js';
import { partitionFloor } from './floor-partition.js';
import { generateInterior } from './interiors.js';
import { unitSubFloorCount, selectPrivateStair } from './unit-vertical.js';
import { floorMaterial } from './floor-materials.js';

// ── generic lazy node + kind registry ─────────────────────────────────────

const REGISTRY = new Map();
export function registerKind(kind, spec) { REGISTRY.set(kind, spec); }

// Instrumentation so tests can prove laziness (how many payloads were generated).
export const _stats = { payloads: {} };
export function _resetStats() { _stats.payloads = {}; }
function _count(kind) { _stats.payloads[kind] = (_stats.payloads[kind] || 0) + 1; }

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h & 0xffff;
}
function seedFromPath(worldSeed, path) {
  let s = worldSeed >>> 0;
  for (const p of path) s = mix(s, typeof p === 'number' ? (p | 0) : hashStr(String(p))) >>> 0;
  return s >>> 0;
}

/**
 * Create a lazy BlueprintNode of `kind` at path-tuple `path`, rooted at `worldSeed`,
 * with a CLOSED `ancestorContext`. Payload + children are materialized lazily.
 */
export function makeNode(kind, path, worldSeed, ancestorContext) {
  const spec = REGISTRY.get(kind);
  if (!spec) throw new Error(`unknown blueprint kind: ${kind}`);
  const node = {
    kind,
    path,
    id: path.join('/'),
    seed: seedFromPath(worldSeed, path),
    worldSeed: worldSeed >>> 0,
    ancestorContext: ancestorContext || null,
  };
  let _p, _pd = false;
  Object.defineProperty(node, 'payload', {
    enumerable: true,
    get() { if (!_pd) { _p = spec.generatePayload(node); _count(kind); _pd = true; } return _p; },
  });
  let _keys, _kd = false;
  node.childKeys = () => { if (!_kd) { _keys = spec.childKeys ? spec.childKeys(node) : []; _kd = true; } return _keys; };
  const cache = new Map();
  node.child = (key) => {
    if (cache.has(key)) return cache.get(key);
    const c = spec.makeChild ? spec.makeChild(node, key) : null;
    cache.set(key, c);
    return c;
  };
  node.children = () => node.childKeys().map((k) => node.child(k));
  node.materializedKeys = () => [...cache.keys()]; // test/observability hook
  return node;
}

// ── helpers ────────────────────────────────────────────────────────────────

function tileSetOf(sections) {
  const set = new Set();
  for (const s of sections)
    for (let y = s.y0; y < s.y0 + s.h; y++)
      for (let x = s.x0; x < s.x0 + s.w; x++) set.add(`${x},${y}`);
  return set;
}

function footprintFromTiles(tiles, doorTile) {
  if (!tiles.length) return { sections: [], walls: [], doors: [], floors: [] };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of tiles) { x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y); x1 = Math.max(x1, t.x); y1 = Math.max(y1, t.y); }
  return {
    sections: [{ x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }],
    walls: [], doors: doorTile ? [doorTile] : [], floors: tiles.map((t) => ({ x: t.x, y: t.y })),
  };
}

// ── kind: building ───────────────────────────────────────────────────────
// ancestorContext (CLOSED): { bx, by, typeId, category, tier, centrality, race?,
//                             sections? } — `sections` lets S2.6 hand the node the
// already-placed footprint; absent, the node generates one from the shape catalog.
registerKind('building', {
  generatePayload(node) {
    const ctx = node.ancestorContext || {};
    const sections = ctx.sections
      ? ctx.sections
      : realizeFootprintFromShape(
          resolveShape(node.seed, ctx.typeId || ctx.category, ctx.tier, ctx.centrality),
          mix(node.seed, 0x5104),
        ).sections;
    const { floorRange, aboveGroundFloors } =
      floorCount(node.worldSeed, ctx.bx | 0, ctx.by | 0, ctx.category, ctx.tier, ctx.centrality, ctx.typeId);
    const stackPlan = floorStackPlan(node.seed, floorRange, ctx.category);
    const stairCores = selectStairCores(sections);
    const lift = reserveLift(aboveGroundFloors, stairCores[0] || null, sections);
    return { sections, floorRange, aboveGroundFloors, stackPlan, stairCores, lift };
  },
  childKeys(node) {
    const [min, max] = node.payload.floorRange;
    const keys = [];
    for (let i = min; i <= max; i++) keys.push(i); // floor index (negatives = basements)
    return keys;
  },
  makeChild(node, floorIdx) {
    const ctx = node.ancestorContext || {};
    const p = node.payload;
    const use = (p.stackPlan.find((f) => f.index === floorIdx) || {}).use || ctx.category;
    // CLOSED floor context: building-level + this floor's own index/use. No sibling floors.
    const floorCtx = {
      buildingId: node.id, sections: p.sections, stairCore: p.stairCores[0] || null,
      floorIndex: floorIdx, floorUse: use, aboveGroundFloors: p.aboveGroundFloors,
      lift: p.lift, typeId: ctx.typeId, category: ctx.category, tier: ctx.tier, race: ctx.race || null,
    };
    return makeNode('floor', [...node.path, 'f', floorIdx], node.worldSeed, floorCtx);
  },
});

// ── kind: floor ────────────────────────────────────────────────────────────
registerKind('floor', {
  generatePayload(node) {
    const ctx = node.ancestorContext;
    const { circulation, units } = partitionFloor(node.seed, ctx.sections, ctx.stairCore, ctx.floorUse, ctx.lift ? ctx.lift.shaft : null);
    return {
      floorIndex: ctx.floorIndex, use: ctx.floorUse, material: floorMaterial(ctx.floorUse),
      stairCore: ctx.stairCore, lift: ctx.lift, circulation: [...circulation], units,
    };
  },
  childKeys(node) { return node.payload.units.map((_, i) => i); },
  makeChild(node, unitIdx) {
    const ctx = node.ancestorContext;
    const unit = node.payload.units[unitIdx];
    const unitCtx = {
      floorId: node.id, unitKind: unit.unitKind, tiles: unit.tiles, doorTile: unit.doorTile,
      floorIndex: node.payload.floorIndex, typeId: ctx.typeId, race: ctx.race, tier: ctx.tier,
    };
    return makeNode('unit', [...node.path, 'u', unitIdx], node.worldSeed, unitCtx);
  },
});

// ── kind: unit ───────────────────────────────────────────────────────────────
// A unit holds one deterministic room — UNLESS it is an eligible large unit that
// becomes a 2-level mini-stack (a private internal stair, depth <= 1). Each sub-floor
// is one room child; rooms are always leaves, so recursion never exceeds one level.
registerKind('unit', {
  generatePayload(node) {
    const ctx = node.ancestorContext;
    const subFloors = unitSubFloorCount(node.seed, ctx.unitKind, ctx.tiles);
    const privateStair = subFloors > 1 ? selectPrivateStair(ctx.tiles) : null;
    return { unitKind: ctx.unitKind, tiles: ctx.tiles, doorTile: ctx.doorTile, subFloors, privateStair };
  },
  childKeys(node) {
    const n = node.payload.subFloors;
    return Array.from({ length: n }, (_, i) => i); // [0] single-floor; [0,1] multi-floor
  },
  makeChild(node, roomIdx) {
    const ctx = node.ancestorContext;
    const p = node.payload;
    const isUpper = roomIdx > 0;
    const roomCtx = {
      unitId: node.id, unitKind: ctx.unitKind, tiles: ctx.tiles,
      // sub-floor 0 enters from the floor circulation; upper sub-floors enter via the private stair
      doorTile: isUpper ? p.privateStair : ctx.doorTile,
      typeId: ctx.typeId, race: ctx.race, tier: ctx.tier,
    };
    return makeNode('room', [...node.path, 'r', roomIdx], node.worldSeed, roomCtx);
  },
});

// ── kind: room (leaf) ────────────────────────────────────────────────────────
registerKind('room', {
  generatePayload(node) {
    const ctx = node.ancestorContext;
    const interior = generateInterior(
      node.seed, ctx.typeId || 'house', ctx.race || null, ctx.tier || null,
      footprintFromTiles(ctx.tiles, ctx.doorTile),
    );
    return { unitKind: ctx.unitKind, tiles: ctx.tiles, doorTile: ctx.doorTile, interior };
  },
  childKeys() { return []; }, // leaf — the tree bottoms out here
});

// ── public convenience constructor ───────────────────────────────────────────

/**
 * Build the root BlueprintNode for a building.
 * @param {number} worldSeed
 * @param {object} ctx CLOSED building context: { bx, by, typeId, category, tier,
 *                     centrality, race?, sections? }
 */
export function buildingNode(worldSeed, ctx) {
  return makeNode('building', ['b', ctx.bx | 0, ctx.by | 0], worldSeed, ctx);
}

/** Tile set of a building node's footprint — for claim-safety checks. */
export function footprintTiles(buildingNodeOrSections) {
  const sections = Array.isArray(buildingNodeOrSections)
    ? buildingNodeOrSections
    : buildingNodeOrSections.payload.sections;
  return tileSetOf(sections);
}
