# F2 Persistent GPU Instance Buffers — Design

**Date:** 2026-06-12
**Status:** Approved by user (brainstorm session)
**Goal:** Raise the GL render path from ~57fps to 144fps by eliminating the per-frame rebuild of the y-sorted field sprite batch. Profiling shows `drawField2Animations` at 45.8% of frame self-CPU.

## Problem

`drawField2Animations` (src/render/field2-animator.js:929-1326) rebuilds the entire y-sorted sprite pool every frame:

1. Iterates every visible tile, fetches/builds tile descriptors.
2. Pushes ~2363 sprite objects (F2 blades + F4/F5/F6 placements) into `drawBuffer` in **screen space**.
3. Full `drawBuffer.sort()` by sortY (line 1173).
4. Rebuilds the 9-float GL instance array (~21k float writes + 2363 `atlasRect()` lookups).
5. Full-replace `bufferSubData` upload (gl-compositor.js `drawSpriteInstances`), plus a parallel shadow array.

Almost none of this changes frame to frame. Only ~7% of sprites self-trigger ambient sway; wind gusts and 120ms anim-frame UV swaps touch a small subset. Position, size, and sort order are deterministic and static. The structural flaw: instances are stored in screen coordinates, so any camera pan dirties all of them.

## Scope

The **entire y-sorted sprite pool** (F2 + F4 + F5 + F6 — they share `drawBuffer` and the sort), GL path only. The Canvas 2D path keeps the current per-frame rebuild (it is the probe path and GL-unavailable fallback; the perf target is GL).

## Design

### 1. World-space instances + camera uniform

Keep the existing 9-float instance layout (`SPRITE_FLOATS = 9`) but reinterpret the spatial fields as **world pixels**: `(wx, wy, worldSize, rot, alpha, u0, v0, du, dv)`. The sprite vertex shader receives a per-frame uniform `(camX, camY, zoom)` and computes screen position itself.

The shadow pass uses the **same instance data** plus sun-angle/shadow-length uniforms and derives the shadow transform in the shader — the all-day rotating shadows then also cost zero buffer writes (today the shadow array is rebuilt per frame alongside the main array).

Constraint: `scaledFrame`/atlas entries are keyed by on-screen draw size, so a **zoom change is a full invalidation** (rare, acceptable). Within a zoom level the shader scales.

### 2. Persistent buffer; rebuild only on events

A blade's sortY is world-space and never changes while the blade exists, so the sorted order is stable between events. The full pass (collect descriptors → build → sort → fill → full upload) runs **only** on:

- visible tile-window change (camera crosses a tile boundary)
- a chunk in the window becoming ready
- tuner `apply()` (any field) / anim toggle
- zoom change

Between events the instance buffer sits untouched on the GPU.

Rebuild also produces a flat CPU-side **blade registry** (parallel array: instance index, trigger params, anim URL bases, ambient phase/period, neighbor indices for contagion, isRigid/lifeSway flags) so per-frame and per-tick code never touches descriptors or Maps.

### 3. Per-render-frame loop (new hot path)

Per frame, only:

1. Iterate the **active list** — blades currently mid-sway or mid-anim (typically ~50–200). Compute rotation (sway envelope) and/or anim-frame UV; write those instances' 9 floats in place in the CPU mirror array.
2. Upload **coalesced dirty ranges** via partial `bufferSubData`. Fallback: if dirty instances exceed ~30% of the buffer, do one full upload (avoids fragmented-range driver stalls).
3. Set camera/sun uniforms; `drawArraysInstanced` (shadows then sprites, as today).

No sort, no allocation, no `atlasRect()` for static sprites.

### 4. Trigger scan at 10Hz

Wind-impulse sampling (`sampleCurrents`), ambient self-trigger checks (`(timeMs + phase) % period < window`), and neighbor contagion move to a 100ms tick over the flat registry — arithmetic only, contagion via precomputed neighbor indices instead of 9 Map lookups per blade per frame. A trigger appends the blade to the active list; the blade leaves the list when its sway envelope and anim cycle finish (its final floats stay written — preserving the freeze-on-last-frame ambient-life behavior).

Behavior is otherwise identical: same salts, same trigger thresholds, same state machine. Worst-case gust-spread timing shifts by ≤100ms, below the F2 probe's drift floor.

### 5. Canvas 2D path untouched

`useGL = false` keeps the existing per-frame rebuild path verbatim. probe-f2-visual's drift-aware gates remain valid.

### 6. Instrumentation & testing

Expose `window._f2Stats = { rebuilds, dirtyInstances, activeCount, lastRebuildMs }`.

- **New headless perf probe:** pan camera within a tile ⇒ `rebuilds` stays 0 and `dirtyInstances` ≪ total; cross a tile boundary ⇒ exactly one rebuild; tuner `apply()` ⇒ rebuild. Run with `PROBE_PORT` like the other probes; never concurrently with another playwright probe.
- **Visual parity:** existing probe-f2-visual (2D path) unchanged; during development, a GL screenshot A/B of old vs new path at a frozen lighting time and fixed camera.
- **Unit tests:** dirty-range coalescer; registry/active-list bookkeeping (trigger adds, envelope-end removes, freeze frame persists).

## Risks

- 10Hz contagion tick subtly changes gust spread timing — bounded ≤100ms, visually invisible, under probe drift floor.
- Fragmented partial `bufferSubData` can stall some drivers — mitigated by range coalescing + the 30% full-upload fallback.
- Zoom-keyed atlas entries force full invalidation on zoom — rare user action; same cost as one of today's ordinary frames.

## Out of scope

- Shader-side sway evaluation (Approach B from brainstorm) — follow-up only if A misses 144fps.
- The 19.7% chunk `worker.onmessage` at-rest cost — separate investigation.
- Canvas 2D path performance.
