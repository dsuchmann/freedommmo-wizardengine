# Building Dressing System — Design

> 2026-06-23. Brainstormed from the user proposal + a 6-subsystem code-mapping pass + 3 calibration
> samples. The base building generator produces CLEAN architecture (walls, windows, doors, roofs,
> stairs, floors, collision). The **dressing system** is a SECOND procedural layer — a stack of
> *dressing fields* (the building analog of landscape fields F0–F8) — that makes buildings feel
> authored, aged, lived-in, region/role-specific, WITHOUT regenerating the base building. The same
> machinery extends later to town/city/metropolis infrastructure (roads, pavers, pathways, plazas).

## Atlas placement & non-negotiables
- **Stratum:** S6 (Story/Shapers presentation) reading from S5 (Society) semantics, drawn through S2's GL pipeline.
- **No-mock:** dressing is presentation; its semantic params derive from the simulation (settlement
  chronicle / specialization), never faked. Where a param has no sim source yet (age/wealth/maintenance),
  it is **honestly absent**, not invented.
- **Everything through GL:** every dressing element — sprites, decals, splines, glow, smoke, shadows —
  renders through the GL chunk/sprite pipeline (lighting, day-night, CRT, depth-sort). NEVER a 2D ctx overlay.
- **Buildings are structures, not sprites:** dressing attaches to the resolved building's real geometry.

---

## 1 · The D-field stack
Eight dressing fields, each a self-contained layer with its own manifest section, deterministic
placement, tuner, and GL path. Grouped by the **render mechanism** that the code mapping confirmed.

| Field | Name | Mechanism | Plane | Default provenance |
|---|---|---|---|---|
| **D0** | Weathering | A · decal-into-bitmap | façade/roof/foundation | procedural (tints) |
| **D1** | Damage | A · decal-into-bitmap | façade/roof | procedural + sprite chips |
| **D2** | Surface growth | A · decal/spline-into-bitmap | façade | hybrid (vine pieces + spline; moss patch + coverage) |
| **D3** | Wall attachments | B · socket-prop | façade plane | sprite + hybrid (lit/sway) |
| **D4** | Structural attachments | B · socket-prop (own depth) | façade/ground | sprite (porches/columns) |
| **D5** | Ground landscaping | C · perimeter field-scatter | ground plane | sprite |
| **D6** | Ground props | C · perimeter field-scatter | ground plane | sprite + code (smoke/shadow) |
| **D7** | Identity kit | D · meta — composes D0–D6 | — | composition |

Mechanisms:
- **A** — painted INTO the building silhouette bitmap (`building-occluder.js drawWalls()` /
  `building-depth.js renderBuildingSilhouette()`); rides wall pixels, inherits lighting/CRT for free,
  no new depth. Pattern already used by `drawApertureFrame()`.
- **B** — socket-anchored prop. Rigid props (signs, awnings) paint into the building bitmap at the
  building's flat baseline depth (read as rigid, get the spotlight-hole for free); props that must sort
  with flora pack into the F2 `SPRITE_FLOATS` pool with `pivotY` depth.
- **C** — perimeter field-scatter; a dedicated field (F7-style) in `decoration-claims.js`, gated on the
  architecture-claim predicate (perimeter tiles), seeded **per-tile** (not per-building) for determinism,
  with tight footprint ellipses so ambient flora still draws around it.
- **D** — identity meta-rules: read `building.specialization.id` and bias/select from D0–D6 + add
  signature props (inn → sign+barrels+lanterns; smith → anvil+smoke+tools; shrine → candles+banners;
  abandoned → boards+heavy vines+moss; wealthy → columns+trimmed hedges+clean path).

---

## 2 · Manifest grain + canonical schema
`Field → Biome → Category → Object → Variant → {States, Animations, affordance components}`.
Category groups objects and carries the application rule; object is a specific thing; variant = pixel
variations; states/anims/components attach per object.

