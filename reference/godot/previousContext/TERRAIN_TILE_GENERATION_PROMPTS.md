# Terrain Tile Generation Prompts for AI

## 🎯 PRIMARY TERRAIN TILE PROMPT
**Character Count: 512/1024**

```
Isometric 2D pixel art terrain tile, seamless edges, brown dirt and soil texture, small scattered rocks and pebbles, earthy brown color palette, top-down 45-degree angle view, game asset style, clean pixel art, 32x32 to 64x64 resolution, tileable pattern, no gaps when repeated, medieval fantasy ground texture, organic natural surface, subtle color variation, hand-painted pixel style, crisp edges, no anti-aliasing, retro game aesthetic, seamless tiling on all four edges
```

## ❌ NEGATIVE PROMPT  
**Character Count: 398/1024**

```
blurry, anti-aliased, smooth gradients, 3D rendering, realistic photography, modern textures, concrete, asphalt, grass, water, snow, sand, characters, objects, buildings, UI elements, text, logos, bright colors, neon, glowing effects, shadows, lighting effects, transparency, alpha channels, non-tileable edges, gaps, seams, high contrast, oversaturated colors
```

## 🔧 TECHNICAL PARAMETERS

**Pattern Reference**: `tile`
- Forces structured, repeating pattern suitable for terrain tiling

**Options**:
- **Count**: `4` (generate 4 variations for variety)
- **Custom Seed**: `true` (allows reproducible results)

**Material Map Assignments**:
- **Base**: `diffuse` (primary color/texture map)
- **Normal Map**: `none` (2D pixel art doesn't need normal maps)
- **Mask Map**: `none` (simple terrain doesn't need complex masking)

---

## 🌿 GRASS TERRAIN VARIANT

**Prompt (489/1024)**:
```
Isometric 2D pixel art grass terrain tile, seamless edges, vibrant green grass texture, small wildflowers, natural meadow, top-down 45-degree view, game asset style, clean pixel art, 32x32 to 64x64 resolution, tileable pattern, medieval fantasy ground, organic surface, subtle green color variation, hand-painted pixel style, crisp edges, no anti-aliasing, retro game aesthetic, seamless tiling
```

**Negative Prompt (Same as above)**

---

## 🪨 ROCKY TERRAIN VARIANT

**Prompt (523/1024)**:
```
Isometric 2D pixel art rocky terrain tile, seamless edges, grey stone and rock texture, scattered boulders and pebbles, weathered stone surface, top-down 45-degree view, game asset style, clean pixel art, 32x32 to 64x64 resolution, tileable pattern, medieval fantasy ground, rugged natural surface, subtle grey color variation, hand-painted pixel style, crisp edges, no anti-aliasing, retro game aesthetic, seamless tiling
```

**Negative Prompt (Same as above)**

---

## 🏜️ DESERT TERRAIN VARIANT

**Prompt (501/1024)**:
```
Isometric 2D pixel art desert terrain tile, seamless edges, sandy beige texture, small dunes and sand ripples, arid landscape, top-down 45-degree view, game asset style, clean pixel art, 32x32 to 64x64 resolution, tileable pattern, medieval fantasy ground, smooth sandy surface, subtle tan color variation, hand-painted pixel style, crisp edges, no anti-aliasing, retro game aesthetic, seamless tiling
```

**Negative Prompt (Same as above)**

---

## 📋 GENERATION SETTINGS SUMMARY

```yaml
Terrain_Base:
  prompt: "Isometric 2D pixel art terrain tile, seamless edges, brown dirt and soil texture..."
  negative_prompt: "blurry, anti-aliased, smooth gradients, 3D rendering..."
  pattern_reference: "tile"
  count: 4
  custom_seed: true
  material_maps:
    base: "diffuse"
    normal_map: "none"
    mask_map: "none"

Terrain_Grass:
  prompt: "Isometric 2D pixel art grass terrain tile, seamless edges..."
  negative_prompt: [same as base]
  pattern_reference: "tile"
  count: 4
  custom_seed: true
  material_maps: [same as base]

Terrain_Rocky:
  prompt: "Isometric 2D pixel art rocky terrain tile, seamless edges..."
  negative_prompt: [same as base]
  pattern_reference: "tile" 
  count: 4
  custom_seed: true
  material_maps: [same as base]

Terrain_Desert:
  prompt: "Isometric 2D pixel art desert terrain tile, seamless edges..."
  negative_prompt: [same as base]
  pattern_reference: "tile"
  count: 4
  custom_seed: true
  material_maps: [same as base]
```

## 🎯 KEY PROMPT ELEMENTS

**Essential Keywords**:
- `isometric 2D pixel art` - Ensures proper perspective
- `seamless edges` - Critical for tiling
- `tileable pattern` - Reinforces seamless requirement
- `32x32 to 64x64 resolution` - Appropriate for game tiles
- `top-down 45-degree view` - Isometric angle
- `no anti-aliasing` - Clean pixel art style
- `crisp edges` - Sharp pixel boundaries

**Style Consistency**:
- `medieval fantasy` - Game world aesthetic
- `hand-painted pixel style` - Artistic quality
- `retro game aesthetic` - Classic game feel
- `clean pixel art` - Professional quality

**Technical Requirements**:
- `seamless tiling on all four edges` - Must tile perfectly
- `no gaps when repeated` - Continuous coverage
- `tileable pattern` - Structured repetition
