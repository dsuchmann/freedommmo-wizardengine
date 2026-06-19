The codebase biome IDs map cleanly onto the prompt's biome list. I have what I need to deliver the mapping with correct names and material/color hooks. Here is the deliverable.

---

# Biome → Roof Mapping Lens

A roof is a **derived structure**: its *material*, *style* (how the heightmap is built/clamped), and *features* are biased by **biome** (climate logic) and then overlaid by **building type** (program logic). This lens hands the generator a deterministic weighting it can sample with `f(seed)`.

## How to read the weights

- **Materials / Styles** are *ranked* (first = highest weight). The generator should turn the ranking into a softmax-ish weight vector, e.g. `[0.45, 0.28, 0.17, 0.10]`, and pick with `seed`.
- **Features** are *flags with a probability of presence* (likely). They are additive — a roof can have several.
- All names map to the three independent axes from the master spec: STYLE = how the wavefront heightmap is clamped (steep gable, flat parapet, mansard, conical…); MATERIAL = the procedural canvas skin; FEATURES = silhouette/extra structures riding on top of the topology (overhang, turret, deck, crenellation…).
- Biome IDs match `src/world/biome-definitions.js` (`arctic`, `tundra`, `taiga`, `forest`, `grassland`/`steppe`/`savanna`, `desert`, `beach`, `hills`, `swamp`, `tropical_forest`, `volcanic`, `mystic`, `mountains`). I fold the prompt's labels onto those canonical IDs.

---

## Master weighting table

| Biome (canonical id) | Materials (ranked) | Styles (ranked) | Features (likely) | Climate logic (WHY) |
|---|---|---|---|---|
| **Arctic / glacial (`arctic`)** | white-frosted slate, copper/patina, dark shingle, sod | **steep gable**, steep hip, pyramidal, mansard | heavy overhang, **buttresses**, snow-cresting on ridge, ice-cap on peak, minimal flat decks | Heavy snow load → steepest pitch so snow sheds; no walkable flats (snow buries them); buttresses brace wide spans under load; tiny eaves to avoid ice-dam. |
| **Tundra (`tundra`)** | **sod/green (frozen turf)**, dark shingle, weathered plank, slate | **shed**, steep gable, hip | low half-buried profile, big overhang, stone-skirt buttress, smoke-vent peak | Cold + low timber → earth-bermed sod roofs (insulation); steep enough to shed; low silhouette ducks wind. |
| **Boreal / taiga (`taiga`)** | **wood plank/shake**, dark shingle, sod, slate | **steep gable**, gambrel, hip | very large overhang, ridge-beam peak, **buttress** at gable ends, log-cribbing eave | Conifer timber abundant → plank/shake; snow + rain → steep gable + huge overhang to throw melt clear of log walls; gambrel for loft volume. |
| **Temperate forest (`forest` / `dense_forest`)** | **shingle**, slate, clay tile, wood plank | **hip**, gable, cross-gable, mansard | overhang + gutters, dormers, ridge cap, modest decks, valleys at L/T joins | Balanced rain/snow → moderate hip/gable; the "default" temperate vernacular; valleys and dormers thrive on L/T footprints. |
| **Grassland / plains (`grassland`/`steppe`/`savanna`)** | **thatch**, shingle, clay tile, sod | **hip**, conical (round huts), gable, shed | deep overhang, ridge thatch-comb, light parapet, few buttresses | Wind + sun, little snow → broad hip sheds rain & resists wind uplift; thatch from grass is the literal local material; conical for round granaries. |
| **Desert / arid (`desert`)** | **flat-stone / mud-plaster (adobe)**, clay tile, copper, bone | **flat/parapet**, stepped/ziggurat, shed, domed | **walkable roof deck**, **crenellated parapet**, roof garden/shade-trellis, parapet drains (scuppers), minimal overhang | Little rain → flat usable roofs (sleeping/work surface); parapet for shade & defense; thick mass for thermal lag; domes over key rooms; small overhang (no rain to throw). |
| **Beach / coast (`beach`)** | **clay tile**, weathered plank, copper/patina, thatch | **hip**, gable, shed, low-pitch | big overhang (sun+squall shade), **walkable deck/widow's-walk**, salt-bleached molding, light railings | Sun + salt squalls → hip sheds sudden rain, overhang shades; copper patinas fast in salt air; coastal lookouts → flat walk decks; no snow load so pitch stays gentle. |
| **Hills / highland (`hills`)** | **slate / flat-stone**, shingle, clay tile, copper | **gable**, hip, cross-gable, mansard | moderate overhang, **buttress**, stepped roofline (terraced lots), small turret/lookout, valleys | Quarried stone abundant → slate; rain + some snow → gable; terraced ground → stepped/multi-level roofs; lookout turrets read across valleys. |
| **Swamp / marsh (`swamp`)** | **thatch**, wood plank, sod, weathered shingle | **steep gable**, hip, shed, conical | **very large overhang + gutters**, raised ridge venting, stilted eave skirt, no flat decks | Heavy rain + humidity → steepest practical pitch + max overhang to throw water far from stilt-raised walls; thatch/plank from reeds & swamp timber; flats would pond and rot. |
| **Jungle / rainforest (`tropical_forest`)** | **thatch (palm)**, wood plank, clay tile, copper | **steep hip**, steep gable, conical, sawtooth | **huge overhang**, vented ridge cap, **roof garden / living green**, gutter troughs, twin-pitch (monsoon) | Torrential rain + heat → very steep hip with enormous overhang (shed water, shade walls); palm thatch is the material; vented ridges dump heat; green roofs flourish. |
| **Volcanic / ashland (`volcanic`)** | **flat-stone / basalt slate**, bone, copper/patina, slate | **flat/parapet**, stepped/ziggurat, shed, mansard | ash-shedding low pitch, **crenellated parapet**, ember-vent peak, buttress, walkable obsidian deck | Ash fall (not snow) → low-moderate pitch sheds ash, heat-resistant stone; parapets catch embers; basalt is the literal ground material (`basalt`); dark, fortress-like. |
| **Mystic / enchanted (`mystic`)** | **crystal**, copper/patina, slate, **bone** | **conical / spire**, domed, pyramidal, gambrel, stepped | **turrets + tall spires**, glowing ridge-line, floating/cantilevered eave, ornate crenellation, faceted peaks | Aesthetic-driven, not climate → tall improbable spires, domes, crystalline facets; light interacts magically (emissive ridges); the `aether_moss`/violet palette wants jewel-tone copper & crystal. |
| **Mountain / alpine (`mountains`)** | **slate**, shingle, **flat-stone**, copper | **steep gable**, steep hip, shed (chalet), mansard | **massive overhang** (snow throw), heavy ridge beam, **buttress**, stone-weighted eave, snow-fence crest | High snow + wind → very steep + giant overhang (alpine chalet); heavy stone slate stays put in wind; buttresses for span; no walkable flats. |
| **Badlands / arid-rock** *(maps onto `desert`+`hills` blend)* | **flat-stone / mud-plaster**, clay tile, weathered plank, bone | **flat/parapet**, stepped/ziggurat, shed, gable | **walkable deck**, **crenellated parapet**, carved-stone molding, dust-scupper drains, sparse buttress | Dry + eroded stone strata → flat & stepped (echoes mesa terracing); parapet defense; little rain so overhang minimal; weathered, sun-bleached palette. |

