#!/usr/bin/env python3
"""
build_generation_queue.py — Walks the object x interaction x lifecycle matrix
and builds a PixelLab generation queue for terrain objects.

For animate objects: queues a base sprite per lifecycle phase, plus an animation
per phase_interaction.
For inanimate objects: queues a base sprite per durability stage (or "default"
if no durability), plus an animation per stage interaction.
"""

import json
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OBJECTS_DIR = REPO_ROOT / "data" / "terrain_objects" / "objects"
ASSETS_DIR = REPO_ROOT / "assets" / "catalog" / "terrain_objects"
OUTPUT_PATH = REPO_ROOT / "data" / "terrain_objects" / "generation" / "queue.json"


def asset_exists(output_path: str) -> bool:
    """Check whether an asset file already exists on disk."""
    full = REPO_ROOT / output_path
    return full.exists()


def queue_entry(object_id: str, category: str, phase_or_stage, asset_type: str,
                interaction, output_path: str) -> dict:
    """Build a single queue entry dict."""
    status = "completed" if asset_exists(output_path) else "pending"
    return {
        "object_id": object_id,
        "category": category,
        "phase": phase_or_stage,
        "asset_type": asset_type,
        "interaction": interaction,
        "status": status,
        "pixellab_job_id": None,
        "output_path": output_path,
    }


def output_path_for(category: str, object_id: str, phase_or_stage: str,
                    asset_type: str, interaction) -> str:
    """Derive the expected output path relative to REPO_ROOT."""
    base = f"assets/catalog/terrain_objects/{category}/{object_id}"
    if asset_type == "base_sprite":
        return f"{base}/{phase_or_stage}/base.png"
    else:
        # animation
        interaction_slug = interaction.replace(" ", "_")
        return f"{base}/{phase_or_stage}/anim_{interaction_slug}.png"


def process_animate(obj: dict, category: str) -> list[dict]:
    """Queue entries for an animate (lifecycle-driven) object."""
    object_id = obj["id"]
    entries = []
    lifecycle = obj.get("lifecycle", {})
    phases = lifecycle.get("phases", [])

    for phase_def in phases:
        phase = phase_def["phase"]
        phase_interactions = phase_def.get("phase_interactions", [])

        # Base sprite for this phase
        out = output_path_for(category, object_id, phase, "base_sprite", None)
        entries.append(queue_entry(object_id, category, phase, "base_sprite", None, out))

        # Animation for each phase interaction
        for interaction in phase_interactions:
            out = output_path_for(category, object_id, phase, "animation", interaction)
            entries.append(queue_entry(object_id, category, phase, "animation", interaction, out))

    return entries


def process_inanimate(obj: dict, category: str) -> list[dict]:
    """Queue entries for an inanimate (durability-driven or plain) object."""
    object_id = obj["id"]
    entries = []
    durability = obj.get("durability")

    if durability and durability.get("stages"):
        # One base sprite + animations per durability stage
        for stage_def in durability["stages"]:
            stage = stage_def["stage"]
            interactions = stage_def.get("interactions", [])

            out = output_path_for(category, object_id, stage, "base_sprite", None)
            entries.append(queue_entry(object_id, category, stage, "base_sprite", None, out))

            for interaction in interactions:
                out = output_path_for(category, object_id, stage, "animation", interaction)
                entries.append(queue_entry(object_id, category, stage, "animation", interaction, out))

    else:
        # No durability → single "default" stage; use top-level interactions list
        stage = "default"
        interactions = obj.get("interactions", [])

        out = output_path_for(category, object_id, stage, "base_sprite", None)
        entries.append(queue_entry(object_id, category, stage, "base_sprite", None, out))

        for interaction in interactions:
            out = output_path_for(category, object_id, stage, "animation", interaction)
            entries.append(queue_entry(object_id, category, stage, "animation", interaction, out))

    return entries


def collect_all_json(root: Path) -> list[Path]:
    """Recursively collect all .json files under root."""
    return sorted(root.rglob("*.json"))


def build_queue() -> dict:
    json_files = collect_all_json(OBJECTS_DIR)
    queue = []
    errors = []

    for path in json_files:
        try:
            with open(path, encoding="utf-8") as f:
                obj = json.load(f)
        except Exception as e:
            errors.append({"path": str(path), "error": str(e)})
            continue

        object_id = obj.get("id", path.stem)
        category = obj.get("category", "unknown")
        ontology = obj.get("ontology", "inanimate")

        if ontology == "animate":
            entries = process_animate(obj, category)
        else:
            entries = process_inanimate(obj, category)

        queue.extend(entries)

    if errors:
        print(f"[WARN] {len(errors)} files had parse errors:")
        for e in errors:
            print(f"  {e['path']}: {e['error']}")

    total = len(queue)
    base_sprites = sum(1 for e in queue if e["asset_type"] == "base_sprite")
    animations = sum(1 for e in queue if e["asset_type"] == "animation")
    completed = sum(1 for e in queue if e["status"] == "completed")

    return {
        "total_queued": total,
        "total_base_sprites": base_sprites,
        "total_animations": animations,
        "total_completed": completed,
        "queue": queue,
    }


def main():
    print(f"Scanning: {OBJECTS_DIR}")
    result = build_queue()

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    print(f"\n=== Generation Queue Built ===")
    print(f"  Total queued     : {result['total_queued']}")
    print(f"  Base sprites     : {result['total_base_sprites']}")
    print(f"  Animations       : {result['total_animations']}")
    print(f"  Already completed: {result['total_completed']}")
    print(f"  Pending          : {result['total_queued'] - result['total_completed']}")
    print(f"\nOutput: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
