// src/render/dressing/socket-index.js
// Façade SOCKET index — the placement scaffolding for the D-stack attachment fields (D3 wall attachments,
// D4 structural). A socket is a semantic anchor on a building face where a prop hangs: a window sill, a
// door lintel, a wall corner, a roof eave. We emit them from the SAME geometry the tile-corpus renderer
// draws (footprint.doors / footprint.windows + southRuns) and project them with the SAME storey-stack
// (runGroundY − (floor+v)·wH), so a marker/prop registers EXACTLY on the rendered wall — no divergence,
// no mock. Pure (no DOM); proven visually by socket-overlay.js before any PixelLab art is generated.
//
// Honest scope: SOUTH face only (the face the exterior renderer draws). N/E/W faces and upper-floor
// window sockets land here once those faces render apertures (design spec §10 prerequisite). Window
// sockets align on tile-corpus biomes (windows come from footprint.windows); legacy biomes that place
// windows heuristically will have door/corner/eave sockets but may not align window sills yet.

import { WALL_CONFIG } from '../wall-config.js';
import { buildingFloors } from '../building-shadow.js';
import { southRuns } from '../building-tiles.js';

// Vertical anchor within a storey band: 0 = the storey's ground line (band bottom), 1 = band top.
// Tunable per kind; a real prop adds its own fine-offset from its anchor metadata on top of this.
export const SOCKET_V = { window_sill: 0.30, above_door: 0.92, wall_corner: 0.5, roof_edge: 1.0, beside_door: 0.62, window_jamb: 0.55, on_door: 0.45, bare_wall: 0.92 };
// Upper-storey window tiles are the ground tile with the bottom foundation cropped (derive-upper foundFrac
// 0.16) and rescaled to the full band, so every feature — including the window OPENING — shifts. A ground
// sill at band-fraction v lands at v' = 1 − (1−v)/UPPER_TILE_KEEP on upper storeys. Used by projectSocket so
// window-anchored props (sill flower box / jamb) sit on the upper opening instead of floating at the ground v.
export const UPPER_TILE_KEEP = 0.84;

function runFor(runs, ax, ay) {
  for (const r of runs) if (r.y === ay && ax >= r.x0 && ax < r.x1) return r;
  return runs.length ? runs[runs.length - 1] : null;
}

/** All SOUTH-face sockets for a building, in building-local terms. Each:
 *  { id, kind, face:'south', floor, runY, cxLocal, v }. Feed to projectSocket() for screen coords.
 *  opts.winAnchor = { xFrac, sillV } (measured from the window art by aperture-measure.js): xFrac is the
 *  opening's horizontal centre as a fraction of the 4-tile tile; sillV is the sill height (0=ground line,
 *  1=storey top). Absent → the geometric tile-centre + the default sill fraction. */
