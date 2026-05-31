#!/usr/bin/env python3
"""
run_pixellab_generation.py — CLI tool for managing the PixelLab terrain object
generation queue.

Commands:
  status                          Show queue statistics
  next [N]                        Show next N pending items (default 10)
  mark-done OBJ_ID PHASE INTER   Mark an item complete ("-" means null interaction)
"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
QUEUE_PATH = REPO_ROOT / "data" / "terrain_objects" / "generation" / "queue.json"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_queue() -> dict:
    if not QUEUE_PATH.exists():
        print(f"[ERROR] Queue not found: {QUEUE_PATH}")
        print("Run build_generation_queue.py first.")
        sys.exit(1)
    with open(QUEUE_PATH, encoding="utf-8") as f:
        return json.load(f)


def save_queue(data: dict) -> None:
    # Recompute summary fields before saving
    queue = data["queue"]
    data["total_queued"] = len(queue)
    data["total_base_sprites"] = sum(1 for e in queue if e["asset_type"] == "base_sprite")
    data["total_animations"] = sum(1 for e in queue if e["asset_type"] == "animation")
    data["total_completed"] = sum(1 for e in queue if e["status"] == "completed")
    with open(QUEUE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def null_interaction(value: str):
    """Convert "-" to None, otherwise return as-is."""
    return None if value == "-" else value


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_status(data: dict) -> None:
    queue = data["queue"]
    total = len(queue)
    completed = sum(1 for e in queue if e["status"] == "completed")
    pending = sum(1 for e in queue if e["status"] == "pending")
    failed = sum(1 for e in queue if e["status"] == "failed")
    in_progress = sum(1 for e in queue if e["status"] == "in_progress")

    base_pending = sum(1 for e in queue if e["asset_type"] == "base_sprite" and e["status"] == "pending")
    anim_pending = sum(1 for e in queue if e["asset_type"] == "animation" and e["status"] == "pending")

    # Breakdown by top-level category
    cat_counter: Counter = Counter()
    for e in queue:
        if e["status"] == "pending":
            top_cat = e.get("category", "unknown").split("/")[0]
            cat_counter[top_cat] += 1

    print("=== Generation Queue Status ===")
    print(f"  Total    : {total}")
    print(f"  Completed: {completed}")
    print(f"  Pending  : {pending}  (base sprites: {base_pending}, animations: {anim_pending})")
    print(f"  In prog. : {in_progress}")
    print(f"  Failed   : {failed}")
    if cat_counter:
        print("\nPending by category:")
        for cat, count in sorted(cat_counter.items(), key=lambda x: -x[1]):
            print(f"  {cat:<20} {count}")


def cmd_next(data: dict, n: int) -> None:
    pending = [e for e in data["queue"] if e["status"] == "pending"]
    items = pending[:n]
    if not items:
        print("No pending items.")
        return
    print(f"Next {len(items)} pending item(s):")
    print(f"  {'#':<4} {'OBJECT_ID':<30} {'PHASE':<18} {'TYPE':<12} INTERACTION")
    print("  " + "-" * 82)
    for i, e in enumerate(items, 1):
        interaction = e["interaction"] or "-"
        print(f"  {i:<4} {e['object_id']:<30} {e['phase']:<18} {e['asset_type']:<12} {interaction}")


def cmd_mark_done(data: dict, object_id: str, phase: str, interaction_raw: str) -> None:
    interaction = null_interaction(interaction_raw)
    queue = data["queue"]
    matched = []
    for e in queue:
        if (e["object_id"] == object_id
                and e["phase"] == phase
                and e["interaction"] == interaction):
            matched.append(e)

    if not matched:
        print(f"[ERROR] No entry found: object_id={object_id!r} phase={phase!r} interaction={interaction!r}")
        sys.exit(1)

    if len(matched) > 1:
        # Mark the first pending one, or all if none are pending
        target = next((e for e in matched if e["status"] == "pending"), matched[0])
    else:
        target = matched[0]

    old_status = target["status"]
    target["status"] = "completed"
    save_queue(data)
    print(f"Marked completed: {object_id} / {phase} / {interaction or '-'}  (was: {old_status})")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Manage the PixelLab terrain object generation queue.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
  status
  next [N]
  mark-done OBJECT_ID PHASE INTERACTION   (use "-" for null interaction)
""",
    )
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("status", help="Show queue statistics")

    next_parser = subparsers.add_parser("next", help="Show next N pending items")
    next_parser.add_argument("n", nargs="?", type=int, default=10,
                             help="Number of items to show (default: 10)")

    done_parser = subparsers.add_parser("mark-done", help="Mark an item complete")
    done_parser.add_argument("object_id", help="Object ID (e.g. oak_tree)")
    done_parser.add_argument("phase", help="Phase or stage name")
    done_parser.add_argument("interaction", help="Interaction name, or '-' for null")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    data = load_queue()

    if args.command == "status":
        cmd_status(data)
    elif args.command == "next":
        cmd_next(data, args.n)
    elif args.command == "mark-done":
        cmd_mark_done(data, args.object_id, args.phase, args.interaction)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