---

## Signature "looks" per biome (1–2 each, for the gallery presets)

| Biome | Signature look A | Signature look B |
|---|---|---|
| Arctic | **Frost-Steeple**: near-vertical white-slate gable, snow crest on ridge, ice-cap peak, buttressed gable ends | **Copper Lodge**: steep hip in green-patina copper, heavy overhang, dark eave shadow |
| Tundra | **Sod Berm**: low shed of frozen turf, smoke-vent peak, half-buried into a stone skirt | — |
| Taiga | **Log-Cabin Gable**: huge-overhang plank gable, exposed ridge beam, log-crib eave | **Trapper Gambrel**: shake gambrel with loft dormer |
| Temperate forest | **Cottage Hip**: shingle hip with two dormers, ridge cap, gutter line | **Cross-Gabled Manor**: clay-tile cross-gable with auto valleys at the L-join |
| Grassland | **Thatch Roundhouse**: conical thatch with woven ridge-comb | **Broad Hip Hall**: low wide thatch/shingle hip, deep eave shade |
| Desert | **Adobe Deck**: flat mud-plaster roof, crenellated parapet, shade-trellis garden, scupper drains | **Domed Sanctum**: clay-tile barrel/dome over a flat parapet field |
| Beach | **Widow's-Walk Tile**: clay-tile hip with a railed walk-deck on the flat-deck center | **Verandah Shed**: low plank shed, deep sun-overhang |
| Hills | **Slate Gable + Turret**: stone-slate gable with a corner lookout turret, buttressed | **Stepped Terrace**: multi-level slate roof tracking the slope |
| Swamp | **Stilt Steeple**: very steep thatch gable, enormous overhang + gutter, raised vent ridge | — |
| Jungle | **Palm Pavilion**: very steep palm-thatch hip, huge overhang, vented ridge | **Green Canopy**: living roof-garden deck framed by steep tile valleys |
| Volcanic | **Basalt Bastion**: low flat basalt-slate field, crenellated parapet, ember-vent, buttressed | **Obsidian Ziggurat**: stepped flat-stone tiers |
| Mystic | **Crystal Spire**: tall faceted conical crystal peak, glowing ridge line, cantilevered eave | **Aether Dome**: patina-copper dome with ornate crenellation and a small turret ring |
| Mountain | **Alpine Chalet**: very steep slate gable, massive snow-throw overhang, heavy ridge beam | **Buttressed Hip**: steep stone hip braced by corner buttresses |
| Badlands | **Mesa Deck**: flat weathered-stone roof, carved-stone crenellation, walkable | **Stepped Pueblo**: ziggurat of mud-plaster tiers |

---

## Building-type overlay (program biases biome defaults)

Apply these as **multipliers/insertions** on top of the biome weights. Biome decides the *palette & climate constraints*; building type decides the *program* (defense, ritual, storage, height) and can override style.

