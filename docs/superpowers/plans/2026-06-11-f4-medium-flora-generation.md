# F4 Medium Flora Generation Plan

**Goal:** Generate all Field 4 (medium flora) assets: base variants, full state coverage, and per-variant wind-sway animations for 48 object types across 16 land biomes — via one resumable script (`scripts/bulk_generate_f4.py`) that runs unattended.

**Approved by user 2026-06-11:** $500 credit top-up incoming; 64px baseline (range allowed); full states for every object; lifecycle + destruction + elemental states; wind sway. Subscription generations exhausted — running on credits.

## Catalog

16 biomes × 3 objects = 48 types (from 2026-06-07 master plan, Field 4 table).
Size 64px default → 16 candidates per `create-1-direction-object` call. A few showpiece types use 80px (still 16 candidates; ≤85px breakpoint): giant_mushroom, bird_of_paradise, heliconia, water_lily, aloe_rosette, prickly_pear_bloom.

**Prompt template:**
```
top-down high fantasy pixel art {object}, jaw-dropping beauty, hyper-detailed,
rich saturated colors, Final Fantasy aesthetic, alpha-transparent background,
detailed shading, medium flora sprite
```

## Stages per object type

1. **Base variants** — 4 × `POST /v2/create-1-direction-object` (16 candidates each). Poll `GET /v2/objects/{id}` → status `review` → download `frame_urls`, validate (PNG magic, >200B, non-empty alpha), `POST .../select-frames` with valid indices → completed per-variant object IDs. Up to 60 variants kept per type.
   Disk: `medium_flora/{biome}/{object}/mf__{biome}__{object}__v{NNN}.png`
2. **States** — 7 states × 16-variant pool (evenly spread across selected variants): `POST /v2/objects/{vid}/states`. States: `seedling`, `wilting`, `dead` (lifecycle), `crushed` (destruction), `burned`, `frozen`, `enchanted` (elemental). Renderer rolls states from pool with base fallback (F3 pattern).
   Disk: `medium_flora/{biome}/{object}/_states/{state}/mf__{biome}__{object}__{state}__v{NNN}.png`
   **8-hour constraint:** PixelLab objects auto-delete after 8h — states are scheduled immediately after each type's selection (global scheduler interleaves types), never batched to the end.
3. **Wind sway** — every selected variant: `POST /v2/animate-with-text-v3` with the variant PNG as `first_frame` (proven F2 pipeline; no host object needed, no expiry concern). 8 frames + reference = 9.
   Disk: `medium_flora/{biome}/{object}/anim/wind_sway/v{NNN}/frame_{NNN}.png`

## Volume

| Stage | API calls | Sprites |
|---|---|---|
| Base | 192 | ~2,880 |
| States | 5,376 (48 × 7 × 16) | 5,376 |
| Wind sway | ~2,880 | ~25,900 frames |
| **Total** | **~8,450 calls** | **~34,000 PNGs** |

## Script architecture (`scripts/bulk_generate_f4.py`)

- **Global scheduler**, max 16 jobs in flight (account limit 20, headroom for other use). Task priority: base > states > anims, interleaved across types so state jobs land minutes after their source objects are created.
- **State file** `medium_flora/_f4_state.json` — every task keyed with status; disk is co-truth (existing valid PNGs are never re-generated). Kill/restart at any point resumes exactly.
- **Credits guard** — checks `GET /v2/balance` every 10 min; below $3.00 it pauses (10-min recheck loop, loud log) instead of dying, so a top-up resumes it automatically. Logs cumulative spend rate from per-response `usage`.
- **Failure policy** — HTTP 429/529 exponential backoff; per-task 3 retries then parked in `failed`; 30-min stuck-job timeout → requeue; 404 on state source (8h expiry) → parked as `expired` for a later repair pass.
- **Validation** — every downloaded PNG: magic bytes, size > 200B, non-trivial alpha coverage (rejects blank/JSON-as-PNG corruption seen in F2/F3).
- CLI: `--status`, `--phase base|states|anims|all`, `--type <object>`, `--dry-run`.

## Out of scope (follow-up tasks)

- Renderer wiring (F4 joins y-sorted GL batch + decoration-claims at priority > F3) — separate plan after assets land.
- Manual aesthetic cull of auto-selected variants.
