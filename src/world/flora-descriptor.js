// Pure, DOM-free flora tile-descriptor builder.
//
// Extracted VERBATIM from src/render/field2-animator.js so it can be imported
// by BOTH the main thread AND a Web Worker. This module MUST stay DOM-free
// (no window/document/Image/canvas/performance) and its import graph MUST stay
// DOM-free — do NOT import anything from field2-animator.js here (that would
// pull the GL/canvas graph into the worker and defeat the split).
//
// buildTileDescriptor is PURE: it reads only its arguments + the deterministic
// placement/claim/tuning/random helpers imported below.

import { WORLD } from '../core/constants.js';
import { rand2, pickIndex } from '../core/random.js';
import { SF_BASE_PATH, SF_VARIANT_COUNT, SF_EXTRA_OBJECTS, sfVariantsFor, sfAnimVariantsFor } from '../render/wang-image-list.js';
import { floorDiv } from './chunk.js';
import { isClaimedAt, f4Placements, f4SpriteUrl, f4AnimUrlBase, f5Placements, f5SpriteUrl, f5AnimUrlBase, f6Placements, f6SpriteUrl, f6AnimUrlBase } from './decoration-claims.js';
import { tuneSize, tuneBiomeDensity, tuneObjDensity, tuneAnimEnabled, tuneStateWeights, rollWeighted,
  F2_STATE_ORDER, F2_STATE_DEFAULTS } from './field-tuning.js';
import { upscaleUrl } from './upscale-manifest.js';

// FRAME_COUNT is duplicated from field2-animator.js (a tiny pure constant that
// is also used elsewhere on the main thread) so this module has no dependency
// on that DOM-bound file. Keep byte-identical.
var FRAME_COUNT = 9;

// Objects that should NEVER sway — rigid/mineral/crystal types
// (moved from field2-animator.js; used only by buildTileDescriptor).
var RIGID_OBJECTS = {
  'ice_needle': true,
  'crystal_sprout': true,
  'hardy_lichen': true,
  'rock_cress': true,
  'alpine_tuft': true,
  'low_berry_bush': true,
  'bracket_fungus': true,
  'dry_tuft': true,
  'sparse_weed': true,
  'cold_moss_tuft': true,
  'ice_moss': true,
};

// biome/object combos that have lifecycle state sprites on disk
// (states/{seedling,wilting,dead}/v000.png) — others use transform-only states.
// Duplicated from field2-animator.js (also used elsewhere on the main thread) to
// keep this module DOM-free. Keep byte-identical.
var STATE_SPRITES = {
  'arctic/frost_flower': true,
  'arctic/frozen_grass': true,
  // arctic/ice_needle removed: its seedling state is a translucent gray blob
  // (bad asset) — transform-only states look correct
  'mountains/rock_cress': true,
  'steppe/grass_wisp': true,
  'volcanic/lava_fern': true,
};

var _ctiStore = null, _ctiFn = null;
function _claimTileInfo(chunkStore) {
  if (_ctiStore === chunkStore && _ctiFn) return _ctiFn;
  _ctiStore = chunkStore;
  _ctiFn = function (wx, wy) {
    var t = chunkStore.tileAt(wx, wy);
    return t ? { biome: t.biome, transition: !!t.transitionPair } : null;
  };
  return _ctiFn;
}

