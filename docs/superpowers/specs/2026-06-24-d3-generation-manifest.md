# D3 Wall Attachments — Generation Manifest (first version, 2026-06-24)

The **generation** layer over the D3 design manifest. The DESIGN (what each prop is, its placement,
affordances, states, anims, fit-to-socket `scale`, and per-biome `biomeSkins`) already lives in
`docs/superpowers/specs/dressing-manifest-parts/D3.json` — **do not duplicate it**. This doc adds the
three things needed to actually fire PixelLab and track the result:
1. the **PixelLab op** per row (object-vs-tile — for D3 it's *all objects*),
2. the **prompt token framework** + per-object prompt seed,
3. the **disk layout + tracker** (disk is the source of truth, never memory).

Iterate freely — this is a first version; the grassland prompts are concrete, the other 20 biomes are
reached by the design manifest's `biomeSkins` (host-swap / climate-default / flora-reskin / lit-multiplier
/ magical-variant / drop), NOT new rows.

## ⚠ OBJECT-vs-TILE — settled for D3: every prop is an OBJECT
A wall attachment is a discrete sprite, not a seamless surface. So, exactly like the wall *pieces* (and
NEVER like roofs/walls which are `create_tiles_pro` tiles):
- **base sprite** → `create_1_direction_object` (view `sidescroller`, size = `scale.nativePx`). One prop,
  centered, transparent background.
- **each `state`** (weathered / rusted / broken / sun_faded / lit-frost / …) → `create_object_state` of the
  base. Never fresh-gen a state (same rule as wall tile states: a state is always a state OF the base).
- **each `anim`** (`wind_sway`, `flicker_glow`, `open_close` hinge) → `animate_object` (mode v3) of the base
  or the relevant state. `static` = no anim job.
- **spline pieces** (strung_festival_lights, triangle_bunting, festoon_garland — `fit: tile-along`) → generate
  ONE node/segment object; code lays it along the socket-to-socket spline. Still an object, not a tileset.
- **`content` season/fill states** (flower boxes, wreaths, lamp fuel) → `create_object_state` per content state.
About to reach for `create_tiles_pro` or `create_topdown_tileset` for a D3 prop? STOP — props are objects.

## Disk layout (source of truth)
```
assets/pixelab/buildings/dressing/<biome>/<object_id>/
  base__v0.png                 # create_1_direction_object
  state__<state>__v0.png       # create_object_state (one per design-manifest state ≠ base)
  anim/<anim>/frame_NNN.png    # animate_object (one dir per design-manifest anim ≠ static)
assets/pixelab/buildings/dressing/<biome>/_pixellab_ids.json   # {object_id: {base, states{}, anims{}}}
```
"Done" = PNGs on disk AND QA-clean (a dressing-prop QA gate — the analog of qa-tiles/qa-frames — is TBD,
build it with the first pilot). Object ids live in `_pixellab_ids.json`, never in memory/chat.

## Prompt token framework (fill per biome from `biomeSkins`; keep the always-clauses)
Per-object tokens: `{PROP}` (the design label), `{HOST}` (biome material host — timber=oak/pine/…, iron,
cloth=linen/canvas/silk, fired-clay, per the biome's wall-material family), `{GLYPH}` (role device for
signs/banners/plates), `{WEAR}` (climate-default state, e.g. sun_faded / rusted / snow_capped), `{GLOW}`
(mystic/volcanic emissive clause, else empty).

**Always-keep clauses (every prop inherits these — they make the sprite composite cleanly onto a wall):**
- "a SINGLE {PROP}, centered, on a FULLY TRANSPARENT background — the prop ONLY, no wall, no ground, nothing else"
- "front-facing flat orthographic SIDESCROLLER view, as mounted on a vertical wall, even lighting"
- "crisp pixel-art, consistent scale, clean alpha edges"
- "render NO legible text" (signs/plates show a simple painted/engraved {GLYPH}, not words)
- lit props: "the {PROP} BODY only — the glow is added in-engine; do NOT bake a large light halo or bloom"
- suspended cloth (awnings/banners/bunting/garland): "hanging at rest, natural drape; sway is added in-engine"

