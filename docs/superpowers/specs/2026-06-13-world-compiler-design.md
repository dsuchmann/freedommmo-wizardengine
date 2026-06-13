# World Compiler — Civilization Generation System

**Date:** 2026-06-13
**Lane:** sim kernel / client rendering
**Status:** design (user review pending)
**Atlas placement:** S5 (society) consumes S2 (climate oracle), S1 (kernel store); feeds S4 (life), S6 (story)
**Prerequisite:** unbounded world (Phases 1–4, merged), chronicle hypergraph (L0–L2, merged)

## Directive

The simulation produces a living world where civilization is visible, varied, and
historically grounded. Pressing the debug overlay (9) reveals the full picture:
color-coded path networks, building footprints with type labels, district boundaries,
organic territory shapes, and political aggregations. Every feature has a reason —
the chronicle says what happened, the world compiler says what it looks like.

The world compiler is a **pure function of coordinates** — like `classifyBiome`.
Given (seed, x, y), it returns what civilization built at this tile: road type,
building footprint, district zone, territory claim. No pathfinding, no graph queries,
instant, GPU-parallelizable.

## Architecture: nested deterministic fields

```
classifyBiome(seed, x, y)           → terrain, climate         [exists]
chronicle(seed, macroCell)           → history, peoples, state  [exists]
─────────────────────────────────────────────────────────────────────────
settlementLayout(seed, macroCell)    → building catalog, roads  [NEW: this spec]
civilizationAt(seed, x, y)          → what's at this tile       [NEW: per-tile query]
```

The world compiler has two levels:
1. **Macro layout** — per macro-cell (128×128 tiles): which buildings exist, where they go, 
   how districts form, where roads run. Computed once, cached.
2. **Per-tile query** — `civilizationAt(seed, x, y)` looks up the macro layout and returns
   what's at this specific tile: road, building wall, building floor, door, open plaza, or nothing.

Both are pure functions. The macro layout is deterministic f(seed, macroCell, chronicle, terrain).
The per-tile query is a spatial lookup into the macro layout.

## Building taxonomy

Every building type that has existed in human civilization, fantasy literature, and science
fiction. Each has: category, footprint patterns, size range, placement rules, race variants.

### Categories and types

**Residential**
- hut (2×2–3×3), cottage (3×3–4×4), house (4×4–6×5), longhouse (3×8–4×12),
  manor (6×6–8×8), villa (8×8–12×10), apartment (4×6–6×10, multi-story implied)

**Commercial**
- market_stall (2×2–3×2), shop (3×3–4×4), warehouse (5×5–8×8),
  trading_post (4×4–6×5), inn (5×5–7×6), tavern (4×4–6×5),
  bazaar (6×6–10×8, open-air with stalls)

**Craft**
- blacksmith (4×5), tannery (4×4), bakery (3×3–4×4), pottery (3×3),
  weaver (3×4), carpenter (4×5), alchemist (3×4), jeweler (3×3),
  glassblower (4×4), dyer (3×4), brewer (4×5)

**Agricultural**
- barn (5×6–8×8), silo (2×2–3×3, circular), mill (4×4–5×5),
  granary (4×4–5×5), greenhouse (3×6), stable (4×6–6×8),
  coop (2×3), apiary (2×2), vineyard_press (3×4)

**Civic**
- town_hall (6×6–8×8), courthouse (5×5–7×7), library (4×5–6×6),
  school (4×5), bathhouse (5×5–7×7), fountain (2×2–3×3),
  well (1×1–2×2), monument (2×2–4×4), prison (4×5–6×6)

**Religious**
- shrine (2×2–3×3), chapel (3×4–4×6), temple (6×6–10×10),
  monastery (8×8–12×12, compound), altar (1×1–2×2),
  oracle_chamber (4×4), burial_ground (4×4–8×8)

**Military**
- watchtower (2×2–3×3), barracks (4×6–6×8), armory (3×4–4×5),
  training_ground (6×6–8×8, open), wall_segment (1×N),
  gate (3×1–5×1), siege_workshop (4×5)