| Building type | Style bias | Material bias | Feature bias | Notes / overlay rule |
|---|---|---|---|---|
| **House** | inherit biome top style (hip/gable/shed) | inherit biome top material | overhang, dormers, modest deck | The baseline — almost pure biome defaults; smallest footprints → simple hip/pyramid. |
| **Temple** | **domed / pyramidal / spire** (override toward grand), conical | upgrade one tier: clay→slate→copper→**crystal/gold-copper**; biome material as accent | **central peak/spire**, **crenellation/molding**, ridge ornament, walkable processional deck | Verticality + symmetry forced; ignores some climate (ritual > pragmatism) but keeps biome material family. |
| **Watchtower** | **conical / pyramidal / steep hip** on a tall narrow terminal section | biome's most durable: slate / flat-stone / copper | **turret cap**, **crenellated parapet**, **walkable battlement deck**, arrow-slit eave, buttress | Tallest terminal wing; almost always a turret + walkable crenellated deck regardless of biome. |
| **Market hall** | **broad low hip / sawtooth / gable** over a wide span | biome thatch/shingle/tile (cheap, broad) | **massive span overhang** (shelter stalls), **clerestory/sawtooth vents**, gutters, light parapet | Wide footprint → favors sawtooth or long gable for daylight + weather cover over an open floor. |
| **Palace** | **mansard / cross-hip / domed**, multi-level stepped | richest biome tier + copper/slate/crystal, ornate | **turrets (multiple)**, **roof gardens / walkable terraces**, crenellation, dormers, valleys galore | Largest multi-wing footprints → exploits valleys/ridges of complex shape; layered, ornamented, walkable. |
| **Smithy** | **shed / low gable**, **vented monitor ridge** | flat-stone / slate / clay (fire-safe, never thatch) | **smoke-vent cupola/louver**, minimal overhang, spark-arrestor crest | Fire safety overrides biome thatch → forces non-combustible material + a vent monitor even in thatch biomes. |
| **Granary** | **conical / pyramidal / steep hip** (round or square keep) | thatch/tile/sod by biome; rat-guard flared eave | **steep shed-water pitch**, flared drip-eave, vent peak, **no walkable deck** | Keep grain dry & vermin out → steep, smooth, flared eave; small footprint → clean conical/pyramid cap. |

### Overlay precedence (resolution order for the generator)
1. **Hard climate constraints** (biome) set the *floor*: e.g. alpine/arctic forbid walkable flat decks; swamp/jungle forbid flat decks; desert/badlands forbid steep-only.
2. **Fire/program constraints** (building type) can *override material* (smithy ≠ thatch) and *force a feature* (watchtower → turret+battlement; granary → steep vent).
3. **Aesthetic upgrade** (building tier) shifts material *up the durability/ornament ladder* (temple/palace) and unlocks crenellation/spire features.
4. Remaining freedom is filled by **biome ranked weights** sampled with `f(seed)` — keeping output deterministic and infinite-world-safe.

### Conflict notes (honest tensions to resolve in code)
- **Temple in arctic/alpine**: a dome sheds snow poorly. Resolution → bias temple toward **steep pyramidal/spire** instead of dome in snow biomes (keep grandeur, satisfy climate).
- **Market hall in jungle/swamp**: sawtooth flats pond water. Resolution → swap sawtooth for **steep multi-gable with monitor vents**.
- **Granary in desert**: steep thatch is wrong (no rain, fire risk). Resolution → **stepped flat-stone keep** with vented dome cap instead.
- **Walkable-deck features** are gated by biome: allow in `desert`/`beach`/`volcanic`/`badlands`/`mystic`/`hills`/`mountains`(only on palace terraces); suppress in `arctic`/`tundra`/`taiga`/`swamp`/`tropical_forest` (snow/rain make decks useless).

---

## Hooks the generator should consume

- **Palette seed per biome** comes free from `BIOMES[id].color` in `C:\Users\daves\AppData\Roaming\wizardgenie\projects\default\src\world\biome-definitions.js` — derive each material's base/shadow/highlight by shifting that hue (e.g. `volcanic` `#6b3328` → basalt slate; `mystic` `#8a5bd6` → crystal/copper jewel tones; `arctic` `#c9e5ee` → frost-white slate). This keeps roof color coherent with the terrain the building sits on.
- **Style → heightmap clamp** is the only place STYLE touches TOPOLOGY: biome picks the *pitch ceiling* (arctic/alpine steep, desert/volcanic flat) which the wavefront uses as its height multiplier and clamp; FEATURES (turret/buttress/parapet/deck) are post-pass silhouette additions keyed off roles (peak→turret/spire, eave→overhang/buttress, flat-deck→walkable garden/crenellation, ridge→molding/snow-crest).
- **Feature → role gating**: crenellation/walkable-deck attach only to `flat-deck` role tiles; turrets/spires to `peak`; buttresses to `eave`+exterior-corner tiles; valleys/dormers are emergent from L/T/U footprints and need no biome weight.

These three axes stay independent: biome+type only *weight* the choice; the heightmap still produces the geometry, the style only clamps it, and the material only skins it.