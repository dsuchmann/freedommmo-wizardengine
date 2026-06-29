// src/render/dressing/d3-props.js
// D3 WALL ATTACHMENTS — mechanism B render. Draws the generated prop sprites INTO the building silhouette
// bitmap (rigid → GL lighting/CRT/depth like the walls; never a 2D overlay). Placement discipline:
//   • DON'T DUPLICATE THE TILE: the window tiles already depict shutters, so D3 adds NO shutter prop.
//   • IDENTITY-AWARE: a trade emblem is placed ONLY where it's TRUE (building.footprint.typeId/category).
//   • EDGE-AWARE: every prop is clamped to the building footprint (never floats off the wall).
//   • PAIR-MIRRORED: the LEFT member of a pair (left lantern) is flipped on X.
//   • VARIANT-RICH: each placement deterministically picks one of the object's base__vN variants on disk.
//   • DRAW ORDER (z): window/sill props behind → signs/awnings → door furniture → lanterns ON TOP. (Player
//     vs prop is a SEPARATE question, handled by the building silhouette depth: all props share the
//     building's flat baseline depth, so the player sorts in front when south of the baseline.)
import { buildSockets, projectSocket } from './socket-index.js';
import { rand2 } from '../../core/random.js';
import { onSceneDiscontinuity } from '../../core/scene-teardown.js';

const ROOT = '/assets/pixelab/buildings/dressing/';
const _img = new Map();
function img(url) { let im = _img.get(url); if (!im) { im = new Image(); im.src = url; _img.set(url, im); } return (im.complete && im.naturalWidth) ? im : null; }
// Every base__vN variant on disk for this object (v0..v7), in order, that has loaded. Picked per placement.
function variantSprites(biome, obj) {
  const arr = [];
  for (let i = 0; i < 8; i++) { const im = img(ROOT + biome + '/' + obj + '/base__v' + i + '.png'); if (im) arr.push(im); }
  return arr;
}
// Per-variant continuous-loop animation frames (anim/v<n>/frame_N.png) — flicker / sway, played by time.
// Non-empty → variant n animates (we cycle its frames instead of drawing it static). So a prop can both
// VARY and ANIMATE: pick the variant, then animate THAT variant if it was animated.
function loopFramesV(biome, obj, n) {
  const arr = [];
  for (let i = 0; i < 16; i++) { const im = img(ROOT + biome + '/' + obj + '/anim/v' + n + '/frame_' + i + '.png'); if (im) arr.push(im); else if (i > 0) break; }
  return arr;
}

export const D3_PROPS = { enabled: true, scale: 1.0 };
if (typeof window !== 'undefined') window._d3Props = window._d3Props || D3_PROPS;

// One light style per building (random — claims no identity). Shutters are GONE; flower box is placed
// directly (no group needed). The round terracotta pot is dropped from windows (it reads as a ground pot —
// a candidate for the future D5/D6 ground field, not a window-sill box).
const GROUPS = {
  doorlight: { salt: 0xD31, members: [['iron_candle_lantern', 0.6], ['wall_oil_lamp', 0.35]] },
};

// IDENTITY-DRIVEN over-door element: emblem must match the building's true purpose, else none.
function overdoorFor(b) {
  const fp = b.footprint || {}; const t = fp.typeId, cat = fp.category;
  if (t === 'tavern' || t === 'inn') return 'swinging_trade_sign';
  if (t === 'bakery') return 'projecting_board_sign';
  if (t === 'blacksmith' || t === 'armory' || t === 'jeweler' || t === 'locksmith' || t === 'foundry') return 'wrought_iron_silhouette_sign';
  if (cat === 'civic' || cat === 'military' || cat === 'religious' || t === 'feast_hall') return 'heraldic_banner';
  if (t === 'shop' || t === 'market_stall' || t === 'bazaar' || t === 'trading_post' || t === 'general_store') {
    const r = rand2(b.x | 0, b.y | 0, 0xD32);
    return r < 0.5 ? 'cloth_market_awning' : r < 0.8 ? 'wood_slat_awning' : 'fringed_shop_canopy';
  }
  // CATCH-ALL so EVERY business communicates its trade: any other craft/commercial building (jeweler handled
  // above; dyer, carpenter, tailor, potter, cobbler, weaver, …) gets a hanging trade sign. Non-business
  // categories (residential, agricultural, entertainment gardens/parks, infrastructure wells) stay bare.
  if (cat === 'craft' || cat === 'commercial') {
    const r = rand2(b.x | 0, b.y | 0, 0xD33);
    return r < 0.55 ? 'swinging_trade_sign' : 'projecting_board_sign';
  }
  return null;
}

