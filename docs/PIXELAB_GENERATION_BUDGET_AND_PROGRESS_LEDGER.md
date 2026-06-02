# PixelLab Generation Budget and Progress Ledger

Last updated: 2026-06-01

Purpose: preserve the generation plan, budget assumptions, progress, and decisions outside chat context so future agents / Claude / WizardGenie can continue without losing track.

Related files:

- `docs/PIXELAB_LANDSCAPE_ASSET_GENERATION_MANIFEST.md`
- `assets/prompts/claude-pixelab-landscape-v2-kickoff.md`
- `assets/prompts/pixelab-landscape-asset-generation-spec.md`
- `assets/prompts/pixelab-landscape-asset-matrix.json`
- `src/render/landscape-recipe.js`
- `src/render/tile-painter.js`

---

## 1. Current User Budget Position

User currently has approximately:

```txt
6,000 PixelLab generations remaining
```

User is willing to buy arbitrarily more generations and wants to eventually do the full asset pass, not only a small sample.

---

## 2. High-Level Answer: How Many Generations Are Needed?

### Practical answer

For a serious full-world PixelLab asset pass, expect approximately:

```txt
8,000–18,000 generations
```

A strong first complete pass is likely possible in:

```txt
6,000–9,000 generations
```

A polished, redundant, high-quality pass with retries, alternates, and consistency checks is more likely:

```txt
12,000–20,000+ generations
```

So the user’s current 6,000 generations are enough to begin seriously and probably finish a broad first-pass landscape library, but not enough to guarantee polished coverage of every biome × surface × Wang × overlay × object combination.

---

## 3. Why The Count Is High

We are not generating isolated sprites. We are building a coherent terrain assembly framework with these layers:

1. Opaque base Wang terrain families.
2. Surface overlays with alpha.
3. Micro decals with alpha.
4. Medium biome dressing.
5. Interactive objects.
6. Plateau / cliff / elevation edge pieces.
7. Transition references / QA sheets.

The expensive part is not just count. It is iteration:

- PixelLab generations fail sometimes.
- Some sheets are stylistically inconsistent.
- Some outputs are too noisy.
- Some lack alpha discipline.
- Some tile edges do not loop.
- Some Wang masks are unreadable.
- Some sprites are centered/repetitive.
- Water/snow/mud/sand edges need extra testing.

Therefore every required asset should budget for retries.

---

## 4. Budget Estimate By Layer

These estimates assume one PixelLab generation typically yields one sheet or one useful candidate sheet, and that we keep 1–3 winners per required family.

### 4.1 Base Wang terrain families

Goal: opaque 32×32 base terrain tile families with complete 16-mask Wang sets where applicable.

Core families we likely need:

- grassland / lush grass
- savanna / dry grass
- steppe / short grass
- forest floor / leaf litter
- dense forest floor
- taiga needle duff
- tropical forest floor
- swamp wet mud
- swamp moss / algae mud
- desert sand
- beach dry sand
- beach wet sand
- tundra frozen earth
- arctic snow / ice
- hills stony grass
- mountains stone
- volcanic ash / lava rock
- mystic/aether moss
- shallow water
- ocean/deep ocean
- river water
- lake water
- mud pool / wetland waterline

Approximate families: 22–26.

Per family:

- 16 Wang masks.
- 1–3 style attempts.
- possible prompt refinement.

Budget:

```txt
22 families × 16 masks × 2 attempts ≈ 704 generations
22 families × 16 masks × 4 attempts ≈ 1,408 generations
```

Estimated range:

```txt
800–1,800 generations
```

Important: if PixelLab can reliably generate a full 16-tile Wang sheet in one generation, this drops dramatically. If each mask must be generated separately, this remains expensive.

---

### 4.2 Biome-to-biome transition Wang families

This is where count can explode.

We should NOT generate all possible biome pairs.

We should generate only common ecological adjacency pairs from biome graph / overmap:

Core transition families:

- grassland ↔ forest
- grassland ↔ savanna
- grassland ↔ steppe
- grassland ↔ beach
- grassland ↔ river
- grassland ↔ lake
- grassland ↔ hills
- savanna ↔ steppe
- savanna ↔ beach
- savanna ↔ desert
- forest ↔ dense_forest
- forest ↔ taiga
- forest ↔ swamp
- forest ↔ hills
- taiga ↔ tundra
- tundra ↔ arctic
- tundra ↔ steppe
- beach ↔ shallow_water
- shallow_water ↔ ocean
- shallow_water ↔ river
- shallow_water ↔ lake
- swamp ↔ shallow_water
- swamp ↔ grassland
- hills ↔ mountains
- mountains ↔ arctic
- mountains ↔ volcanic
- mystic ↔ grassland/forest/hills

Approximate useful transition pairs: 25–35.

Budget:

