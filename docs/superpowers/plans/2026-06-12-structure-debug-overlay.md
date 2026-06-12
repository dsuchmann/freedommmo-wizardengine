# Structure Debug Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A toggleable debug overlay (existing key **9**) in the canvas client and the overmap that draws settlement territory, districts, plots, building footprints/stamps, paths/roads/crossings, and tier labels as colored rectangles — pure structure visualization, no sprites, no fake layers.

**Architecture:** Three small extensions along an existing seam. (1) `serializeEntity` in `sim/server/protocol.js` gains explicit `settlement` and `plot` cases (today they leak through the generic living-entity branch WITHOUT territory/districts/rect — the overlay header comment at `src/render/sim-debug-overlay.js:4-6` already declares this gap and forbids faking it). (2) `collectDebugDrawables` / `drawSimDebugOverlay` in `src/render/sim-debug-overlay.js` gain settlement/plot/building/crossing layers. (3) `OvermapController.drawOverlay` gains settlement markers + tier labels at chunk scale, gated on the same toggle.

**Tech Stack:** Plain ES modules, Canvas 2D, node:test (`sim/test/protocol.test.js` for the wire form, `test/sim-debug-overlay.test.mjs` for the pure collector). No new dependencies, no new hotkeys.

**Honest absences (no-mock rule):** state/country/fiefdom layers do NOT exist kernel-side and are NOT drawn. The overmap only shows settlements inside the client's attention bubble (the server sends `nodesNear` around the viewport, `sim/server/server.js:78-84`) — distant settlements are honestly absent, never synthesized. Wall-aware client movement (`src/physics/movement.js canOccupy`) remains a separate backlog item; this overlay VISUALIZES walls, it does not enforce them.

**Verified seams (controller-read, 2026-06-12):**
- `serializeEntity(node, tick)` — `sim/server/protocol.js:67-117`; building case at :76-79 sends `{template, footprint, stamps}`; path case :68-70 sends `wear`; matter case :84-86 sends `archetype` (covers `road_segment`, `ford`, `bridge` — crossings confirmed as matter archetypes, `sim/world/crossings.js:65`).
- Settlement node attrs: `{tier, founderGroup, territory:{x0,y0,w,h}, districts:[{kind,rect,reason}], reasons, noFlux}` (`sim/society/settlements.js:58-62`). Plot node attrs: `{rect:{x0,y0,w,h}, settlement, district, owner, noFlux}` (settlements.js + `sim/society/growth.js deedPlots`).
- Stamps: `{x, y, piece:'wall'|'door'|'floor', material, walkable}` (`sim/world/blueprints.js:65-72`).
- Both settlement and plot nodes have x,y → spatially indexed → already returned by `nodesNear` and already cross the wire via the generic branch (protocol.js:88-116) as malformed living-shaped objects. Task 1 replaces that accidental leak with an explicit wire form.
- Overlay collector is pure & node-tested (`test/sim-debug-overlay.test.mjs`); draw fn reads `window._simClient` (`src/render/sim-debug-overlay.js:38`); toggle key 9 (`:81-88`); drawn from `canvas-renderer.js` (line ~432). Transform: `sx = x*tilePx − camX`.
- Overmap: `src/world/overmap.js` `drawOverlay(ctx, pcx, pcy)` (:121-168); chunk→px: `px = center + (chunk − pcx)/chunkScale`; `WORLD.chunkSize = 64`; key m toggles, f expands (`src/main.js:138-139`).

**File structure:**
- `sim/server/protocol.js` — settlement/plot wire forms (modify)
- `sim/test/protocol.test.js` — wire-form tests (append)
- `src/render/sim-debug-overlay.js` — collector + draw layers (modify)
- `test/sim-debug-overlay.test.mjs` — collector tests (append)
- `src/world/overmap.js` — settlement markers (modify)

---

### Task 1: settlement + plot wire forms

**Files:**
- Modify: `sim/server/protocol.js` (insert before the `if (node.type === 'matter')` case at line 84)
- Test: `sim/test/protocol.test.js` (append)

- [ ] **Step 1: Write the failing tests** — append to `sim/test/protocol.test.js`:

```js
test('serializeEntity: settlement wire form carries structure geometry, not sim internals', () => {
  const node = { id: 9, type: 'settlement', x: 935, y: 4, attrs: {
    tier: 'village', founderGroup: 3,
    territory: { x0: 930, y0: 0, w: 12, h: 10 },
    districts: [{ kind: 'residential', rect: { x0: 935, y0: 0, w: 6, h: 10 }, reason: 'west half' }],
    reasons: [{ axis: 'water', score: 0.9 }],
    noFlux: true, growthEnabled: true, peakBuildings: 2,
  } };
  const e = serializeEntity(node, 50);
  assert.deepEqual(e, {
    id: 9, type: 'settlement', x: 935, y: 4, tier: 'village',
    territory: { x0: 930, y0: 0, w: 12, h: 10 },
    districts: [{ kind: 'residential', rect: { x0: 935, y0: 0, w: 6, h: 10 } }],
  });
  // sim internals stay private: no founderGroup, reasons, growthEnabled, peakBuildings, noFlux
  assert.equal('founderGroup' in e, false);
  assert.equal('growthEnabled' in e, false);
});

test('serializeEntity: plot wire form carries rect + owner + district', () => {
  const node = { id: 12, type: 'plot', x: 935, y: 4, attrs: {
    rect: { x0: 935, y0: 4, w: 5, h: 4 }, settlement: 9, district: 'residential',
    owner: 3, noFlux: true,
  } };
  const e = serializeEntity(node, 50);
  assert.deepEqual(e, {
    id: 12, type: 'plot', x: 935, y: 4,
    rect: { x0: 935, y0: 4, w: 5, h: 4 }, district: 'residential', owner: 3, settlement: 9,
  });
});
```

- [ ] **Step 2: Run to verify failure** — `node --test sim/test/protocol.test.js` → FAIL (generic branch returns living-shaped object with `species`/`stage` keys).

- [ ] **Step 3: Implement** — in `sim/server/protocol.js`, insert immediately after the `corpse` case (line 83):

```js
  if (node.type === 'settlement') {
    // Structure geometry is render truth (debug overlay); founderGroup, scoring
    // reasons and growth-loop state stay sim-side (privacy rule precedent).
    const { tier, territory, districts } = node.attrs;
    return { id: node.id, type: 'settlement', x: node.x, y: node.y, tier, territory,
             districts: (districts ?? []).map(d => ({ kind: d.kind, rect: d.rect })) };
  }
  if (node.type === 'plot') {
    // owner/settlement are node ids — observable deeds, not private knowledge.
    const { rect, district, owner, settlement } = node.attrs;
    return { id: node.id, type: 'plot', x: node.x, y: node.y, rect, district, owner, settlement };
  }
```

- [ ] **Step 4: Run** — `node --test sim/test/protocol.test.js sim/test/protocol-wire.test.js` → PASS.

- [ ] **Step 5: Commit** — `git add sim/server/protocol.js sim/test/protocol.test.js && git commit -m "feat(wire): settlement + plot structure geometry crosses to clients"`

---

### Task 2: canvas overlay — structure layers

**Files:**
- Modify: `src/render/sim-debug-overlay.js`
- Test: `test/sim-debug-overlay.test.mjs` (append)

- [ ] **Step 1: Write the failing tests** — append to `test/sim-debug-overlay.test.mjs`:

