// src/render/building-facade.js — FAÇADE-BLOCK building renderer.
//
// Draws a building as a single PixelLab-generated whole-building sprite (low top-down /
// front-three-quarter view) scaled to the building's FOOTPRINT WIDTH and anchored so the
// sprite's ground-contact line sits on the footprint's south edge. This replaces the per-tile
// wall+roof assembly (building-occluder.js drawWalls + procedural roof) for buildings that have
// a matching façade archetype. Everything still routes through the EXISTING GL plumbing: this
// draws into the same offscreen 2D canvas building-layer.js hands to gl-compositor, which blits
// it into the scene FBO before present — so it inherits lighting / day-night / fog / CRT / depth
// identically (CLAUDE.md: everything through GL). No new compositor code.
//
// Flag: window._facadeBlocks (default ON). Set false to fall back to the old tile path.
// Live tuning: window._facadeFit { groundOffsetTiles, widthScale }.
//
// The sprite is a SKIN. The building's structure (footprint/sections/floors/doors) is untouched
// and still drives collision, interiors, and claims — so interiors stay 1:1 with the exterior.

import { archetypeForBuilding, heightTilesFor, isMappedType } from './facade-archetypes.js';

const MANIFEST_URL = '/assets/pixelab/buildings/facade/facade-manifest.json';

export const FACADE_FIT = { groundOffsetTiles: 0.25, heightScale: 1.0 };
if (typeof window !== 'undefined') window._facadeFit = FACADE_FIT;

function flagOn() { return typeof window === 'undefined' || window._facadeBlocks !== false; }

// ---- manifest (biome -> archetype -> [variant entries]) ----------------------------------
// entry: { variant, file, groundFrac, doorXFrac, contentW, contentH, widthTiles, stories }
let _manifest = null;
let _state = 'idle'; // idle | loading | ready | missing
let _retryAt = 0;

function loadManifest() {
  if (_state === 'loading' || _state === 'ready') return;
  if (typeof fetch === 'undefined') return;
  _state = 'loading';
  fetch(MANIFEST_URL, { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error('no manifest'); return r.json(); })
    .then((j) => { _manifest = j; _state = 'ready'; })
    .catch(() => { _state = 'missing'; _retryAt = (typeof performance !== 'undefined' ? performance.now() : 0) + 3000; });
}
if (typeof window !== 'undefined') window._reloadFacadeManifest = () => { _state = 'idle'; _manifest = null; loadManifest(); };

function manifestReady() {
  if (_state === 'ready') return true;
  if (_state === 'idle') { loadManifest(); return false; }
  if (_state === 'missing') {
    const now = (typeof performance !== 'undefined') ? performance.now() : 0;
    if (now >= _retryAt) { _state = 'idle'; loadManifest(); }
    return false;
  }
  return false;
}

// Deterministic variant pick per building position (stable; mirrors runBondVariant's hash).
function variantIndex(x, y, n) {
  if (n <= 1) return 0;
  let h = (Math.imul(x | 0, 0x9e3779b9) ^ Math.imul(y | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  return h % n;
}

// Resolve the façade entry for a building (or null). biome falls back to grassland (only biome
// generated in the pilot).
function entryFor(b) {
  if (!_manifest) return null;
  const arch = archetypeForBuilding(b);
  if (!arch) return null;
  const biome = (b && b.biome) || 'grassland';
  const byArch = (_manifest[biome] && _manifest[biome][arch]) || (_manifest.grassland && _manifest.grassland[arch]);
  if (!byArch || !byArch.length) return null;
  const idx = variantIndex(b.x, b.y, byArch.length);
  return byArch[idx];
}

// True if this building HAS a façade block available (archetype + manifest entry), regardless of
// whether its image has finished loading. Used by door-leaves/roof to suppress the old passes.
export function hasFacade(b) {
  return flagOn() && manifestReady() && !!entryFor(b);
}

// Is this building owned by the façade system? (flag on + its type is known to the map). When true,
// the renderer must NOT fall back to the old brown tile walls: it either draws the sprite, or draws
// nothing (open/object type, or sprite still loading). Only UNMANAGED types use the old path.
export function isFacadeManaged(b) {
  return flagOn() && isMappedType(b);
}

// ---- image cache --------------------------------------------------------------------------
const _img = new Map();
function img(url) {
  let im = _img.get(url);
  if (!im) { im = new Image(); im.src = url; _img.set(url, im); }
  return (im.complete && im.naturalWidth) ? im : null;
}

// ---- draw ---------------------------------------------------------------------------------
// Draw building b as a façade sprite block. Returns true if drawn (caller should then SKIP the
// old wall+roof), false if no façade applies or its image isn't ready yet (caller falls back).
export function drawBuildingFacade(ctx, b, camX, camY, tilePx, w, h) {
  if (!flagOn() || !manifestReady()) return false;
  const e = entryFor(b);
  if (!e) return false;
  const im = img('/' + String(e.file).replace(/^\/+/, ''));
  if (!im) return false; // not loaded yet → fallback this frame

  const bb = b.footprint && b.footprint.boundingBox;
  if (!bb) return false;

  // Scale by HEIGHT (preserve the sprite's aspect — no stretch). The sprite's content height maps
  // to the archetype's HEIGHT_TILES world tiles; width follows. Centered on the footprint, base on
  // the south edge. Decoupling visual size from the (generous) footprint width avoids the
  // wide-footprint-becomes-a-tower bug and keeps every building at its natural proportions.
  const arch = archetypeForBuilding(b);
  const contentW = im.naturalWidth, contentH = im.naturalHeight;
  const heightTiles = heightTilesFor(arch) * (FACADE_FIT.heightScale || 1);
  const dH = heightTiles * tilePx;
  const scale = dH / contentH;
  const dW = contentW * scale;
  const footCenterX = (b.x + bb.w / 2) * tilePx - camX;
  const dLeft = footCenterX - dW / 2;
  const groundScreenY = Math.round((b.y + bb.h) * tilePx - camY) + (FACADE_FIT.groundOffsetTiles || 0) * tilePx;
  const dTop = groundScreenY - (e.groundFrac != null ? e.groundFrac : 1.0) * dH;

  if (dLeft + dW < 0 || dLeft > w || dTop + dH < 0 || dTop > h) return true; // off-screen but "handled"

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(im, 0, 0, contentW, contentH, dLeft, dTop, dW, dH);
  return true;
}
