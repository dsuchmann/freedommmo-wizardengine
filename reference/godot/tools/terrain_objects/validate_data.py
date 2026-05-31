"""
validate_data.py — validates all terrain_objects JSON data for:
  1. Structure — all JSON parses
  2. Required fields — per domain schema
  3. Referential integrity — cross-file ID references
  4. Value ranges — density 0-1, hp > 0, resistances 0-1

Exit 0 on clean. Exit 1 on hard errors.
Warnings are reported but do not fail the build.
"""

import json
import os
import sys
import glob

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
DATA_ROOT = os.path.join(PROJECT_ROOT, "data", "terrain_objects")

OBJECTS_DIR = os.path.join(DATA_ROOT, "objects")
INTERACTIONS_DIR = os.path.join(DATA_ROOT, "interactions")
AFFINITIES_DIR = os.path.join(DATA_ROOT, "affinities")
TRANSITIONS_DIR = os.path.join(DATA_ROOT, "transitions")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
errors = []
warnings = []


def error(context, msg):
    errors.append(f"[ERROR] {context}: {msg}")


def warn(context, msg):
    warnings.append(f"[WARN]  {context}: {msg}")


def load_all_json(directory, recursive=False):
    """Return list of (filepath, parsed_dict) for all JSON files in directory."""
    pattern = os.path.join(directory, "**", "*.json") if recursive else os.path.join(directory, "*.json")
    results = []
    for fpath in glob.glob(pattern, recursive=recursive):
        try:
            with open(fpath, encoding="utf-8") as f:
                data = json.load(f)
            results.append((fpath, data))
        except json.JSONDecodeError as e:
            error(fpath, f"JSON parse error: {e}")
        except OSError as e:
            error(fpath, f"File read error: {e}")
    return results


# ---------------------------------------------------------------------------
# Phase 1: Load everything
# ---------------------------------------------------------------------------
print("Loading data...")
object_files = load_all_json(OBJECTS_DIR, recursive=True)
interaction_files = load_all_json(INTERACTIONS_DIR, recursive=True)
affinity_files = load_all_json(AFFINITIES_DIR, recursive=False)
transition_files = load_all_json(TRANSITIONS_DIR, recursive=False)

print(f"  Objects:      {len(object_files)} files")
print(f"  Interactions: {len(interaction_files)} files")
print(f"  Affinities:   {len(affinity_files)} files")
print(f"  Transitions:  {len(transition_files)} files")

# Build ID registries
object_ids = set()
interaction_ids = set()
affinity_ids = set()

for fpath, data in object_files:
    oid = data.get("id")
    if oid:
        object_ids.add(oid)

for fpath, data in interaction_files:
    iid = data.get("id")
    if iid:
        interaction_ids.add(iid)

for fpath, data in affinity_files:
    bid = data.get("biome_id")
    if bid:
        affinity_ids.add(bid)

print(f"\n  Registered object IDs:      {len(object_ids)}")
print(f"  Registered interaction IDs: {len(interaction_ids)}")
print(f"  Registered biome IDs:       {len(affinity_ids)}")

# ---------------------------------------------------------------------------
# Phase 2: Required fields — Objects
# ---------------------------------------------------------------------------
print("\n--- Validating object files ---")
REQUIRED_OBJECT_FIELDS = ["id", "category", "ontology"]

for fpath, data in object_files:
    ctx = os.path.relpath(fpath, PROJECT_ROOT)

    # Required top-level fields
    for field in REQUIRED_OBJECT_FIELDS:
        if field not in data:
            error(ctx, f"Missing required field: '{field}'")

    # Must have id
    obj_id = data.get("id")
    if not obj_id:
        error(ctx, "Missing 'id' field")
        continue

    # interactions referenced in durability stages must be valid
    durability = data.get("durability") or {}
    stages = durability.get("stages", [])
    for stage in stages:
        stage_name = stage.get("stage", "?")
        for interaction_id in stage.get("interactions", []):
            if interaction_id not in interaction_ids:
                warn(ctx, f"Stage '{stage_name}' references unknown interaction '{interaction_id}'")

    # top-level interactions array (if present)
    for interaction_id in data.get("interactions", []):
        if interaction_id not in interaction_ids:
            warn(ctx, f"Top-level interactions references unknown interaction '{interaction_id}'")

    # Value range checks
    hp = durability.get("hp")
    if hp is not None and hp <= 0:
        error(ctx, f"durability.hp must be > 0, got {hp}")

    resistances = durability.get("resistances", {})
    for res_name, res_val in resistances.items():
        if not (0.0 <= res_val <= 1.0):
            error(ctx, f"durability.resistances.{res_name} must be 0-1, got {res_val}")

# ---------------------------------------------------------------------------
# Phase 3: Required fields — Interactions
# ---------------------------------------------------------------------------
print("--- Validating interaction files ---")
REQUIRED_INTERACTION_FIELDS = ["id", "category", "trigger", "animation"]

