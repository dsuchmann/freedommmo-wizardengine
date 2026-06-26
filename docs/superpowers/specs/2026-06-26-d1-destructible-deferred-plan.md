# D1 Destructible Building Pieces — Deferred Plan (2026-06-26)

**Status: DEFERRED** (user shelved 2026-06-26 to move on to D2). The D1 sprite-chip half ships
as STATIC honest neglect/repair (committed `4ebe94a8b`): plank gaps / board patches / daub fill,
driven by the per-building disrepair baseline + host-gating. This doc captures how to make those
pieces TRULY DESTRUCTIBLE (player breaks one → it persists for everyone) when work resumes.

## Goal
A player can strike a damageable building piece (a sprung plank, a patch) and:
- the piece visibly breaks/widens (gap grows, patch is pried off → underlying gap shows),
- the change **persists** (survives reload, broadcasts to all clients) — never a faked/local break.

## The pivotal finding (seam map, 2026-06-25/26)
The object-permanence **delta log is production-wired** and is NOT the blocker:
- `sim/store/deltas.js` — `Deltas.push({tick,x,y,target,kind,attrs})` / `remove(id)` / `flush`/`load`.
- `sim/kernel/kernel.js` — `kernel.deltas` (line 24).
- `sim/world/actions.js` — `strike(kernel, playerId, targetId, damageType, amount, tick)` (~255) writes
  `'damaged'`/`'destroyed'` deltas (~273,281) — **but only for MATTER nodes**.
- `sim/world/buildings.js` — `constructBuilding` pushes a `'claimed'` delta (~140); decay removes it (~179).
- `sim/server/server.js` — broadcasts `kernel.deltas.list` (~101,155); **no delta-write request handler.**
- `sim/server/protocol.js` — validates **8 verbs only**; `strike` requires a matter-node target.

**The real blocker = the building ENTITY MODEL.** Building pieces are immutable STAMP TUPLES, not
entities with hp; there is no protocol verb to damage a building piece. So today the chips are honestly
STATIC (no-mock: we do not wire a destroy we cannot persist).

## Chosen approach — tile-addressed delta OVER the deterministic baseline (NOT full entities)
The CLAUDE.md model is **claims + deterministic baseline + delta log**. The procedural chips ARE the
deterministic baseline (disrepair-driven). So the honest, LIGHT path is: a player strike writes a
**building-damage delta keyed to the piece's tile**; the renderer composes baseline + delta. This avoids
rebuilding every wall piece into a full hp-entity (the heavier alternative the first map suggested).

Delta shape (proposed; confirm against the real conventions in the lifecycle map below):
`Deltas.push({ tick, x, y, target: 'bdmg:'+x+','+y, kind: 'building_damage', attrs: { level } })`
where `level` escalates `0 baseline → 1 widened/cracked → 2 destroyed/gap` (idempotent-ish: a strike
raises the level, capped). `building_damage` likely belongs in `wire.js` REMOVAL_KINDS-style handling.

## Build steps (when resumed)
1. **Protocol verb** — add `damage_building` to `sim/server/protocol.js` (or extend `strike` to accept a
   building-tile target), validated like the other verbs. Message: `{ verb:'damage_building', x, y }`.
2. **Server handler** — in `server.js` dispatch → a new `sim/world/actions.js` handler that validates the
   tile is a damageable building piece (a claimed building tile carrying a chip), then `Deltas.push` a
   `building_damage` delta escalating `level`. Deterministic, tick-stamped.
3. **Client ingestion** — `SimWorldState` (`src/sim/sim-world-state.js`) ingests the delta into its `_map`
   under a building-damage key (mirror the `f3:`/matter-destroyed overlay pattern — see lifecycle map).
4. **Renderer compose** — `d1-chips.js` / `building-occluder.js` query the building-damage overlay at each
   building tile (via `_simWorldState`) and compose over the baseline: `level 1` widen the gap art / show a
   bigger break; `level 2` drop the patch and reveal the gap. **Honest absence:** no sim connected → the
   procedural baseline still renders unchanged.
5. **Interaction trigger** — let the player target a chip's tile and send `damage_building`. Reuse an
   existing strike/interact input if one exists (see lifecycle map `interaction-trigger`); else add a
   key/click that resolves the targeted building tile (cursor→world-tile or tile-in-front-of-player) and
   only fires on a damageable piece.
