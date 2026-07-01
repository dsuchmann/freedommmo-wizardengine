// Web Worker: resolve the building set OFF the render thread. layoutSettlement is 20–155ms per
// cold settlement; running it synchronously in the draw froze the frame on every macro-cell
// crossing (the walk-into-town stutter). Terrain is a pure procedural f(x,y,seed), so the worker
// computes everything from the world seed alone — no loaded chunk data needed. See
// docs/superpowers/specs/2026-06-29-building-resolve-worker-plan.md.
//
// The render thread keeps drawing the previous resolved set until a reply lands (brief, like terrain
// chunk streaming), so it never blocks. This module is gated behind window._buildingWorker on the
// client; if it fails to load, the client falls back to the synchronous resolve.

import { resolveBuildingsInRange } from './resolved-buildings.js';
import { setWorldSeed } from '../../../src/core/world-seed.js';

self.onmessage = (e) => {
  const m = e.data;
  if (!m || m.type !== 'resolve') return;
  try {
    setWorldSeed(m.seed); // the terrain classifiers read getWorldSeed(); localStorage is absent here
    const { buildings, claimTiles } = resolveBuildingsInRange(m.seed, m.mx0, m.my0, m.mx1, m.my1);
    // The blueprint `node` (functions) and `_genSeed` (non-enumerable) don't survive structuredClone.
    // Copy what the render thread needs onto enumerable fields: the scalar the shadow pass reads, and
    // the gen seed so the client can lazily rebuild an identical node for walk-in / the '9' overlay.
    for (let i = 0; i < buildings.length; i++) {
      const fp = buildings[i].footprint;
      if (!fp) continue;
      try { fp.aboveGroundFloors = (fp.node && fp.node.payload && fp.node.payload.aboveGroundFloors) || 1; }
      catch (_) { fp.aboveGroundFloors = 1; }
      if (fp._genSeed !== undefined) fp.genSeed = fp._genSeed;
    }
    // claimTiles is a Set → post as an array; the client rebuilds the Set + the claim predicate.
    self.postMessage({ type: 'resolved', reqId: m.reqId, key: m.key, buildings, claimKeys: [...claimTiles] });
  } catch (err) {
    self.postMessage({ type: 'error', reqId: m.reqId, key: m.key, message: String((err && err.message) || err) });
  }
};
