// WebGL2 terrain compositor — Stage 1 of the GPU migration.
//
// Draws worker-painted chunk ImageBitmaps as GPU textures on a GL canvas that
// sits UNDERNEATH the existing 2D canvas. Each chunk bitmap is uploaded whole
// via texImage2D (the path verified safe against the atlas stripe bug — we
// never re-assemble terrain from a tile atlas on the GPU).
//
// Sampling is NEAREST + CLAMP_TO_EDGE to match ctx.imageSmoothingEnabled=false.
// Quad placement uses the exact same CSS-pixel sx/sy/chunkPx math as the 2D
// path, so the two modes are pixel-comparable with the A/B toggle (G key).

import { onSceneDiscontinuity } from '../core/scene-teardown.js';

var VERT_SRC = `#version 300 es
precision highp float;
in vec2 aUnit;            // unit quad corner (0..1)
uniform vec2 uPos;        // quad top-left, CSS px
uniform vec2 uSize;       // quad size, CSS px
uniform vec2 uViewport;   // viewport size, CSS px
out vec2 vUV;
void main() {
  vec2 px = uPos + aUnit * uSize;
  vec2 clip = vec2(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vUV = aUnit;
}`;

var FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  outColor = texture(uTex, vUV);
}`;

// Building spotlight overlay: blit the FRONT building bitmap over the scene but fade it to nothing
// in a soft radial hole around the player, so you see THROUGH it to yourself on the real terrain.
// Reuses the chunk VERT_SRC quad (z=0 — the Y-split, not depth, orders player-vs-building). The
// hole is a GPU smoothstep on the distance from each fragment to the player's screen centre. NOTE
// gl_FragCoord origin is bottom-left in the FBO; uPlayerPx is top-left CSS/art px → flip Y.
var SPOTLIGHT_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uViewport;   // _artW, _artH
uniform vec2 uPlayerPx;   // player screen centre (top-left origin)
uniform float uSpotInner; // px: fully clear at/inside this radius
uniform float uSpotOuter; // px: fully solid building at/outside this radius
out vec4 outColor;
void main() {
  vec2 frag = vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y); // → top-left origin
  float hole = smoothstep(uSpotInner, uSpotOuter, distance(frag, uPlayerPx)); // 0 at player → 1 out
  outColor = texture(uTex, vUV) * hole; // premultiplied: fades colour AND alpha together
}`;

// Building-depth pass: write a building silhouette into the scene FBO's DEPTH buffer at a flat
// per-building depth (uDepthZ = the south baseline mapped to NDC z) so the player sprite can
// depth-test against it. The depth comes from the QUAD's gl_Position.z, NOT gl_FragDepth — Chrome
// on Windows (ANGLE/D3D) SILENTLY IGNORES fragment gl_FragDepth writes, which is why the depth
// pass produced no occlusion. One draw per near building; the frag only discards outside the
// silhouette (alpha mask). Colour is written only in debug (colourMask in JS).
var DEPTHWRITE_VERT_SRC = `#version 300 es
precision highp float;
in vec2 aUnit;
uniform vec2 uPos; uniform vec2 uSize; uniform vec2 uViewport; uniform float uDepthZ;
out vec2 vUV;
void main() {
  vec2 px = uPos + aUnit * uSize;
  vec2 clip = vec2(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, uDepthZ, 1.0); // geometry-z depth (works on ANGLE; gl_FragDepth does not)
  vUV = aUnit;
}`;
var DEPTHWRITE_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  if (texture(uTex, vUV).a < 0.5) discard; // outside the building silhouette → leave depth far
  outColor = vec4(0.6, 0.3, 0.3, 1.0);      // reaches colour only when colourMask is on (debug)
}`;

// Building COLOUR+DEPTH pass: same geometry-z depth as DEPTHWRITE, but writes the building's real
// premultiplied texel colour (colorMask on, blend on). One draw per near building, BEFORE the sprite
// batch → the player sprite depth-tests against each building per-pixel (no behind/front flip, no pop).
var COLORDEPTH_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  vec4 texel = texture(uTex, vUV);
  if (texel.a < 0.5) discard;   // outside the building silhouette → leave depth far
  outColor = texel;             // premultiplied colour (uploaded with UNPACK_PREMULTIPLY_ALPHA)
}`;

// GPU Wang-tile terrain: index-map sampler. Each 64×64 RGBA8 texel stores two 12-bit
// atlas slot indices (base + transition) encoded by gpu-terrain-index.js::encodeTexel.
// This phase decodes only baseSlot, looks up its (u0,v0) in the RG32F slot-UV table,
// then samples the atlas at (u0 + frac * 31/atlasSize) where 31 texels = the tile
// without its 1-px gutter. vUV (0..1) comes from the shared VERT_SRC vertex shader.
var TILEMAP_FRAG_SRC = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUV;
uniform sampler2D uIndex;    // 64x64 RGBA8 index map
uniform sampler2D uAtlas;    // wang tile atlas
uniform sampler2D uSlotUV;   // RG32F, width=uSlotUVW, height 1: texel[slot] = (u0,v0)
uniform int   uSlotUVW;
uniform float uAtlasSize;
out vec4 outColor;
const float CHUNK = 64.0;
void main() {
  vec2 t = vUV * CHUNK;            // tile space
  ivec2 cell = ivec2(clamp(floor(t), 0.0, CHUNK - 1.0));
  vec2 frac = fract(t);
  vec4 texel = texelFetch(uIndex, cell, 0);   // RGBA8 in 0..1
  int R = int(texel.r * 255.0 + 0.5);
  int G = int(texel.g * 255.0 + 0.5);
  int B = int(texel.b * 255.0 + 0.5);
  int baseSlot = R | ((G & 15) << 8);
  if (baseSlot == 0) { outColor = vec4(0.0); return; }   // empty cell
  int s = baseSlot; if (s >= uSlotUVW) s = 0;
  vec2 uv0 = texelFetch(uSlotUV, ivec2(s, 0), 0).rg;     // tile origin (half-texel inset baked in)
  // tile spans 31 texels (matches WangAtlas du = (32-1)/atlasSize)
  vec2 atlasUv = uv0 + frac * (31.0 / uAtlasSize);
  vec4 col = texture(uAtlas, atlasUv);                    // base wang tile (premultiplied)
  // Cliff overlay — a SECOND atlas tile drawn over the base, exactly as the bitmap
  // path layers paintCliffOverlay on top of paintWangBase. The (formerly unused)
  // transitionSlot field carries the cliff slot; 0 = no cliff face here.
  int cliffSlot = B | (((G >> 4) & 15) << 8);
  if (cliffSlot != 0 && cliffSlot < uSlotUVW) {
    vec2 cuv0 = texelFetch(uSlotUV, ivec2(cliffSlot, 0), 0).rg;
    vec4 cliff = texture(uAtlas, cuv0 + frac * (31.0 / uAtlasSize));
    col = cliff + col * (1.0 - cliff.a);                  // premultiplied "over"
  }
  outColor = col;
}`;

// --- Stage 2: instanced sprite pipeline (F2 small flora) ---
// Sprites live in a runtime shelf-packed atlas. Each instance replicates the
// 2D path's pivot math: translate(sx, sy + halfDraw); rotate(a); drawImage at
// (-halfDraw, -drawSize) — i.e. pivot at bottom-center of the quad.
var SPRITE_VERT_SRC = `#version 300 es
precision highp float;
in vec2 aUnit;     // unit quad corner (0..1)
in vec4 aPSR;      // pivot.xy (world TILE units), size (tiles), rotation (rad)
in float aAlpha;
in vec4 aUV;       // u0, v0, du, dv
uniform vec2 uViewport;
uniform vec3 uCam; // x,y = screen-px offset, z = px per tile (tilePxSnapped)
uniform float uDepthOn;    // 0 = legacy (z=0); 1 = depth from baseline (building↔player occlusion)
uniform float uDepthRef;   // reference tile Y (screen centre) — must match the building-depth pass
uniform float uDepthScale; // tiles→depth slope (must match building-depth.js DEPTH_SCALE)
out vec2 vUV;
out float vAlpha;
out vec2 vLocal;
void main() {
  float sizePx = aPSR.z * uCam.z;
  vec2 pivotPx = aPSR.xy * uCam.z + uCam.xy;
  vec2 local = vec2(aUnit.x * sizePx - sizePx * 0.5, aUnit.y * sizePx - sizePx);
  float c = cos(aPSR.w);
  float s = sin(aPSR.w);
  vec2 px = pivotPx + vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 clip = vec2(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0);
  // Depth from the sprite's BASELINE (aPSR.y, world tiles): larger Y = more south = nearer =
  // smaller depth. NDC z = 2d-1 → gl_FragDepth = d, matching the building-depth pass exactly.
  float z = 0.0;
  if (uDepthOn > 0.5) {
    float d = clamp(0.5 - (aPSR.y - uDepthRef) * uDepthScale, 0.0, 1.0);
    z = d * 2.0 - 1.0;
  }
  gl_Position = vec4(clip, z, 1.0);
  vUV = aUV.xy + aUnit * aUV.zw;
  vAlpha = aAlpha;
  vLocal = aUnit; // 0..1 over the quad (y: 1=feet, 0=head) — for the see-through soft falloff
}`;

var SPRITE_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUV;
in float vAlpha;
in vec2 vLocal;
uniform sampler2D uAtlas;
uniform float uSeeThrough; // >0 = the occluded "ghost" reveal: strength, faded torso→edges
out vec4 outColor;
void main() {
  vec4 c = texture(uAtlas, vUV) * vAlpha; // premultiplied alpha
  if (uSeeThrough > 0.001) {
    float r = distance(vLocal, vec2(0.5, 0.58));
    c *= uSeeThrough * (1.0 - smoothstep(0.30, 0.66, r)); // semi-transparent "you're behind this"
  }
  outColor = c;
}`;

// Silhouette shadows: same instance data as sprites, but the quad is sheared
// along the sun direction and flattened onto the ground. The fragment shader
// keeps only the sprite's alpha as a dark, tip-faded silhouette.
var SHADOW_VERT_SRC = `#version 300 es
precision highp float;
in vec2 aUnit;
in vec4 aPSR;      // pivot.xy (world tiles), size (tiles), w = diffusion
in float aAlpha;   // sprite alpha * per-biome shadow strength
in vec4 aUV;
uniform vec2 uViewport;
uniform vec3 uCam;        // x,y = screen-px offset, z = px per tile
uniform vec2 uShadowVec;
out vec2 vUV;
out float vAlpha;
out float vH;
out float vDiff;
void main() {
  float sizePx = aPSR.z * uCam.z;
  vec2 pivotPx = aPSR.xy * uCam.z + uCam.xy;
  float hgt = 1.0 - aUnit.y;
  float diff = aPSR.w;
  float shadowLen = length(uShadowVec);
  float flatK = clamp(1.0 - shadowLen / 2.5, 0.0, 1.0);
  float vert = mix(0.85, 0.40, flatK);
  float wide = 1.0 + diff * 0.45;
  vec2 base = vec2((aUnit.x - 0.5) * sizePx * wide, hgt * sizePx * vert);
  vec2 px = pivotPx + base + hgt * sizePx * uShadowVec;
  vec2 clip = vec2(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vUV = aUV.xy + aUnit * aUV.zw;
  vAlpha = aAlpha;
  vH = hgt;
  vDiff = diff;
}`;

