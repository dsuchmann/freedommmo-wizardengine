# Mystic Tile Corpus — Manifest (3rd biome pilot)

> The THIRD biome pilot, after grassland + desert. Inherits ALL structure from the `building-tile-pipeline` skill
> and the grassland/desert manifests (same 9 wall states + gable + roofs, generate-WEST-flip-EAST corners,
> animate door/window, OBJECTS-vs-TILES rule). This file ONLY specifies the Mystic vocabulary + the 4 biome tokens.
> Authored by the `mystic-biome-design` workflow (5 takes → art-director synthesis), 2026-06-24.

## Aesthetic — ASTRAL-RUNIC
A starlit settlement of pale self-luminous masonry under perpetual twilight: pearl moonstone + constellation-inlaid
marble bodies, faceted amethyst temples, dark warded service walls. The magic is **restrained + STRUCTURAL** — soft
silver inlays, tiny star-points, faint cool inner glow in seams — never neon, never see-through. Every wall reads
FIRST as one solid opaque load-bearing surface; the otherworldly quality is the cool moonlit palette (pearl,
lilac-grey, deep amethyst violet, near-black with cyan rune-light) + small luminous inlays, NOT holes/transparency.

## Biome tokens (mystic) — resolve into the shared BASE + STATE prompts
- `{FOUNDATION}`: "a low footing course of darker blue-grey moonstone blocks veined with faint silver, about half a tile high, with a thin engraved silver line along its top edge where it meets the wall above"
- `{DOOR}`: "a tall pointed-arch door of pale silver-banded timber inlaid with a small constellation of star-rivets, set in a recessed pointed-arch moonstone frame with a faint cool glow tracing the arch; it REACHES THE GROUND with the threshold flush at the bottom edge, NO foundation beneath it"
- `{WINDOW}`: "a small deep-set pointed-arch window of leaded moonstone-glass divided into a few diamond panes by thin silver leading, set deep in a moonstone reveal with a narrow sill and a faint cool inner glow; no shutters"
- `{WALLPLATE}`: "a horizontal eave band of pale carved moonstone topped by a thin engraved silver cap-rail set with tiny inlaid star-points, running the full width"

## Walls (4) — smooth / coursed / cut / woven spread
| slug | MATERIAL_PHRASE | MATERIAL_FACE (opacity-enforced middle) | MATERIAL_EDGE (finished flat wall-END) |
|---|---|---|---|
| **moonstone** | "smooth moonstone render" | "a smooth UNIFORM pearl-white moonstone render covering the whole zone as one solid plastered surface, with a soft opalescent lilac-and-cyan sheen, gentle tonal mottling and faint silver mineral flecks — matte-to-satin, opaque, NOT a window, NOT glassy; every pixel SOLID OPAQUE, NO holes, NO see-through gaps, NO panels" | "a finished vertical edge of the SAME pearl-white moonstone render, gently rounded with a soft silver highlight where the render wraps to a clean end — SAME pearl colour, NOT bright-white, NOT glass, NOT a window, NOT a frame" |
| **starlit_marble** | "starlit marble ashlar" | "tightly-coursed cool white-and-pale-grey marble blocks in regular horizontal courses, set in pale-silver SOLID mortar filling every joint, with thin engraved silver constellation inlay-lines tracing between a few blocks and tiny star-point glints — opaque, a continuous coursed masonry wall, NOT window panes, NO holes, NO gaps" | "a neat vertical column of larger dressed white-marble quoin blocks edged with a thin silver inlay line, a clean flat termination in the SAME cool white-grey marble — no depth, no receding side" |
| **amethyst_ashlar** | "faceted amethyst ashlar" | "large precisely-CUT faceted amethyst ashlar blocks in deep violet in a regular ashlar bond, each block a flat polished facet catching a crisp edge-highlight with a faint cool inner glow, separated by thin pale-silver SOLID joints filling every seam — FLAT cut-stone faces, NOT windows, NOT transparent; continuous cut-crystal masonry, NO holes, NO gaps" | "a finished vertical column of larger interlocking amethyst quoin blocks in the SAME deep violet, cleanly cut and flush to the wall end — a flat termination, no receding 3D side" |
| **wardweave_lattice** | "ward-weave lattice" | "solid dark slate-grey daub panels packed flush into every bay, overlaid by a woven lattice of thin black-iron rune-chain in a tight diagonal basket weave with faint cyan glow where the chains cross — the dark daub FILLS behind the weave so the whole zone is fully OPAQUE, NO holes, NO see-through gaps, NOT a screen, NOT a grille; a solid woven warded wall with a dark backing" | "a finished vertical dark-iron post anchoring the woven rune-chain at the end bay, SAME dark iron-and-slate-grey colouring — a clean flat termination, NOT a 3D corner, NOT a frame" |