```jsonc
category = {
  id, field: 'D0'..'D7', label,
  placement: { plane: 'ground|facade|roof', anchor, method: 'decal|spline|socket_prop|scatter', fitDefault },
  application: {
    when: { biome[], building_role[], surface_type?, socket_type?, min_age?, min_wetness?,
            settlement_tier?, exposure? },          // gate; all params sim-derived or absent
    avoid: ['door_path','stairs','road','windows', ...],
    chance | density
  },
  biomeApplicability: 'universal' | { only:[...] } | { drop:[...] },
  objects: [ object, ... ]
}

object = {
  id, label,
  source: 'pixellab' | 'procedural' | 'hybrid',
  codeEffect: [ 'tint'|'emissive'|'particle'|'shadow'|'spline-assembly'|'shader-sway'|'coverage' ],
  scale: { nativePx, worldSize: { w, h }, fit: 'fixed|span|tile-along|grow|cover' },
  variants: { count: 3..8, drivenBy: 'role-glyph|material|style|random' },
  states: [ 'base', ... ],                          // discrete wear/lifecycle (taxonomy-aligned)
  anim:   [ 'static'|'wind_sway'|'flicker_glow'|... ],

  // affordance components — present ONLY when they apply (the contextual rule lives in `notes`):
  interact:     { verb: 'none|open_close|toggle|use|momentary', motion?, emits? } | null,
  destructible: { breakable: bool, broken_state, debris: [...] } | null,   // writes object-permanence delta
  light:        { color, radius, intensity, diurnal: bool, flicker?: profile } | null,  // (replaces lit:bool)
  content:      { axis: 'fill|load|season', states: ['full','empty','loaded','snow_capped', ...] } | null,
  attach:       { holds: [childCategoryId], slots: [...] } | null,         // composition (bracket→lantern)

  // SURFACE fields (D0–D2, mechanism A) use a coverage sub-grain INSTEAD of discrete variant+state art:
  coverage?: { scalar: 'driven by age|wetness 0-1',
               mask: { direction: 'down|up|none', falloff: 'bottom|top|patchy', facing: 'north|south|any' },
               textureVariants: count, blend: 'soft-light|multiply' },

  biomeSkins: { /* per-biome overrides: material host, climate-default state, flora-reskin, lit-multiplier */ },
  notes: 'why these affordances apply (the contextual rule)'
}
```

### Affordance rules (contextual — the calibration findings)
- **wind_sway** iff suspended/light/cloth (cloth_awning ✓, wood_slat_awning ✗ — anim is a property of
  *suspension*, not the category). **flicker_glow** is an emissive loop on light sources.
- **interact.verb**: `open_close` = constrained hinge (shutters); `toggle` = diurnal on/off; `use` =
  rope/pump stroke that emits a resource; `momentary` = one-shot (knocker, bell-pull).
- **destructible** iff fragile/container; emits `broken_state` + `debris[]` and a destruction delta.
- **light** for actual light sources only; the BODY is a sprite, the GLOW is procedural emissive into the
  GL lighting pass.
- **content** for vessels/yield (full/empty/loaded/seasonal) — orthogonal to wear states.
- **attach** for composites; the child (lantern, load, gate) is a separate lootable/destructible object.
- **Surfaces** are intensity-driven: a `coverage` scalar + directional/gravity/facing `mask`, not discrete states.

---

## 3 · Placement model — two spaces, vertical-aware
- **Ground plane** (z=0): addressed by world tile `(wx, wy)`. Knows perimeter rings, pathway mask, plaza,
  claims. Depth by the object's own `pivotY` (sorts with flora). → D5, D6.
- **Façade plane** (per visible face): addressed by `(face, floor, socket, fine-offset)`:
  - *face* = south/north/east/west; *floor* = storey (0,1,2…); *socket* = semantic anchor on that storey
    (window_sill, above_door, between_windows, wall_corner, roof_edge); *fine-offset* = sit-on-ledge nudge
    from the prop's anchor metadata.
  - Projection `(building, face, floor, socket) → (screenX, screenY, depth)` reuses the wall renderer's
    storey-stack (`NORTH_BAND_BASE + storey·STORY`); depth = the building's flat baseline. → D3, D4; D0–D2
    decals ride the same projected surface.
- **Roof plane**: ridge/eaves/pitch — chimneys, finials, roof-moss, snow.
- **Surface descriptor** (the shape knowledge fields query), emitted by extending
  `building-tile-query.js cachedLayout()` to produce a `surfacesIndex` + `socketsIndex` alongside `wallIndex`:
  `{ id, plane, face?, floor_range, extentTiles:{u,v}, orientation, material, exposure:{sun,wet,shade},
     apertures:[blocked_zones], edges:{top,bottom,left,right}, corners:[…], allows:[…], claims:[…] }`.

> **Dependency:** upper-floor sockets come from `BlueprintNode` per-floor apertures, and require the façade
> to actually render upper-storey windows. Confirm whether the south face draws floor≥1 apertures today;
> if not, that's a small render prerequisite for vertical placement (the pilot may start ground-floor only).

---

## 4 · Scale & fit
- **Scale:** `nativePx (PixelLab, generate large for quality) → worldSize (tiles) → renderScale =
  worldSize·tilePx / nativePx`. Per-biome multiplicative size tuner (reuse `field-tuning.js`).
- **Fit modes:** `fixed` (one anchor, set size) · `span` (stretch to anchor width, e.g. awning→door) ·
  `tile-along` (repeat kit pieces along a run, e.g. fence) · `grow` (assemble segment/fork/leaf pieces
  along a generated spline path, e.g. vine — start at foundation, climb to min(rule,wall_top), branch,
  avoid apertures) · `cover` (coverage 0–1 over a region, e.g. moss/dirt).

---