for fpath, data in interaction_files:
    ctx = os.path.relpath(fpath, PROJECT_ROOT)
    for field in REQUIRED_INTERACTION_FIELDS:
        if field not in data:
            error(ctx, f"Missing required field: '{field}'")

# ---------------------------------------------------------------------------
# Phase 4: Required fields — Affinities
# ---------------------------------------------------------------------------
print("--- Validating affinity files ---")
REQUIRED_AFFINITY_FIELDS = ["biome_id", "object_pools"]

for fpath, data in affinity_files:
    ctx = os.path.relpath(fpath, PROJECT_ROOT)

    for field in REQUIRED_AFFINITY_FIELDS:
        if field not in data:
            error(ctx, f"Missing required field: '{field}'")

    biome_id = data.get("biome_id", "?")

    # Check each pool entry references a valid object
    for i, entry in enumerate(data.get("object_pools", [])):
        ref_id = entry.get("object_id")
        if not ref_id:
            error(ctx, f"Pool entry[{i}] missing 'object_id'")
        elif ref_id not in object_ids:
            error(ctx, f"Pool entry[{i}] references unknown object '{ref_id}'")

        # Density range
        density = entry.get("density")
        if density is not None:
            if not (0.0 <= density <= 1.0):
                error(ctx, f"Pool entry[{i}] ({ref_id}) density {density} out of range [0,1]")

        # elevation_range validity
        elev = entry.get("elevation_range")
        if elev is not None:
            if len(elev) != 2 or not (0.0 <= elev[0] <= 1.0) or not (0.0 <= elev[1] <= 1.0):
                warn(ctx, f"Pool entry[{i}] ({ref_id}) elevation_range {elev} looks invalid")

        # moisture_range validity
        moist = entry.get("moisture_range")
        if moist is not None:
            if len(moist) != 2 or not (0.0 <= moist[0] <= 1.0) or not (0.0 <= moist[1] <= 1.0):
                warn(ctx, f"Pool entry[{i}] ({ref_id}) moisture_range {moist} looks invalid")

# ---------------------------------------------------------------------------
# Phase 5: Required fields — Transitions
# ---------------------------------------------------------------------------
print("--- Validating transition files ---")
REQUIRED_TRANSITION_FIELDS = ["biome_a", "biome_b", "blend_width"]

for fpath, data in transition_files:
    ctx = os.path.relpath(fpath, PROJECT_ROOT)

    for field in REQUIRED_TRANSITION_FIELDS:
        if field not in data:
            error(ctx, f"Missing required field: '{field}'")

    biome_a = data.get("biome_a", "?")
    biome_b = data.get("biome_b", "?")

    # Biome IDs must exist in affinity registry
    if biome_a != "?" and biome_a not in affinity_ids:
        error(ctx, f"biome_a '{biome_a}' not found in affinities")
    if biome_b != "?" and biome_b not in affinity_ids:
        error(ctx, f"biome_b '{biome_b}' not found in affinities")

    # blend_width should be positive
    blend_width = data.get("blend_width")
    if blend_width is not None and blend_width <= 0:
        error(ctx, f"blend_width must be > 0, got {blend_width}")

    # edge_objects must reference valid objects
    for i, eo in enumerate(data.get("edge_objects", [])):
        ref_id = eo.get("object_id")
        if not ref_id:
            error(ctx, f"edge_objects[{i}] missing 'object_id'")
        elif ref_id not in object_ids:
            error(ctx, f"edge_objects[{i}] references unknown object '{ref_id}'")

        density = eo.get("density")
        if density is not None and not (0.0 <= density <= 1.0):
            error(ctx, f"edge_objects[{i}] ({ref_id}) density {density} out of range [0,1]")

    # gradient field
    gradient = data.get("gradient", {})
    valid_modes = {"linear_fadeout", "linear_fadein", "hard_cutoff", "noise_blend"}
    for key in ["biome_a_objects", "biome_b_objects"]:
        mode = gradient.get(key)
        if mode and mode not in valid_modes:
            warn(ctx, f"gradient.{key} '{mode}' is not a recognised blend mode")

# ---------------------------------------------------------------------------
# Phase 6: Report
# ---------------------------------------------------------------------------
print("\n" + "=" * 60)
print("VALIDATION REPORT")
print("=" * 60)

if warnings:
    print(f"\n{len(warnings)} WARNING(S):")
    for w in warnings:
        print(f"  {w}")

if errors:
    print(f"\n{len(errors)} ERROR(S):")
    for e in errors:
        print(f"  {e}")
    print(f"\nFAILED — {len(errors)} error(s) must be fixed.")
    sys.exit(1)
else:
    if warnings:
        print(f"\nPASSED with {len(warnings)} warning(s) — no hard errors.")
    else:
        print("\nPASSED — clean.")
    sys.exit(0)