**Infrastructure**
- bridge (1×N), dock (3×4–4×6), lighthouse (3×3),
  road_station (3×3), waystone (1×1), aqueduct_section (1×N),
  cistern (3×3), granary (4×4)

**Entertainment**
- theater (6×6–8×8), arena (8×8–12×12), garden (4×4–8×8, open),
  park (6×6–12×12, open), feast_hall (5×8–6×10)

**Race-specific**
- crystal_nexus (Veylith, 4×4, hexagonal), ember_forge (Ignaar, 5×5, volcanic),
  root_hall (Sylvari, irregular, grown), stone_sanctuary (Kaldreth, carved),
  tide_lodge (Thalori, stilts over water), moss_den (Grotharn, sunken),
  sand_pavilion (Ashren, tent-like), frost_hall (Frostwyn, ice architecture)

### Footprint patterns

Buildings are NOT rectangles. Each type has a footprint **pattern** — a set of
connected rectangular sections with corridors:

```
Pattern: L-shape          Pattern: T-shape          Pattern: courtyard
  ████                      ████                    ████████
  ████                      ████                    █      █
  ██████                  ████████                  █      █
  ██████                  ████████                  █      █
                                                    ████████

Pattern: winged           Pattern: compound          Pattern: round
  ██  ██                    ██████  ████            ░░████░░
  ██████                    ██████  ████            ████████
  ██████                    ██████████              ████████
  ██  ██                    ██████████              ░░████░░
```

Each building type declares which patterns it can use. A house might be rectangular
or L-shaped. A temple might be T-shaped or courtyard. A monastery is always compound.
The specific pattern is seeded per building instance: `rand(seed, buildingId)` selects
from the type's allowed patterns.

### Footprint generation algorithm

```
footprint(seed, buildingType, biome, race, tier) → {
  sections: [{ x0, y0, w, h }],   // connected rectangular pieces
  walls: [{ x, y }],              // perimeter tiles
  doors: [{ x, y, facing }],      // passable gaps in walls
  floors: [{ x, y }],             // interior tiles
  features: [{ type, x, y }],     // forge, bed, table, etc.
}
```