export function buildSockets(b, opts = {}) {
  const fp = b && b.footprint;
  if (!fp) return [];
  const stories = Math.max(1, buildingFloors(b));
  const runs = southRuns(fp);
  if (!runs.length) return [];
  const wa = opts.winAnchor || null;
  const sillV = wa && wa.sillV != null ? wa.sillV : SOCKET_V.window_sill;
  const xOff = wa && wa.xFrac != null ? (wa.xFrac - 0.5) * 4 : 0; // tiles: shift to the true opening centre (tile art is 4 tiles wide)
  const out = [];
  // Door lintels + the lantern-flanking sockets either side of the doorway (clamped inside the run so
  // they never fall off a corner).
  for (const d of (fp.doors || [])) {
    const r = runFor(runs, d.x, d.y);
    const ry = r ? r.y : d.y;
    out.push({ id: `door:${d.x},${d.y}`, kind: 'above_door', face: 'south', floor: 0, runY: ry, cxLocal: d.x + 0.5, v: SOCKET_V.above_door });
    const lo = r ? r.x0 + 0.5 : d.x - 1, hi = r ? r.x1 - 0.5 : d.x + 2;
    const cl = (v) => Math.max(lo, Math.min(hi, v));
    // pairX/pairY = a key SHARED by both flank sockets, so a paired prop (lanterns) picks the SAME variant
    // on the left and right (a matched pair). mirror:true is on the RIGHT member so the pair faces the right
    // way (user 2026-06-26: the left/right lanterns were swapped — moved the flip from besideL to besideR).
    out.push({ id: `besideL:${d.x},${d.y}`, kind: 'beside_door', face: 'south', floor: 0, runY: ry, cxLocal: cl(d.x + 0.5 - 1.2), v: SOCKET_V.beside_door, pairX: d.x, pairY: ry });
    out.push({ id: `besideR:${d.x},${d.y}`, kind: 'beside_door', face: 'south', floor: 0, runY: ry, cxLocal: cl(d.x + 0.5 + 1.2), v: SOCKET_V.beside_door, mirror: true, pairX: d.x, pairY: ry });
    out.push({ id: `onDoor:${d.x},${d.y}`, kind: 'on_door', face: 'south', floor: 0, runY: ry, cxLocal: d.x + 0.5, v: SOCKET_V.on_door });
  }
  // Window sills, on every storey the window stacks up (mirrors the renderer's per-storey window draw).
  for (const wn of (fp.windows || [])) {
    const r = runFor(runs, wn.x, wn.y);
    const ry = r ? r.y : wn.y;
    const cx = wn.x + 0.5 + xOff;
    for (let st = 0; st < stories; st++) {
      out.push({ id: `win:${wn.x},${wn.y}#${st}`, kind: 'window_sill', face: 'south', floor: st, runY: ry, cxLocal: cx, v: sillV, winX: wn.x });
      out.push({ id: `jambL:${wn.x},${wn.y}#${st}`, kind: 'window_jamb', face: 'south', floor: st, runY: ry, cxLocal: cx - 0.9, v: SOCKET_V.window_jamb, winX: wn.x, mirror: true });
      out.push({ id: `jambR:${wn.x},${wn.y}#${st}`, kind: 'window_jamb', face: 'south', floor: st, runY: ry, cxLocal: cx + 0.9, v: SOCKET_V.window_jamb, winX: wn.x });
    }
  }
  // Wall corners — a corner is a full-height vertical edge, so emit one per storey at each run end.
  // Roof eave at the run centre, on the top storey.
  for (const r of runs) {
    for (let st = 0; st < stories; st++) {
      out.push({ id: `corL:${r.x0},${r.y}#${st}`, kind: 'wall_corner', face: 'south', floor: st, runY: r.y, cxLocal: r.x0, v: SOCKET_V.wall_corner });
      out.push({ id: `corR:${r.x1},${r.y}#${st}`, kind: 'wall_corner', face: 'south', floor: st, runY: r.y, cxLocal: r.x1, v: SOCKET_V.wall_corner });
    }
    out.push({ id: `eave:${r.x0}-${r.x1},${r.y}`, kind: 'roof_edge', face: 'south', floor: stories - 1, runY: r.y, cxLocal: (r.x0 + r.x1) / 2, v: SOCKET_V.roof_edge });
  }
  // BARE-WALL socket — a south column with NO door and NO window (and 1 tile of clearance from either), so a
  // hung banner never lands over the doorway, where the door-swing animation would slide out from under it
  // (user 2026-06-24: banners belong on bare wall, never on/over a door). Emit ONE — the clearest bare column
  // on the ground storey — and skip the corner tiles on a wide run. If the face is fully occupied, emit none
  // (honest absence: the banner just won't hang rather than landing on an opening).
  const occupied = new Set();
  for (const d of (fp.doors || [])) for (let k = -1; k <= 1; k++) occupied.add(d.x + k);
  for (const wn of (fp.windows || [])) for (let k = -1; k <= 1; k++) occupied.add(wn.x + k);
  let best = null;
  for (const r of runs) {
    for (let t = r.x0; t <= r.x1 - 1; t++) {
      if (occupied.has(t)) continue;
      // clearance score: distance to the run ends (so corner tiles score low) AND to any door/window column.
      // The clearest, most-central bare column wins; a narrow wall still falls back to a near-corner bare tile.
      let clr = Math.min(t - r.x0, (r.x1 - 1) - t);
      for (const o of occupied) clr = Math.min(clr, Math.abs(t - o));
      const score = clr + (r.x1 - r.x0) * 0.01;           // tie-break toward the wider run
      if (!best || score > best.score) best = { t, r, score };
    }
  }
  if (best) out.push({ id: `bare:${best.t},${best.r.y}`, kind: 'bare_wall', face: 'south', floor: 0, runY: best.r.y, cxLocal: best.t + 0.5, v: SOCKET_V.bare_wall });
  return out;
}

/** Project a socket to screen (x, y) + the building's flat baseline depth tile. Mirrors building-tiles.js
 *  runGroundY + the per-storey band math, so markers/props register with the rendered wall. */
export function projectSocket(b, s, camX, camY, tilePx) {
  const t = tilePx;
  const wH = Math.round(t * WALL_CONFIG.wallHeight);
  const WY = WALL_CONFIG.wallYOffset;
  const groundY = Math.round((b.y + s.runY + 1) * t - camY) + Math.round(t * WY);
  const x = Math.round((b.x + s.cxLocal) * t - camX);
  // window props on upper storeys ride the cropped+rescaled upper tile's opening (see UPPER_TILE_KEEP).
  let v = s.v;
  if (s.floor >= 1 && (s.kind === 'window_sill' || s.kind === 'window_jamb')) v = 1 - (1 - v) / UPPER_TILE_KEEP;
  const y = groundY - (s.floor + v) * wH;
  const bb = b.footprint && b.footprint.boundingBox;
  return { x, y, baselineTileY: b.y + (bb ? bb.h : 0) };
}