## Roofs (4) — TILES (`create_tiles_pro`, segmentation) — curate into ONE biome-wide pool
| slug | name | prompt |
|---|---|---|
| **moonstone_slate** | Moonstone Slate | "A seamless top-down pixel-art roof surface of overlapping rectangular blue-grey MOONSTONE SLATE roof-slates in tidy staggered offset courses, viewed from DIRECTLY ABOVE, full-bleed edge to edge, no border. Each slate a flat rectangle with a thin pale-silver lit edge, crisp shadow joints, faint cool opalescent sheen; a capped ridge across the peak. Uniform repeating rows, tiles seamlessly on all four edges. Cool greys, detailed pixel shading, fully opaque. NO walls/sky/ground/moss/border. Render NO text." |
| **geode_scale** | Geode Scale Tile | "A seamless top-down pixel-art roof surface of GEODE SCALE TILES, from DIRECTLY ABOVE, full-bleed, no border. Rounded fish-scale tiles in overlapping fanned rows, each a banded agate roundel in smoky grey-lilac and soft rose with a tiny sparkling druzy centre, thin pale luminous joints, each row lapping the one below. Regular scale rhythm, tiles seamlessly on all edges. Cool lilac+rose, detailed pixel shading, fully opaque. NO walls/sky/ground/moss/border. Render NO text." |
| **amethyst_facet_slab** | Amethyst Facet Slab | "A seamless top-down pixel-art roof surface of FACETED AMETHYST SLABS, from DIRECTLY ABOVE, full-bleed, no border. Large angular polygonal crystal slabs in deep amethyst violet fitted like a cracked-facet mosaic, each a flat polished facet with one crisp highlight edge + faint cool inner glow, thin glowing cool seams. Even balanced polygon tessellation, tiles seamlessly on all edges, opaque stone NOT transparent. Deep violet + luminous highlights, detailed pixel shading. NO walls/sky/ground/moss/border. Render NO text." |
| **silver_thatch** | Astral Silver Thatch | "A seamless top-down pixel-art roof surface of pale silver-grey ASTRAL THATCH, from DIRECTLY ABOVE, full-bleed, no border. Combed bundles of moon-bleached straw in tight overlapping horizontal courses with a darker tied ridge across the peak, soft moonlit highlights along each comb, warm shadow in the valleys, a few faint inlaid star-flecks. Dense opaque, structured repeating rows, tiles seamlessly on all edges. Pale silver-grey, detailed pixel shading. NO walls/sky/ground/moss/border. Render NO text." |

## Execution (follow the skill, vertical slice first)
Per `building-tile-pipeline` skill: onboard (this doc + building-materials.json `mystic` + ledger + TOKENS_AUTHORED) →
**moonstone v0 end-to-end** (base + 6 states + 2 flips + 2 anims + gable) → if clean, the other 3 walls + 4 roofs →
curate the roof pool + per-material gables in `tools/building-studio.html` → wire (`TILE_MATERIALS.mystic` in
building-tiles.js, slugs = folder names) → verify in game.