export function buildTileDescriptor(chunkStore, tile, objects, wx, wy) {
  // Returns { desc, cacheable }; desc === null means nothing on this tile.
  var cacheable = true;

  // Skip tiles near any edge — biome transitions OR elevation changes
  var myElev = tile.climate ? tile.climate.elevation : 0.5;
  var isNearEdge = false;
  for (var edy = -2; edy <= 2 && !isNearEdge; edy++) {
    for (var edx = -2; edx <= 2 && !isNearEdge; edx++) {
      if (edx === 0 && edy === 0) continue;
      var nwx = wx + edx, nwy = wy + edy;
      // chunkStore.tileAt() falls back to the OLD player chunk for a not-yet-ready destination
      // chunk, returning a WRONG neighbour biome that reads as a false edge and gets cached as
      // desc=null forever (flora never appears there after a teleport). Only trust a neighbour
      // whose chunk is actually ready; if it isn't, skip it and mark the tile not-cacheable so
      // it is re-evaluated once that chunk streams in.
      if (!chunkStore.getIfReady(floorDiv(nwx, WORLD.chunkSize), floorDiv(nwy, WORLD.chunkSize))) { cacheable = false; continue; }
      var nbTile = chunkStore.tileAt(nwx, nwy);
      if (!nbTile) { cacheable = false; continue; }
      if (nbTile.biome !== tile.biome) { isNearEdge = true; break; }
      var nbElev = nbTile.climate ? nbTile.climate.elevation : 0.5;
      if (Math.abs(Math.floor(myElev * 10) - Math.floor(nbElev * 10)) >= 1) { isNearEdge = true; break; }
    }
  }
  if (isNearEdge) return { desc: null, cacheable: cacheable };

  // ---- Field 4 medium flora (deterministic, claim-registered) ----
  var f4Blades = [];
  var f4pls = f4Placements(wx, wy, _claimTileInfo(chunkStore));
  for (var fi = 0; fi < f4pls.length; fi++) {
    var fp = f4pls[fi];
    f4Blades.push({
      bi: 90 + fi, // distinct trigger-key space from F2 blades
      // Cached for sim override URL construction at draw time
      _f4Name: fp.name, _f4Biome: fp.biome, _f4Variant: fp.variant,
      stateUrl: fp.state ? f4SpriteUrl(fp) : null,
      animUrlBase: (!fp.state && fp.hasAnim
        && tuneAnimEnabled('f4', fp.biome, fp.name, 'wind_sway')) ? f4AnimUrlBase(fp) : null,
      staticUrl: fp.state ? f4SpriteUrl(fp) : f4SpriteUrl({ name: fp.name, biome: fp.biome, variant: fp.variant, state: null }),
      isRigid: false,
      lifeScale: fp.sizeTiles,         // 64px -> 2 tiles, 80px -> 2.5 tiles
      lifeSway: 0.35,                  // big plants sway less than grass
      baseAngle: 0,
      offUX: fp.ux - 0.5,
      offUY: fp.uy - 0.5,
      sortYOff: fp.uy + fp.sizeTiles * 0.30,  // sort by sprite base, not centre
      ambientPeriod: 6000 + rand2(wx, wy, 9710) * 9000,
      ambientPhase: rand2(wx, wy, 9711) * 9000,
      startDelay: rand2(wx, wy, 9712) * 300,
      loopCount: 4,
      restFrame: Math.floor(rand2(wx, wy, 9713) * FRAME_COUNT)
    });
  }

  // ---- Field 5 medium objects (static, y-sorted with F2/F4/player) ----
  var f5pls = f5Placements(wx, wy, _claimTileInfo(chunkStore));
  for (var gi = 0; gi < f5pls.length; gi++) {
    var gp = f5pls[gi];
    f4Blades.push({
      bi: 80 + gi, // distinct trigger-key space from F2 (0-19) and F4 (90+)
      stateUrl: null,
      // No F5 anim frames exist on disk yet; the tuner gate is honored here
      // so playback lights up when art lands + catalog regenerates.
      animUrlBase: (gp.hasAnim && !gp.state
        && tuneAnimEnabled('f5', gp.biome, gp.name, 'wind_sway'))
        ? f5AnimUrlBase(gp)
        : null,
      staticUrl: f5SpriteUrl(gp),
      isRigid: true,                       // objects never sway-rotate
      lifeScale: gp.sizeTiles,             // 96px @ 1.0 -> 3 tiles
      lifeSway: 0,
      baseAngle: 0,
      offUX: gp.ux - 0.5,
      offUY: gp.uy - 0.5,
      // Sort at the sprite's visual base: bottom edge (uy - 0.5 + sizeTiles*0.5)
      // minus a FIXED 0.1-tile ground-contact inset. A proportional inset
      // (0.1*sizeTiles) drifts the anchor up toward mid-sprite as objects grow —
      // big sprites are exactly where base-accurate sorting matters most.
      // At sizeTiles=3 this equals the old 0.30 formula (no resort churn);
      // at 6 tiles it sits at the trunk base instead of 0.7 tiles above it.
      sortYOff: gp.uy + gp.sizeTiles * 0.5 - 0.6,
      ambientPeriod: 0,
      ambientPhase: 0,
      startDelay: 0,
      loopCount: 0,
      restFrame: 0
    });
  }

  // ---- Field 6 large flora (trees; y-sorted with F2/F4/F5/player) ----
  var f6pls = f6Placements(wx, wy, _claimTileInfo(chunkStore));
  for (var hi = 0; hi < f6pls.length; hi++) {
    var hp = f6pls[hi];
    // @384 detail upscale (tree-upscale pipeline): if this sprite has one, load it and draw at 2x
    // (384px native = 12 tiles, full detail). Falls back to the 192 source -> no change for other trees.
    var _f6url = f6SpriteUrl(hp), _f6up = upscaleUrl(_f6url), _f6big = _f6up !== _f6url;
    f4Blades.push({
      bi: 60 + hi, // distinct trigger-key space (F2 0-19, F5 80+, F4 90+)
      stateUrl: null,
      animUrlBase: (hp.hasAnim && !hp.state
        && tuneAnimEnabled('f6', hp.biome, hp.name, 'wind_sway'))
        ? f6AnimUrlBase(hp) : null,
      staticUrl: _f6up,                     // @384 upscale when present, else the 192 source
      isRigid: true,                        // trunk never sway-rotates; wind lives in the frames
      frameCount: 8,                        // W2 tree anims are 8 frames (F2/F4/F5 use the 9-frame default)
      lifeScale: hp.sizeTiles * (_f6big ? 2 : 1), // upscaled -> 2x so the 384 detail actually shows
      lifeSway: 0,
      baseAngle: 0,
      offUX: hp.ux - 0.5,
      offUY: hp.uy - 0.5,
      // Sort at the visual base: bottom edge minus a FIXED 0.1-tile ground-
      // contact inset (same formula as F5). The old 0.30 proportional form
      // drifted the anchor ~0.7 tiles above the trunk base at 6 tiles —
      // nearby F5 logs drew in front of trees they stood behind.
      sortYOff: hp.uy + hp.sizeTiles * 0.5 - 0.6,
      // Same ambient/trigger treatment as F4 wind-sway blades (fresh salts):
      // trees sway in periodic gusts and settle back to restFrame.
      ambientPeriod: 6000 + rand2(wx, wy, 9837) * 9000,
      ambientPhase: rand2(wx, wy, 9838) * 9000,
      startDelay: rand2(wx, wy, 9839) * 300,
      loopCount: 4,
      restFrame: Math.floor(rand2(wx, wy, 9838) * 8) // 8-frame anims
    });
  }

  // Density driven by biome + tile fertility/vegetation
  var vegDensity = tile.layers && tile.layers[6] ? tile.layers[6].vegetationDensity : 0.5;
  var fertility = tile.layers && tile.layers[6] ? tile.layers[6].fertility : 0.5;
  var bladeCountOverride = -1;
  if (vegDensity < 0.08 && fertility < 0.10) {
    if (!f4Blades.length) return { desc: null, cacheable: cacheable };
    bladeCountOverride = 0;
  }

  var biome = tile.biome;
  var baseDensity = 4;
  var tileChance = 1.0;
  if (biome === 'grassland') baseDensity = 7;
  else if (biome === 'forest' || biome === 'tropical_forest') baseDensity = 6;
  else if (biome === 'dense_forest') baseDensity = 8;
  else if (biome === 'savanna' || biome === 'steppe') baseDensity = 5;
  else if (biome === 'swamp') baseDensity = 5;
  else if (biome === 'taiga') baseDensity = 7;
  else if (biome === 'volcanic') { baseDensity = 1; tileChance = 0.20; }
  else if (biome === 'mountains') { baseDensity = 1; tileChance = 0.10; }
  else if (biome === 'arctic') { baseDensity = 1; tileChance = 0.075; }
  else if (biome === 'tundra') { baseDensity = 1; tileChance = 0.30; }
  else if (biome === 'desert') { baseDensity = 1; tileChance = 0.35; }
  else if (biome === 'beach') { baseDensity = 1; tileChance = 0.175; }

  // F2 biome density tuning: sparse biomes (tileChance<1) scale the tile
  // chance; dense biomes scale the blade count. Default 1.0 = no change.
  var f2bd = tuneBiomeDensity('f2', biome);
  if (f2bd !== 1) {
    if (tileChance < 1.0) tileChance = Math.min(1, tileChance * f2bd);
    else baseDensity = Math.max(0, Math.round(baseDensity * f2bd));
  }

  if (tileChance < 1.0 && rand2(wx, wy, 6999) > tileChance) {
    if (!f4Blades.length) return { desc: null, cacheable: cacheable };
    bladeCountOverride = 0;
  }

  var bladeCount = bladeCountOverride === 0 ? 0 : baseDensity + Math.floor(fertility * 3);
  var blades = [];

  for (var bi = 0; bi < bladeCount; bi++) {
    var isAccent = bi >= baseDensity;
    if (isAccent) {
      var accentCoverage = 0.30 + fertility * 0.40;
      if (rand2(wx, wy, 7000 + bi) > accentCoverage) continue;
    }

    var speciesRoll = rand2(wx, wy, 7010 + bi * 100);
    var oi;
    if (objects.length === 1) {
      oi = 0;
    } else if (!isAccent) {
      oi = speciesRoll < 0.95 ? 0 : (objects.length > 2 && speciesRoll > 0.98 ? 2 : 1);
    } else {
      if (objects.length === 2) oi = speciesRoll < 0.40 ? 0 : 1;
      else { if (speciesRoll < 0.25) oi = 0; else if (speciesRoll < 0.65) oi = 1; else oi = 2; }
    }
    var objName = objects[oi];
    if (objName === 'cold_moss_tuft' && rand2(wx, wy, 7036 + bi) > 0.15) {
      oi = 0;
      objName = objects[0];
    }

    // Object-level density: <1 culls this blade (NEW salt 7400+bi)
    var f2od = tuneObjDensity('f2', biome, objName);
    if (f2od < 1 && rand2(wx, wy, 7400 + bi) > f2od) continue;

    var variantWl = sfVariantsFor(biome, objName);
    if (Array.isArray(variantWl) && variantWl.length === 0) continue; // fully culled → render nothing
    var variantIdx = variantWl
      ? variantWl[pickIndex(rand2(wx, wy, 7035 + bi), variantWl.length)]
      : pickIndex(rand2(wx, wy, 7035 + bi), SF_VARIANT_COUNT);
    var vStr = variantIdx < 10 ? '00' + variantIdx : (variantIdx < 100 ? '0' + variantIdx : '' + variantIdx);

    // Lifecycle via the tunable state-weight resolver. Defaults reproduce the
    // historical 15/55/20/10 split exactly (same salt, same thresholds).
    var lifecycleState = rollWeighted(
      tuneStateWeights('f2', biome, objName, F2_STATE_DEFAULTS),
      F2_STATE_ORDER, rand2(wx, wy, 7100 + bi));

    var lifeScale = 1.0;
    var lifeAngle = 0;
    var lifeSway = 1.0;
    if (lifecycleState === 'seedling') {
      lifeScale = 0.45 + rand2(wx, wy, 7101 + bi) * 0.15;
      lifeSway = 0.3;
    } else if (lifecycleState === 'wilting') {
      lifeScale = 0.85 + rand2(wx, wy, 7102 + bi) * 0.1;
      lifeAngle = (0.2 + rand2(wx, wy, 7103 + bi) * 0.3) * (rand2(wx, wy, 7104 + bi) > 0.5 ? 1 : -1);
      lifeSway = 0.5;
    } else if (lifecycleState === 'dead') {
      lifeScale = 0.6 + rand2(wx, wy, 7106 + bi) * 0.2;
      lifeAngle = (0.4 + rand2(wx, wy, 7107 + bi) * 0.4) * (rand2(wx, wy, 7108 + bi) > 0.5 ? 1 : -1);
      lifeSway = 0;
    }

    // Size tuning folds into lifecycle scale (NEW salts 7600+bi*4..+2)
    lifeScale *= tuneSize('f2', biome, objName, variantIdx, wx, wy, 7600 + bi * 4);

    // Ambient self-trigger (~7% of sprites animate on their own)
    var ambient = rand2(wx, wy, 7080 + bi) < 0.07;
    var ambientPeriod = 0;
    var ambientPhase = 0;
    if (ambient) {
      ambientPeriod = 4000 + rand2(wx, wy, 7081 + bi) * 8000;
      ambientPhase = rand2(wx, wy, 7082 + bi) * ambientPeriod;
    }

    var loopRoll = rand2(wx, wy, 7090 + bi);
    var loopCount = loopRoll < 0.05 ? 8 : loopRoll < 0.10 ? 7 : loopRoll < 0.40 ? 6 : loopRoll < 0.70 ? 5 : 4;

    // NOTE on rigidity: per long-standing (accidental but desired) behavior,
    // rigid objects DO play their wind_sway frames when available — rigidity
    // only zeroes the sway *rotation*, never the frame animation.
    var animWl = sfAnimVariantsFor(biome, objName);
    var animAvail = (!animWl || animWl.indexOf(variantIdx) !== -1)
      && tuneAnimEnabled('f2', biome, objName, 'wind_sway');

    var offUX = (rand2(wx, wy, 7030 + bi) - 0.5) * 1.1;
    var offUY = (rand2(wx, wy, 7031 + bi) - 0.5) * 1.1;

    // F3+ claim test: blade root in world art px (root sits ~0.35 tile
    // below sprite center). Claimed cell -> the blade never existed.
    var rootPx = (wx + 0.5 + offUX) * 32;
    var rootPy = (wy + 0.5 + offUY) * 32 + 0.35 * 32;
    if (isClaimedAt(rootPx, rootPy, _claimTileInfo(chunkStore))) continue;

    blades.push({
      bi: bi,
      stateUrl: lifecycleState !== 'normal' && STATE_SPRITES[biome + '/' + objName]
        ? SF_BASE_PATH + biome + '/' + objName + '/states/' + lifecycleState + '/v000.png'
        : null,
      animUrlBase: animAvail ? SF_BASE_PATH + biome + '/' + objName + '/anim/wind_sway/v' + vStr + '/' : null,
      staticUrl: SF_BASE_PATH + biome + '/' + objName + '/sf__' + biome + '__' + objName + '__v' + vStr + '.png',
      isRigid: RIGID_OBJECTS[objName] || false,
      lifeScale: lifeScale,
      lifeSway: lifeSway,
      baseAngle: (rand2(wx, wy, 7040 + bi) - 0.5) * 0.35 + lifeAngle,
      offUX: offUX,
      offUY: offUY,
      sortYOff: 0.5 + (rand2(wx, wy, 7031 + bi) - 0.5) * 0.5,
      ambientPeriod: ambientPeriod,
      ambientPhase: ambientPhase,
      startDelay: rand2(wx, wy, 7095 + bi) * 300,
      loopCount: loopCount,
      restFrame: Math.floor(rand2(wx, wy, 7096 + bi) * FRAME_COUNT)
    });
  }

  // Rare static decor objects (e.g., tundra fish piles, snow sculptures).
  // Same claim-cull as regular blades: decor inside an F3/F4/F5 footprint
  // never existed (root = tile center + offset, drawn 1 tile @ sortY +0.5).
  var extra = null;
  var extraObjs = SF_EXTRA_OBJECTS[biome];
  if (extraObjs && rand2(wx, wy, 7300) < 0.012) {
    var exOffUX = (rand2(wx, wy, 7302) - 0.5) * 0.6;
    var exOffUY = (rand2(wx, wy, 7303) - 0.5) * 0.6;
    var exRootPx = (wx + 0.5 + exOffUX) * 32;
    var exRootPy = (wy + 0.5 + exOffUY) * 32 + 0.35 * 32;
    if (!isClaimedAt(exRootPx, exRootPy, _claimTileInfo(chunkStore))) {
      extra = {
        url: extraObjs[pickIndex(rand2(wx, wy, 7301), extraObjs.length)],
        offUX: exOffUX,
        offUY: exOffUY
      };
    }
  }

  for (var fbi = 0; fbi < f4Blades.length; fbi++) blades.push(f4Blades[fbi]);

  if (blades.length === 0 && !extra) return { desc: null, cacheable: cacheable };
  return { desc: { blades: blades, extra: extra }, cacheable: cacheable };
}
