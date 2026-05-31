# Terrain Object System — Extension Points

Future agents: this document tells you *exactly* where to hook new systems into
the terrain object pipeline. Each section names the current state, the precise
hook locations, and what to add.

Do not create new parallel systems. Extend the existing hooks.

---

## 1. Identity System

**Current state:** Each `object_instance.gd` instance carries an `instance_seed`
(derived from world_seed + position hash) that drives the `variance` block in
`object_schema.json` — branching, lean angle, color shift, scale. All instances
of the same object type look slightly different but have no persistent identity.

**Hook locations:**

| Where | What |
|-------|------|
| `schema/object_schema.json` `variance` block | Add `identity_fields` array listing which variance parameters persist across sessions |
| `scripts/core/object_instance.gd` | Add `identity_id` string field (UUID generated once, stored in delta record) |
| `scripts/core/object_catalog.gd` | Add `get_object_identity(instance_id)` — returns persistent identity record from delta store |

**What to add:**

- `identity_id` — stable UUID that persists even if the object is damaged and
  regrows; links NPC memories ("the oak tree near the well") to the same entity.
- `growth_history` — array of `{game_day, phase_transition}` records so you can
  tell an object is "that tree that was a sapling when the village was founded."
- `damage_scars` — persistent HP events that leave visual marks even after
  full HP recovery (chop marks, lightning scars).
- `relationship_to_neighbors` — spatial index of nearby object_ids; used by
  NPC goal graph to form location anchors ("I'll meet you by the tall pine
  cluster east of the market").

---

## 2. Weather Integration

**Current state:** Environmental interactions (`interactions/environmental/`)
define `trigger.weather_field` and `trigger.threshold` but the runtime does not
yet query a live WeatherSystem. The fields exist in the schema; nothing reads
them.

**Hook locations:**

| Where | What |
|-------|------|
| `interactions/environmental/*.json` | `trigger.weather_field` and `trigger.threshold` are already the hook; no schema change needed |
| `scripts/visual/animation_resolver.gd` | Add `_get_weather_intensity(weather_field)` that queries `WorldManager.weather_system.get_field(weather_field)` and returns 0.0–1.0 |
| `scripts/core/delta_persistence.gd` | Add `recovery_time` modification: rain accelerates fill decay on `mine` deltas; drought slows `regrow` deltas |

**What to add:**

- Query `WeatherSystem` for each active environmental interaction at the
  start of each animation frame tick.
- Scale `intensity_variable` animations by the returned 0.0–1.0 value (a light
  breeze barely sways leaves; a storm bends the whole canopy).
- Rain (`precipitation > threshold`) accelerates `fill` delta entropy — ore
  pockets refill faster in wet biomes.
- Drought (`precipitation < low_threshold`) slows `regrow` entropy — grass and
  saplings recover more slowly during dry seasons.

---

## 3. Seasonal System

**Current state:** The `seasonal_change` interaction is defined in
`interactions/ambient/` and the `lifecycle_phase` schema has a `sprite_set`
field, but nothing reads `GameTime.season` to switch sprite sets.

**Hook locations:**

| Where | What |
|-------|------|
| `schema/object_schema.json` `lifecycle_phase` def | Add `season_locked` boolean — if true, this phase only activates during the matching season |
| `scripts/visual/animation_resolver.gd` | Check `GameTime.season` when resolving the active sprite_set for a lifecycle phase |
| `data/terrain_objects/objects/*.json` lifecycle phases | Add seasonal overlay sprite_set keys: `sprite_set_spring`, `sprite_set_autumn`, etc. (additive to base) |

**What to add:**

- Per-season overlay sprites that composite over the base phase sprite:
  - **spring** — bloom buds, green tinge.
  - **summer** — full canopy, fruit visible.
  - **autumn** — red/gold hue shift, fruit drop particle.
  - **bare** (winter) — skeletal branches, snow accumulation overlay.
- The `seasonal_change` interaction fires at season boundary and triggers the
  sprite_set transition animation (leaves falling, buds bursting).
- `season_locked` phases: e.g. the `fruit` phase only exists in summer; outside
  summer the lifecycle skips it.

---

## 4. Building Integration

**Current state:** The inanimate `durability` pattern (HP, stages, resistances,
break_products) is already the correct model for structural materials. No
building objects exist in `data/terrain_objects/objects/` yet.

**Hook locations:**

| Where | What |
|-------|------|
| `data/terrain_objects/objects/` | Add `structure/` subdirectory with `wall_stone.json`, `floor_wood.json`, `door_oak.json`, `roof_thatch.json` as inanimate objects |
| `scripts/core/placement_engine.gd` | Add settlement footprint input: village generator emits a list of `{object_id, tile_pos}` tuples; placement engine places them as baseline structure objects |
| `scripts/core/delta_persistence.gd` | Add `permanent` decay type (entropy = 0, never returns to baseline) for destroyed structural elements |

**What to add:**

- Wall/floor/door/roof tiles as inanimate terrain objects using the existing
  durability schema — walls have HP and crack stages, doors have open/closed
  state transitions via `state_reactive` interactions.
- Permanent deltas for player-built or destroyed structures. A demolished wall
  does not regenerate unlike a chopped tree.
- The `composition-principles.md` rule applies: buildings are spatial tile
  structures composed from individual object tiles, never a single stamped image.

---

## 5. NPC Interaction

**Current state:** The `entity_action` trigger type in `interaction_schema.json`
is identical whether the acting entity is the player or an NPC. The `player_action`
category name is a misnomer — all entity actions apply equally.

**Hook locations:**

| Where | What |
|-------|------|
| `interactions/player_action/*.json` | These apply to all entities; rename category to `entity_action` in a future schema migration, or simply treat player_action as entity_action in code |
| `scripts/core/interaction_registry.gd` | Add `resolve_npc_action(action_verb, object_instance)` — maps NPC goal verbs ("chop", "mine", "harvest") to interaction IDs and validates preconditions |
| NPC goal graph (`scripts/core/npc_behavior.gd` or future `npc_goal_graph.gd`) | Reference `object_ids` from `object_instance.gd` as goal targets; goal entry: `{verb: "chop", target_object_id: "oak_001", interaction_id: "chop"}` |

**What to add:**

- NPCs chop trees, mine ore, water crops, and harvest fruit using the same
  `chop`, `mine`, `water_plant`, `pick` interactions as the player. Same effects,
  same break_products, same delta records.
- `resolve_npc_action` checks `requires_tool` and `requires_target` constraints —
  an NPC without an axe cannot chop, same as the player.
- NPC goal graph entries store `object_id` (the stable identity_id, see #1)
  so NPCs navigate to specific named objects ("go chop the oak_001 near home")
  rather than any tree in range.
- Completed NPC actions write delta records identical to player-generated deltas —
  the world doesn't know or care who acted.