```txt
30 pairs × 16 masks × 2 attempts ≈ 960 generations
30 pairs × 16 masks × 4 attempts ≈ 1,920 generations
```

Estimated range:

```txt
1,000–2,500 generations
```

---

### 4.3 Surface overlays

Alpha overlays, not opaque tiles:

- mud pools
- wet shine
- algae film
- leaf litter
- pine needles
- dry grass wisps
- cracked soil
- sand ripples
- wet sand sheen
- snow drift
- ice glaze
- stone scatter
- ash dust
- moss patches
- aether motes / mystic glow
- shallow water caustics
- foam / shoreline froth
- river ripples

Approximate overlay families: 18–28.

Each should have:

- 4–8 variants.
- alpha transparency.
- non-centered placement.

Budget:

```txt
24 families × 6 variants × 2 attempts ≈ 288 generations
24 families × 6 variants × 4 attempts ≈ 576 generations
```

Estimated range:

```txt
300–800 generations
```

---

### 4.4 Micro decals

Small alpha marks:

- soil flecks
- grass blades
- dry grass blades
- flowers
- debris
- pebbles
- reeds bits
- tiny moss
- needles
- snow specks
- ice chips
- mud specks
- ash flecks
- aether motes

Need per biome family color/style variants.

Budget:

```txt
15 micro kinds × 8 biome style families × 4 variants × 2 attempts ≈ 960 generations
```

Estimated range:

```txt
700–1,500 generations
```

---

### 4.5 Medium dressing

Larger non-interactive environmental dressing:

- reed clusters
- cattails
- bush clumps
- moss clumps
- root clusters
- grass tufts
- flower clusters
- stone clusters
- driftwood
- snow clumps
- cactus/scrub clusters
- volcanic rock clumps
- mystic crystals/mushrooms

Need biome-specific variants.

Budget:

```txt
20 dressing categories × 8 biome style families × 3 variants × 2 attempts ≈ 960 generations
```

Estimated range:

```txt
800–1,800 generations
```

---

### 4.6 Interactive objects

Objects with gameplay implications:

- forage bush
- chop/climb tree
- mineable stone
- harvestable reeds
- inspectable mud pool / water feature
- flowers/herbs
- logs/stumps
- crystals
- volcanic stones
- snow boulders

Need biome variants and state variants.

Budget:

```txt
12 object categories × 10 biome/material variants × 3 states × 2 attempts ≈ 720 generations
```

Estimated range:

```txt
700–1,500 generations
```

---

### 4.7 Plateau / elevation / cliff edges

Terrain structure pieces:

- grass cliff top
- dirt cliff face
- rock ledge
- snow cliff
- sand dune edge
- mud bank
- river bank
- beach waterline drop
- mountain face
- volcanic ledge
- swamp bank/root edge

Need horizontal, vertical, corner, inner/outer variants.

Budget:

```txt
12 structure families × 8 edge/corner masks × 2 attempts ≈ 192 generations
12 × 8 × 5 attempts ≈ 480 generations
```

Estimated range:

```txt
250–800 generations
```

---

### 4.8 QA / reference / style calibration sheets

We should spend generations on deliberate references:

- biome mood boards
- layer stack previews
- transition preview strips
- swamp calibration sheet
- savanna hillside calibration sheet
- snow/grass calibration sheet
- beach/water calibration sheet
- full 8-biome sampler sheets

Budget:

```txt
100–500 generations
```

---

## 5. Total Estimated Budget

Conservative first serious pass:

```txt
Base Wang:              800
Transition Wang:       1,000
Surface overlays:        300
Micro decals:            700
Medium dressing:         800
Interactive objects:     700
Plateau/cliff edges:     250
QA/reference:            100
--------------------------------
Subtotal:              4,650
Retry/salvage buffer:  1,500
--------------------------------
Total:                 6,150
```

Strong complete pass:

```txt
Base Wang:            1,400
Transition Wang:      2,000
Surface overlays:       600
Micro decals:         1,200
Medium dressing:      1,400
Interactive objects:  1,200
Plateau/cliff edges:    600
QA/reference:           300
--------------------------------
Subtotal:             8,700
Retry/salvage buffer: 3,000
--------------------------------
Total:               11,700
```

Polished production pass:

```txt
Expected: 15,000–20,000+ generations
```

---

## 6. Recommendation

Because user wants to do it all and can buy more generations:

### Recommended initial purchase / budget target

```txt
Start with 12,000 total available generations.
```

Current account:

```txt
6,000 available
```

Suggested additional purchase:

```txt
+6,000 generations
```

This should cover a strong complete pass if disciplined.

If the goal is polished production-level coverage with lots of retries:

```txt
Target 18,000–20,000 total generations.
```

Suggested additional purchase:

```txt
+12,000 to +14,000 generations
```

---