// z = draw order (low first / behind, high last / on top).
const P = {
  // Trade signs HANG on a bare south wall column (like the banner) — anchor:'top' + a NEGATIVE vBias mounts
  // the header at MID-WALL (~lantern height), so the board hangs on visible solid wall BELOW the roof eave
  // (user 2026-06-25: high-mounted signs were occluded by the roof overhang) and never over a door opening.
  swinging_trade_sign:          { socket: 'bare_wall', size: 1.4,  anchor: 'top', vBias: -0.30, anim: 'sway', overdoor: true, salt: 0x02, z: 2 },
  projecting_board_sign:        { socket: 'bare_wall', size: 1.3,  anchor: 'top', vBias: -0.30, overdoor: true, salt: 0x03, z: 2 },
  wrought_iron_silhouette_sign: { socket: 'bare_wall', size: 1.25, anchor: 'top', vBias: -0.30, overdoor: true, salt: 0x04, z: 2 },
  // awnings are RIGID-MOUNTED canopies at the door head. They are bolted UNDER the eave, so they bake into the
  // building sprite BEFORE the roof (underRoof:true → drawBakedAwnings) and the roof overhangs their top — the
  // awning projects out from UNDERNEATH the roof (user 2026-06-27), NOT over it. NO object sway — a bolted-on
  // awning doesn't swing as a unit (user 2026-06-25); only its fabric ripples (internal wind_sway anim, TODO).
  wood_slat_awning:             { socket: 'above_door', size: 2.85, vBias: -0.14, overdoor: true, underRoof: true, salt: 0x05, z: 2 },
  cloth_market_awning:          { socket: 'above_door', size: 3.05, vBias: -0.14, overdoor: true, underRoof: true, salt: 0x06, z: 2 },
  fringed_shop_canopy:          { socket: 'above_door', size: 3.05, vBias: -0.14, overdoor: true, underRoof: true, salt: 0x07, z: 2 },
  // a banner hangs on a BARE south column (no door/window) — never over the door, where the door-swing anim
  // would slide out from under it. `overdoor:true` here only gates it to civic/military/religious buildings.
  heraldic_banner:              { socket: 'bare_wall', size: 2.2, vBias: -0.55, anim: 'sway', overdoor: true, salt: 0x08, z: 2 },
  // flower box is RIGID-MOUNTED on the sill — NO object sway (user 2026-06-25); the BLOOMS sway via an internal
  // generated wind_sway anim (TODO), not a procedural rotation of the whole box.
  timber_flower_box:            { socket: 'window_sill', size: 1.1, vBias: 0.16, chance: 0.4, salt: 0x31, seedBy: 'win', z: 3 },
  // door_handle_latch / door_knocker REMOVED (2026-06-24): on_door props float over the opening when the door
  // swings, and the generated door tiles already bake in a ring handle — a prop on a door doesn't work in-game.
  iron_candle_lantern:          { socket: 'beside_door', size: 1.35, group: 'doorlight', anim: 'flicker', salt: 0x01, z: 4 },
  wall_oil_lamp:                { socket: 'beside_door', size: 1.2,  group: 'doorlight', anim: 'flicker', salt: 0x09, z: 4 },
};
const DRAW_ORDER = Object.keys(P).sort((a, c) => (P[a].z || 0) - (P[c].z || 0));