var SHADOW_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUV;
in float vAlpha;
in float vH;
in float vDiff;
uniform sampler2D uAtlas;
uniform float uShadowAlpha; // global strength (sun-height driven)
uniform float uAtlasTexel;  // 1 / atlas size
uniform sampler2D uBuildingHeightMask;
uniform vec2 uHMViewport;   // the draw's viewport in px (FBO _artW/_artH if sceneActive, else css)
uniform vec2 uHMDims;       // mask.w, mask.h (CSS px the grid covers)
uniform vec4 uHMGrid;       // x=cell(8) y=cols z=rows w=on(>0.5)
out vec4 outColor;
void main() {
  // 3-tap diagonal blur of atlas alpha (was 5-tap) — radius scaled by per-instance
  // diffusion. Two opposite diagonal taps cover both axes at 40% fewer fetches;
  // shadows are soft dark blobs so the look is indistinguishable in motion.
  float r = vDiff * 1.6 * uAtlasTexel;
  float sa = texture(uAtlas, vUV).a * 0.50
           + (texture(uAtlas, vUV + vec2(r, r)).a
            + texture(uAtlas, vUV - vec2(r, r)).a) * 0.25;
  // crisp large silhouettes keep a mild edge; diffuse flora stays soft
  float crisp = smoothstep(0.25, 0.75, sa);
  sa = mix(crisp, sa, clamp(vDiff * 2.0, 0.0, 1.0));
  if (uHMGrid.w > 0.5) {
    vec2 fragScreen = vec2(gl_FragCoord.x, uHMViewport.y - gl_FragCoord.y);  // bottom-left -> top-left
    vec2 screenPx   = fragScreen * (uHMDims / uHMViewport);                  // FBO texels -> CSS screen px
    vec2 cell       = floor(screenPx / uHMGrid.x);
    vec2 uv         = (cell + 0.5) / vec2(uHMGrid.y, uHMGrid.z);
    if (texture(uBuildingHeightMask, uv).r * 255.0 > 0.5) discard;          // any building (>=1 storey) beats ground-level grass
  }
  float a = sa * vAlpha * uShadowAlpha * (1.0 - vH * 0.55);
  outColor = vec4(vec3(0.035, 0.045, 0.085) * a, a); // premultiplied dark blue-black
}`;

// Floats per sprite instance: pivotX, pivotY, size, rot, alpha, u0, v0, du, dv
export var SPRITE_FLOATS = 9;
var SPRITE_STRIDE = SPRITE_FLOATS * 4;

// === GPU-driven flora ("anim sprite") ===
// A STATIC per-instance buffer (uploaded once per pool rebuild; a sprite's slot is
// re-patched only at 10Hz when a wind gust triggers it). The vertex shader derives
// the current animation frame, the sway rotation and the fade-in alpha from a uTime
// uniform — so the per-frame CPU cost (the ~85ms resolve loop) disappears entirely.
// Frames are packed as a contiguous horizontal STRIP in the atlas, so frame i lives
// at u0 + i*frameStride and the shader needs no per-frame lookup.
// Layout (5 vec4 = 20 floats):
//   a0 pivotX, pivotY, size(tiles), baseAngle
//   a1 baseU0, v0, frameStride, sampleDu
//   a2 frameCount, restFrame, loopCount, triggerTime(ms; <=-99998 = never)
//   a3 spawnTime(ms; <=0 = no fade), lifeSway, tileRot, edgeFade
//   a4 sampleDv, biomeShadow, diffusion(=1-tier), rigid(>0.5 = no sway)
export var ANIM_SPRITE_FLOATS = 20;
var ANIM_SPRITE_STRIDE = ANIM_SPRITE_FLOATS * 4;
var ANIM_FRAME_DUR = 120; // ms per anim frame — MUST match field2-animator FRAME_DURATION

// Shared GLSL: derive frameIdx + animBlend from uTime — a direct port of the CPU
// resolve (field2-animator _poolFrame). uFrameDur = FRAME_DURATION (ms/frame).
var ANIM_FRAME_GLSL = `
float animFrame(vec4 a2, float uTime, float uFrameDur, out float animBlend) {
  animBlend = 0.0;
  float frameCount = a2.x, restFrame = a2.y, loopCount = a2.z, triggerTime = a2.w;
  if (triggerTime <= -99998.0) return restFrame;          // never gusted -> rest
  float blCycle = frameCount * uFrameDur;
  float elapsed = uTime - triggerTime;
  float dur = blCycle * loopCount;
  if (elapsed >= 0.0 && elapsed <= dur) {
    float cp = elapsed / blCycle;
    animBlend = (cp < 1.0) ? min(1.0, cp * 2.0)
              : (cp > loopCount - 1.0) ? max(0.0, (loopCount - cp) * 2.0)
              : 1.0;
    return floor(mod(elapsed / uFrameDur + restFrame, frameCount));
  }
  if (elapsed > dur) return floor(mod(dur / uFrameDur + restFrame, frameCount)); // freeze on end
  return restFrame;                                        // startDelay (elapsed < 0)
}`;

var ANIM_SPRITE_VERT_SRC = `#version 300 es
precision highp float;
in vec2 aUnit;
in vec4 a0; in vec4 a1; in vec4 a2; in vec4 a3; in vec4 a4;
uniform vec2 uViewport;
uniform vec3 uCam;       // x,y = screen-px offset, z = px per tile
uniform float uTime;     // ms
uniform float uFrameDur; // ms per anim frame
uniform float uDepthOn;    // 0 = z=0 (legacy, draws over everything); 1 = depth-from-baseline so flora is OCCLUDED behind buildings
uniform float uDepthRef;   // reference tile Y (screen centre) — must match the building-depth pass
uniform float uDepthScale; // tiles→depth slope (must match building-depth.js DEPTH_SCALE)
out vec2 vUV;
out float vAlpha;
out vec2 vLocal; // must match SPRITE_FRAG_SRC (shared frag) or the anim program fails to link
${ANIM_FRAME_GLSL}
void main() {
  float animBlend;
  float frameIdx = animFrame(a2, uTime, uFrameDur, animBlend);
  float sway = (a4.w > 0.5) ? 0.0 : (a3.z * 1.2 * animBlend * a3.y); // tileRot*1.2*blend*lifeSway
  float rot = a0.w + sway;
  float sizePx = a0.z * uCam.z;
  vec2 pivotPx = a0.xy * uCam.z + uCam.xy;
  vec2 local = vec2(aUnit.x * sizePx - sizePx * 0.5, aUnit.y * sizePx - sizePx);
  float c = cos(rot), s = sin(rot);
  vec2 px = pivotPx + vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  // Depth from the sprite's BASELINE (a0.y, world tiles): larger Y = more south = nearer = smaller depth.
  // NDC z = 2d-1, matching the building-depth pass + drawPoolSprites exactly so flora occludes correctly.
  float z = 0.0;
  if (uDepthOn > 0.5) {
    float d = clamp(0.5 - (a0.y - uDepthRef) * uDepthScale, 0.0, 1.0);
    z = d * 2.0 - 1.0;
  }
  gl_Position = vec4(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0, z, 1.0);
  vec2 uv0 = vec2(a1.x + frameIdx * a1.z, a1.y);
  vUV = uv0 + aUnit * vec2(a1.w, a4.x);
  float fade = (a3.x > 0.0) ? clamp((uTime - a3.x) / 400.0, 0.0, 1.0) : 1.0;
  vAlpha = a3.w * fade;
  vLocal = aUnit;
}`;

var ANIM_SHADOW_VERT_SRC = `#version 300 es
precision highp float;
in vec2 aUnit;
in vec4 a0; in vec4 a1; in vec4 a2; in vec4 a3; in vec4 a4;
uniform vec2 uViewport;
uniform vec3 uCam;
uniform float uTime;
uniform float uFrameDur;
uniform vec2 uShadowVec;
out vec2 vUV;
out float vAlpha;
out float vH;
out float vDiff;
${ANIM_FRAME_GLSL}
void main() {
  float animBlend;
  float frameIdx = animFrame(a2, uTime, uFrameDur, animBlend);
  float sizePx = a0.z * uCam.z;
  vec2 pivotPx = a0.xy * uCam.z + uCam.xy;
  float hgt = 1.0 - aUnit.y;
  float diff = a4.z;
  float shadowLen = length(uShadowVec);
  float flatK = clamp(1.0 - shadowLen / 2.5, 0.0, 1.0);
  float vert = mix(0.85, 0.40, flatK);
  float wide = 1.0 + diff * 0.45;
  vec2 base = vec2((aUnit.x - 0.5) * sizePx * wide, hgt * sizePx * vert);
  vec2 px = pivotPx + base + hgt * sizePx * uShadowVec;
  gl_Position = vec4(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0, 0.0, 1.0);
  vec2 uv0 = vec2(a1.x + frameIdx * a1.z, a1.y);
  vUV = uv0 + aUnit * vec2(a1.w, a4.x);
  float fade = (a3.x > 0.0) ? clamp((uTime - a3.x) / 400.0, 0.0, 1.0) : 1.0;
  float spriteAlpha = a3.w * fade;
  vAlpha = spriteAlpha * a4.y * (0.30 + 0.70 * (1.0 - diff)); // a4.y=biomeShadow, tier=1-diff
  vH = hgt;
  vDiff = diff;
}`;

// --- Stage 3: 1:1 art-res scene framebuffer + sharp-bilinear present ---
// The whole GL scene (terrain + sprites) renders at art resolution (one
// texel per art pixel) into an offscreen framebuffer, snapped to integer
// art pixels. The present pass upscales to the canvas with "sharp bilinear"
// sampling: pixels stay fat and crisp, but pixel EDGES get exactly one
// screen-pixel of bilinear smoothing — uniform pixel sizes at any zoom, and
// smooth sub-pixel camera scroll via the fractional offset uniform.
var PRESENT_VERT_SRC = `#version 300 es
precision highp float;
in vec2 aUnit;
out vec2 vTL; // unit coords, top-left origin
void main() {
  gl_Position = vec4(aUnit.x * 2.0 - 1.0, 1.0 - aUnit.y * 2.0, 0.0, 1.0);
  vTL = aUnit;
}`;

var PRESENT_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vTL;
uniform sampler2D uScene;
uniform vec4 uArt;    // artW, artH, allocW, allocH (texels)
uniform vec2 uView;   // visible art px (cssW/zoom, cssH/zoom)
uniform vec2 uOff;    // fractional camera offset, art px
uniform float uSharp; // DEVICE px per art px (zoom * devicePixelRatio)
// Stage 4: per-tile water wave field, soft-light blended over the scene.
// One texel per world tile; 0.5 = neutral (non-water tiles stay untouched).
uniform sampler2D uWave;
uniform float uWaveOn;
uniform vec2 uWaveOrg; // art px from view texel space to wave field origin
uniform vec2 uWaveN;   // wave field size, tiles
uniform float uTilePx; // art px per tile
uniform float uCrt;    // 0 = off, 1 = subtle CRT (scanlines + aperture grille)
uniform float uCrtK;   // zoom / 1.84 — keeps scanline device-px pitch constant
// Atmosphere pass: per-tile biome grading fields (same addressing as uWave)
uniform sampler2D uAtmoA;  // hue, sat, con, bri
uniform sampler2D uAtmoB;  // warm, fog, shadow, night-floor
uniform sampler2D uAtmoC;  // mood one-hot weights (filmic/painterly/muted/chiaroscuro)
uniform float uAtmoOn;
uniform vec2 uAtmoOrg;     // art-px offset, view texel space -> field origin
uniform vec2 uAtmoN;       // field size, tiles
uniform float uAmbient;    // phase ambient 0..1
uniform vec3 uPhaseTint;   // phase tint (≈1.0 neutral)
uniform vec3 uFogColor;    // phase fog color 0..1
uniform float uSunAzim;    // sun angle: 0=east, pi/2=overhead, pi=west
uniform float uSunHeight;  // 0..1
uniform float uTimeSec;
uniform float uCloudCover; // 0..1
uniform vec2 uCloudOff;    // accumulated cloud drift, world art px
uniform vec2 uWorldOrg;    // world art-px of view texel origin (camXi, camYi)
uniform vec2 uPlayerPos;   // world art-px of player feet
uniform float uPlayerLight; // visibility radius scale, ~1.0
out vec4 outColor;

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c2 = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, u.x), mix(c2, d, u.x), u.y);
}
vec3 blendOverlay(vec3 b, vec3 s) {
  return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(vec3(0.5), b));
}
vec3 blendScreen(vec3 b, vec3 s) { return 1.0 - (1.0 - b) * (1.0 - s); }
vec3 blendSoft(vec3 b, vec3 s) {
  vec3 d = mix(((16.0 * b - 12.0) * b + 4.0) * b, sqrt(b), step(vec3(0.25), b));
  return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(vec3(0.5), s));
}
vec3 satAdj(vec3 c, float s) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return mix(vec3(l), c, s);
}
vec3 hueRot(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float cs = cos(a), sn = sin(a);
  return c * cs + cross(k, c) * sn + k * dot(k, c) * (1.0 - cs);
}
vec4 atmoSample(sampler2D t, vec2 uv, vec2 bs) {
  // center + 4-tap cross blur — widens the biome blend band beyond bilinear
  return texture(t, uv) * 0.4
       + (texture(t, uv + vec2(bs.x, 0.0)) + texture(t, uv - vec2(bs.x, 0.0))
        + texture(t, uv + vec2(0.0, bs.y)) + texture(t, uv - vec2(0.0, bs.y))) * 0.15;
}

void main() {
  vec2 texel = vTL * uView + uOff;            // art px, top-left origin
  // Sharp bilinear: sample pinned to the texel CENTER across the texel's
  // interior (crisp plateau), with a sub-pixel blend band at each edge.
  // uSharp includes an 8× boost so the blend band is ~0.125 device px —
  // visually identical to nearest-neighbour while preserving smooth sub-pixel
  // camera scrolling via the fractional offset.
  vec2 ip = floor(texel);
  vec2 cd = texel - ip - 0.5;                 // distance from texel center
  vec2 rr = vec2(max(0.0, 0.5 - 0.5 / uSharp)); // crisp half-width
  vec2 p = ip + 0.5 + (cd - clamp(cd, -rr, rr)) * uSharp;
  vec2 uv = vec2(p.x / uArt.z, (uArt.y - p.y) / uArt.w);
  vec3 c = texture(uScene, uv).rgb;
  if (uWaveOn > 0.5) {
    vec2 wuv = ((texel + uWaveOrg) / uTilePx) / uWaveN;
    float s = texture(uWave, wuv).r;
    // W3C soft-light blend, single gray source channel
    vec3 d = mix(((16.0 * c - 12.0) * c + 4.0) * c, sqrt(c), step(vec3(0.25), c));
    vec3 b = (s <= 0.5)
      ? c - (1.0 - 2.0 * s) * c * (1.0 - c)
      : c + (2.0 * s - 1.0) * (d - c);
    c = mix(c, b, 0.85);
    // Sun glints: wave crests catch the sun's color. Strongest at low sun
    // (golden path of sparkle), aligned to the sun's side of the screen.
    if (uAtmoOn > 0.5 && uSunHeight > 0.02) {
      float crest = smoothstep(0.62, 0.85, s);
      float lowSun2 = 1.0 - smoothstep(0.10, 0.60, uSunHeight);
      float sunSide = 1.0 - abs(vTL.x - (0.5 + cos(uSunAzim) * 0.45));
      float glint = crest * (0.10 + lowSun2 * 0.55) * clamp(sunSide, 0.2, 1.0);
      c += uPhaseTint * glint;
    }
  }
  if (uAtmoOn > 0.5) {
    vec2 auv = ((texel + uAtmoOrg) / uTilePx) / uAtmoN;
    vec2 bs = vec2(8.0) / uAtmoN;            // ±8-tile blur taps → ~24-tile blend band
    vec4 A = atmoSample(uAtmoA, auv, bs);
    vec4 B = atmoSample(uAtmoB, auv, bs);
    vec4 M = atmoSample(uAtmoC, auv, bs);
    float hue = (A.r * 120.0 - 60.0) * 0.017453;
    float sat = A.g * 2.0;
    float con = A.b * 2.0;
    float bri = A.a * 2.0;
    float warm = B.r;
    float fogD = B.g;
    float nightF = B.a;
    float msum = max(0.001, M.r + M.g + M.b + M.a);
    vec4 mw = M / msum;                       // mood weights, sum 1

    // mood base curves (from tuner CSS filters):
    // filmic contrast(1.12) | painterly saturate(1.15) | muted sat(.82) con(1.08) | chiaroscuro con(1.28)
    float mCon = mw.x * 1.12 + mw.y * 1.00 + mw.z * 1.08 + mw.w * 1.28;
    float mSat = mw.x * 1.00 + mw.y * 1.15 + mw.z * 0.82 + mw.w * 1.18;
    c = satAdj(c, sat * mSat);
    c = clamp(hueRot(c, hue), 0.0, 1.0);
    c = (c - 0.5) * (con * mCon) + 0.5;
    c = clamp(c * bri, 0.0, 1.0);

    // mood overlays — screen-space gradients matching the tuner previews,
    // scaled by warmth and gated to daylight (sun up) like golden light is
    float dayGate = smoothstep(0.0, 0.15, uSunHeight);
    float gd = clamp(vTL.x * 0.5 + vTL.y * 0.5, 0.0, 1.0);  // 160° diagonal
    float wA = warm * 0.55 * dayGate;
    vec3 filmCol = mix(vec3(1.0, 0.63, 0.24), vec3(0.0, 0.24, 0.31), gd);
    c = mix(c, blendOverlay(c, filmCol), mix(wA, wA * 0.6, gd) * mw.x);
    float rad = clamp(length(vTL - vec2(0.2, 0.0)), 0.0, 1.0);
    vec3 paintCol = mix(vec3(1.0, 0.82, 0.35), vec3(0.47, 0.31, 0.55), rad);
    c = mix(c, blendScreen(c, paintCol), clamp(mix(wA * 1.6, 0.10 * dayGate, rad), 0.0, 0.85) * mw.y);
    vec3 muteCol = mix(vec3(0.71, 0.51, 0.31), vec3(0.24, 0.27, 0.43), vTL.y);
    c = mix(c, blendSoft(c, muteCol), (wA * 0.66 + 0.10) * mw.z);
    vec3 chiCol = mix(vec3(1.0, 0.55, 0.12), vec3(0.06, 0.04, 0.16), gd);
    c = mix(c, blendOverlay(c, chiCol), clamp(mix(wA * 1.4, wA * 1.65 + 0.10, gd), 0.0, 0.85) * mw.w);
    float vig = smoothstep(0.55, 1.0, length(vTL - 0.5) * 1.6);
    c *= 1.0 - vig * (0.32 * mw.z + 0.30 * mw.w);

    // cloud shadows: 2-octave world-space noise drifting with the wind
    vec2 wp = (texel + uWorldOrg + uCloudOff) * 0.004;
    float cl = vnoise(wp) * 0.65 + vnoise(wp * 2.7 + 13.1) * 0.35;
    float cmask = smoothstep(0.55, 0.80, cl) * uCloudCover * uSunHeight;
    c *= 1.0 - cmask * 0.18;

    // phase tint (replaces the 2D tint fillRect)
    c = clamp(c * uPhaseTint, 0.0, 1.0);

    // day/night brightness with per-biome night floor (the "too dark" fix).
    // The floor lifts toward a luminance-NORMALIZED moonlit version of the
    // scene: dark-albedo biomes (deep ocean) have bases far too dark for a
    // multiplicative floor to ever keep them readable at night.
    float nightAmt = 1.0 - smoothstep(0.10, 0.55, uAmbient);
    vec3 nightShift = vec3(0.62, 0.70, 1.10);
    vec3 dark = c * max(uAmbient, 0.10) * nightShift;
    float lum0 = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 moonlit = min(c * (0.25 / max(lum0, 0.05)), vec3(1.0)) * nightShift;
    dark = mix(dark, moonlit, nightF);
    // player visibility pool: the night stays dark, but a warm readable
    // circle follows the player (torch-like falloff, ~3 tiles core, ~7 fade)
    float pdist = length((texel + uWorldOrg) - uPlayerPos);
    float pvis = (1.0 - smoothstep(uTilePx * 2.5, uTilePx * 7.0, pdist)) * uPlayerLight;
    float nightLocal = nightAmt * (1.0 - pvis * 0.85);
    c = mix(c, dark, nightLocal);
    c += vec3(0.85, 0.55, 0.22) * pvis * nightAmt * 0.13;   // faint warm torch tint, only at night

    // god rays: soft patchy light shafts, present most of the day, fading
    // near high noon, strongest at low sun. Never visible parallel lines.
    float rayAmt = (1.0 - smoothstep(0.30, 0.95, uSunHeight)) * step(0.02, uSunHeight);
    float rayStr = rayAmt * (0.25 + fogD * 0.75) * 0.14;
    if (rayStr > 0.004) {
      vec2 rd = normalize(vec2(cos(uSunAzim), 0.55));
      float band = dot(vTL, rd) * 3.5 + uTimeSec * 0.05;
      float n = vnoise(vec2(band, band * 0.13)) * 0.6
              + vnoise(vec2(band * 2.3 + 7.0, band * 0.31)) * 0.4;
      float shafts = smoothstep(0.30, 1.05, n);
      // large-scale screen mask: shafts are patchy, not wall-to-wall
      float pmask = smoothstep(0.25, 0.80, vnoise(vTL * 2.1 + vec2(uTimeSec * 0.02, 3.7)));
      vec3 sunCol = mix(uPhaseTint, vec3(1.0, 0.85, 0.55), 0.6);
      c += sunCol * shafts * pmask * rayStr * (1.0 - vig * 0.5);
    }

    // fog: per-biome density, phase-colored, breathing noise, edge-biased
    float fn = vnoise((texel + uWorldOrg) * 0.012 + vec2(uTimeSec * 0.015, -uTimeSec * 0.010));
    float fedge = smoothstep(0.25, 0.95, length(vTL - 0.5) * 1.45);
    float fogA = clamp(fogD * (0.30 + 0.45 * fedge + 0.25 * fn), 0.0, 0.8);
    c = mix(c, uFogColor, fogA * 0.55);
    c = clamp(c, 0.0, 1.0);
  }
  if (uCrt > 0.5) {
    // Subtle CRT: gentle scanlines aligned to art rows (darkest at row
    // boundaries) + a faint aperture-grille RGB tint per device-pixel
    // triad, brightness-compensated so the image doesn't dim.
    float scan = 1.0 - 0.22 * (0.5 + 0.5 * cos(6.28318 * texel.y * uCrtK));
    float gx = mod(gl_FragCoord.x, 3.0);
    vec3 grille = gx < 1.0 ? vec3(1.06, 0.94, 0.94)
                : gx < 2.0 ? vec3(0.94, 1.06, 0.94)
                           : vec3(0.94, 0.94, 1.06);
    c = clamp(c * scan * grille * 1.13, 0.0, 1.0);
  }
  outColor = vec4(c, 1.0);
}`;

