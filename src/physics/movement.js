import { f4Placements, f5Placements, f6Placements } from '../world/decoration-claims.js';
import { volumeForPlacement } from '../world/traversal-templates.js';
import { isInside, getActiveInterior, isWalkableLocal } from '../render/active-interior.js';

const PLAYER_R = 0.30;       // player capsule radius (tiles)
const SUPPORT_EPS = 0.05;    // landing tolerance onto a standable top
const SCAN_R = 3;            // placement anchor scan radius (covers 192px trees)

// placement record -> volume (records are cached upstream).
// SEAM: sim state overrides are F4-only today (flora -> null volume), so cached
// volumes can never go stale. When the sim lane adds F5/F6 state deltas (e.g.
// chop -> stump), collision must consume the same override source the renderer
// does, and this cache must key on (record, state) or be invalidated per delta.
const _volCache = new WeakMap();
let _tiStore = null, _tiFn = null;
function claimTileInfo(chunkStore) {
  if (_tiStore === chunkStore && _tiFn) return _tiFn;
  _tiStore = chunkStore;
  _tiFn = (wx, wy) => {
    const t = chunkStore.tileAt(wx, wy);
    return t ? { biome: t.biome, transition: !!t.transitionPair } : null;
  };
  return _tiFn;
}

function volumeOf(p, field) {
  let v = _volCache.get(p);
  if (v === undefined) { v = volumeForPlacement(p, field); _volCache.set(p, v); }
  return v;
}

// Default volume source: decoration placements around the player.
function decorationVolumes(chunkStore, px, py) {
  const ti = claimTileInfo(chunkStore);
  const cx = Math.floor(px), cy = Math.floor(py);
  const out = [];
  for (let y = cy - SCAN_R; y <= cy + SCAN_R; y++) {
    for (let x = cx - SCAN_R; x <= cx + SCAN_R; x++) {
      pushVols(f6Placements(x, y, ti), 'f6', out);
      pushVols(f5Placements(x, y, ti), 'f5', out);
      pushVols(f4Placements(x, y, ti), 'f4', out);
    }
  }
  return out;
}
function pushVols(pls, field, out) {
  for (let i = 0; i < pls.length; i++) {
    const v = volumeOf(pls[i], field);
    if (v) out.push(v);
  }
}

function volumeBlocks(v, px, py, z) {
  if (z >= v.solidH - 1e-9) return false;            // above it: jump-over is implicit
  const rx = v.baseRX + PLAYER_R, ry = v.baseRY + PLAYER_R * 0.6;
  const dx = (px - v.x) / rx, dy = (py - v.y) / ry;
  return dx * dx + dy * dy < 1;
}
function volumesBlock(vols, px, py, z) {
  for (let i = 0; i < vols.length; i++) if (volumeBlocks(vols[i], px, py, z)) return true;
  return false;
}

function floorZOf(v, px, py, z) {
  // standable top: only supports from above (never lifts through the side)
  if (v.topZ != null && z >= v.topZ - SUPPORT_EPS) {
    const dx = (px - v.x) / (v.baseRX + PLAYER_R * 0.5);
    const dy = (py - v.y) / (v.baseRY + PLAYER_R * 0.5 * 0.6);
    if (dx * dx + dy * dy < 1) return v.topZ;
  }
  // ramp annulus: floor rises linearly from the outer edge to rampH at the core
  if (v.rampW > 0) {
    const orx = v.baseRX + v.rampW, ory = v.baseRY + v.rampW * 0.6;
    const dx = (px - v.x) / orx, dy = (py - v.y) / ory;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1) {
      const coreFrac = v.baseRX / orx;
      const t = Math.min(1, (1 - d) / Math.max(1e-6, 1 - coreFrac));
      return v.rampH * t;
    }
  }
  return 0;
}

function underOverhead(v, px, py, z) {
  if (v.overheadZ == null || z >= v.overheadZ) return false;
  const dx = (px - v.x) / Math.max(0.01, v.overheadR);
  const dy = (py - v.y) / Math.max(0.01, v.overheadR * 0.6);
  return dx * dx + dy * dy < 1;
}

