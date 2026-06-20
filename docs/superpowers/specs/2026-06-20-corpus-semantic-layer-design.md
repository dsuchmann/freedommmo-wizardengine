# Corpus Semantic Layer — Design Spec

> **Status:** Draft for review (2026-06-20). A sub-system of the generative-animation effort. Slots **between INGEST and the PSCH STRUCTURE/hypergraph** — it decides *what each clip is* and *which clips are variants of the same thing* before the hypergraph clusters and blends them.
> **Atlas placement:** S4 · Life, L2–L3 (corpus organization for the motion DSL / PSCH generator).
> **Relationship to prior specs:** Feeds (does not duplicate) `2026-06-17-psch-phase1-motion-representation-design.md` (STRUCTURE/clustering/adverbs) and targets the canonical rig `2026-06-19-canonical-humanoid-rig-design.md`. It provides the **category + attribute assignment** that STRUCTURE consumes.

---

## 1. The problem

A 2,346+ clip Mixamo dump cannot be organized by name. The names cram many orthogonal axes into one fuzzy string, inconsistently, and some are outright traps. Real examples from the corpus catalog:

- `"Crouched Rifle Walk Strafe Left"` — category + stance + held-item + heading in one name.
- `"Female Ninja Walk Forward Arc Left"` vs `"Female Ninja Walk Backward Arc Left"` — same family, **opposite heading**, named almost identically.
- `"Drunken Walking Backward Right Turn"` — category + style + heading + turn.
- `"Baseball Batter Walking Into Batters Box"` — contains "walk" but is **not a gait** (the "different thing, similar name" trap).
- `"Crouched Idle To Strafe Walk Right"`, `"Crouch To Run Backwards"` — **transitions**, not steady cycles.

We must reason about: (a) which clips are **variants of the same thing** (to blend within a node/family), (b) which are **different things named similarly** (separate families), and (c) where each sits on the **continuous control axes** a game needs (heading, speed, …).

## 2. Core principle (non-negotiable)

**Motion geometry is ground truth for what a clip *is*; the name is only a noisy hint.** The name seeds a hypothesis and supplies human-readable labels and attributes the geometry can't see (style, held-item). The **geometry decides sameness and *measures* the structural attributes** (kind, heading, turn, speed). Conflicts between name and geometry are **flagged, never faked** (the no-mock rule). This mirrors the project's cognition model: the LLM *interprets*, the simulation (here, the measured motion) is *truth*.

## 3. The normalized motion-attribute schema

Every clip (per relevant part-group — see §6) gets a record on these orthogonal axes:

| Axis | Values | Source of truth |
|---|---|---|
| `category` | walk, run, jog, sprint, idle, turn, jump, roll, climb, sit, attack, block, dodge, cast, dance, gesture, … (**discovered + extensible**, seeded from the corpus, not a fixed enum) | name → **geometry-gated** (§5) |
| `kind` | `cyclic` (steady gait) \| `transition` (idle→walk, start/stop) \| `oneshot` (acyclic action) | **geometry** (phase/contact) |
| `heading` | continuous travel direction vs. facing: forward=0°, strafe=±90°, backward=180°, arcs in between | **geometry** (recovered root motion, §7) — *never the name* |
| `turnRate` | in-place / arc rotation (deg per cycle) | **geometry** |
| `speed` | root travel speed (continuous) | **geometry** |
| `stance` | standing \| crouched \| prone \| … | name + geometry (pelvis height) |
| `style` | normal \| sneaky \| drunken \| injured \| aggressive \| zombie \| … | name (soft metadata) |
| `heldItem` | none \| rifle \| sword \| bow \| bat \| … (constrains the **arms** part-group) | name |
| `bodyVariant` | source species/gender/age | name (recorded, **not a family key** — all clips retarget to the one canonical rig) |
| `confidence`, `source`, `flags` | per-axis: name-derived / geometry-measured / reconciled / review | bookkeeping |