## 7. Phased Generation Strategy

Do not generate everything randomly. Follow phases.

### Phase 0 — Calibration

Budget:

```txt
100–250 generations
```

Goal:

- confirm style
- confirm alpha discipline
- confirm tile scale
- confirm Wang mask readability
- confirm swamp example stack
- confirm savanna hillside stack
- confirm snow/grass transition
- confirm beach/water transition

Do not continue to mass generation until calibration assets pass visual inspection.

---

### Phase 1 — Core base terrain / Wang

Budget:

```txt
1,000–2,000 generations
```

Goal:

- base opaque ground families
- first 16-mask Wang sets
- especially grassland, savanna, swamp, beach, shallow_water, forest, tundra

Critical biome families:

1. grassland
2. savanna
3. swamp
4. beach
5. shallow_water
6. forest
7. tundra
8. hills/mountains

---

### Phase 2 — Critical transitions

Budget:

```txt
1,000–2,500 generations
```

Goal:

- land/water
- grass/snow
- grass/forest
- grass/savanna/steppe
- swamp/water
- beach/water

---

### Phase 3 — Surface overlays and micro decals

Budget:

```txt
1,000–2,500 generations
```

Goal:

- alpha overlay sheets
- non-centered micro detail
- biome-specific color variants

---

### Phase 4 — Medium dressing and interactive objects

Budget:

```txt
1,500–3,000 generations
```

Goal:

- bushes
- reeds
- trees
- rocks
- forage objects
- harvestable/environmental objects

---

### Phase 5 — Plateau / elevation / cliffs

Budget:

```txt
500–1,500 generations
```

Goal:

- cliff edges
- plateau tops
- banks
- ledges
- water banks
- snow/rock faces

---

### Phase 6 — Completion / gap fill

Budget:

```txt
2,000–5,000 generations
```

Goal:

- fill missing biome combinations
- fix rejected sheets
- make style consistent
- generate alternates
- generate seasonal/weather variants later if desired

---

## 8. Persistent Progress Table

Update this table whenever assets are generated, accepted, rejected, or queued for regeneration.

| Phase | Category | Target | Status | Generations Spent | Accepted | Rejected | Notes |
|---|---|---:|---|---:|---:|---:|---|
| 0 | Swamp calibration stack | 1 | Not started | 0 | 0 | 0 | Must test wet_mud + mud_pools + soil/ground_cover/foliage |
| 0 | Savanna hillside stack | 1 | Not started | 0 | 0 | 0 | Use diagnostic tile: savanna/hillside/dry_grass |
| 0 | Snow/grass transition | 1 | Not started | 0 | 0 | 0 | Validate non-square biome edges |
| 0 | Beach/water transition | 1 | Not started | 0 | 0 | 0 | Water entries known missing |
| 1 | Base Wang terrain families | 22–26 | Not started | 0 | 0 | 0 | Start with 8 critical families |
| 2 | Critical transition Wang families | 25–35 | Not started | 0 | 0 | 0 | Do ecological adjacency only |
| 3 | Surface overlays | 18–28 | Not started | 0 | 0 | 0 | Alpha discipline required |
| 3 | Micro decals | 100+ sheets/variants | Not started | 0 | 0 | 0 | Must avoid centered sprites |
| 4 | Medium dressing | 100+ variants | Not started | 0 | 0 | 0 | Biome-colored variants |
| 4 | Interactive objects | 100+ variants | Not started | 0 | 0 | 0 | Separate gameplay objects |
| 5 | Plateau/cliff/edge families | 12+ | Not started | 0 | 0 | 0 | Needed after base terrain solid |

---

## 9. Current Estimated Spend Tracker

```txt
Generations available now:      6,000
Recommended target available:  12,000
Recommended additional buy:     6,000
Production target available:   18,000–20,000
Production additional buy:     12,000–14,000
Generations spent so far:       0 tracked in this ledger
```

Update this section after each PixelLab session.

---

## 10. Rules For Future Agents / Claude

1. Do not rely on chat memory for progress.
2. Update this file after every generation batch.
3. Record accepted and rejected assets.
4. Record exact prompts/seeds when assets are accepted.
5. Record file paths of accepted outputs.
6. Do not generate every possible combination blindly.
7. Start with calibration stacks before mass generation.
8. Prefer ecological adjacency pairs over all biome pairs.
9. Keep opaque Wang bases separate from alpha overlays.
10. Keep interactive objects separate from decorative micro decals.

---

## 11. Immediate Next Actions

1. Use `assets/prompts/claude-pixelab-landscape-v2-kickoff.md` to start Claude.
2. Have Claude read this ledger and the giant manifest.
3. Have Claude produce a Phase 0 generation batch plan.
4. Generate calibration sheets only.
5. Inspect in-engine before mass generation.
6. Update this ledger with actual generations spent.

