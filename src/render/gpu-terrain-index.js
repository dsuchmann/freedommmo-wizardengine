// src/render/gpu-terrain-index.js
// Pure (no GL, no worker globals) encode/decode of one terrain index texel.
// RGBA16UI layout — one unsigned 16-bit integer per channel:
//   R = base wang atlas slot   (0..65535; 0 = empty cell)
//   G = cliff wang atlas slot  (0..65535; 0 = no cliff overlay)
//   B = soil id                (0..65535; 0 = no soil; see wang-image-list SOIL_IDS)
//   A = reserved               (0)
// Returns/accepts a 4-element array of 16-bit values (caller packs into a Uint16Array).
export function encodeTexel(baseSlot, cliffSlot, soilId) {
  return [baseSlot & 0xffff, cliffSlot & 0xffff, soilId & 0xffff, 0];
}
export function decodeTexel(texel) {
  return { baseSlot: texel[0], cliffSlot: texel[1], soilId: texel[2] };
}