## 5 · Provenance
Every object declares `source` + `codeEffect`:
- **PixelLab sprite** (~80–85%): discrete objects + kit pieces. Generate large → downscale.
- **Pure code / GL effect** (no asset): pixel-mods (weathering tint, dirt/soot, water-stain streaks,
  sun-fade, wetness sheen), light (lantern/window/forge glow → emissive in lighting pass), particles
  (smoke, embers, falling leaves, dust, drips), prop ground shadows.
- **Hybrid** (pieces + code): vines (pieces + spline-growth), lit lantern (body + glow + diurnal), swaying
  sign (sprite + shader-sway), strung lanterns (pieces + line-layout + glow), moss (patch + coverage-scatter).

**Guardrail:** all code effects route through GL (emissive in the lighting pass, particles in the GL batch,
tints in the chunk bake/shader). Never a 2D ctx overlay.

---

## 6 · Determinism & seeding
Re-derivable everywhere (MMO-shaped, infinite world). Recipe:
`dressingRoot = seedFromPath(node.worldSeed, [...node.path, 'dressing'])` →
`seed = mix(dressingRoot, socketHash, ruleId, 0xD_channel)` → `rand(seed, choiceIdx)` for variant/state.
Never seed on `(bx,by)` alone (the regionally-constant-hash bug). Ground-scatter fields seed per-tile
`(wx,wy)` to match existing field determinism. `hashStr` for socket/object names.

---

## 7 · No-mock semantic source
Read at resolve-time (`resolved-buildings.js`, after biome stamp, before `byTile`):
- **building_role** ← `building.specialization.id` (100% derived, deterministic). ✓
- **biome / category / settlement_tier** ← available. ✓
- **wetness** ← derivable from biome + water-proximity (extend `terrain-suitability.js` to expose 0–1).
- **age / wealth / maintenance** ← **no sim source today → honestly absent.** Do NOT fake. (TODO: wire
  settlement founding event / chronicle age to `building.dressingContext`.) Attach a `dressingContext`
  object carrying only the available params; the rule engine reads it and skips age/wealth-gated rules
  until a source exists.

---

## 8 · Engine integration seams (from the code map)
1. **Surfaces/sockets:** extend `src/render/building-tile-query.js cachedLayout()` to emit
   `surfacesIndex` + `socketsIndex` (O(1) macro-cell queries), reusing its existing edge detection.
2. **Decals (A):** new `drawWallDecals()` in `building-occluder.js drawWalls()`, soft-light blend after the
   base facade tile; coverage/mask procedural.
3. **Props (B):** `building.dressingProps` resolved at blueprint time; rigid → painted into silhouette;
   flora-sorted → F2 `SPRITE_FLOATS` pool with `pivotY`. Premultiplied alpha; gate on `renderOn('walls')`/
   `renderOn('roof')` and `!_inside`; 2D fallback path.
4. **Ground scatter (C):** add an F7-style field to `src/dev/field-registry.js` (`applyKind:'live'`);
   `f7Placements()` in `decoration-claims.js` following the F4 pattern, gated on `architectureClaimAt()`,
   tight ellipses, avoid door_path/road.
5. **Asset pipeline:** `assets/pixelab/dressing/[biome]/[kit_type]/` named `dk__BIOME__KITTYPE__vNNN.png`;
   post-process `solidify → alpha-trim → metadata(anchor points) → gen-dk-catalog.mjs`; manifest section in
   `building-materials.json`. Views: sidescroller (wall), high top-down (roof/ground).
6. **Light/particles:** emissive + particle effects into the existing GL lighting/weather passes (never overlay).

---

## 9 · Build phasing & vertical-slice pilot
Author the **whole manifest** (schema above), but **execute grassland first**, one field at a time, each
proven in-game before the next:
1. **D0 weathering** (procedural tints) on one grassland building — cheapest, proves the surface-descriptor
   + coverage/mask path with zero new assets.
2. **D3 wall attachments** (sockets) — proves the socket emission + façade projection + sprite/lit/sway.
3. **D2 surface growth** (vine spline) — proves the grow-fit + spline assembly + aperture avoidance.
4. **D5/D6 ground** — proves the F7 perimeter-scatter field + claim coexistence with flora.
5. **D7 identity** — composes the above by role.
Then scale horizontally: the other 20 biomes via `biomeSkins` specialization (material host, climate-default
states, flora-reskin), validating per biome group. Pilot-before-burst gate applies (assemble a real chunk,
verify, then unlock mass generation), per the project's composable-asset discipline.

## 10 · Open items / dependencies
- Upper-storey façade window rendering (vertical placement prerequisite).
- Sim source for age/wealth/maintenance (chronicle → per-building) — honest absence until then.
- Town/city/metropolis infrastructure = sibling stack reusing this schema (pathway/plaza anchors reserved).
- Interiors = generalizable sibling, different context/aesthetic — deferred.