```js
const structureSim = () => ({
  tick: 200,
  entities: new Map([
    ['s1', { id: 's1', type: 'settlement', x: 935, y: 4, tier: 'village',
             territory: { x0: 930, y0: 0, w: 12, h: 10 },
             districts: [{ kind: 'residential', rect: { x0: 935, y0: 0, w: 6, h: 10 } },
                         { kind: 'craft', rect: { x0: 930, y0: 0, w: 5, h: 10 } }] }],
    ['pl1', { id: 'pl1', type: 'plot', x: 935, y: 4,
              rect: { x0: 935, y0: 4, w: 5, h: 4 }, district: 'residential', owner: 3, settlement: 's1' }],
    ['b1', { id: 'b1', type: 'building', x: 935, y: 4, template: 'hut',
             footprint: { x0: 935, y0: 4, w: 5, h: 4 },
             stamps: [{ x: 935, y: 4, piece: 'wall', walkable: false },
                      { x: 936, y: 7, piece: 'door', walkable: true },
                      { x: 936, y: 5, piece: 'floor', walkable: true }] }],
    ['c1', { id: 'c1', type: 'matter', archetype: 'ford', x: 931, y: 2 }],
    ['c2', { id: 'c2', type: 'matter', archetype: 'bridge', x: 931, y: 3 }],
  ]),
  deltas: [],
});

test('collector extracts settlements, plots, buildings, and crossings', () => {
  const d = collectDebugDrawables(structureSim());
  assert.deepEqual(d.settlements, [{ x: 935, y: 4, tier: 'village',
    territory: { x0: 930, y0: 0, w: 12, h: 10 },
    districts: [{ kind: 'residential', rect: { x0: 935, y0: 0, w: 6, h: 10 } },
                { kind: 'craft', rect: { x0: 930, y0: 0, w: 5, h: 10 } }] }]);
  assert.deepEqual(d.plots, [{ rect: { x0: 935, y0: 4, w: 5, h: 4 }, owner: 3, district: 'residential' }]);
  assert.deepEqual(d.buildings, [{ template: 'hut', footprint: { x0: 935, y0: 4, w: 5, h: 4 },
    stamps: [{ x: 935, y: 4, piece: 'wall', walkable: false },
             { x: 936, y: 7, piece: 'door', walkable: true },
             { x: 936, y: 5, piece: 'floor', walkable: true }] }]);
  assert.deepEqual(d.crossings, [{ x: 931, y: 2, kind: 'ford' }, { x: 931, y: 3, kind: 'bridge' }]);
});

test('collector stays null-safe and backwards-compatible with the new keys', () => {
  const d = collectDebugDrawables(null);
  assert.deepEqual(d.settlements, []);
  assert.deepEqual(d.plots, []);
  assert.deepEqual(d.buildings, []);
  assert.deepEqual(d.crossings, []);
});
```

- [ ] **Step 2: Run to verify failure** — `node --test test/sim-debug-overlay.test.mjs` → FAIL (`d.settlements` undefined).

- [ ] **Step 3: Implement collector** — in `src/render/sim-debug-overlay.js`, replace `collectDebugDrawables` with:

```js
export function collectDebugDrawables(sim) {
  const out = { paths: [], roads: [], deltas: [], settlements: [], plots: [],
                buildings: [], crossings: [], tick: sim?.tick ?? -1 };
  if (!sim?.entities) return out;
  for (const e of sim.entities.values()) {
    if (e.type === 'path') out.paths.push({ x: e.x, y: e.y, wear: e.wear ?? 0 });
    else if (e.type === 'matter' && e.archetype === 'road_segment') out.roads.push({ x: e.x, y: e.y });
    else if (e.type === 'matter' && (e.archetype === 'ford' || e.archetype === 'bridge'))
      out.crossings.push({ x: e.x, y: e.y, kind: e.archetype });
    else if (e.type === 'settlement' && e.territory)
      out.settlements.push({ x: e.x, y: e.y, tier: e.tier, territory: e.territory,
                             districts: e.districts ?? [] });
    else if (e.type === 'plot' && e.rect)
      out.plots.push({ rect: e.rect, owner: e.owner, district: e.district });
    else if (e.type === 'building' && e.footprint)
      out.buildings.push({ template: e.template, footprint: e.footprint, stamps: e.stamps ?? [] });
  }
  for (const d of sim.deltas ?? []) {
    if (d.x != null && d.y != null) out.deltas.push({ x: d.x, y: d.y, kind: d.kind });
  }
  return out;
}
```

NOTE: the existing null-safe test asserts `deepEqual(collectDebugDrawables(null), { paths: [], roads: [], deltas: [], tick: -1 })` — UPDATE that assertion in the same commit to include the four new empty arrays (it is a shape change, not a behavior change).

- [ ] **Step 4: Implement draw layers** — in `drawSimDebugOverlay`, after the existing roads loop (line ~60) and before the deltas loop, add (drawing order: territory → districts → plots → buildings → crossings, so finer structure paints over coarser):