// Evict chunk textures not drawn for this many frames. Tightened from 600/256: the old ~14s
// retention (600 frames + a sweep only every 256) let rapid biome teleports pile up 300-500MB of
// stale chunk VRAM before anything freed -> 3-4fps. The discontinuity purge (purgeOffscreen, fired
// on every far teleport) is the real fix for teleports; these are the gradual-walking backstop.
var EVICT_AFTER_FRAMES = 240;
var SWEEP_INTERVAL = 120;
// Max NEW chunk-bitmap texImage2D uploads per frame. Spreads the boundary-crossing
// burst (up to ~6 workers finishing at once) across frames to kill walk stutter.
var CHUNK_UPLOAD_BUDGET = 2;
// Max NEW sprite atlas packs (texSubImage2D) per frame. Walking 4 tiles rebuilds the
// F2 pool and pulls a whole strip of new tiles (~200+ sprites) that all pack at once
// — a per-rebuild stutter. Over-budget sprites return null and the pool's `pending`
// list retries them next frame, so they fill in over a few frames instead of stalling.
var SPRITE_PACK_BUDGET = 32;

function parseColor(css) {
  // Supports '#rgb', '#rrggbb', 'rgb(...)' / 'rgba(...)'. Fallback: dark slate.
  if (typeof css === 'string') {
    if (css[0] === '#') {
      var hex = css.slice(1);
      if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      if (hex.length >= 6) {
        var n = parseInt(hex.slice(0, 6), 16);
        if (!isNaN(n)) return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
      }
    } else {
      var m = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (m) return [m[1] / 255, m[2] / 255, m[3] / 255];
    }
  }
  return [0.094, 0.149, 0.169]; // #18262b
}