Sections are generated by:
1. Start with base rectangle (type's min size + seeded variance)
2. If pattern allows wings: attach 1-2 wing rectangles at seeded positions
3. If pattern allows corridors: connect sections with 1-wide corridors
4. Walls = perimeter of union of sections
5. Doors = seeded gaps in walls (at least 1, facing road if possible)
6. Floors = interior of sections
7. Features = type-specific interior placement rules

## District formation

Buildings don't scatter randomly — they cluster into districts with shared character.

### District types

- **residential** — houses, cottages; quiet, setback from main roads
- **market** — shops, stalls, warehouses; along main road, open plazas
- **craft** — workshops, forges, tanneries; near roads, away from residential (noise/smell)
- **civic** — town hall, library, bathhouse; settlement center, largest buildings
- **religious** — temple, shrine, cemetery; elevated ground or quiet corner
- **military** — barracks, walls, towers; settlement perimeter
- **agricultural** — barns, fields, silos; settlement edge toward fertile land
- **harbor** — docks, warehouses, taverns; waterfront (coastal/river settlements only)

### District layout algorithm

Per macro-cell, if a settlement exists:
1. Place settlement center (from genesis site-finding, already exists)
2. Determine district set from settlement tier:
   - Village: residential + craft (2 districts)
   - Town: residential + market + craft + civic + religious (5 districts)
   - City: all types (8+ districts)
3. Assign district positions as radial sectors from center:
   - Civic at center
   - Market along the primary road
   - Residential fills most area
   - Craft/military at edges
   - Harbor at waterfront (if water within territory)
   - Seeded noise displaces sector boundaries for organic shapes
4. Each district gets a building budget based on area and tier
5. Buildings placed within districts following placement rules (below)

## Building placement

### Placement algorithm (per district)

```
placeBuildings(seed, district, terrain) → [{type, footprint, x, y, rotation}]
```

1. **Seed the road spine** — a primary path through the district (noise-displaced curve
   from district center toward district edge). Secondary paths branch at seeded intervals.
2. **Place anchor buildings** — the most important building for this district type
   (town hall for civic, temple for religious, market for market). Placed first at the
   path intersection nearest district center.
3. **Fill along roads** — remaining buildings placed along paths with:
   - Seeded setback from road (1-4 tiles, varies per building)
   - Seeded gap between buildings (1-3 tiles)
   - Seeded rotation (0°, 90°, 180°, 270° — facing road)
   - Building type selected by district type + seeded roll against type weights
4. **Validate placement** — each footprint checked against terrain (no water tiles,
   reasonable slope) and against other buildings (no overlap). If invalid, try next
   candidate position along the road.
5. **Fill remaining area** — gardens, open spaces, minor paths between buildings.
   Empty areas are plazas or parks, not bare terrain.

### Placement constraints

- Buildings face roads (door toward nearest path)
- No building footprint on water tiles
- Minimum 1-tile gap between buildings (breathing room)
- Larger buildings closer to district center
- Race-specific placement rules (Sylvari grow buildings in forest clearings,
  Kaldreth carve into cliff faces, Thalori build on stilts over water)

## Territory shape

Settlement territory is NOT a rectangle. It's an **influence field** — a flood-fill
from the settlement center, spreading through walkable terrain with cost proportional
to terrain difficulty.

```
territoryAt(seed, x, y) → { settlement, influence } | null
```

### Algorithm

1. From settlement center, flood-fill outward in rings
2. Each tile's influence = base - accumulated terrain cost to reach it
3. Water tiles block spread (but Thalori can cross shallow water)
4. Mountain/cliff tiles are high cost (Kaldreth ignore this penalty)
5. Territory edge = where influence drops below threshold
6. Where two settlements' influence zones meet, the boundary follows the
   equal-influence contour (like a Voronoi diagram weighted by terrain cost)
7. Territory shape is computed once per macro-cell and cached

The territory boundary is organic — it follows rivers, runs along ridgelines,
curves around obstacles. Not a rectangle. Not a circle. A terrain-following contour.

## Political aggregation

Settlements with shared characteristics form political units:

```
Territory → District (of a settlement)
Settlement → Commune (independent) or Member (of a state)
State → collection of settlements sharing race + chronicle lineage
Realm → collection of states (rare, large-scale)
```

### Rules

- Settlements sharing the same dominant race AND whose territories are contiguous
  (touching or connected by road) form a **state**
- State name derived from dominant race + biome + chronicle
  (e.g., "Ashren Steppe Confederacy", "Kaldreth Mountain Hold")
- States with shared chronicle lineage (founding events reference each other)
  form a **realm** (extremely rare — only in ancient flourishing heartlands)
- Wilderness between territories is unclaimed — no political unit

Political boundaries are derived from territory boundaries — they inherit the
organic shape. A state boundary = the union of its member territories' boundaries.

## Path network

The road system is a **pure field function** — each tile independently determines
whether a road passes through it.

```
roadAt(seed, x, y) → null | { tier, wear, culture }
```

### Road tiers

| Tier | Width | Wear | Description |
|------|-------|------|-------------|
| concourse | 3-4 tiles | 1.0 | Major trade routes between cities |
| road | 2 tiles | 0.8 | Main roads between settlements |
| street | 1-2 tiles | 0.6 | Within-settlement streets |
| path | 1 tile | 0.4 | Trails to farms, shrines, POIs |
| alley | 1 tile | 0.2 | Narrow passages between buildings |
| game_trail | 1 tile | 0.1 | Animal paths, barely visible |

### Road generation algorithm

For inter-settlement roads:
1. Each settlement knows its neighbors (from macro-cell grid — pure, no graph)
2. For each pair, a road curve is computed as a cubic Bézier:
   - Control points displaced by `fbm` noise seeded by the settlement pair
   - Noise amplitude proportional to distance (longer roads wander more)
   - Roads follow valleys (bias toward low elevation) and avoid water
3. Road tier determined by chronicle density:
   - Ancient flourishing heartland → concourse
   - Active trade route → road
   - Young colony → path
   - Ruined connection → game_trail (ghost of former road)
4. A tile is "on the road" if its distance to the nearest point on any curve
   is less than the road's half-width

For within-settlement roads:
1. Primary street: straight-ish line through settlement center, noise-displaced
2. Secondary streets: branch at seeded intervals
3. Alleys: emerge between buildings naturally (gaps in building placement)

### Road rendering

Roads suppress underlying decorations (F2/F3/F4 flora) via the claims system.
Road tiles render as a Wang tile layer (same as biome terrain):
- Per biome: dirt road on grassland, sand path on desert, stone road on mountain
- Per race: cobblestone (human), crystal (Veylith), carved stone (Kaldreth)
- Per wear: fresh → worn → overgrown (ruins)

Assets: ~10-15 Wang tilesets (biome × culture), 16 tiles each. Generated in
PixelLab bursts, placeholder colored overlay until assets exist.

## Overlay (debug view)

When the user presses 9, all civilization layers render as translucent overlays:

| Layer | Color | Shows |
|-------|-------|-------|
| Territory boundary | Race color, organic contour | Influence extent |
| Political boundary | White dashed, thicker | State/realm borders |
| District zones | Tinted fills per type | Residential (green), market (gold), etc. |
| Building footprints | Semi-opaque shapes per category | Walls, doors, type labels |
| Roads/paths | Tan/brown, width by tier | Full network |
| Building labels | Text on footprint | "blacksmith", "inn", "temple" |
| Settlement label | Pill above center | "TOWN · Ashren · 4 ages" |

Click any building to inspect: type, district, age, race, chronicle provenance.

## Implementation phases

### Phase A — Building taxonomy + footprint generator (pure, no rendering)
Data: building types, patterns, footprint generation function.
Test: deterministic footprints, valid wall/door/floor decomposition.

### Phase B — District layout + building placement (pure, per macro-cell)
The layout engine: given a settlement (center, tier, race, chronicle), produce
a complete building catalog with positions. Cached per macro-cell.
Test: deterministic layouts, no overlapping buildings, buildings face roads.

### Phase C — Territory field (organic boundaries)
Replace rectangular territories with influence-based flood-fill.
Test: territory contours follow terrain, neighboring settlements share boundaries.

### Phase D — Path network field (pure per-tile)
The `roadAt(seed, x, y)` function: noise-displaced Bézier curves between settlements,
within-settlement streets from district layout.
Test: roads exist between settlements, within-settlement streets connect buildings.

### Phase E — Political aggregation
Derive states and realms from territory contiguity + race/chronicle.
Test: settlements of same race with touching territories form a state.

### Phase F — Overlay rendering
Client-side visualization of all layers. No Wang tiles yet — colored shapes and labels.
Test: overlay shows correct data for all layer types.

### Phase G — Wang tile rendering + asset pipeline
Road Wang tilesets generated in PixelLab. Building sprites generated per type.
Roads render as terrain layer. Buildings render as stamped sprites.

## Determinism contract

- Same seed ⇒ same civilization everywhere, visit-order independent
- `civilizationAt(seed, x, y)` is pure — reads only seed + terrain oracle + chronicle
- Macro layout cached but recomputable (the cache is an optimization, not state)
- Live deltas (player-built/destroyed buildings) overlay the baseline (locked decision #7)

## Honest absences

- Phase A alone: building types exist as data, no spatial placement yet
- Phase B alone: buildings have positions but no visual rendering (overlay only)
- Phase C alone: territories are organic shapes but buildings are still Phase B rects
- Phase D alone: roads exist as a field but no Wang tile rendering (overlay lines only)
- Phase E alone: political units exist as data, NPCs don't know about them (Phase 4 story)
- Phase F: the overlay IS the visualization until Phase G delivers sprites
- Building interiors are honestly absent until interior generation lands
- NPC awareness of buildings/politics is Phase 4 (story rendering) territory

## Verification

- Headless probe: generate 100 macro-cells, verify >50% have buildings, no overlapping
  footprints, every building faces a road, districts cluster correctly
- Overlay probe: boot game, press 9, verify layers render at three far coordinates
- Determinism: two runs with same seed produce identical building catalogs
- Territory: organic boundary follows river/ridge, not a rectangle
- Roads: noise-displaced curves connect settlements, streets connect buildings within
