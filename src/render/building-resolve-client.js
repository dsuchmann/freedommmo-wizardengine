// Main-thread client for the building-resolve Worker. Owns the Worker, dedupes requests by macro-range
// key (only the most-recent pending request is kept), and holds the latest resolved set so the renderer
// keeps drawing it while the next one computes off-thread. Gated behind window._buildingWorker; if the
// Worker can't be constructed/loaded, everything degrades to no-op so building-renderer uses its
// synchronous path. See docs/superpowers/specs/2026-06-29-building-resolve-worker-plan.md.

import { buildingNode } from '../../sim/world/buildings/blueprint-node.js';
import { setArchitectureClaim } from '../world/decoration-claims.js';

let _worker = null, _failed = false;
let _latest = null;       // { key, buildings, claimSet }
let _pendingKey = null;   // key the worker is resolving right now
let _queued = null;       // { msg, key } — most-recent request received while busy
let _reqId = 0;

// The blueprint `node` (functions) is dropped crossing the Worker boundary. Reattach it as a lazy,
// non-enumerable getter rebuilt from the carried generation seed — identical to footprints.js — so
// walk-in interiors, floor-view, and the '9' overlay work. The common shadow path already has the
// plain `aboveGroundFloors` the worker copied, so most buildings never trigger this rebuild.
function _reattachNode(b) {
  const fp = b && b.footprint;
  if (!fp || fp.node || fp.genSeed === undefined) return;
  Object.defineProperty(fp, 'node', {
    enumerable: false, configurable: true,
    get() {
      const n = buildingNode(fp.genSeed, {
        bx: 0, by: 0, typeId: fp.typeId, category: fp.category, tier: fp.tier,
        centrality: 0.5, race: fp.race ?? null, sections: fp.sections,
      });
      Object.defineProperty(fp, 'node', { value: n, enumerable: false, configurable: true });
      return n;
    },
  });
}

function _onMessage(e) {
  const m = e.data;
  if (!m) return;
  if (m.type === 'resolved') {
    for (let i = 0; i < m.buildings.length; i++) _reattachNode(m.buildings[i]);
    const claimSet = new Set(m.claimKeys);
    _latest = { key: m.key, buildings: m.buildings, claimSet };
    setArchitectureClaim((wx, wy) => claimSet.has(wx + ',' + wy));
  }
  // 'resolved' or 'error' both free the slot; run the queued (latest) request if any.
  _pendingKey = null;
  if (_queued && _worker) {
    const q = _queued; _queued = null; _pendingKey = q.key; _worker.postMessage(q.msg);
  }
}

function _ensureWorker() {
  if (_worker || _failed) return _worker;
  try {
    _worker = new Worker(new URL('../../sim/world/buildings/resolve-worker.js', import.meta.url), { type: 'module' });
    _worker.onmessage = _onMessage;
    _worker.onerror = () => { _failed = true; };
  } catch (e) { _failed = true; _worker = null; }
  return _worker;
}

/** True when the worker path should be used (flag on AND the worker hasn't failed to load). */
export function buildingWorkerEnabled() {
  return typeof window !== 'undefined' && window._buildingWorker === true && !_failed;
}

/** Ask the worker to resolve `key`'s range. Dedupes; only the most-recent pending request survives. */
export function requestResolve(seed, mx0, my0, mx1, my1, key) {
  if (!buildingWorkerEnabled()) return;
  if (_latest && _latest.key === key) return;        // already have it
  if (_pendingKey === key || (_queued && _queued.key === key)) return; // already asked
  if (!_ensureWorker()) return;
  const msg = { type: 'resolve', seed, mx0, my0, mx1, my1, key, reqId: ++_reqId };
  if (_pendingKey) _queued = { msg, key };            // busy → keep only the latest
  else { _pendingKey = key; _worker.postMessage(msg); }
}

export function latestBuildings() { return _latest ? _latest.buildings : null; }
export function latestKey() { return _latest ? _latest.key : null; }
