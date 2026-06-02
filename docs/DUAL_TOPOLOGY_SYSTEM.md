# Dual Topology System

The landscape uses two complementary topology languages inspired by classic 2D action RPGs while remaining more seamless and modern.

## 1. Smooth Implied Elevation

Smooth terrain is not true 3D geometry, but the game communicates incline/decline through coordinated cues:

- movement cost changes when traversing uphill/downhill
- camera zoom subtly pulls out on higher ground and opens the view when climbing
- elevation shading creates ridge/valley flow
- contours and soft shadows show slope direction
- terrain texture stretches into coherent patches rather than noisy tiles
- distant objects/depth bokeh vary by relative elevation

This is used for hills, valleys, mountain bowls, ridges, dunes, and broad slopes.

## 2. Quantized Plateau Elevation

Major height changes are quantized into readable 2D plateau levels:

- plateau level 0: lowland/water-adjacent floor
- plateau level 1: raised field/low hill shelf
- plateau level 2: highland/mesa shelf
- plateau level 3: mountain shelf
- plateau level 4: peak/overlook

Transitions between levels are explicit:

- step ledges
- cliff walls
- ramps/switchbacks
- climbable vines/handholds
- stairs/natural stone steps
- overhangs/cave mouths
- bridges connecting shelves

This creates Link to the Past / CrossCode-style readable map topology.

## Runtime Rules

- Smooth slope modifies speed and camera feel.
- Plateau differences determine cliffs, steps, ledges, and climbable transitions.
- Player can walk smooth inclines.
- Player can climb or step up small quantized changes.
- Player cannot cross cliff transitions unless a ramp, stair, bridge, vine, or climb route exists.
- Jump/glide can interact with plateau differences later.

## Rendering Rules

- Cached terrain remains seam-aligned and flat.
- Dynamic overlay draws contours, step bands, and cliff shadows across chunk boundaries.
- Object/player draw order uses y + elevation.
- Canopy/overhangs draw above actors.

## Goal

The landscape should feel like a fluid, believable topographic field with discrete, artful RPG-readable plateau grammar layered on top.
