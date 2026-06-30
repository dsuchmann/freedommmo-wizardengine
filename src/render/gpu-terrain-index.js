// src/render/gpu-terrain-index.js
// Pure (no GL, no worker globals) encode/decode of one terrain index texel. RGBA8 layout:
//   R = baseSlot low 8 bits
//   G = (baseSlot high 4 bits) | (transitionSlot high 4 bits << 4)   -- 4 bits each
//   B = transitionSlot low 8 bits
//   A = soilId (0..15) in low 4 bits  (high nibble reserved)
// baseSlot/transitionSlot are 0..4095 (12-bit atlas slot indices); transitionSlot 0 = no transition.
export function encodeTexel(baseSlot, transitionSlot, soilId) {
  const r = baseSlot & 0xff;
  const g = ((baseSlot >> 8) & 0x0f) | (((transitionSlot >> 8) & 0x0f) << 4);
  const b = transitionSlot & 0xff;
  const a = soilId & 0x0f;
  return [r, g, b, a];
}
export function decodeTexel(rgba) {
  const baseSlot = rgba[0] | ((rgba[1] & 0x0f) << 8);
  const transitionSlot = rgba[2] | (((rgba[1] >> 4) & 0x0f) << 8);
  const soilId = rgba[3] & 0x0f;
  return { baseSlot, transitionSlot, soilId };
}