```js
  const px = v => Math.ceil(v * tilePx);
  const rectPx = r => [Math.floor(r.x0 * tilePx - camX), Math.floor(r.y0 * tilePx - camY), px(r.w), px(r.h)];
  const rectOnScreen = ([sx, sy, sw, sh]) => sx < w && sy < h && sx + sw > 0 && sy + sh > 0;
  const DISTRICT_COLORS = { residential: 'rgba(80,220,120,', craft: 'rgba(255,150,60,' };
  for (const s of d.settlements) {                 // territory: white dashed outline + tier label
    const r = rectPx(s.territory);
    if (!rectOnScreen(r)) continue;
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(r[0] + 0.5, r[1] + 0.5, r[2] - 1, r[3] - 1);
    ctx.setLineDash([]);
    for (const dist of s.districts) {              // districts: tinted fill + outline by kind
      const dr = rectPx(dist.rect);
      const c = DISTRICT_COLORS[dist.kind] ?? 'rgba(180,180,180,';
      ctx.fillStyle = c + '0.10)';
      ctx.fillRect(...dr);
      ctx.strokeStyle = c + '0.8)';
      ctx.lineWidth = 1;
      ctx.strokeRect(dr[0] + 0.5, dr[1] + 0.5, dr[2] - 1, dr[3] - 1);
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = c + '0.9)';
      ctx.fillText(dist.kind, dr[0] + 3, dr[1] + 11);
    }
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = s.tier === 'ghost' ? 'rgba(160,160,160,0.95)' : '#ffd24a';
    ctx.fillText(s.tier.toUpperCase(), r[0] + 3, r[1] - 5);
  }
  for (const p of d.plots) {                       // plots: thin white box + owner tag
    const r = rectPx(p.rect);
    if (!rectOnScreen(r)) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(r[0] + 0.5, r[1] + 0.5, r[2] - 1, r[3] - 1);
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(`g${p.owner}`, r[0] + 2, r[1] + r[3] - 3);
  }
  for (const b of d.buildings) {                   // buildings: stamps are the render truth
    const fr = rectPx(b.footprint);
    if (!rectOnScreen(fr)) continue;
    for (const st of b.stamps) {
      const sx = Math.floor(st.x * tilePx - camX), sy = Math.floor(st.y * tilePx - camY);
      if (st.piece === 'wall') ctx.fillStyle = 'rgba(70,80,95,0.85)';
      else if (st.piece === 'door') ctx.fillStyle = 'rgba(160,110,60,0.85)';
      else ctx.fillStyle = 'rgba(200,190,170,0.35)';            // floor
      ctx.fillRect(sx, sy, Math.ceil(tilePx), Math.ceil(tilePx));
    }
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.fillText(b.template, fr[0] + 2, fr[1] - 3);
  }
  for (const c of d.crossings) {                   // crossings: teal diamonds
    const sx = Math.floor(c.x * tilePx - camX), sy = Math.floor(c.y * tilePx - camY);
    if (!onScreen(sx, sy)) continue;
    ctx.fillStyle = c.kind === 'bridge' ? 'rgba(0,220,220,0.8)' : 'rgba(0,160,160,0.6)';
    const t = Math.ceil(tilePx), hx = sx + t / 2, hy = sy + t / 2;
    ctx.beginPath();
    ctx.moveTo(hx, sy + 2); ctx.lineTo(sx + t - 2, hy); ctx.lineTo(hx, sy + t - 2); ctx.lineTo(sx + 2, hy);
    ctx.closePath();
    ctx.fill();
  }
```

Also extend the HUD summary line (line ~73) to:

```js
  ctx.fillText(`SIM DEBUG  tick=${d.tick}  paths=${d.paths.length} roads=${d.roads.length} stl=${d.settlements.length} plots=${d.plots.length} bld=${d.buildings.length}`, w - 14, 22);
```

And update the header comment (lines 4-6): the wire NOW carries settlement/plot geometry (Task 1) — delete the "NOT serialized" caveat, keep the never-fake instruction.

- [ ] **Step 5: Run** — `node --test test/sim-debug-overlay.test.mjs` → PASS (all, including the updated null-safe shape).

- [ ] **Step 6: Commit** — `git add src/render/sim-debug-overlay.js test/sim-debug-overlay.test.mjs && git commit -m "feat(render): structure debug layers — territory, districts, plots, building stamps, crossings (key 9)"`

