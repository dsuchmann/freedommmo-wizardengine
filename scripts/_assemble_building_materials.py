#!/usr/bin/env python3
"""
_assemble_building_materials.py — fold the building-material-vocabulary workflow
output into assets/pixelab/buildings/manifest/building-materials.json.

The vocabulary workflow returns {result:{groups:[{biomes:[{id,displayName,walls,roofs}]}]}}.
This flattens it to {version, biomes:{<id>:{displayName,walls,roofs}}}, validates against
the canonical 21 SPEC_BIOME_IDS, dedupes slugs within a biome, and writes the manifest.

Usage:
  python scripts/_assemble_building_materials.py <workflow_output.json>
"""
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT = REPO_ROOT / "assets" / "pixelab" / "buildings" / "manifest" / "building-materials.json"
REGISTRY_JS = REPO_ROOT / "sim" / "world" / "buildings" / "building-material-registry.js"

SPEC_BIOME_IDS = [
    "ocean", "deep_ocean", "shallow_water", "beach", "river", "lake",
    "grassland", "forest", "dense_forest", "tropical_forest", "taiga",
    "savanna", "steppe", "desert", "swamp", "tundra", "arctic",
    "hills", "mountains", "volcanic", "mystic",
]


def main():
    src = Path(sys.argv[1])
    raw = json.loads(src.read_text(encoding="utf-8"))
    result = raw.get("result", raw)
    groups = result.get("groups", [])

    biomes = {}
    for g in groups:
        for b in g.get("biomes", []):
            bid = b["id"]
            biomes[bid] = {
                "displayName": b.get("displayName", bid),
                "walls": _clean(b.get("walls", []), bid, "wall"),
                "roofs": _clean(b.get("roofs", []), bid, "roof"),
            }

    # validate
    missing = [b for b in SPEC_BIOME_IDS if b not in biomes]
    extra = [b for b in biomes if b not in SPEC_BIOME_IDS]
    problems = []
    for bid in SPEC_BIOME_IDS:
        if bid not in biomes:
            continue
        for role in ("walls", "roofs"):
            n = len(biomes[bid][role])
            if n != 4:
                problems.append(f"{bid}.{role}: {n} (expected 4)")

    print(f"biomes assembled: {len(biomes)}/{len(SPEC_BIOME_IDS)}")
    if missing:
        print(f"  MISSING: {missing}")
    if extra:
        print(f"  EXTRA (not in SPEC): {extra}")
    if problems:
        print("  COUNT PROBLEMS:")
        for p in problems:
            print(f"    {p}")

    # order biomes canonically
    ordered = {b: biomes[b] for b in SPEC_BIOME_IDS if b in biomes}

    n_wall = sum(len(v["walls"]) for v in ordered.values())
    n_roof = sum(len(v["roofs"]) for v in ordered.values())
    manifest = {
        "version": 1,
        "spec": "docs/superpowers/specs/2026-06-20-building-asset-manifest-design.md",
        "counts": {"biomes": len(ordered), "wall_materials": n_wall, "roof_materials": n_roof},
        "biomes": ordered,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT}")
    print(f"  wall materials: {n_wall}  roof materials: {n_roof}  (target 84 + 84)")

    write_registry(ordered)
    print(f"wrote {REGISTRY_JS}")

    ok = not missing and not problems
    print("OK" if ok else "INCOMPLETE — see problems above")
    sys.exit(0 if ok else 2)