## The 22 objects (op + seed; design = D3.json)
`B`=create_1_direction_object base · `S(n)`=n create_object_state · `A[..]`=animate_object per anim.
| category | object_id | px | ops | notes / prompt seed (grassland) |
|---|---|---|---|---|
| awnings | cloth_market_awning | 128 | B·S(3)·A[wind_sway] | striped {HOST=linen} market awning, scalloped front edge |
| awnings | wood_slat_awning | 128 | B·S(3) | {HOST=oak} slat pent-roof rain hood, iron brackets |
| awnings | fringed_shop_canopy | 128 | B·S(2)·A[wind_sway] | {HOST=cloth} shop canopy w/ hanging fringe, trade colour |
| hanging_signs | swinging_trade_sign | 96 | B·S(3)·A[wind_sway] | hanging board sign w/ painted {GLYPH}, iron hook+eye |
| hanging_signs | projecting_board_sign | 96 | B·S(2) | rigid board sign bolted flat/projecting, {GLYPH} |
| hanging_signs | wrought_iron_silhouette_sign | 96 | B·S(1) | forged iron silhouette of the trade {GLYPH} |
| wall_lanterns | **iron_candle_lantern** | 64 | B·S(3)·A[flicker_glow] | **iron-and-glass candle lantern, warm flame inside (body only)** |
| wall_lanterns | wall_oil_lamp | 64 | B·S(2)·A[flicker_glow] | brass bracket oil lamp, glass font |
| wall_lanterns | strung_festival_lights | 64 | B·S(1)·A[flicker_glow,wind_sway] | ONE paper lantern node (spline-tiled) |
| shutters | board_batten_shutter | 64 | B·S(4)·A[open_close] | board-and-batten shutter leaf, hinge edge |
| shutters | louvred_shutter | 64 | B·S(3)·A[open_close] | slatted louvred shutter leaf |
| flower_boxes | timber_flower_box | 64 | B·S(2)·A[wind_sway]+content(5) | sill flower box, {HOST=oak} — BLOOMS sway, box stays planted |
| flower_boxes | terracotta_wall_planter | 64 | B·S(3)·A[wind_sway]+content(5) | fired-clay half-pot wall planter — blooms sway |
| wall_brackets | wrought_iron_bracket | 64 | B·S(1) | iron scrollwork mounting bracket, hook_eye |
| wall_brackets | carved_timber_bracket | 64 | B·S(2) | carved corbel bracket, {HOST} |
| door_furniture | door_knocker | 64 | B·S(2)·A[momentary] | iron ring/lion-head door knocker |
| door_furniture | door_handle_latch | 64 | B·S(2) | iron/brass handle + thumb-latch |
| door_furniture | door_nameplate | 64 | B·S(2) | engraved {HOST} nameplate, {GLYPH} |
| banners | heraldic_banner | 128 | B·S(2)·A[wind_sway] | long vertical heraldic banner, {GLYPH} tincture |
| banners | triangle_bunting | 64 | B·S(2)·A[wind_sway] | ONE triangle pennant (spline-tiled) |
| wreaths | door_wreath | 64 | B·S(2)·A[wind_sway]+content(4) | foliage door wreath — foliage sways gently, mount stays put |
| wreaths | festoon_garland | 64 | B·S(2)+content(4) | ONE garland swag segment (spline-tiled) |

## Animations (contextual — `animate_object` per the `A[..]` column)
Animation is a property of the prop's PHYSICAL condition, not its category, and is **biome-invariant** (a
sign sways in every biome; only mystic/volcanic *magical* skins may ADD emissive). So the anim SET per
object is fixed here; the frames are re-generated per biome from that biome's art.
- **wind_sway** — suspended/hanging cloth + strung pieces **and living foliage that moves in wind**.
- **flicker_glow** — light sources. TWO parts: the flame-flicker sprite frames (`animate_object`) PLUS a
  separate game **light** (emissive into the GL lighting pass + flame particle — never a 2D overlay).
- **open_close** — constrained hinge (shutters). **momentary** — one-shot (knocker). **static** — rigid
  mounts (brackets, projecting/iron signs, slat awning, door handle/nameplate): no anim job.

**Refinement (user, 2026-06-24): living foliage sways.** `timber_flower_box`, `terracotta_wall_planter`,
and `door_wreath` get a SUBTLE `wind_sway` (the blooms/foliage move, the vessel/mount stays planted) —
overriding the design manifest's original "rigid vessel = static" call. Rule going forward: **any prop
carrying living `content` (season) foliage gets a gentle foliage `wind_sway`.**

## PILOT (recommended): `iron_candle_lantern`, grassland, beside_door socket
Highest payoff (light transforms a façade) and exercises the full B path + the emissive-into-GL thesis.
Stage it so the cheap part proves first:
1. **Sprite + socket** — fire `create_1_direction_object` (size 64, sidescroller) with the prompt below;
   download → place at the `beside_door` socket via the socket index; render RIGID into the silhouette
   bitmap. This alone proves "a generated prop lands on the wall through GL."
2. **States** — `create_object_state` ×3 (rusted / soot_grimed / broken_glass).
3. **Light + flame** — wire the `light` component (warm amber, r≈2.5, diurnal) as procedural emissive into the
   GL lighting pass + a flame particle; `animate_object` `flicker_glow`. (This is the part the skill's §7 fills.)

Pilot base prompt (grassland):
> "A SINGLE iron-and-glass candle lantern mounted to flank a doorway, centered, on a FULLY TRANSPARENT
> background — the lantern ONLY, no wall, no ground. Black wrought-iron frame, four clear glass panes, a lit
> warm candle inside giving a soft amber core (the lantern BODY only — do NOT bake a large light halo or
> bloom; the glow is added in-engine). Front-facing flat orthographic sidescroller view as mounted on a
> vertical wall, even lighting. Crisp pixel-art, clean alpha edges, render NO text."

If you'd rather de-risk the bare render path with a rigid, non-lit prop first, swap the pilot to
`projecting_board_sign` (B·S(2), no light/anim) — fewer moving parts, then come back for the lantern.

## Tracker (TBD with the pilot)
Build `scripts/dressing-status.mjs` (mirror `scripts/desert-pilot-status.mjs`): walks
`assets/pixelab/buildings/dressing/`, cross-checks `_pixellab_ids.json` + the design manifest's expected
states/anims per object, prints MISSING / BROKEN / next-actions. Until then, the per-object `ops` column
above is the checklist.
