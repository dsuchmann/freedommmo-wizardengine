// flora-desc-codec.js — transferable serialization for per-chunk flora descriptors.
//
// The chunk worker builds a flora descriptor (buildTileDescriptor) for every tile in a
// chunk, then encodes them here into TWO transferable ArrayBuffers: a UTF-8 byte blob of
// per-tile JSON, plus a Uint32 offset table [start,end] per tile. Transfer = ZERO structured-
// clone cost on the main thread (the whole point — a plain-object postMessage of ~30k blades
// would be a 20-50ms deserialize spike on chunk arrival). The main thread stores the buffers
// on the chunk and decodes ONE tile at a time inside the amortized pool build (decodeTileFlora),
// so the JSON.parse cost is spread across frames exactly like the old main-thread build was.
//
// PARITY: JSON round-trips the descriptor exactly (all fields are number/string/null/bool;
// undefined keys drop on both encode and read, so `blade.frameCount` is undefined either way).
// This is what makes the worker descriptor byte-identical to the main-thread one by construction.
// DOM-free + dependency-free → trivially unit-testable and importable by both threads.

// Encode an array of per-tile descriptors (indexed by local tile index ty*chunkSize+tx;
// each entry is a desc object, or null/undefined for "no flora on this tile") into
// { bytes: Uint8Array, offsets: Uint32Array }. offsets has 2 entries per tile: [start,end)
// byte range into `bytes`; end===start means the tile has no descriptor.
export function encodeChunkFlora(descs, tileCount) {
  var enc = new TextEncoder();
  var parts = new Array(tileCount);
  var offsets = new Uint32Array(tileCount * 2);
  var cursor = 0;
  for (var i = 0; i < tileCount; i++) {
    offsets[i * 2] = cursor;
    var d = descs[i];
    if (d) {
      var bytes = enc.encode(JSON.stringify(d));
      parts[i] = bytes;
      cursor += bytes.length;
    }
    offsets[i * 2 + 1] = cursor;
  }
  var buf = new Uint8Array(cursor);
  var off = 0;
  for (var j = 0; j < tileCount; j++) {
    var p = parts[j];
    if (p) { buf.set(p, off); off += p.length; }
  }
  return { bytes: buf, offsets: offsets };
}

var _dec = null;

// Decode a single tile's descriptor from the transferred buffers. Returns the desc object,
// or null if the tile has no flora. Cheap + amortizable: one subarray view + TextDecoder +
// JSON.parse of a small (~few KB) per-tile string.
export function decodeTileFlora(bytes, offsets, tileIndex) {
  var s = offsets[tileIndex * 2], e = offsets[tileIndex * 2 + 1];
  if (e <= s) return null;
  if (!_dec) _dec = new TextDecoder();
  return JSON.parse(_dec.decode(bytes.subarray(s, e)));
}