// Strung festoons — festival lights / bunting / garland — draped across the FRONT of festive buildings and
// tiled along a catenary between the building edges (not socket-point props; they span the whole facade).
function strungChoice(b) {
  const fp = b.footprint || {}, t = fp.typeId, cat = fp.category;
  const festive = cat === 'entertainment' || cat === 'civic' || t === 'inn' || t === 'tavern' || t === 'feast_hall' || t === 'shrine' || t === 'market_stall';
  if (!festive) return null;
  const r = rand2(b.x | 0, b.y | 0, 0xD3F);
  if (r > 0.45) return null;
  return r < 0.18 ? 'strung_festival_lights' : r < 0.30 ? 'triangle_bunting' : 'festoon_garland';
}
function drawStrung(ctx, b, camX, camY, tilePx, w, h, obj, biome, socks, gscale) {
  const variants = variantSprites(biome, obj); if (!variants.length) return;
  const eave = socks.find((s) => s.kind === 'roof_edge'); const bb = b.footprint && b.footprint.boundingBox;
  const fp = b && b.footprint; if (!eave || !bb || !fp) return;
  // A festoon spans a CLEAR run of south wall and TERMINATES at the nearest door/window edge — never strung
  // across an opening or the whole facade, and NOT up at the eave (user 2026-06-25). Find the widest gap
  // between apertures, then hang the swag across it at MID-WALL so the roof occludes it like real wall decor.
  const occ = [];
  for (const d of (fp.doors || [])) occ.push([d.x + 0.5 - 1.4, d.x + 0.5 + 1.4]);
  for (const wn of (fp.windows || [])) occ.push([wn.x + 0.5 - 1.2, wn.x + 0.5 + 1.2]);
  occ.sort((a, c) => a[0] - c[0]);
  const lo = 0.35, hi = bb.w - 0.35;
  let best = null; const consider = (a, c) => { if (c - a >= 1.8 && (!best || c - a > best[1] - best[0])) best = [a, c]; };
  let cur = lo;
  for (const [a, c] of occ) { if (a > cur) consider(cur, Math.min(a, hi)); cur = Math.max(cur, c); }
  if (cur < hi) consider(cur, hi);
  if (!best) return; // no clear wall section wide enough → festoon honestly absent
  const ends = best.map((lx) => projectSocket(b, { runY: eave.runY, floor: eave.floor, cxLocal: lx, v: 0.58 }, camX, camY, tilePx));
  const x0 = ends[0].x, x1 = ends[1].x, y0 = ends[0].y;
  if (x1 - x0 < tilePx) return;
  const sag = tilePx * 0.5;
  const node = variants[Math.floor(rand2(b.x | 0, b.y | 0, 0xD40) * variants.length)];
  const sz = Math.round(tilePx * 0.6 * gscale), step = Math.max(6, Math.round(sz * 0.8));
  for (let px = x0; px <= x1; px += step) {
    const t = (px - x0) / (x1 - x0);
    const y = y0 + sag * Math.sin(Math.PI * t); // catenary sag across the clear wall section
    if (px > -sz && px < w + sz && y > -sz && y < h + sz)
      ctx.drawImage(node, 0, 0, node.naturalWidth, node.naturalHeight, Math.round(px - sz / 2), Math.round(y - sz / 2), sz, sz);
  }
}

function pickGroup(b, g) {
  const r = rand2(b.x | 0, b.y | 0, g.salt);
  let acc = 0;
  for (const [obj, wt] of g.members) { acc += wt; if (r < acc) return obj; }
  return null;
}