---

### Task 3: overmap settlement markers

**Files:**
- Modify: `src/world/overmap.js`

No unit test (DOM-bound draw code, same as the rest of OvermapController — the pure collector is already covered by Task 2). Verification is the headless render check in Step 3.

- [ ] **Step 1: Implement** — in `src/world/overmap.js`, at the END of `drawOverlay(ctx, pcx, pcy)` (after the border strokeRect at line ~165, before the closing comment), add:

```js
    // Structure markers (debug, gated on the sim debug overlay toggle, key 9).
    // HONEST LIMIT: the sim only sends entities inside the attention bubble —
    // distant settlements are absent here, never synthesized.
    const dbg = (typeof window !== 'undefined') ? window._simDebugOverlay : null;
    const sim = (typeof window !== 'undefined') ? window._simClient : null;
    if (dbg?.isEnabled() && sim?.entities) {
      const chunkPx = tile => ({
        x: c + (tile.x / WORLD.chunkSize - pcx) / this.chunkScale,
        y: c + (tile.y / WORLD.chunkSize - pcy) / this.chunkScale,
      });
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      for (const e of sim.entities.values()) {
        if (e.type !== 'settlement' || !e.territory) continue;
        const p = chunkPx(e);
        if (p.x < 0 || p.y < 0 || p.x > this.size || p.y > this.size) continue;
        ctx.fillStyle = e.tier === 'ghost' ? 'rgba(160,160,160,0.95)' : '#ffd24a';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(e.tier.toUpperCase(), p.x, p.y - 5);
      }
    }
```

(`c` and `this.chunkScale` are already in scope in `drawOverlay`; `WORLD` is already imported at line 1.)

- [ ] **Step 2: Syntax check** — `node --check src/world/overmap.js` → OK.

- [ ] **Step 3: Headless render check** — run the existing render-affecting test files to confirm no regression: `node --test test/sim-debug-overlay.test.mjs` → PASS (overmap has no test harness; the change is additive and gated).

- [ ] **Step 4: Commit** — `git add src/world/overmap.js && git commit -m "feat(overmap): settlement tier markers when sim debug overlay is on"`

---

### Task 4: close-out

**Files:**
- Modify: `docs/superpowers/plans/2026-06-12-structure-debug-overlay.md` (Deviations section)

- [ ] **Step 1:** Append `## Deviations (canonical)` to THIS plan recording every deviation the implementers logged (or "None" if clean).
- [ ] **Step 2:** Commit — `git add docs/superpowers/plans/2026-06-12-structure-debug-overlay.md && git commit -m "docs(overlay): close-out + deviations"`
- [ ] **Step 3 (controller):** final whole-branch READ-ONLY review, full suite in background, merge `git fetch . client-structure-overlay:master`, memory update, **REPORT TO USER: activation = key 9 in-game (overlay + overmap markers); overmap itself = key m, expand f.**

---

## Quality backlog (accepted up front)

- Plot `owner` renders as raw group id (`g3`) — names don't exist kernel-side yet (honest absence; Pass 5 society naming).
- Overmap markers only cover the attention bubble — a world-map structure registry (server-side settlement index endpoint) is future work if global maps are wanted.
- District `reason` text is wire-stripped (privacy precedent kept conservative); hover-inspection of reasons would need a query round-trip — backlog.
- `window._simClient` / `window._simDebugOverlay` dev hooks are the access path (existing precedent, sim-debug-overlay.js:38) — fine for a debug overlay, not for gameplay UI.
- Client `canOccupy` wall-awareness (src/physics/movement.js) remains open — overlay visualizes walls, doesn't enforce them.

---

## Deviations (canonical)

None substantive — all three tasks applied the plan code verbatim. Review notes accepted as backlog:

1. **Settlement `territory` crosses the wire by reference** (protocol.js) — safe today because the server JSON.stringifies synchronously; defensive-copy if wire objects ever outlive the send.
2. **Pre-existing: `group` nodes still leak through the generic living branch** as malformed living-shaped wire objects (species undefined). Not worsened by this branch; a non-renderable-type guard is a future protocol commit.
3. **Tier label clips when territory hugs the viewport top** (label drawn at y−5) — cosmetic debug nit.