6. **State art (optional)** — generate the manifest's `cracked`/`destroyed` chip states (PixelLab) so the
   widen/break has dedicated art instead of just scaling the base gap. Manifest: `d1_missing_roof_tile`
   (states base/cracked/destroyed), `d1_plank_gap` (base/destroyed), `d1_board_patch` (base/weathered).
7. **Debris (optional, manifest)** — a `destroyed` piece drops ground debris (`d1_tile_shard_ground` /
   `d1_plank_splinter_ground`) — a D5/D6 ground-scatter object, also delta-driven.

## Also deferred: the missing ROOF tile
`d1_missing_roof_tile` needs roof-engine work (`tools/roof/roof-renderer.js` has no per-sprite pass; only
a `roof_edge` socket exists — no roof-course/roof-hole sockets). Add roof-course sockets in
`socket-index.js` + a `drawRoofChips()` pass between skirt and facet loop (destination-out to punch a hole
revealing underlay). Independent of the destructibility work; can be done with the static baseline first.

## Lifecycle map (workflow wa7v5ovyb, 2026-06-26) — the exact hooks

**A. Server: verb → delta** (PARTIAL; the delta schema + strike pattern exist, building branch is new).
- `strike()` in `sim/world/actions.js:255-286` is the template — it writes a `'damaged'` delta (273,281)
  with stage escalation `intact→cracked→gap→shattered`, but for MATTER nodes only.
- Add `damage_building(kernel, playerId, x, y, damageType, amount, tick)` mirroring it: call
  `buildingStampAt(kernel, x, y)` (`sim/world/buildings.js:41`) to find the stamp + parent building; if none,
  return null (honest no-op); keep escalating per-stamp damage in `building.attrs.stampDamage[x+','+y]`
  (`none→cracked→gap→remove`), reusing `damageTaken(def, damageType, amount)` from `objects.js`; emit a
  ledger event; then write the delta:
  `kernel.deltas.push({ tick, x, y, target: 'building-stamp:'+buildingId+':'+x+','+y, kind: 'building_damage', attrs: { level, newLevel, damageType, magnitude } })`.
- Add `'damage_building'` to the verb set in `sim/server/protocol.js:8` + validation (finite int x,y;
  damageType in DAMAGE_TYPES; amount ≤50). Dispatch it in the `server.js` intent pump (~line 117).
- **Keep `building_damage` OUT of `REMOVAL_KINDS`** (`wire.js:41`, `sim-world-state.js:5`) — it's a stage
  scar that PERSISTS visually, not a removal. Deltas already broadcast via `tickDeltaMsg` (`server.js:155`).

**B. Client: delta → renderer** (EXISTS for removals; building_damage needs a small SimWorldState branch).
- `SimWorldState._map` key format `'f3:wx,wy:i'`; overlay value `{ visual, removed, entityId, entityType }`;
  lookup API `simWorldState.overrideFor(key)` (used by `field2-animator.js:1434`). Today `update()` only
  retains REMOVAL_KINDS into `_map`.
- ADD: have `SimWorldState.update()` also retain `building_damage` deltas into `_map` under a tile key (e.g.
  `'bdmg:'+x+','+y` → `{ level }`). Then in `d1-chips.js`/`building-occluder.js`, query
  `simWorldState?.overrideFor('bdmg:'+wx+','+wy)` per building tile and compose over the procedural baseline
  (level `cracked`→widen the gap art / level `gap`→drop the patch + show the gap). **Honest absence:**
  `simWorldState === null` (no sim) → render the baseline unchanged (the `_onSimClose` path already degrades).

**C. Interaction trigger** (EXISTS — reuse the intent send path).
- Send API: `simClient.intend({ verb, target, damageType, amount })` → wire `{type:'intent', verb, ...}`
  (`sim-client.js:37`). Player already presses **F** to interact; add a SECONDARY key (e.g. X / middle-mouse)
  for a targeted strike so it doesn't collide with the F entity path.
- Target the tile in FRONT of the player: `player.character.facingDirection` (8-way) + a dirMap unit step →
  `targetTx = floor(player.x)+dx, targetTy = floor(player.y)+dy`; send `{ verb:'damage_building', x:targetTx,
  y:targetTy, damageType:'blunt', amount }`. (Screen→tile if cursor-targeted: `(screenX+camX)/tilePx`.)
  Only fire when that tile carries a damageable chip (high-disrepair timber piece) — gate client-side for feedback,
  server re-validates via `buildingStampAt`.

**Net:** ~one new server handler + one verb + one SimWorldState branch + one renderer query + one input key.
No full entity-rebuild needed — the chip is the deterministic baseline, the delta is the persistent override.