// D3 props have TWO entry points so AWNINGS can be occluded by the roof:
//   • drawBakedAwnings — ONLY the door-head awnings (underRoof:true). Called from the building bake BEFORE the
//     roof, so the eave overhangs the awning top and it projects out from UNDERNEATH the roof (user 2026-06-27).
//   • drawD3Props — EVERYTHING ELSE (signs, banners, lanterns, flower box, festoons). Drawn LIVE on the dynamic
//     prop quad over the cached sprite; these animate (sway/flicker) and the roof has no south overhang, so they
//     sit cleanly on the wall. Awnings are SKIPPED here (baked under the roof instead) to avoid a double-draw.
function renderProps(ctx, b, camX, camY, tilePx, w, h, keep, withFestoons) {
  const cfg = (typeof window !== 'undefined' && window._d3Props) || D3_PROPS;
  if (cfg.enabled === false) return;
  const biome = b && b.biome; if (!biome) return;
  const socks = buildSockets(b);
  if (!socks.length) return;
  const gscale = cfg.scale || 1;
  const picks = {};
  for (const k in GROUPS) picks[k] = pickGroup(b, GROUPS[k]);
  const overdoor = overdoorFor(b);
  const bb = b.footprint && b.footprint.boundingBox;
  const bbL = bb ? Math.round(b.x * tilePx - camX) : -1e9;
  const bbR = bb ? Math.round((b.x + bb.w) * tilePx - camX) : 1e9;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const obj of DRAW_ORDER) {
    const pl = P[obj];
    if (!keep(pl)) continue; // splits the two entry points: awnings (underRoof) bake separately from the overlay
    if (pl.overdoor) { if (obj !== overdoor) continue; }
    else if (pl.group && picks[pl.group] !== obj) continue;
    const variants = variantSprites(biome, obj); if (!variants.length) continue;
    const sz = Math.round(tilePx * pl.size * gscale);
    const half = sz / 2;
    for (const s of socks) {
      if (s.kind !== pl.socket) continue;
      const vx = pl.seedBy === 'win' && s.winX != null ? s.winX : Math.round(s.cxLocal);
      if (pl.chance != null && pl.chance < 1) {
        if (rand2((b.x + vx) | 0, (b.y + s.runY) | 0, (pl.salt || 0) ^ 0xD3) > pl.chance) continue;
      }
      // Pick the variant for this placement, then animate THAT variant if it has frames, else draw it
      // static. Props both vary AND animate. PAIR-MATCH: a socket with pairX/pairY (the two door flanks)
      // seeds its variant from the SHARED pair key, so the left and right lantern are the SAME design (a
      // matched pair) — yet pairs still vary building-to-building (the key is the door position).
      const seedX = (b.x + (s.pairX != null ? s.pairX : vx)) | 0;
      const seedY = (b.y + (s.pairY != null ? s.pairY : s.runY)) | 0;
      const vi = Math.min(Math.floor(rand2(seedX, seedY, (pl.salt || 0) ^ 0x5A) * variants.length), variants.length - 1);
      const vloop = loopFramesV(biome, obj, vi);
      let sprite;
      if (vloop.length) {
        // phase stays per-SOCKET (uses vx) so the two matched flames flicker independently, not in lockstep.
        const phase = (rand2((b.x + vx) | 0, (b.y + s.runY) | 0, (pl.salt || 0) ^ 0x7C) * vloop.length) | 0;
        const tnow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
        sprite = vloop[(Math.floor(tnow / 110) + phase) % vloop.length];
      } else {
        sprite = variants[vi];
      }
      const p = projectSocket(b, { ...s, v: s.v + (pl.vBias || 0) }, camX, camY, tilePx);
      let cx = p.x;
      // Awnings (above_door) stay CENTRED on the door even if they slightly overhang a small building's wall
      // (user 2026-06-26: clamping pushed the awning off the door). Other props clamp to the footprint so they
      // never float off the wall; a prop wider than the whole building is skipped.
      if (bb && pl.socket !== 'above_door') { if (bbR - bbL < sz) continue; cx = Math.max(bbL + half, Math.min(bbR - half, cx)); }
      if (cx < -sz || cx > w + sz || p.y < -sz || p.y > h + sz) continue;
      const dy = pl.anchor === 'top' ? Math.round(p.y) : Math.round(p.y - half);
      // PROCEDURAL anim (only when this variant has NO generated frames — grassland keeps its frame anims).
      // Still GL-routed (a transform on the silhouette-bitmap draw, never a 2D overlay): sway = pendulum about
      // the top (hanging sign/banner) or bottom (planted flower box); flicker = additive warm pulse on the
      // lit sprite (lanterns/lamps). Per-placement phase so neighbours don't move in lockstep. Zero PixelLab.
      const proc = vloop.length ? null : pl.anim;
      const tnow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
      const ph = rand2((b.x + vx) | 0, (b.y + s.runY) | 0, (pl.salt || 0) ^ 0x9E) * 6.2832;
      const sway = proc === 'sway' ? 0.05 * Math.sin(tnow / 900 + ph) : 0;
      const botPivot = pl.swayPivot === 'bottom';
      const paint = (alpha, additive) => {
        ctx.save();
        ctx.translate(Math.round(cx), Math.round(botPivot ? dy + sz : dy));
        if (sway) ctx.rotate(sway);
        if (s.mirror) ctx.scale(-1, 1);
        if (additive) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = alpha; }
        ctx.drawImage(sprite, 0, 0, sprite.naturalWidth, sprite.naturalHeight, -half, botPivot ? -sz : 0, sz, sz);
        ctx.restore();
      };
      paint(1, false);
      if (proc === 'flicker') {
        const fl = 0.14 + 0.16 * Math.sin(tnow / 120 + ph) + 0.09 * Math.sin(tnow / 53 + ph * 1.7);
        if (fl > 0.02) paint(Math.min(0.34, fl), true);
      }
    }
  }
  if (withFestoons) { // festoons hang across a CLEAR mid-wall section, draped over the front of festive buildings
    const strung = strungChoice(b);
    if (strung) drawStrung(ctx, b, camX, camY, tilePx, w, h, strung, biome, socks, gscale);
  }
  ctx.restore();
}

// Dynamic prop overlay (drawn over the cached sprite): every prop EXCEPT the awnings, which bake under the roof.
export function drawD3Props(ctx, b, camX, camY, tilePx, w, h) {
  renderProps(ctx, b, camX, camY, tilePx, w, h, (pl) => !pl.underRoof, true);
}
// Bake pass (drawn into the building sprite BEFORE the roof): ONLY the door-head awnings, so the eave overhangs
// their top and they project out from underneath the roof. No festoons here.
export function drawBakedAwnings(ctx, b, camX, camY, tilePx, w, h) {
  renderProps(ctx, b, camX, camY, tilePx, w, h, (pl) => !!pl.underRoof, false);
}