def write_registry(ordered):
    """Emit a lean ES-module registry (slug/name/palette only — no prompts) so the
    game can pick + resolve materials without loading the heavy JSON. Kept in sync
    by regenerating from the same source."""
    def lite(items):
        return [{"slug": it["slug"], "name": it["name"], "palette": it["palette"]} for it in items]
    data = {b: {"displayName": v["displayName"], "walls": lite(v["walls"]), "roofs": lite(v["roofs"])}
            for b, v in ordered.items()}
    js = '''// AUTO-GENERATED from assets/pixelab/buildings/manifest/building-materials.json
// by scripts/_assemble_building_materials.py — do NOT edit by hand; regenerate instead.
// Biome-anchored building wall + roof materials (4 each per 21 biomes).
// Spec: docs/superpowers/specs/2026-06-20-building-asset-manifest-design.md

export const BUILDING_MATERIALS = ''' + json.dumps(data, indent=2, ensure_ascii=False) + ''';

export const WALL_FALLBACK_DIR = '/assets/pixelab/buildings/walls/stone_brick_tiles/';
export const WEAR_STATES = ['normal', 'weathered', 'damaged', 'mossy'];
export const WINDOW_SHAPES = ['arched', 'round', 'shuttered', 'lattice', 'bay', 'slit'];
export const DOOR_SHAPES = ['plank', 'iron_banded', 'arched_double', 'carved', 'rounded', 'studded'];
export const INTERIOR_DOOR_SHAPES = ['plank', 'arched'];
// The 9 wall piece keys the renderer consumes (building-renderer.js).
export const WALL_PIECE_KEYS = ['south_base', 'south_corner_west', 'south_corner_east',
  'north_back', 'edge_ew', 'south_window', 'south_door', 'interior_base', 'interior_archway'];

export function wallsForBiome(biome) { return (BUILDING_MATERIALS[biome] || {}).walls || []; }
export function roofsForBiome(biome) { return (BUILDING_MATERIALS[biome] || {}).roofs || []; }

/** Deterministically pick one entry of a material list by an integer hash (e.g. building id). */
export function pickMaterial(list, n) {
  if (!list || !list.length) return null;
  return list[((n % list.length) + list.length) % list.length];
}

export function wallAssetDir(biome, slug) { return `/assets/pixelab/buildings/walls/${biome}/${slug}/`; }
export function roofAssetDir(biome, slug) { return `/assets/pixelab/buildings/roof/${biome}/${slug}/`; }

/**
 * Resolve a wall piece file name. Mirrors the storage layout written by
 * scripts/bulk_generate_buildings.py.
 *   pieceKey: one of WALL_PIECE_KEYS
 *   opts.wear: WEAR_STATES (for surface pieces; ignored by window/door/archway)
 *   opts.shape: WINDOW_SHAPES (windows) | DOOR_SHAPES (doors)
 *   opts.open: doors only — the open sprite
 */
export function wallPieceFile(pieceKey, opts = {}) {
  const wear = opts.wear || 'normal';
  const shape = opts.shape;
  switch (pieceKey) {
    case 'south_base':
    case 'south_corner_west':
    case 'south_corner_east':
    case 'north_back':
    case 'edge_ew':
    case 'interior_base':
      return `${pieceKey}__${wear}.png`;
    case 'interior_archway':
      return 'interior_archway.png';
    case 'south_window':
      return `south_window__${shape || 'arched'}.png`;
    case 'south_door':
      return `south_door__${shape || 'plank'}${opts.open ? '__open' : ''}.png`;
    default:
      return `${pieceKey}.png`;
  }
}

/** Door open/close animation frame path (frame index 0..8). */
export function doorAnimFrame(biome, slug, shape, i) {
  return `${wallAssetDir(biome, slug)}anim/door_open/${shape}/frame_${String(i).padStart(3, '0')}.png`;
}

/** Roof texture path. variant 0..3 (v000 base + 3 interpolation variants); fascia for the eave drop. */
export function roofTextureFile(variant = 0) { return `roof_top__v${String(variant).padStart(3, '0')}.png`; }
export const ROOF_FASCIA_FILE = 'roof_fascia.png';
'''
    REGISTRY_JS.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY_JS.write_text(js, encoding="utf-8")


def _clean(items, bid, role):
    """Dedupe slugs within a biome; keep first occurrence."""
    seen, out = set(), []
    for it in items:
        slug = it.get("slug", "").strip()
        if not slug or slug in seen:
            # make unique if collision
            base = slug or role
            i = 2
            while f"{base}_{i}" in seen:
                i += 1
            slug = f"{base}_{i}"
        seen.add(slug)
        out.append({
            "slug": slug,
            "name": it.get("name", slug),
            "prompt": it.get("prompt", ""),
            "palette": it.get("palette", ""),
            "rationale": it.get("rationale", ""),
        })
    return out


if __name__ == "__main__":
    main()