export class GLCompositor {
  constructor() {
    this.ok = false;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'glTerrain';
    var gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      // false lets the driver swap (not copy) the backbuffer each frame. Nothing
      // reads this canvas back (no toDataURL/readPixels on #glTerrain; Playwright
      // screenshots composite the page), so preservation is pure per-frame cost.
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    });
    if (!gl) {
      console.warn('[GL] WebGL2 unavailable — staying on Canvas 2D terrain path');
      return;
    }
    this.gl = gl;
    this.textures = new Map(); // 'cx,cy' -> { tex, bmp, lastUsed }
    // Far teleport = discontinuity: free this biome's chunk/building textures + reset the sprite
    // atlas at once (purgeOffscreen), instead of waiting ~14s for the lastUsed sweep — that wait is
    // what let rapid teleports accumulate stale VRAM and collapse fps to 3-4.
    onSceneDiscontinuity((info) => this.purgeOffscreen(info));
    this.crt = true;      // subtle CRT scanlines + grille (C key toggles)
    this.frame = 0;
    this._lastSkyCss = null;
    this._skyRGB = [0, 0, 0];

    var program = this._buildProgram(VERT_SRC, FRAG_SRC);
    if (!program) return;
    this.program = program;
    this.uPos = gl.getUniformLocation(program, 'uPos');
    this.uSize = gl.getUniformLocation(program, 'uSize');
    this.uViewport = gl.getUniformLocation(program, 'uViewport');
    this.uTex = gl.getUniformLocation(program, 'uTex');

    // Static unit quad (triangle strip)
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.unitVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(program, 'aUnit');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.spritesOk = false;
    this._initSprites();

    gl.disable(gl.BLEND); // terrain chunks are opaque
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.ok = false;
      console.warn('[GL] context lost — falling back to Canvas 2D terrain');
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      console.warn('[GL] context restored — press G twice to re-enable');
    });

    this.ok = true;
    console.log('[GL] WebGL2 terrain compositor ready:', gl.getParameter(gl.VERSION));
    console.log('[GL] dpr:', window.devicePixelRatio, 'innerW:', window.innerWidth,
      'canvasW:', this.canvas.width, 'drawBufW:', gl.drawingBufferWidth,
      'cssW:', this.canvas.style.width);
  }

  _buildProgram(vsSrc, fsSrc) {
    var gl = this.gl;
    var vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSrc);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      console.error('[GL] vertex shader:', gl.getShaderInfoLog(vs));
      return null;
    }
    var fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSrc);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error('[GL] fragment shader:', gl.getShaderInfoLog(fs));
      return null;
    }
    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[GL] program link:', gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }

  resize(cssW, cssH, dpr) {
    if (!this.ok) return;
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
  }

  beginFrame(skyColorCss, cssW, cssH) {
    if (!this.ok) return;
    var gl = this.gl;
    this.sceneActive = false;
    if (skyColorCss !== this._lastSkyCss) {
      this._lastSkyCss = skyColorCss;
      this._skyRGB = parseColor(skyColorCss);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(this._skyRGB[0], this._skyRGB[1], this._skyRGB[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.uViewport, cssW, cssH);
    gl.uniform1i(this.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
  }

  // Stage 3: begin an art-resolution scene pass. All subsequent drawChunk /
  // drawSpriteInstances calls take ART-pixel coordinates (integer-snapped
  // camera). Returns false if the framebuffer path is unavailable — caller
  // should fall back to beginFrame() with CSS-px coordinates.
  beginScene(skyColorCss, artW, artH) {
    if (!this.ok || !this._ensureScene(artW, artH)) return false;
    var gl = this.gl;
    // Canvas = art resolution; CSS image-rendering:pixelated does the upscale.
    // This avoids GL-side upscaling that Chrome on Windows filters incorrectly.
    if (skyColorCss !== this._lastSkyCss) {
      this._lastSkyCss = skyColorCss;
      this._skyRGB = parseColor(skyColorCss);
    }
    this._artW = artW;
    this._artH = artH;
    this.sceneActive = true;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, artW, artH);
    gl.clearColor(this._skyRGB[0], this._skyRGB[1], this._skyRGB[2], 1);
    gl.clearDepth(1.0); // 1.0 = far; the building-depth pass writes nearer values where buildings are
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.uViewport, artW, artH);
    gl.uniform1i(this.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    return true;
  }

  _ensureScene(artW, artH) {
    if (this.sceneOk === false) return false; // failed once — don't retry
    var gl = this.gl;
    if (!this.presentProgram) {
      var prog = this._buildProgram(PRESENT_VERT_SRC, PRESENT_FRAG_SRC);
      if (!prog) { this.sceneOk = false; return false; }
      this.presentProgram = prog;
      this.pUScene = gl.getUniformLocation(prog, 'uScene');
      this.pUArt = gl.getUniformLocation(prog, 'uArt');
      this.pUView = gl.getUniformLocation(prog, 'uView');
      this.pUOff = gl.getUniformLocation(prog, 'uOff');
      this.pUSharp = gl.getUniformLocation(prog, 'uSharp');
      this.pUCrt = gl.getUniformLocation(prog, 'uCrt');
      this.pUCrtK = gl.getUniformLocation(prog, 'uCrtK');
      this.pUWave = gl.getUniformLocation(prog, 'uWave');
      this.pUWaveOn = gl.getUniformLocation(prog, 'uWaveOn');
      this.pUWaveOrg = gl.getUniformLocation(prog, 'uWaveOrg');
      this.pUWaveN = gl.getUniformLocation(prog, 'uWaveN');
      this.pUTilePx = gl.getUniformLocation(prog, 'uTilePx');
      this.pUAtmoA = gl.getUniformLocation(prog, 'uAtmoA');
      this.pUAtmoB = gl.getUniformLocation(prog, 'uAtmoB');
      this.pUAtmoC = gl.getUniformLocation(prog, 'uAtmoC');
      this.pUAtmoOn = gl.getUniformLocation(prog, 'uAtmoOn');
      this.pUAtmoOrg = gl.getUniformLocation(prog, 'uAtmoOrg');
      this.pUAtmoN = gl.getUniformLocation(prog, 'uAtmoN');
      this.pUAmbient = gl.getUniformLocation(prog, 'uAmbient');
      this.pUPhaseTint = gl.getUniformLocation(prog, 'uPhaseTint');
      this.pUFogColor = gl.getUniformLocation(prog, 'uFogColor');
      this.pUSunAzim = gl.getUniformLocation(prog, 'uSunAzim');
      this.pUSunHeight = gl.getUniformLocation(prog, 'uSunHeight');
      this.pUTimeSec = gl.getUniformLocation(prog, 'uTimeSec');
      this.pUCloudCover = gl.getUniformLocation(prog, 'uCloudCover');
      this.pUCloudOff = gl.getUniformLocation(prog, 'uCloudOff');
      this.pUWorldOrg = gl.getUniformLocation(prog, 'uWorldOrg');
      this.pUPlayerPos = gl.getUniformLocation(prog, 'uPlayerPos');
      this.pUPlayerLight = gl.getUniformLocation(prog, 'uPlayerLight');
      this.atmoTex = [];
      for (var ai = 0; ai < 3; ai++) {
        var t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.atmoTex.push(t);
      }
      this._atmoOn = false;
      this._atmoTW = 0;
      this._atmoTH = 0;
      this._atmoEnv = null;
      this.waveTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.waveTex);
      // LINEAR: smooth tile-to-tile shimmer gradients (the 2D path was blocky
      // per tile); CLAMP so the viewport edge holds the last tile's value.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this._waveOn = false;
      this._waveTW = 0;
      this._waveTH = 0;
      this.heightMaskTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.heightMaskTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);  // discrete 8px cells, binary occlusion — never blur storeys
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this._hmOn = false; this._hmTW = 0; this._hmTH = 0;
      this.presentVao = gl.createVertexArray();
      gl.bindVertexArray(this.presentVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.unitVbo);
      var loc = gl.getAttribLocation(prog, 'aUnit');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this.sceneTex = gl.createTexture();
      this.sceneFbo = gl.createFramebuffer();
      this.sceneDepthRb = gl.createRenderbuffer(); // depth buffer for GL-native player↔building occlusion
      this._sceneAllocW = 0;
      this._sceneAllocH = 0;
    }
    if (artW > this._sceneAllocW || artH > this._sceneAllocH) {
      // Round allocation up to 64-texel steps so zoom wobble doesn't realloc
      this._sceneAllocW = Math.max(this._sceneAllocW, Math.ceil(artW / 64) * 64);
      this._sceneAllocH = Math.max(this._sceneAllocH, Math.ceil(artH / 64) * 64);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this._sceneAllocW, this._sceneAllocH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      // LINEAR — the present pass samples 1:1 (no upscale) so filtering is
      // irrelevant; LINEAR is kept for the fractional-offset sub-pixel scroll.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex, 0);
      // Depth attachment, sized with the scene. INERT until the building-depth pass writes into it
      // and the player sprite depth-tests against it (GL-native building↔player occlusion). All
      // existing draws keep depth-test OFF, so adding this changes nothing on its own.
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.sceneDepthRb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, this._sceneAllocW, this._sceneAllocH);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.sceneDepthRb);
      var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.warn('[GL] scene framebuffer incomplete (status ' + status + ') — falling back to direct rendering');
        this.sceneOk = false;
        return false;
      }
      console.log('[GL] art-res scene framebuffer: ' + this._sceneAllocW + 'x' + this._sceneAllocH);
    }
    this.sceneOk = true;
    return true;
  }

  // Stage 4: upload this frame's per-tile wave field (RGBA, one texel/tile,
  // 128 = neutral). orgX/orgY = art-px offset from the view's texel space to
  // the field origin (camXi - tile0X*tileSize). tilePx = art px per tile.
  setWaveField(data, tilesW, tilesH, orgX, orgY, tilePx) {
    if (!this.ok || !this.waveTex) return;
    var gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.waveTex);
    if (tilesW !== this._waveTW || tilesH !== this._waveTH) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tilesW, tilesH, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      this._waveTW = tilesW;
      this._waveTH = tilesH;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tilesW, tilesH, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
    gl.activeTexture(gl.TEXTURE0);
    this._waveOn = true;
    this._waveOrgX = orgX;
    this._waveOrgY = orgY;
    this._waveTilePx = tilePx;
  }

  clearWaveField() {
    this._waveOn = false;
  }

  setHeightMask(mask) {
    if (!this.ok || !this.heightMaskTex || !mask || !mask.data) { this._hmOn = false; return; }
    var gl = this.gl;
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.heightMaskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);  // R8 rows are cols bytes wide
    if (mask.cols !== this._hmTW || mask.rows !== this._hmTH) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, mask.cols, mask.rows, 0, gl.RED, gl.UNSIGNED_BYTE, mask.data);
      this._hmTW = mask.cols; this._hmTH = mask.rows;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, mask.cols, mask.rows, gl.RED, gl.UNSIGNED_BYTE, mask.data);
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.activeTexture(gl.TEXTURE0);
    this._hmOn = true;
    this._hmW = mask.w; this._hmH = mask.h; this._hmCols = mask.cols; this._hmRows = mask.rows; this._hmCell = mask.cell;
  }
  clearHeightMask() { this._hmOn = false; }

  // Atmosphere field: three per-tile RGBA layers (see atmosphere-pass.js).
  // Same origin convention as setWaveField.
  setAtmoField(field, tilesW, tilesH, orgX, orgY, tilePx) {
    if (!this.ok || !this.atmoTex) return;
    var gl = this.gl;
    var bufs = [field.a, field.b, field.c];
    for (var i = 0; i < 3; i++) {
      gl.activeTexture(gl.TEXTURE2 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.atmoTex[i]);
      if (tilesW !== this._atmoTW || tilesH !== this._atmoTH) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tilesW, tilesH, 0, gl.RGBA, gl.UNSIGNED_BYTE, bufs[i]);
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tilesW, tilesH, gl.RGBA, gl.UNSIGNED_BYTE, bufs[i]);
      }
    }
    this._atmoTW = tilesW;
    this._atmoTH = tilesH;
    gl.activeTexture(gl.TEXTURE0);
    this._atmoOn = true;
    this._atmoOrgX = orgX;
    this._atmoOrgY = orgY;
    if (tilePx) this._atmoTilePx = tilePx;
  }

  // Per-frame scalar atmosphere environment (sun/weather/time).
  setAtmoEnv(env) {
    this._atmoEnv = env;
  }

  clearAtmoField() {
    this._atmoOn = false;
  }

  // Present the art-res scene with atmosphere/CRT post-processing.
  presentScene(cssW, cssH, zoom, fracX, fracY) {
    if (!this.ok || !this.sceneActive) return;
    var gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.presentProgram);
    gl.bindVertexArray(this.presentVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.uniform1i(this.pUScene, 0);
    // Full-resolution FBO: texel space = CSS pixels. uView maps vTL to CSS px.
    // uArt: x,y = FBO content size (CSS px), z,w = alloc size (texels = CSS px).
    gl.uniform4f(this.pUArt, this._artW, this._artH, this._sceneAllocW, this._sceneAllocH);
    gl.uniform2f(this.pUView, cssW, cssH);
    gl.uniform2f(this.pUOff, 0, 0); // no sub-pixel offset at full resolution
    gl.uniform1f(this.pUSharp, 100); // 1:1, no upscale — pin to texel center
    gl.uniform1f(this.pUCrt, this.crt ? 1 : 0);
    // CRT scanlines: texel is in CSS px; one art row = zoom CSS px.
    // Period = 1.84 art rows = 1.84*zoom CSS px → uCrtK = 1/(1.84*zoom).
    gl.uniform1f(this.pUCrtK, 1 / (1.84 * zoom));
    if (this._waveOn) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.waveTex);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(this.pUWave, 1);
      gl.uniform1f(this.pUWaveOn, 1);
      gl.uniform2f(this.pUWaveOrg, this._waveOrgX, this._waveOrgY);
      gl.uniform2f(this.pUWaveN, this._waveTW, this._waveTH);
      gl.uniform1f(this.pUTilePx, this._waveTilePx);
    } else {
      gl.uniform1f(this.pUWaveOn, 0);
    }
    var env = this._atmoEnv;
    if (this._atmoOn && env) {
      for (var ai = 0; ai < 3; ai++) {
        gl.activeTexture(gl.TEXTURE2 + ai);
        gl.bindTexture(gl.TEXTURE_2D, this.atmoTex[ai]);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(this.pUAtmoA, 2);
      gl.uniform1i(this.pUAtmoB, 3);
      gl.uniform1i(this.pUAtmoC, 4);
      gl.uniform1f(this.pUAtmoOn, 1);
      // uTilePx is shared with the wave block; ensure it's set even when
      // no water is visible this frame (wave branch skipped).
      if (!this._waveOn) gl.uniform1f(this.pUTilePx, this._atmoTilePx || 16);
      gl.uniform2f(this.pUAtmoOrg, this._atmoOrgX, this._atmoOrgY);
      gl.uniform2f(this.pUAtmoN, this._atmoTW, this._atmoTH);
      gl.uniform1f(this.pUAmbient, env.ambient);
      gl.uniform3f(this.pUPhaseTint, env.tint[0], env.tint[1], env.tint[2]);
      gl.uniform3f(this.pUFogColor, env.fogColor[0], env.fogColor[1], env.fogColor[2]);
      gl.uniform1f(this.pUSunAzim, env.sunAzim);
      gl.uniform1f(this.pUSunHeight, env.sunHeight);
      gl.uniform1f(this.pUTimeSec, env.timeSec);
      gl.uniform1f(this.pUCloudCover, env.cloudCover);
      gl.uniform2f(this.pUCloudOff, env.cloudOffX, env.cloudOffY);
      gl.uniform2f(this.pUWorldOrg, env.worldOrgX, env.worldOrgY);
      gl.uniform2f(this.pUPlayerPos, env.playerX || 0, env.playerY || 0);
      gl.uniform1f(this.pUPlayerLight, env.playerLight !== undefined ? env.playerLight : 1);
    } else {
      gl.uniform1f(this.pUAtmoOn, 0);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    this.sceneActive = false;
  }

  // Upload (or reuse) the chunk bitmap as a texture and draw it as a quad.
  // Identity check on the bitmap reference handles chunk repaints: the
  // provider creates a NEW ImageBitmap on repaint, triggering re-upload.
  //
  // UPLOAD THROTTLE: each chunk bitmap is a large (~2048²) texImage2D. Crossing a
  // chunk boundary delivers a burst of new chunks (up to ~6 workers at once), and
  // uploading them all in one frame stalls it (measured: frames with uploads ~131ms
  // vs ~0 without) — the walk stutter. So cap NEW uploads per frame; over-budget
  // brand-new chunks draw one frame later (a barely-visible edge fill-in as you
  // walk into them), and over-budget repaints keep showing their existing texture.
  drawChunk(key, bitmap, sx, sy, dw, dh) {
    if (!this.ok) return;
    var gl = this.gl;
    // Reset the per-frame upload budget when the frame advances (same pattern as
    // the atlas reset below; avoids needing a hook in beginFrame/beginScene).
    if (this.frame !== this._uploadFrame) { this._uploadFrame = this.frame; this._uploadsThisFrame = 0; }
    var entry = this.textures.get(key);
    var needsUpload = !entry || entry.bmp !== bitmap;
    if (needsUpload && this._uploadsThisFrame >= CHUNK_UPLOAD_BUDGET) {
      // Over budget this frame — defer the upload to spread the burst.
      if (!entry) return;                 // brand-new chunk: draw it next frame instead
      gl.bindTexture(gl.TEXTURE_2D, entry.tex); // repaint: keep drawing the stale tex
      entry.lastUsed = this.frame;        // it IS still on-screen — don't let it get evicted
      // (entry.bmp left unchanged so needsUpload stays true → re-uploaded a later frame)
    } else if (needsUpload) {
      // Allocate each chunk's texture store ONCE, then upload pixels with texSubImage2D
      // (an in-place DMA). The old code re-specced the whole store with the DOM-source
      // texImage2D on EVERY upload (first stream-in AND every repaint); on ANGLE/D3D11 that
      // recreates the GPU texture resource + re-stages the full ~16.8MB image (measured
      // ~131ms/upload), and a burst of new chunks at a run-speed boundary crossing stacked
      // these into a ~851ms draw hitch. texSubImage2D into a pre-allocated store skips the
      // resource recreation. Visual result is identical (same pixelStorei state applies).
      var bw = bitmap.width, bh = bitmap.height;
      var tex;
      if (entry && entry.tex && entry.w === bw && entry.h === bh) {
        tex = entry.tex;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        entry.bmp = bitmap; entry.lastUsed = this.frame;
      } else {
        if (entry && entry.tex) gl.deleteTexture(entry.tex); // size changed (rare) — realloc
        tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, bw, bh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); // allocate store ONCE (no staging)
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        entry = { tex: tex, bmp: bitmap, w: bw, h: bh, lastUsed: this.frame };
        this.textures.set(key, entry);
      }
      this._uploadsThisFrame++;
    } else {
      gl.bindTexture(gl.TEXTURE_2D, entry.tex);
      entry.lastUsed = this.frame;
    }
    gl.uniform2f(this.uPos, sx, sy);
    gl.uniform2f(this.uSize, dw, dh);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Blit an RGBA overlay bitmap onto the SCENE framebuffer — call AFTER the sprite batch and
  // BEFORE presentScene, so the present pass lights / day-nights / CRTs it IDENTICALLY to the
  // baked chunks (used for GL-native building→player occlusion; see CLAUDE.md: everything goes
  // through GL). Reuses the chunk program + quad; uploads premultiplied + blends
  // ONE/ONE_MINUS_SRC_ALPHA (matching the sprite batch) so the bitmap's transparent areas and
  // its see-through hole composite over the scene. The bitmap is authored at art = CSS-px
  // resolution (artW = w), so it fills the whole scene FBO 1:1.
  drawSceneOverlayBitmap(bitmap) {
    if (!this.ok || !this.sceneActive || !bitmap) return;
    var gl = this.gl;
    // The sprite batch left its own program/VAO bound — rebind the chunk quad pipeline + FBO.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, this._artW, this._artH);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.uViewport, this._artW, this._artH);
    gl.uniform1i(this.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    if (!this._overlayTex) this._overlayTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._overlayTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha (same as sprites)
    gl.uniform2f(this.uPos, 0, 0);
    gl.uniform2f(this.uSize, this._artW, this._artH);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  // Like drawSceneOverlayBitmap, but blits the FRONT building bitmap with a GPU spotlight hole
  // around the player (playerPx in art/CSS px, top-left origin; spotInner/spotOuter in px). Call
  // AFTER the sprite batch, BEFORE presentScene. Premultiplied ONE/ONE_MINUS_SRC_ALPHA.
  drawBuildingSpotlightOverlay(bitmap, playerPx, spotInner, spotOuter) {
    if (!this.ok || !this.sceneActive || !bitmap) return;
    var gl = this.gl;
    if (!this.spotProgram) {
      var prog = this._buildProgram(VERT_SRC, SPOTLIGHT_FRAG_SRC);
      if (!prog) { this.spotProgram = null; this.spotOk = false; return; }
      this.spotProgram = prog;
      this.spotUViewport = gl.getUniformLocation(prog, 'uViewport');
      this.spotUPos = gl.getUniformLocation(prog, 'uPos');
      this.spotUSize = gl.getUniformLocation(prog, 'uSize');
      this.spotUTex = gl.getUniformLocation(prog, 'uTex');
      this.spotUPlayerPx = gl.getUniformLocation(prog, 'uPlayerPx');
      this.spotUInner = gl.getUniformLocation(prog, 'uSpotInner');
      this.spotUOuter = gl.getUniformLocation(prog, 'uSpotOuter');
      this.spotVao = gl.createVertexArray();
      gl.bindVertexArray(this.spotVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.unitVbo);
      var loc = gl.getAttribLocation(prog, 'aUnit');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    if (this.spotOk === false) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, this._artW, this._artH);
    gl.useProgram(this.spotProgram);
    gl.bindVertexArray(this.spotVao);
    gl.uniform2f(this.spotUViewport, this._artW, this._artH);
    gl.uniform2f(this.spotUPlayerPx, playerPx.x, playerPx.y);
    gl.uniform1f(this.spotUInner, spotInner);
    gl.uniform1f(this.spotUOuter, spotOuter);
    gl.uniform1i(this.spotUTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    if (!this._spotTex) this._spotTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._spotTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(this.spotUPos, 0, 0);
    gl.uniform2f(this.spotUSize, this._artW, this._artH);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  // Write the per-building DEPTH bitmap (building-depth.js) into the scene FBO's depth buffer —
  // call AFTER the chunk blit, BEFORE the sprite batch, so the player sprite can depth-test against
  // it. R = baseline depth, A = building mask (transparent → depth left far). debug=true also dumps
  // the depth as greyscale colour to verify alignment. Reuses VERT_SRC's uPos/uSize quad.
  writeBuildingDepth(bitmap, depthZ, debug) {
    if (!this.ok || !this.sceneActive || !bitmap || this.depthWriteOk === false) return;
    var gl = this.gl;
    if (!this.depthWriteProgram) {
      var prog = this._buildProgram(DEPTHWRITE_VERT_SRC, DEPTHWRITE_FRAG_SRC);
      if (!prog) { this.depthWriteOk = false; return; }
      this.depthWriteProgram = prog;
      this.dwUViewport = gl.getUniformLocation(prog, 'uViewport');
      this.dwUPos = gl.getUniformLocation(prog, 'uPos');
      this.dwUSize = gl.getUniformLocation(prog, 'uSize');
      this.dwUTex = gl.getUniformLocation(prog, 'uTex');
      this.dwUDepthZ = gl.getUniformLocation(prog, 'uDepthZ');
      this.depthWriteVao = gl.createVertexArray();
      gl.bindVertexArray(this.depthWriteVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.unitVbo);
      var dloc = gl.getAttribLocation(prog, 'aUnit');
      gl.enableVertexAttribArray(dloc);
      gl.vertexAttribPointer(dloc, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this._depthTex = gl.createTexture();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, this._artW, this._artH);
    gl.useProgram(this.depthWriteProgram);
    gl.bindVertexArray(this.depthWriteVao);
    gl.uniform2f(this.dwUViewport, this._artW, this._artH);
    gl.uniform2f(this.dwUPos, 0, 0);
    gl.uniform2f(this.dwUSize, this._artW, this._artH);
    gl.uniform1f(this.dwUDepthZ, depthZ);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._depthTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.dwUTex, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);     // nearer building (smaller z) wins where silhouettes overlap
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.colorMask(!!debug, !!debug, !!debug, !!debug);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // Restore defaults — the sprite batch enables depth-test only for the player; present is 2D.
    gl.colorMask(true, true, true, true);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
  }

  // Draw one building's TEXTURED silhouette into the scene FBO with BOTH colour AND per-object depth at
  // its south-baseline z (uDepthZ). Like writeBuildingDepth but colorMask ON + premultiplied blend, so the
  // building's real pixels paint (inheriting the present pass's lighting/day-night/CRT) AND sit at a real
  // depth the player sprite tests against per-pixel. Call AFTER the chunk blit, BEFORE the sprite batch,
  // farthest-first (depthFunc LESS so the nearer building wins where silhouettes overlap).
  drawBuildingColorDepth(bitmap, depthZ) {
    if (!this.ok || !this.sceneActive || !bitmap || this.colorDepthOk === false) return;
    var gl = this.gl;
    if (!this.colorDepthProgram) {
      var prog = this._buildProgram(DEPTHWRITE_VERT_SRC, COLORDEPTH_FRAG_SRC);
      if (!prog) { this.colorDepthOk = false; return; }
      this.colorDepthProgram = prog;
      this.cdUViewport = gl.getUniformLocation(prog, 'uViewport');
      this.cdUPos = gl.getUniformLocation(prog, 'uPos');
      this.cdUSize = gl.getUniformLocation(prog, 'uSize');
      this.cdUTex = gl.getUniformLocation(prog, 'uTex');
      this.cdUDepthZ = gl.getUniformLocation(prog, 'uDepthZ');
      this.colorDepthVao = gl.createVertexArray();
      gl.bindVertexArray(this.colorDepthVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.unitVbo);
      var cloc = gl.getAttribLocation(prog, 'aUnit');
      gl.enableVertexAttribArray(cloc);
      gl.vertexAttribPointer(cloc, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this._colorDepthTex = gl.createTexture();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, this._artW, this._artH);
    gl.useProgram(this.colorDepthProgram);
    gl.bindVertexArray(this.colorDepthVao);
    gl.uniform2f(this.cdUViewport, this._artW, this._artH);
    gl.uniform2f(this.cdUPos, 0, 0);
    gl.uniform2f(this.cdUSize, this._artW, this._artH);
    gl.uniform1f(this.cdUDepthZ, depthZ);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._colorDepthTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);  // premultiplied for ONE/ONE_MINUS_SRC_ALPHA
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.cdUTex, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);       // nearer building (smaller z) wins where silhouettes overlap
    gl.depthMask(true);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.colorMask(true, true, true, true);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // Restore defaults (present is 2D; the sprite batch manages its own depth test).
    gl.disable(gl.BLEND);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.bindVertexArray(null);
  }

  // CACHED building sprite → colour+depth. Same depth-write semantics as drawBuildingColorDepth, but the bitmap
  // is a SMALL building-local image uploaded ONCE per `key` (texImage2D only on a miss / bitmap swap) and drawn
  // each frame as a building-sized quad at (sx,sy,dw,dh). Fixes the ~336ms per-frame full-screen repaint+upload.
  drawBuildingSprite(key, bitmap, sx, sy, dw, dh, depthZ) {
    if (!this.ok || !this.sceneActive || !bitmap || this.colorDepthOk === false) return;
    var gl = this.gl;
    if (!this.colorDepthProgram) {
      var prog = this._buildProgram(DEPTHWRITE_VERT_SRC, COLORDEPTH_FRAG_SRC);
      if (!prog) { this.colorDepthOk = false; return; }
      this.colorDepthProgram = prog;
      this.cdUViewport = gl.getUniformLocation(prog, 'uViewport');
      this.cdUPos = gl.getUniformLocation(prog, 'uPos');
      this.cdUSize = gl.getUniformLocation(prog, 'uSize');
      this.cdUTex = gl.getUniformLocation(prog, 'uTex');
      this.cdUDepthZ = gl.getUniformLocation(prog, 'uDepthZ');
      this.colorDepthVao = gl.createVertexArray();
      gl.bindVertexArray(this.colorDepthVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.unitVbo);
      var cloc = gl.getAttribLocation(prog, 'aUnit');
      gl.enableVertexAttribArray(cloc);
      gl.vertexAttribPointer(cloc, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this._colorDepthTex = gl.createTexture();
    }
    // Per-key texture cache: upload the small building bitmap once; bind & reuse every later frame.
    if (!this.bldTextures) this.bldTextures = new Map();
    var entry = this.bldTextures.get(key);
    if (!entry || entry.bmp !== bitmap) {
      var tex = entry ? entry.tex : gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      entry = { tex: tex, bmp: bitmap, lastUsed: this.frame };
      this.bldTextures.set(key, entry);
    } else {
      entry.lastUsed = this.frame;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, this._artW, this._artH);
    gl.useProgram(this.colorDepthProgram);
    gl.bindVertexArray(this.colorDepthVao);
    gl.uniform2f(this.cdUViewport, this._artW, this._artH);
    gl.uniform2f(this.cdUPos, sx, sy);
    gl.uniform2f(this.cdUSize, dw, dh);
    gl.uniform1f(this.cdUDepthZ, depthZ);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    gl.uniform1i(this.cdUTex, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);        // nearer building (smaller z) wins where silhouettes overlap
    gl.depthMask(true);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.colorMask(true, true, true, true);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.bindVertexArray(null);
  }

  // LIVE D3 PROPS quad — same depth-writing program as drawBuildingSprite, for the per-building props bitmap
  // rebuilt EVERY frame (banner sway / lantern flicker animate). Two differences vs the cached-sprite path:
  // (1) ALWAYS re-upload (the bitmap changes each frame), and (2) depthFunc LEQUAL + depthMask FALSE so props
  // pass OVER their OWN building's wall (equal building-z) yet stay OCCLUDED by a NEARER building's silhouette
  // (smaller z already in the depth buffer) — fixing a back-building's props drawing over a front-building's
  // roof. Props only TEST depth, never WRITE it. One shared texture, re-specified per building per frame.
  drawBuildingPropsSprite(bitmap, sx, sy, dw, dh, depthZ) {
    if (!this.ok || !this.sceneActive || !bitmap || this.colorDepthOk === false) return;
    var gl = this.gl;
    if (!this.colorDepthProgram) {
      var prog = this._buildProgram(DEPTHWRITE_VERT_SRC, COLORDEPTH_FRAG_SRC);
      if (!prog) { this.colorDepthOk = false; return; }
      this.colorDepthProgram = prog;
      this.cdUViewport = gl.getUniformLocation(prog, 'uViewport');
      this.cdUPos = gl.getUniformLocation(prog, 'uPos');
      this.cdUSize = gl.getUniformLocation(prog, 'uSize');
      this.cdUTex = gl.getUniformLocation(prog, 'uTex');
      this.cdUDepthZ = gl.getUniformLocation(prog, 'uDepthZ');
      this.colorDepthVao = gl.createVertexArray();
      gl.bindVertexArray(this.colorDepthVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.unitVbo);
      var cloc = gl.getAttribLocation(prog, 'aUnit');
      gl.enableVertexAttribArray(cloc);
      gl.vertexAttribPointer(cloc, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this._colorDepthTex = gl.createTexture();
    }
    if (!this._propTex) this._propTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._propTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, this._artW, this._artH);
    gl.useProgram(this.colorDepthProgram);
    gl.bindVertexArray(this.colorDepthVao);
    gl.uniform2f(this.cdUViewport, this._artW, this._artH);
    gl.uniform2f(this.cdUPos, sx, sy);
    gl.uniform2f(this.cdUSize, dw, dh);
    gl.uniform1f(this.cdUDepthZ, depthZ);
    gl.uniform1i(this.cdUTex, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);     // pass over own building (equal z); occluded by a nearer building (smaller z)
    gl.depthMask(false);         // props TEST depth but never WRITE it
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.colorMask(true, true, true, true);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.bindVertexArray(null);
  }

  // Evict building-sprite textures unused for a while (LRU). Called from _sweep alongside chunk eviction.
  _evictBuildingTextures(maxAgeFrames) {
    if (!this.bldTextures) return;
    var gl = this.gl;
    for (var [key, entry] of this.bldTextures) {
      if (this.frame - entry.lastUsed > maxAgeFrames) {
        gl.deleteTexture(entry.tex);
        this.bldTextures.delete(key);
      }
    }
  }

  // --- Stage 2: sprite atlas + instanced rendering ---

  _initSprites() {
    var gl = this.gl;
    var prog = this._buildProgram(SPRITE_VERT_SRC, SPRITE_FRAG_SRC);
    if (!prog) return;
    this.spriteProgram = prog;
    this.sUViewport = gl.getUniformLocation(prog, 'uViewport');
    this.sUCam = gl.getUniformLocation(prog, 'uCam');
    this.sUAtlas = gl.getUniformLocation(prog, 'uAtlas');
    this.sUDepthOn = gl.getUniformLocation(prog, 'uDepthOn');
    this.sUDepthRef = gl.getUniformLocation(prog, 'uDepthRef');
    this.sUDepthScale = gl.getUniformLocation(prog, 'uDepthScale');
    this.sUSeeThrough = gl.getUniformLocation(prog, 'uSeeThrough');

    // Runtime shelf-packed sprite atlas. With F2 (32px), F4 (64px), F5 (96px),
    // F6 (192px) AND F6 upscaled trees (up to 384px) sharing one atlas, even 8192²
    // overflows in dense tree biomes (arctic/forest), which forced repeated mid-walk
    // resets (the on-screen reload). Prefer 16384² — 4× the area — so a realistic
    // visible set never overflows; the atlas never evicts, so capacity IS the budget.
    // Allocation is GL-error-checked: if the driver can't back the larger texture we
    // fall back to 8192² (the compaction + sync-rebuild path still hides the rare reset).
    var maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.atlasSize = Math.min(16384, maxTex);
    this.atlasTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    while (gl.getError() !== gl.NO_ERROR) {} // drain stale errors before probing the alloc
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.atlasSize, this.atlasSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    if (gl.getError() !== gl.NO_ERROR && this.atlasSize > 8192) {
      console.warn('[GL] sprite atlas ' + this.atlasSize + '² alloc failed — falling back to 8192²');
      this.atlasSize = 8192;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.atlasSize, this.atlasSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    console.log('[GL] sprite atlas: ' + this.atlasSize + '² (max ' + maxTex + ')');
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.atlasRects = new Map(); // url -> {u0,v0,du,dv} | null (failed/full)
    this._lastAtlasReset = -99999;
    this.atlasGen = 0; // bumped on atlas reset; consumers caching a rect (F2 memo) invalidate on change
    // Fixed region reserved for the player sprite, re-uploaded every frame so
    // the player participates in the depth-sorted instance batch.
    this._playerRegion = { x: 1, y: 1, w: 256, h: 256 };
    this._shelfX = 1;
    this._shelfY = this._playerRegion.y + this._playerRegion.h + 2; // shelves pack below it
    this._shelfH = 0;
    this._atlasFullWarned = false;

    // Sprite VAO: shared unit quad + per-instance attributes (divisor 1)
    this.spriteVao = gl.createVertexArray();
    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitVbo);
    var locUnit = gl.getAttribLocation(prog, 'aUnit');
    gl.enableVertexAttribArray(locUnit);
    gl.vertexAttribPointer(locUnit, 2, gl.FLOAT, false, 0, 0);
    this.instVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo);
    var locPSR = gl.getAttribLocation(prog, 'aPSR');
    gl.enableVertexAttribArray(locPSR);
    gl.vertexAttribPointer(locPSR, 4, gl.FLOAT, false, SPRITE_STRIDE, 0);
    gl.vertexAttribDivisor(locPSR, 1);
    var locAlpha = gl.getAttribLocation(prog, 'aAlpha');
    gl.enableVertexAttribArray(locAlpha);
    gl.vertexAttribPointer(locAlpha, 1, gl.FLOAT, false, SPRITE_STRIDE, 16);
    gl.vertexAttribDivisor(locAlpha, 1);
    var locUV = gl.getAttribLocation(prog, 'aUV');
    gl.enableVertexAttribArray(locUV);
    gl.vertexAttribPointer(locUV, 4, gl.FLOAT, false, SPRITE_STRIDE, 20);
    gl.vertexAttribDivisor(locUV, 1);
    gl.bindVertexArray(null);
    this._instCapacityBytes = 0;
    this._spriteAttribLocs = { psr: locPSR, alpha: locAlpha, uv: locUV };

    // Shadow pass: same instance layout, separate program/VAO/VBO so the
    // shadow batch (subset of sprites) doesn't disturb the sprite batch.
    var sprog = this._buildProgram(SHADOW_VERT_SRC, SHADOW_FRAG_SRC);
    this.shadowOk = false;
    if (sprog) {
      this.shadowProgram = sprog;
      this.shUViewport = gl.getUniformLocation(sprog, 'uViewport');
      this.shUCam = gl.getUniformLocation(sprog, 'uCam');
      this.shUAtlas = gl.getUniformLocation(sprog, 'uAtlas');
      this.shUShadowVec = gl.getUniformLocation(sprog, 'uShadowVec');
      this.shUShadowAlpha = gl.getUniformLocation(sprog, 'uShadowAlpha');
      this.shUAtlasTexel = gl.getUniformLocation(sprog, 'uAtlasTexel');
      this.shUHM = gl.getUniformLocation(sprog, 'uBuildingHeightMask');
      this.shUHMViewport = gl.getUniformLocation(sprog, 'uHMViewport');
      this.shUHMDims = gl.getUniformLocation(sprog, 'uHMDims');
      this.shUHMGrid = gl.getUniformLocation(sprog, 'uHMGrid');
      this.shadowVao = gl.createVertexArray();
      gl.bindVertexArray(this.shadowVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.unitVbo);
      var sLocUnit = gl.getAttribLocation(sprog, 'aUnit');
      gl.enableVertexAttribArray(sLocUnit);
      gl.vertexAttribPointer(sLocUnit, 2, gl.FLOAT, false, 0, 0);
      this.shadowVbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowVbo);
      var sLocPSR = gl.getAttribLocation(sprog, 'aPSR');
      gl.enableVertexAttribArray(sLocPSR);
      gl.vertexAttribPointer(sLocPSR, 4, gl.FLOAT, false, SPRITE_STRIDE, 0);
      gl.vertexAttribDivisor(sLocPSR, 1);
      var sLocAlpha = gl.getAttribLocation(sprog, 'aAlpha');
      gl.enableVertexAttribArray(sLocAlpha);
      gl.vertexAttribPointer(sLocAlpha, 1, gl.FLOAT, false, SPRITE_STRIDE, 16);
      gl.vertexAttribDivisor(sLocAlpha, 1);
      var sLocUV = gl.getAttribLocation(sprog, 'aUV');
      gl.enableVertexAttribArray(sLocUV);
      gl.vertexAttribPointer(sLocUV, 4, gl.FLOAT, false, SPRITE_STRIDE, 20);
      gl.vertexAttribDivisor(sLocUV, 1);
      gl.bindVertexArray(null);
      this._shadowCapacityBytes = 0;
      this._shadowAttribLocs = { psr: sLocPSR, alpha: sLocAlpha, uv: sLocUV };
      this.shadowOk = true;
    }
    this.spritesOk = true;
    this._initAnimSprites();
  }

  // === GPU-driven flora machinery (additive; old CPU path untouched) ===
  // Two programs (sprite + shadow) read a STATIC 20-float instance buffer and derive
  // frame/sway/fade from uTime. Frames live as contiguous strips in the same atlas.
  _buildAnimVao(prog, vbo) {
    var gl = this.gl;
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitVbo);
    var lU = gl.getAttribLocation(prog, 'aUnit');
    gl.enableVertexAttribArray(lU);
    gl.vertexAttribPointer(lU, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    var locs = [];
    var names = ['a0', 'a1', 'a2', 'a3', 'a4'];
    for (var i = 0; i < names.length; i++) {
      var loc = gl.getAttribLocation(prog, names[i]);
      locs.push(loc);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, ANIM_SPRITE_STRIDE, i * 16);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    return { vao: vao, locs: locs };
  }

  _initAnimSprites() {
    if (!this.spritesOk) return;
    var gl = this.gl;
    this.animOk = false;
    var prog = this._buildProgram(ANIM_SPRITE_VERT_SRC, SPRITE_FRAG_SRC);
    if (!prog) return;
    this.animProgram = prog;
    this.aUViewport = gl.getUniformLocation(prog, 'uViewport');
    this.aUCam = gl.getUniformLocation(prog, 'uCam');
    this.aUTime = gl.getUniformLocation(prog, 'uTime');
    this.aUFrameDur = gl.getUniformLocation(prog, 'uFrameDur');
    this.aUAtlas = gl.getUniformLocation(prog, 'uAtlas');
    this.aUDepthOn = gl.getUniformLocation(prog, 'uDepthOn');
    this.aUDepthRef = gl.getUniformLocation(prog, 'uDepthRef');
    this.aUDepthScale = gl.getUniformLocation(prog, 'uDepthScale');
    this.animVbo = gl.createBuffer();
    this._animCapBytes = 0;
    var sv = this._buildAnimVao(prog, this.animVbo);
    this.animVao = sv.vao; this._animLocs = sv.locs;

    var sprog = this._buildProgram(ANIM_SHADOW_VERT_SRC, SHADOW_FRAG_SRC);
    if (!sprog) return;
    this.animShadowProgram = sprog;
    this.asUViewport = gl.getUniformLocation(sprog, 'uViewport');
    this.asUCam = gl.getUniformLocation(sprog, 'uCam');
    this.asUTime = gl.getUniformLocation(sprog, 'uTime');
    this.asUFrameDur = gl.getUniformLocation(sprog, 'uFrameDur');
    this.asUAtlas = gl.getUniformLocation(sprog, 'uAtlas');
    this.asUShadowVec = gl.getUniformLocation(sprog, 'uShadowVec');
    this.asUShadowAlpha = gl.getUniformLocation(sprog, 'uShadowAlpha');
    this.asUAtlasTexel = gl.getUniformLocation(sprog, 'uAtlasTexel');
    this.asUHM = gl.getUniformLocation(sprog, 'uBuildingHeightMask');
    this.asUHMViewport = gl.getUniformLocation(sprog, 'uHMViewport');
    this.asUHMDims = gl.getUniformLocation(sprog, 'uHMDims');
    this.asUHMGrid = gl.getUniformLocation(sprog, 'uHMGrid');
    this.animShadowVbo = gl.createBuffer();
    this._animShadowCapBytes = 0;
    var sh = this._buildAnimVao(sprog, this.animShadowVbo);
    this.animShadowVao = sh.vao; this._animShadowLocs = sh.locs;
    this.animOk = true;
  }

  // Pack N same-size frames as a contiguous horizontal strip (1px gaps). Returns
  // {u0,v0,frameStride,du,dv,n} (frame i at u0 + i*frameStride) or null if it
  // doesn't fit / sizes differ — caller falls back to the CPU path for that sprite.
  atlasStrip(frames) {
    if (!this.ok || !this.spritesOk || !frames || !frames.length) return null;
    var gl = this.gl;
    var f0 = frames[0];
    var w = f0.naturalWidth || f0.width, h = f0.naturalHeight || f0.height;
    if (!w || !h) return null;
    var n = frames.length, A = this.atlasSize, stride = w + 1, totalW = n * stride;
    if (totalW + 1 > A || h + 2 > A) return null;
    if (this._shelfX + totalW + 1 > A) { this._shelfY += this._shelfH + 1; this._shelfX = 1; this._shelfH = 0; }
    if (this._shelfY + h + 1 > A) return null; // atlas full — caller retries after reset
    var x0 = this._shelfX, y0 = this._shelfY;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    for (var i = 0; i < n; i++) {
      var fi = frames[i];
      if ((fi.naturalWidth || fi.width) !== w || (fi.naturalHeight || fi.height) !== h) {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); return null;
      }
      try { gl.texSubImage2D(gl.TEXTURE_2D, 0, x0 + i * stride, y0, gl.RGBA, gl.UNSIGNED_BYTE, fi); }
      catch (e) { gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); return null; }
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this._shelfX = x0 + totalW + 1;
    if (h > this._shelfH) this._shelfH = h;
    var s = 0.5; // half-texel inset (NEAREST)
    return { u0: (x0 + s) / A, v0: (y0 + s) / A, frameStride: stride / A,
             du: (w - 2 * s) / A, dv: (h - 2 * s) / A, n: n };
  }

  ensureAnimCapacity(kind, instCount) {
    if (!this.animOk) return false;
    var gl = this.gl;
    var vbo = kind === 'shadow' ? this.animShadowVbo : this.animVbo;
    var capKey = kind === 'shadow' ? '_animShadowCapBytes' : '_animCapBytes';
    var bytes = Math.max(4096 * ANIM_SPRITE_STRIDE, instCount * ANIM_SPRITE_STRIDE);
    if (bytes > this[capKey]) {
      this[capKey] = bytes * 2;
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, this[capKey], gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    return true;
  }

  uploadAnimRange(kind, mirror, start, count, orphan) {
    if (!this.animOk || count === 0) return;
    var gl = this.gl;
    var vbo = kind === 'shadow' ? this.animShadowVbo : this.animVbo;
    var cap = kind === 'shadow' ? this._animShadowCapBytes : this._animCapBytes;
    if ((start + count) * ANIM_SPRITE_STRIDE > cap) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    if (orphan) gl.bufferData(gl.ARRAY_BUFFER, cap, gl.DYNAMIC_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, start * ANIM_SPRITE_STRIDE,
      mirror, start * ANIM_SPRITE_FLOATS, count * ANIM_SPRITE_FLOATS);
  }

  _pointAnimAttribs(vbo, locs, startInst) {
    var gl = this.gl;
    var base = startInst * ANIM_SPRITE_STRIDE;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    for (var i = 0; i < 5; i++) gl.vertexAttribPointer(locs[i], 4, gl.FLOAT, false, ANIM_SPRITE_STRIDE, base + i * 16);
  }

  drawAnimSprites(start, count, cssW, cssH, cam, timeMs) {
    if (!this.animOk || count === 0) return;
    var gl = this.gl;
    gl.useProgram(this.animProgram);
    gl.bindVertexArray(this.animVao);
    if (this.sceneActive) gl.uniform2f(this.aUViewport, this._artW, this._artH);
    else gl.uniform2f(this.aUViewport, cssW, cssH);
    gl.uniform3f(this.aUCam, cam.x, cam.y, cam.scale);
    gl.uniform1f(this.aUTime, timeMs);
    gl.uniform1f(this.aUFrameDur, ANIM_FRAME_DUR);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(this.aUAtlas, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // Depth-test against the building depth buffer so flora is OCCLUDED by buildings in front of it (the GPU
    // path previously hardcoded z=0 + no depth test → grass drew over buildings, esp. after teleport). Mirrors
    // drawPoolSprites: TEST only (depthMask false), so flora's own painter's-order by sortY is unchanged.
    var _depthOn = !!this._spriteDepth;
    if (this.aUDepthOn) gl.uniform1f(this.aUDepthOn, _depthOn ? 1 : 0);
    if (_depthOn) {
      gl.uniform1f(this.aUDepthRef, this._spriteDepth.refY);
      gl.uniform1f(this.aUDepthScale, this._spriteDepth.scale);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
    }
    try {
      this._pointAnimAttribs(this.animVbo, this._animLocs, start);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    } finally {
      this._pointAnimAttribs(this.animVbo, this._animLocs, 0);
      gl.bindVertexArray(null);
      if (_depthOn) { gl.disable(gl.DEPTH_TEST); gl.depthMask(true); }
    }
    gl.disable(gl.BLEND);
  }

  _bindHeightMaskUniforms(uHM, uViewport, uDims, uGrid, vpx, vpy) {
    var gl = this.gl;
    if (this._hmOn) {
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.heightMaskTex); gl.uniform1i(uHM, 5);
      gl.uniform2f(uViewport, vpx, vpy); gl.uniform2f(uDims, this._hmW, this._hmH);
      gl.uniform4f(uGrid, this._hmCell, this._hmCols, this._hmRows, 1.0); gl.activeTexture(gl.TEXTURE0);
    } else { gl.uniform4f(uGrid, 8.0, 1.0, 1.0, 0.0); }
  }

  drawAnimShadows(start, count, cssW, cssH, cam, shadowVec, strength, timeMs) {
    if (!this.animOk || count === 0) return;
    var gl = this.gl;
    gl.useProgram(this.animShadowProgram);
    gl.bindVertexArray(this.animShadowVao);
    if (this.sceneActive) gl.uniform2f(this.asUViewport, this._artW, this._artH);
    else gl.uniform2f(this.asUViewport, cssW, cssH);
    gl.uniform3f(this.asUCam, cam.x, cam.y, cam.scale);
    gl.uniform1f(this.asUTime, timeMs);
    gl.uniform1f(this.asUFrameDur, ANIM_FRAME_DUR);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(this.asUAtlas, 0);
    gl.uniform2f(this.asUShadowVec, shadowVec.x, shadowVec.y);
    gl.uniform1f(this.asUShadowAlpha, strength);
    gl.uniform1f(this.asUAtlasTexel, 1 / (this.atlasSize || 1));
    this._bindHeightMaskUniforms(this.asUHM, this.asUHMViewport, this.asUHMDims, this.asUHMGrid,
      this.sceneActive ? this._artW : cssW, this.sceneActive ? this._artH : cssH);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    try {
      this._pointAnimAttribs(this.animShadowVbo, this._animShadowLocs, start);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    } finally {
      this._pointAnimAttribs(this.animShadowVbo, this._animShadowLocs, 0);
      gl.bindVertexArray(null);
    }
    gl.disable(gl.BLEND);
  }

  // Pack an Image into the atlas (or return its cached rect). Returns
  // {u0,v0,du,dv} or null (not ready / failed / atlas full → caller draws 2D).
  atlasRect(img, url) {
    if (!this.ok || !this.spritesOk) return null;
    var rect = this.atlasRects.get(url);
    if (rect !== undefined) return rect;
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    // Canvases (downscale cache) have no .complete — only gate Images on decode
    if (!w || !h || img.complete === false) return null; // not decoded yet — retry later
    // THROTTLE new packs per frame to spread the walk-into-new-flora burst. An
    // over-budget (but ready) sprite is deferred exactly like a not-yet-decoded one
    // — caller pushes it to `pending` and retries next frame.
    if (this.frame !== this._packFrame) { this._packFrame = this.frame; this._packsThisFrame = 0; }
    if (this._packsThisFrame >= SPRITE_PACK_BUDGET) return null;
    var A = this.atlasSize;
    if (w + 2 > A || h + 2 > A) {
      this.atlasRects.set(url, null); // sprite larger than the whole atlas
      return null;
    }
    if (this._shelfX + w + 1 > A) {
      this._shelfY += this._shelfH + 1;
      this._shelfX = 1;
      this._shelfH = 0;
    }
    if (this._shelfY + h + 1 > A) {
      // Atlas full. Unique URLs grow unbounded over a session (every anim
      // frame is its own URL), so permanent null-marking makes sprites vanish
      // in art-scene mode. Reset the shelves and rebuild lazily from the
      // sprites actually drawn — packing is synchronous, so the working set
      // repacks within a frame. Thrash guard: if it fills again within the
      // SAME frame, this frame's working set itself exceeds the atlas; mark
      // overflow null (retried after the next reset).
      if (this.frame !== this._lastAtlasReset) {
        this._lastAtlasReset = this.frame;
        this.atlasGen++; // relocates every sprite — invalidate any cached rects (F2 memo)
        this.atlasRects.clear();
        this._shelfX = 1;
        this._shelfY = this._playerRegion.y + this._playerRegion.h + 2;
        this._shelfH = 0;
        console.log('[GL] sprite atlas full — reset, repacking visible sprites');
      } else {
        if (!this._atlasFullWarned) {
          this._atlasFullWarned = true;
          console.warn('[GL] sprite atlas working set exceeds capacity (' + this.atlasRects.size + ' sprites) — overflow sprites skipped');
        }
        this.atlasRects.set(url, null);
        return null;
      }
    }
    var x = this._shelfX;
    var y = this._shelfY;
    var gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    try {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, img);
    } catch (e) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      this.atlasRects.set(url, null);
      return null;
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this._packsThisFrame++;
    this._shelfX += w + 1;
    if (h > this._shelfH) this._shelfH = h;
    // Half-texel inset prevents NEAREST bleed from neighboring sprites
    rect = { u0: (x + 0.5) / A, v0: (y + 0.5) / A, du: (w - 1) / A, dv: (h - 1) / A };
    this.atlasRects.set(url, rect);
    return rect;
  }

  // Upload the player's composited canvas into its reserved atlas region.
  // Returns the UV rect, or null if sprites are unavailable.
  uploadPlayerSprite(canvas) {
    if (!this.ok || !this.spritesOk) return null;
    var gl = this.gl;
    var r = this._playerRegion;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    try {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    } catch (e) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      return null;
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    var A = this.atlasSize;
    return { u0: r.x / A, v0: r.y / A, du: r.w / A, dv: r.h / A };
  }

  // Draw `count` sprite instances from a packed Float32Array
  // (SPRITE_FLOATS floats each, in back-to-front order).
  drawSpriteInstances(data, count, cssW, cssH) {
    if (!this.ok || !this.spritesOk || count === 0) return;
    var gl = this.gl;
    gl.useProgram(this.spriteProgram);
    gl.bindVertexArray(this.spriteVao);
    // In scene mode the viewport MUST match beginScene's art dims exactly,
    // or sprites drift off the terrain's pixel grid by the ceil+margin delta.
    if (this.sceneActive) gl.uniform2f(this.sUViewport, this._artW, this._artH);
    else gl.uniform2f(this.sUViewport, cssW, cssH);
    gl.uniform3f(this.sUCam, 0, 0, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(this.sUAtlas, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo);
    var bytes = count * SPRITE_STRIDE;
    if (bytes > this._instCapacityBytes) {
      this._instCapacityBytes = bytes * 2;
      gl.bufferData(gl.ARRAY_BUFFER, this._instCapacityBytes, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * SPRITE_FLOATS);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  // Draw silhouette shadows (same packed layout as sprites). shadowVec is the
  // ground displacement of a sprite's TOP, as a fraction of sprite size
  // (x = horizontal skew toward shadow side, y = vertical ground run).
  drawShadowInstances(data, count, cssW, cssH, shadowVec, strength) {
    if (!this.ok || !this.shadowOk || count === 0) return;
    var gl = this.gl;
    gl.useProgram(this.shadowProgram);
    gl.bindVertexArray(this.shadowVao);
    if (this.sceneActive) gl.uniform2f(this.shUViewport, this._artW, this._artH);
    else gl.uniform2f(this.shUViewport, cssW, cssH);
    gl.uniform3f(this.shUCam, 0, 0, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(this.shUAtlas, 0);
    gl.uniform2f(this.shUShadowVec, shadowVec.x, shadowVec.y);
    gl.uniform1f(this.shUShadowAlpha, strength);
    gl.uniform1f(this.shUAtlasTexel, 1 / (this.atlasSize || 1));
    this._bindHeightMaskUniforms(this.shUHM, this.shUHMViewport, this.shUHMDims, this.shUHMGrid,
      this.sceneActive ? this._artW : cssW, this.sceneActive ? this._artH : cssH);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowVbo);
    var bytes = count * SPRITE_STRIDE;
    if (bytes > this._shadowCapacityBytes) {
      this._shadowCapacityBytes = bytes * 2;
      gl.bufferData(gl.ARRAY_BUFFER, this._shadowCapacityBytes, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * SPRITE_FLOATS);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  // --- Persistent sprite pool (world-space instances, partial uploads) ---
  // The pool owns two VBOs (sprites, shadows) that survive across frames.
  // ensurePoolCapacity grows them; uploadPoolRange patches dirty instances;
  // drawPoolRange draws a contiguous instance range by re-pointing the
  // instance attributes (WebGL2 has no baseInstance).

  ensurePoolCapacity(kind, instCount) {
    if (!this.ok || !this.spritesOk) return false;
    var gl = this.gl;
    if (!this._pool) this._pool = {};
    var p = this._pool[kind];
    if (!p) {
      p = this._pool[kind] = { vbo: gl.createBuffer(), capBytes: 0 };
    }
    var bytes = Math.max(4096 * SPRITE_STRIDE, instCount * SPRITE_STRIDE);
    if (bytes > p.capBytes) {
      gl.bindBuffer(gl.ARRAY_BUFFER, p.vbo);
      p.capBytes = bytes * 2;
      gl.bufferData(gl.ARRAY_BUFFER, p.capBytes, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    return true;
  }

  // Upload `count` instances from mirror (Float32Array of packed instances)
  // starting at instance index `start` (same index in VBO and mirror).
  // orphan=true re-specs the buffer (bufferData(null)) before writing, so the
  // driver hands back a fresh allocation instead of blocking the CPU until the
  // GPU finishes reading last frame's VBO. ONLY pass orphan=true when `count`
  // is the entire live range [0, n) — orphaning discards the whole buffer, so a
  // partial write would leave the rest as garbage.
  uploadPoolRange(kind, mirror, start, count, orphan) {
    if (!this.ok || !this.spritesOk || count === 0) return;
    var gl = this.gl;
    var p = this._pool && this._pool[kind];
    if (!p) return;
    if ((start + count) * SPRITE_STRIDE > p.capBytes) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, p.vbo);
    if (orphan) gl.bufferData(gl.ARRAY_BUFFER, p.capBytes, gl.DYNAMIC_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, start * SPRITE_STRIDE,
      mirror, start * SPRITE_FLOATS, count * SPRITE_FLOATS);
  }

  // Point the 3 instance attributes of the currently-bound VAO at byte offset
  // start*stride of the given VBO. attribLocs = { psr, alpha, uv }.
  _pointPoolAttribs(vbo, locs, startInst) {
    var gl = this.gl;
    var base = startInst * SPRITE_STRIDE;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.vertexAttribPointer(locs.psr, 4, gl.FLOAT, false, SPRITE_STRIDE, base);
    gl.vertexAttribPointer(locs.alpha, 1, gl.FLOAT, false, SPRITE_STRIDE, base + 16);
    gl.vertexAttribPointer(locs.uv, 4, gl.FLOAT, false, SPRITE_STRIDE, base + 20);
  }

  // Draw instances [start, start+count) of the persistent sprite pool.
  // cam = { x, y, scale } (screen-px offset + px-per-tile).
  drawPoolSprites(start, count, cssW, cssH, cam, seeThrough) {
    if (!this.ok || !this.spritesOk || count === 0) return;
    var p = this._pool && this._pool.sprite;
    if (!p) return;
    if (seeThrough && !this._spriteDepth) return; // see-through reveal only with depth occlusion on
    var gl = this.gl;
    gl.useProgram(this.spriteProgram);
    gl.bindVertexArray(this.spriteVao);
    if (this.sceneActive) gl.uniform2f(this.sUViewport, this._artW, this._artH);
    else gl.uniform2f(this.sUViewport, cssW, cssH);
    gl.uniform3f(this.sUCam, cam.x, cam.y, cam.scale);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(this.sUAtlas, 0);
    // Depth occlusion (player): test against the building-depth buffer so the sprite is hidden
    // behind buildings, but DON'T write depth (depthMask false) so flora ordering is unchanged.
    var depthOn = !!this._spriteDepth;
    if (this.sUSeeThrough) gl.uniform1f(this.sUSeeThrough, (seeThrough && this._spriteDepth) ? (typeof this._spriteDepth.see === 'number' ? this._spriteDepth.see : 0.45) : 0);
    if (depthOn) {
      gl.uniform1f(this.sUDepthOn, 1);
      gl.uniform1f(this.sUDepthRef, this._spriteDepth.refY);
      gl.uniform1f(this.sUDepthScale, this._spriteDepth.scale);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(seeThrough ? gl.GREATER : gl.LEQUAL); // GREATER → draw the ghost ONLY where occluded
      gl.depthMask(false);
    } else if (this.sUDepthOn) {
      gl.uniform1f(this.sUDepthOn, 0);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    try {
      this._pointPoolAttribs(p.vbo, this._spriteAttribLocs, start);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    } finally {
      // Restore VAO's default pointers (offset 0 into the legacy instVbo) so
      // legacy drawSpriteInstances callers are unaffected.
      this._pointPoolAttribs(this.instVbo, this._spriteAttribLocs, 0);
      gl.bindVertexArray(null);
    }
    gl.disable(gl.BLEND);
    if (depthOn) { gl.disable(gl.DEPTH_TEST); gl.depthMask(true); }
  }

  // Enable building-depth occlusion for the player pool draw (refY/scale must match the
  // building-depth pass). Cleared with clearSpriteDepth() after the player is drawn.
  setSpriteDepth(refY, scale, see) { this._spriteDepth = { refY: refY, scale: scale, see: see }; }
  clearSpriteDepth() { this._spriteDepth = null; }

  drawPoolShadows(start, count, cssW, cssH, cam, shadowVec, strength) {
    if (!this.ok || !this.shadowOk || count === 0) return;
    var p = this._pool && this._pool.shadow;
    if (!p) return;
    var gl = this.gl;
    gl.useProgram(this.shadowProgram);
    gl.bindVertexArray(this.shadowVao);
    if (this.sceneActive) gl.uniform2f(this.shUViewport, this._artW, this._artH);
    else gl.uniform2f(this.shUViewport, cssW, cssH);
    gl.uniform3f(this.shUCam, cam.x, cam.y, cam.scale);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(this.shUAtlas, 0);
    gl.uniform2f(this.shUShadowVec, shadowVec.x, shadowVec.y);
    gl.uniform1f(this.shUShadowAlpha, strength);
    gl.uniform1f(this.shUAtlasTexel, 1 / (this.atlasSize || 1));
    this._bindHeightMaskUniforms(this.shUHM, this.shUHMViewport, this.shUHMDims, this.shUHMGrid,
      this.sceneActive ? this._artW : cssW, this.sceneActive ? this._artH : cssH);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    try {
      this._pointPoolAttribs(p.vbo, this._shadowAttribLocs, start);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    } finally {
      this._pointPoolAttribs(this.shadowVbo, this._shadowAttribLocs, 0);
      gl.bindVertexArray(null);
    }
    gl.disable(gl.BLEND);
  }

  // --- GPU Wang-tile terrain compositor methods ---

  // Register the fully-built WangAtlas texture + its serialized meta (from atlas.serializeMeta()).
  // Builds a 1-row RG32F lookup texture so the tilemap fragment shader can resolve a slot integer
  // to (u0,v0) atlas UV in one texelFetch. Call once after the atlas is fully populated (or again
  // if new tiles are added — it rebuilds the lookup table each time).
  setWangAtlas(tex, meta) {
    if (!this.ok) return;
    var gl = this.gl;
    this._wangAtlasTex = tex;
    this._wangAtlasSize = meta.atlasSize;

    // Find the largest slot index across all registered tiles
    var maxSlot = 0;
    for (var val of Object.values(meta.slots)) { if (val.slot > maxSlot) maxSlot = val.slot; }
    var w = maxSlot + 1;

    // Fill a Float32Array: index slot*2 = u0, slot*2+1 = v0; slot 0 stays 0,0 (RESERVED=empty)
    var data = new Float32Array(w * 2);
    for (var val of Object.values(meta.slots)) {
      data[val.slot * 2]     = val.u0;
      data[val.slot * 2 + 1] = val.v0;
    }

    // Upload as RG32F 1-row texture (texelFetch-able in WebGL2 without extension)
    if (!this._slotUVTex) this._slotUVTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._slotUVTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, w, 1, 0, gl.RG, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this._slotUVW = w;

    // Lazily build the tilemap program now that we know the atlas exists
    if (!this._tilemapProgram) this._buildTilemapProgram();
  }

  _buildTilemapProgram() {
    var gl = this.gl;
    var prog = this._buildProgram(VERT_SRC, TILEMAP_FRAG_SRC);
    if (!prog) { this._tilemapOk = false; return; }
    this._tilemapProgram = prog;
    this._tmUViewport = gl.getUniformLocation(prog, 'uViewport');
    this._tmUPos      = gl.getUniformLocation(prog, 'uPos');
    this._tmUSize     = gl.getUniformLocation(prog, 'uSize');
    this._tmUIndex    = gl.getUniformLocation(prog, 'uIndex');
    this._tmUAtlas    = gl.getUniformLocation(prog, 'uAtlas');
    this._tmUSlotUV   = gl.getUniformLocation(prog, 'uSlotUV');
    this._tmUSlotUVW  = gl.getUniformLocation(prog, 'uSlotUVW');
    this._tmUAtlasSize = gl.getUniformLocation(prog, 'uAtlasSize');
    // Own VAO that shares the same unit-quad VBO as the base chunk program
    this._tilemapVao = gl.createVertexArray();
    gl.bindVertexArray(this._tilemapVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitVbo);
    var loc = gl.getAttribLocation(prog, 'aUnit');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  // Upload (or refresh) the 64×64 RGBA8 index map for a chunk. buf is a Uint8Array
  // of length 64*64*4 produced by encodeTexel in gpu-terrain-index.js. No upload
  // budget/throttle: the index map is only 16 KB (vs ~16 MB for a chunk bitmap).
  uploadChunkIndex(key, buf) {
    if (!this.ok) return;
    var gl = this.gl;
    if (!this._chunkIndexTex) this._chunkIndexTex = new Map();
    var tex = this._chunkIndexTex.get(key);
    if (!tex) {
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this._chunkIndexTex.set(key, tex);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, tex);
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // Draw a chunk quad by sampling the Wang tile atlas via the index map — the GPU
  // tilemap path. Placement (sx/sy/dw/dh) is identical to drawChunk; the scene FBO
  // and viewport are re-bound to match drawSceneOverlayBitmap's defensive pattern.
  // Falls back (returns early) if atlas/slot-UV/index textures are not ready so the
  // caller can fall through to the bitmap drawChunk path. Restores the base chunk
  // program + VAO after drawing so drawChunk can be called interleaved.
  drawChunkTilemap(key, sx, sy, dw, dh) {
    if (!this.ok || !this._wangAtlasTex || !this._slotUVTex) return;
    if (!this._chunkIndexTex) return;
    var indexTex = this._chunkIndexTex.get(key);
    if (!indexTex) return;
    if (!this._tilemapProgram || this._tilemapOk === false) return;

    var gl = this.gl;
    // Bind scene FBO + viewport (defensive re-bind, mirrors drawSceneOverlayBitmap)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, this._artW, this._artH);
    gl.useProgram(this._tilemapProgram);
    gl.bindVertexArray(this._tilemapVao);

    // Texture unit 0 = per-chunk index map, unit 1 = wang atlas, unit 2 = slot-UV table
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, indexTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._wangAtlasTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this._slotUVTex);
    gl.activeTexture(gl.TEXTURE0); // restore unit 0 as active (convention)

    gl.uniform2f(this._tmUViewport, this._artW, this._artH);
    gl.uniform2f(this._tmUPos,      sx, sy);
    gl.uniform2f(this._tmUSize,     dw, dh);
    gl.uniform1i(this._tmUIndex,    0);
    gl.uniform1i(this._tmUAtlas,    1);
    gl.uniform1i(this._tmUSlotUV,   2);
    gl.uniform1i(this._tmUSlotUVW,  this._slotUVW);
    gl.uniform1f(this._tmUAtlasSize, this._wangAtlasSize);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Restore base chunk pipeline so subsequent drawChunk calls continue to work
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.uViewport, this._artW, this._artH);
    gl.uniform1i(this.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
  }

  endFrame() {
    if (!this.ok) return;
    this.frame++;
    if (this.frame % SWEEP_INTERVAL === 0) this._sweep();
  }

  _sweep() {
    var gl = this.gl;
    for (var [key, entry] of this.textures) {
      if (this.frame - entry.lastUsed > EVICT_AFTER_FRAMES) {
        gl.deleteTexture(entry.tex);
        this.textures.delete(key);
        // Evict the GPU index texture for this chunk at the same time
        if (this._chunkIndexTex) { var it = this._chunkIndexTex.get(key); if (it) { gl.deleteTexture(it); this._chunkIndexTex.delete(key); } }
      }
    }
    this._evictBuildingTextures(EVICT_AFTER_FRAMES);
  }

  // Reclaim the entire sprite-atlas working set (mirrors the atlas-full path). atlasGen++ also
  // invalidates field2's _stripCache memo; sprites repack lazily from whatever is actually drawn next.
  resetAtlas() {
    this._lastAtlasReset = this.frame;
    this.atlasGen++;
    if (this.atlasRects) this.atlasRects.clear();
    this._shelfX = 1;
    this._shelfY = this._playerRegion ? this._playerRegion.y + this._playerRegion.h + 2 : 1;
    this._shelfH = 0;
  }

  // Fraction of the atlas height consumed by packed shelves (0..1). The atlas never
  // evicts individual sprites, so walking accumulates a trail of off-screen sprites until
  // it fills and resets mid-draw — which reloads on screen. Callers use this to compact
  // PROACTIVELY at a rebuild boundary (resetAtlas before re-packing) so the now-visible set
  // repacks fresh inline in one pass instead of overflowing mid-frame.
  atlasFillRatio() {
    if (!this.ok || !this.atlasSize) return 0;
    return this._shelfY / this.atlasSize;
  }

  // Discontinuity teardown (registered on the scene-teardown bus). After a far teleport the cached
  // chunk + building textures are stale; the destination biome re-uploads what it needs. Keep only
  // chunk textures NEAR the destination (so short/overlapping teleports don't re-upload), free the
  // rest + all building textures + reset the atlas — so rapid teleports can't accumulate stale VRAM.
  purgeOffscreen(info) {
    if (!this.ok) return 0;
    var gl = this.gl, freed = 0;
    var hasDest = info && typeof info.x === 'number';
    var dcx = hasDest ? Math.floor(info.x / 64) : 0, dcy = hasDest ? Math.floor(info.y / 64) : 0;
    var KEEP = 8; // chunks: keep a margin around the destination, evict everything farther
    for (var [key, entry] of this.textures) {
      var keep = false;
      if (hasDest) { var p = key.split(','); if (Math.abs((+p[0]) - dcx) <= KEEP && Math.abs((+p[1]) - dcy) <= KEEP) keep = true; }
      if (!keep) { gl.deleteTexture(entry.tex); this.textures.delete(key); freed++;
        if (this._chunkIndexTex) { var ci = this._chunkIndexTex.get(key); if (ci) { gl.deleteTexture(ci); this._chunkIndexTex.delete(key); } }
      }
    }
    if (this.bldTextures) { for (var [, e2] of this.bldTextures) { gl.deleteTexture(e2.tex); freed++; } this.bldTextures.clear(); }
    // INTENTIONALLY NOT resetting the sprite atlas here. resetAtlas() bumped atlasGen → forced a full
    // re-pack of every visible F2 sprite (SPRITE_PACK_BUDGET=32/frame ≈ 1.5s = the post-teleport stutter).
    // The atlas is a fixed-size texture (no leak); stale old-biome sprites are reclaimed lazily by its own
    // overflow reset when it actually fills. Freeing the big per-chunk textures above is the real VRAM win.
    return freed;
  }

  stats() {
    return { glTextures: this.textures.size, atlasSprites: this.atlasRects ? this.atlasRects.size : 0 };
  }
}