`heading`, `turnRate`, `speed`, `kind` are **measured**, overriding the name. `style`/`heldItem` come from the name (the geometry can't always see them). This schema is the contract the LLM emits, geometry verifies, and STRUCTURE consumes.

## 4. Pipeline — three passes

### Pass A — Name normalization (LLM, one-time batch)
Input: clip name (+ Mixamo `description`/`type` from the products API if captured). Output: the §3 record as a **hypothesis**, validated against the schema, with per-axis confidence + a one-line rationale. Method: a deterministic prompt to a small/cheap model (the project's cognition model) → structured JSON; few-shot with the hard chaos cases above. Re-runnable over the full catalog. Ambiguous names → low confidence + `flags:["review"]`, never silently guessed.

### Pass B — Geometry measurement (the truth)
Input: the ingested packet on the **canonical 21-bone rig** + the **recovered root-motion sidecar** (travel vector + turn — see §7). Measures: `kind` (phase/contact → cyclic/acyclic/transition), `heading`/`turnRate`/`speed` (from root motion), `stance` (pelvis height), and the **Fourier+PCA signature** (the part-group feature vectors). These measured facts **override** the name on their axes.

### Pass C — Reconcile, gate, cluster
1. **Membership gate** — a clip keeps its name-category only if its geometry fits that category's signature profile (e.g. `walk` ⇒ `cyclic` + locomotor phase + nonzero translation). `"Baseball Batter Walking Into Batters Box"` fails (it's a short `oneshot`) → re-routed out of the walk family. *This is what kills the "similar name, different thing" trap — automatically.*
2. **Cluster within (category, part-group)** in signature space → nodes; `heading`/`speed`/etc. become the node's adverb coordinates. Conflated names split (forward vs backward walk land in different heading regions); synonyms merge.
3. **Reconcile** — name-label vs geometry agree → confident node; disagree → `flags:["conflict"]`, trust geometry for structure, keep the name for labels/style.

Output → PSCH STRUCTURE builds the hypergraph from these categorized, attributed, clustered records.

## 5. Worked examples (real corpus names)

| Name | Pass A (name → hypothesis) | Pass B/C (geometry verdict) |
|---|---|---|
| `Female Ninja Walk Forward` | walk / cyclic / heading≈fwd / style:ninja | cyclic ✓, heading **measured** 0° → walk node, heading 0° |
| `Female Ninja Walk Backward` | walk / cyclic / heading:back / style:ninja | cyclic ✓, heading **measured** 180° → *same walk family*, heading 180° |
| `Crouched Rifle Walk Strafe Left` | walk / crouched / heldItem:rifle / heading:strafe_L | **legs**→ crouch-strafe-walk node (heading −90°); **arms**→ rifle-aim node (§6) |
| `Baseball Batter Walking Into Batters Box` | walk?? (low conf) | geometry: `oneshot`, no locomotor cycle → **gate rejects** walk; routed to a "sport/transition" family |
| `Crouched Idle To Strafe Walk Right` | transition / idle→walk | `kind:transition` → a transition edge, **not** a steady node |

## 6. The combinatorial collapse (why this beats per-clip animation)

This is the payoff for the "no infinite explosion" goal. **The semantic record is per (clip, part-group)** because PSCH decomposes motion into independent part-groups (legs / torso / arms / head). `"Crouched Rifle Walk Strafe Left"` contributes a great **legs** exemplar (crouch strafe gait) and a separate **arms** exemplar (rifle aim) — and is irrelevant to the others. So the generator composes *legs from one cluster + arms from another*: you get crouch-walk-with-rifle-while-strafing **without a clip that is exactly that combination**. The name's `stance × heldItem × heading × …` explosion collapses to a few independent per-part-group axes that **blend**. The semantic layer's job is to tag *which part-groups each clip informs* and *where it sits on each axis*, so STRUCTURE can recombine them.

## 7. Prerequisite: recover root motion (reverse the Phase-1 strip)

The current PSCH ingest **strips root motion** (hips pinned, hip-yaw zeroed) — which deletes exactly the signal that distinguishes forward/backward/strafe and the heading the game needs to steer. This layer **requires ingest to recover and keep root motion** (per-clip travel vector + turn rate) as a sidecar. It is simultaneously: the **disambiguator** (Pass B `heading`/`turnRate`/`speed`), the **adverb axis** the generator steers on, and the **travel** the game controller consumes. This is a real change to the ingest contract and is in-scope for this layer's prerequisites.

## 8. Atlas placement & edges

- **Node:** S4 · Life — corpus organization for the motion generator, between INGEST (L2) and STRUCTURE (the hypergraph).
- **Reads:** ingested packets + root-motion sidecar (geometry), clip names + Mixamo metadata (hints), the LLM cognition layer (Pass A).
- **Writes:** `library/_corpus.semantics.json` (per-clip records) + per-(category, part-group) node memberships + adverb-axis ranges → consumed by PSCH STRUCTURE to bake `_psch.graph.json`.

## 9. Honest-absence semantics

Unlabelable/ambiguous clips → `flags:["review"]`, excluded from confident nodes (not faked into a family). Categories with too few members → `support:"degenerate"`. Name/geometry conflicts → surfaced for human/LLM review. The taxonomy is **discovered and inspectable**, never a hardcoded façade.

## 10. Data contract

`library/_corpus.semantics.json`:
```jsonc
{ "schemaVersion": "corpus-sem-1.0.0",
  "clips": { "<clipId>": {
    "name": "Crouched Rifle Walk Strafe Left",
    "category": "walk", "kind": "cyclic",
    "heading": -90, "turnRate": 0, "speed": 0.42, "stance": "crouched",
    "style": "normal", "heldItem": "rifle", "bodyVariant": "female",
    "partGroups": { "legs": {"node": "walk:legs:crouch_strafe", "conf": 0.91},
                    "arms": {"node": "aim:arms:rifle", "conf": 0.78} },
    "source": {"category":"name+geometry","heading":"geometry"},
    "confidence": 0.86, "flags": [] } } }
```

## 11. Build & validation plan

- **Pass A is buildable/validatable NOW** (no motion needed) against the ~2,346 names already in `mixamo_anims.json` — produces the hypothesis taxonomy and confirms the attribute axes. Good first deliverable while the corpus downloads.
- **Pass B/C** need the ingested corpus (after download) + the root-motion recovery (§7).
- **Validation gates:** the membership gate must reject `"Baseball Batter Walking…"` from the walk family; forward vs backward walk must separate by **measured** heading even when names are silent; a human spot-checks the `conflict`/`review` flags; per-part-group node assignment for a composite clip (rifle-strafe-walk) must split legs vs arms correctly.

## 12. Out of scope (own specs)

The hypergraph clustering/blend math (PSCH STRUCTURE/GENERATE — this only feeds it); two-actor/combat-pair semantics; non-humanoid corpora; the LLM model selection for Pass A (a deployment detail).

## Open questions

1. **`style` as adverb vs metadata** — is "drunken/sneaky" a continuous adverb to blend, or discrete style families? (Recommend: a few discrete style families now; revisit as an adverb if the corpus supports a continuum.)
2. **Pass-A model** — small/cheap local model vs API; deterministic prompt either way.
3. **Heading representation** — single angle vs 2D heading vector (recommend 2D so strafe/diagonal blend cleanly).
