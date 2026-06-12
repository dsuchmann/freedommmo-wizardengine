// Traversal templates (Plan B): interpret silhouette measurements as 3D
// collision volumes. Pure data->data; all outputs in tile units (z in tiles,
// matching player.z). Spec: docs/superpowers/specs/2026-06-12-traversal-interaction-plane-design.md
//
// Volume: { x, y, baseRX, baseRY, rampW, rampH, solidH, topZ, overheadZ, overheadR }
//   x/y       volume center (tiles; set by volumeForPlacement)
//   baseRX/RY solid-core ellipse radii at ground (RY squashed for the top-down view)
//   rampW/H   ramp annulus beyond the core; floor rises 0 -> rampH walking inward
//   solidH    blocking height; Infinity = never jumpable
//   topZ      standable surface height or null
//   overheadZ/overheadR  canopy underside height + half-width, or null/0

var Y_SQUASH = 0.6;          // depth foreshortening for footprint ellipses
var JUMP_APEX = 1.75;        // vz 7.5, gravity 16 -> apex ~= 1.76 tiles (reference)

// Per-archetype class overrides (curated; defaults by field below).
export var TRAVERSAL_CLASS = {
  // e.g. 'fallen_log': 'fence', 'standing_stone': 'prop' — fill as art review demands
};

var FIELD_DEFAULT = { f4: 'flora', f5: 'boulder', f6: 'tree' };

// State overrides applied after class lookup: a tree in state 'stump' collides
// as a stump; destroyed objects stop colliding.
var STATE_CLASS = { stump: 'stump', snag: 'snag', destroyed: 'flora' };

export function classFor(field, name, state) {
  if (state && STATE_CLASS[state]) return STATE_CLASS[state];
  return TRAVERSAL_CLASS[name] || FIELD_DEFAULT[field] || 'flora';
}

// sil measurements are trim-local file px; pxT converts to tiles.
export function volumeFor(sil, cls, sizeTiles, size) {
  if (cls === 'flora') return null;
  var pxT = sizeTiles / size;
  var visT = sil ? sil.visH * pxT : sizeTiles * 0.8;   // visible height in tiles
  var baseR = sil ? Math.max(0.12, sil.baseW * pxT / 2) : sizeTiles * 0.18;
  var coreR = sil ? Math.max(0.15, sil.coreW * pxT / 2) : sizeTiles * 0.12;

  if (cls === 'tree') {
    // trunk core: the measured core band is canopy-contaminated on low-canopy
    // trees (coreW can exceed baseW), so the trunk can never exceed the root
    // flare nor a sane fraction of the drawn size.
    var trunkR = Math.min(coreR, baseR, Math.max(0.15, sizeTiles * 0.15));
    var rampR = Math.max(trunkR, baseR);
    var v = vol(trunkR, trunkR * Y_SQUASH, rampR - trunkR, 0.3, Infinity, null);
    // canopy underside: lowest upper-half band notably wider than the root
    // flare (base-relative — coreW is unreliable on low-canopy trees)
    if (sil) {
      for (var b = 15; b >= 0; b--) {
        if (b <= 8 && sil.bands[b] > sil.baseW * 1.4) {
          var frac = 1 - (b + 1) / 16;
          v.overheadZ = Math.max(1.0, frac * visT);
          v.overheadR = Math.max.apply(null, sil.bands) * pxT / 2;
          break;
        }
      }
    }
    return v;
  }
  if (cls === 'boulder') {
    var h = clamp(visT * 0.55, 0.25, 2.2);
    return vol(baseR * 0.85, baseR * 0.85 * Y_SQUASH, 0, 0, h, h);
  }
  if (cls === 'stump' || cls === 'snag') {
    var th = cls === 'stump' ? clamp(visT * 0.5, 0.3, 0.6) : clamp(visT * 0.5, 0.4, 0.7);
    return vol(coreR * 1.3, coreR * 1.3 * Y_SQUASH, 0, 0, th, th);
  }
  if (cls === 'fence' || cls === 'wall') {
    return vol(baseR, 0.12, 0, 0, clamp(visT * 0.8, 0.3, 6), null);
  }
  // prop: plain solid cylinder, no ramp, not standable
  return vol(baseR * 0.8, baseR * 0.8 * Y_SQUASH, 0, 0, Math.max(0.5, visT), null);
}

export function volumeForPlacement(p, field) {
  var cls = classFor(field, p.name, p.state);
  var v = volumeFor(p.sil || null, cls, p.sizeTiles, p.size);
  if (!v) return null;
  v.x = p.bx / 32;   // footprint center, world art px -> tiles (TILE_ART_PX)
  v.y = p.by / 32;
  return v;
}

function vol(baseRX, baseRY, rampW, rampH, solidH, topZ) {
  return { x: 0, y: 0, baseRX: baseRX, baseRY: baseRY, rampW: rampW, rampH: rampH,
           solidH: solidH, topZ: topZ, overheadZ: null, overheadR: 0 };
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