export function canEnterTile(tile) {
  if (!tile?.walkable) return false;
  return true;
}

function objectBlocksPlayer(object, px, py) {
  const radius = object.kind === 'tree' ? 0.38 : object.kind === 'rock' ? 0.34 : object.kind === 'shrub' ? 0.24 : 0;
  if (!radius) return false;
  const ox = object.wx + 0.5;
  const oy = object.wy + 0.72;
  const dx = px - ox;
  const dy = py - oy;
  return dx * dx + dy * dy < radius * radius;
}

function canOccupy(chunkStore, x, y) {
  if (!canEnterTile(chunkStore.tileAt(x, y))) return false;
  const cx = Math.floor(x / 64);
  const cy = Math.floor(y / 64);
  for (let yy = cy - 1; yy <= cy + 1; yy++) {
    for (let xx = cx - 1; xx <= cx + 1; xx++) {
      const chunk = chunkStore.getIfReady?.(xx, yy) ?? chunkStore.get?.(xx, yy);
      if (!chunk?.objects) continue;
      for (const object of chunk.objects) if (objectBlocksPlayer(object, x, y)) return false;
    }
  }
  return true;
}

export function movementCost(tile) {
  let cost = tile?.movementCost ?? 1;
  const slope = tile.layers?.[7]?.slope ?? 0;
  const localStep = tile.layers?.[7]?.localStep ?? 0;
  cost *= 1 + slope * 5 + localStep * 4;
  if (tile.terrainForm === 'hillside') cost *= 1.25;
  if (tile.terrainForm === 'mountain_slope') cost *= 1.65;
  if (tile.terrainForm === 'mountain_bowl') cost *= 1.45;
  if (tile.terrainForm === 'step') cost *= 1.35;
  if (tile.terrainForm === 'ridge') cost *= 1.18;
  if (tile.terrainForm === 'valley') cost *= 0.92;
  if (tile.features?.includes('dry_riverbed')) cost *= 0.82;
  if (tile.features?.includes('natural_bridge')) cost *= 1.1;
  return cost;
}

// Interior wall/void collision: when the player is INSIDE a building, a destination
// tile whose footprint-LOCAL cell is not walkable (wall / off-floor void) is rejected
// exactly like impassable terrain. When NOT inside this is a no-op, so open-world
// movement is byte-identical. Gate == draw: same isWalkableLocal the renderer uses.
function interiorBlocks(/* destX, destY */) {
  // SLICE 1: hard interior wall collision is DEFERRED. The inset walkable set excludes the
  // perimeter + doorway, so gating on it would trap the player at the entrance. The player
  // roams freely for now; walls are visual. Slice 2 re-enables per-tile blocking with a
  // proper door portal. (isInside/getActiveInterior/isWalkableLocal kept imported for then.)
  return false;
}

export function resolveMovement(player, chunkStore, dx, dy, volumeSource) {
  const z = player.z || 0;
  const vols = volumeSource ? volumeSource(chunkStore, player.x, player.y)
                            : decorationVolumes(chunkStore, player.x, player.y);
  const nextX = player.x + dx;
  const nextY = player.y + dy;
  if (canOccupy(chunkStore, nextX, player.y) && !volumesBlock(vols, nextX, player.y, z) && !interiorBlocks(nextX, player.y)) player.x = nextX;
  if (canOccupy(chunkStore, player.x, nextY) && !volumesBlock(vols, player.x, nextY, z) && !interiorBlocks(player.x, nextY)) player.y = nextY;
  let floor = 0, under = false;
  for (let i = 0; i < vols.length; i++) {
    const f = floorZOf(vols[i], player.x, player.y, z);
    if (f > floor) floor = f;
    if (!under && underOverhead(vols[i], player.x, player.y, z)) under = true;
  }
  player.floorZ = floor;
  player.underCanopy = under;
  return canOccupy(chunkStore, player.x, player.y);
}
