// src/render/building-layer.js — the outdoor building GL layer (two Y-split bitmaps).
//
// Buildings are NO LONGER baked into the terrain chunk bitmap (worker-chunk-renderer.js drops the
// wall post-pass + roof bake), so real terrain exists under every building. This module re-renders
// the visible buildings at the live camera into TWO bitmaps split by the player's tile Y:
//   • behind — buildings whose south baseline is NORTH of the player (drawn UNDER the player)
//   • front  — buildings whose south baseline is at/SOUTH of the player (drawn OVER the player,
//              with the GPU spotlight so you see through to yourself on the terrain).
// canvas-renderer blits `behind` before the sprite batch and `front` (spotlight) after it. This
// resolves player-vs-building by the same Y-split the sprite sort uses; building-vs-building is the
// south-edge painter sort within each set. See
// docs/superpowers/specs/2026-06-20-outdoor-building-spotlight-seethrough-design.md and the plan.

import { drawBuildingTextured } from './building-occluder.js';
import { nearDepthBuildings } from './building-depth.js';

// South baseline = the building's front (south) edge in tile space.
function baseline(b) { return b.y + b.footprint.boundingBox.h; }

/** Partition buildings into those BEHIND the player (drawn under) and those IN FRONT (drawn over,
 *  spotlit). Split key = south baseline vs the player's tile Y; baseline >= playerY ⇒ in front
 *  (nearer the camera, can occlude). Each set is south-sorted (farther first) so the nearer
 *  building paints over the farther one. Pure; skips buildings missing a bounding box. */
export function splitBuildingsByPlayer(buildings, playerY) {
  const behind = [], front = [];
  for (const b of buildings) {
    const bb = b.footprint && b.footprint.boundingBox;
    if (!bb) continue;
    (b.y + bb.h >= playerY ? front : behind).push(b);
  }
  const bySouth = (a, c) => baseline(a) - baseline(c);
  behind.sort(bySouth);
  front.sort(bySouth);
  return { behind, front };
}
