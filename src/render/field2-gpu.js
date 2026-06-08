// GPU-instanced sprite renderer for Field 2 vegetation.
// Uses WebGL2 instanced rendering to draw thousands of sprites in 1-2 draw calls.
// CPU prepares per-instance data (position, rotation, frame, scale, alpha).
// GPU does all the actual drawing in parallel.

var gl = null;
var program = null;
var quadVAO = null;
var instanceBuffer = null;
var textureAtlas = null;
var atlasWidth = 0;
var atlasHeight = 0;
var atlasFrameWidth = 32;
var atlasFrameHeight = 32;
var atlasColumns = 0;
var atlasRows = 0;
var maxInstances = 16000;
var instanceData = null; // Float32Array
var canvas = null;
var initialized = false;

// Per-instance attributes: x, y, rotation, scaleX, scaleY, alpha, frameU, frameV
var FLOATS_PER_INSTANCE = 8;

var VERT_SRC = `#version 300 es
precision highp float;

// Quad vertex (2D position + UV)
in vec2 a_pos;
in vec2 a_uv;

// Per-instance data
in vec2 i_pos;       // screen position
in float i_rot;      // rotation in radians
in vec2 i_scale;     // scale x, y
in float i_alpha;    // opacity
in vec2 i_frameUV;   // UV offset into atlas for this frame

uniform vec2 u_resolution;
uniform vec2 u_frameSize; // normalized frame size in atlas

out vec2 v_uv;
out float v_alpha;

void main() {
  // Rotate around bottom-center anchor
  float c = cos(i_rot);
  float s = sin(i_rot);
  vec2 scaled = a_pos * i_scale;
  // Anchor at bottom center: shift so (0,0) is at bottom-center
  vec2 anchored = vec2(scaled.x, scaled.y - i_scale.y * 0.5);
  vec2 rotated = vec2(
    anchored.x * c - anchored.y * s,
    anchored.x * s + anchored.y * c
  );
  vec2 screen = i_pos + rotated;

  // Convert to clip space (-1 to 1)
  vec2 clip = (screen / u_resolution) * 2.0 - 1.0;
  clip.y = -clip.y; // flip Y for canvas coordinates
  gl_Position = vec4(clip, 0.0, 1.0);

  // UV: map into atlas frame
  v_uv = i_frameUV + a_uv * u_frameSize;
  v_alpha = i_alpha;
}
`;

var FRAG_SRC = `#version 300 es
precision highp float;

in vec2 v_uv;
in float v_alpha;

uniform sampler2D u_atlas;

out vec4 fragColor;

void main() {
  vec4 tex = texture(u_atlas, v_uv);
  if (tex.a < 0.02) discard;
  fragColor = vec4(tex.rgb, tex.a * v_alpha);
}
`;

function compileShader(gl, type, src) {
  var shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function initField2GPU(existingCanvas) {
  if (initialized) return true;

  // Create an overlay canvas for WebGL on top of the main 2D canvas
  canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.pointerEvents = 'none';
  canvas.style.imageRendering = 'pixelated';
  existingCanvas.parentElement.appendChild(canvas);

  gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false });
  if (!gl) {
    console.warn('[Field2GPU] WebGL2 not available, falling back to Canvas2D');
    return false;
  }

  // Compile shaders
  var vert = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
  var frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vert || !frag) return false;

  program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    return false;
  }

  // Unit quad: two triangles covering (-0.5, -0.5) to (0.5, 0.5)
  var quadVerts = new Float32Array([
    // pos x, y, uv u, v
    -0.5, 0.0, 0, 1,
     0.5, 0.0, 1, 1,
     0.5, 1.0, 1, 0,
    -0.5, 0.0, 0, 1,
     0.5, 1.0, 1, 0,
    -0.5, 1.0, 0, 0,
  ]);

  quadVAO = gl.createVertexArray();
  gl.bindVertexArray(quadVAO);

  // Quad vertex buffer
  var quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

  var a_pos = gl.getAttribLocation(program, 'a_pos');
  var a_uv = gl.getAttribLocation(program, 'a_uv');
  gl.enableVertexAttribArray(a_pos);
  gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(a_uv);
  gl.vertexAttribPointer(a_uv, 2, gl.FLOAT, false, 16, 8);

  // Instance buffer
  instanceBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  instanceData = new Float32Array(maxInstances * FLOATS_PER_INSTANCE);
  gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW);

  var i_pos = gl.getAttribLocation(program, 'i_pos');
  var i_rot = gl.getAttribLocation(program, 'i_rot');
  var i_scale = gl.getAttribLocation(program, 'i_scale');
  var i_alpha = gl.getAttribLocation(program, 'i_alpha');
  var i_frameUV = gl.getAttribLocation(program, 'i_frameUV');

  gl.enableVertexAttribArray(i_pos);
  gl.vertexAttribPointer(i_pos, 2, gl.FLOAT, false, FLOATS_PER_INSTANCE * 4, 0);
  gl.vertexAttribDivisor(i_pos, 1);

  gl.enableVertexAttribArray(i_rot);
  gl.vertexAttribPointer(i_rot, 1, gl.FLOAT, false, FLOATS_PER_INSTANCE * 4, 8);
  gl.vertexAttribDivisor(i_rot, 1);

  gl.enableVertexAttribArray(i_scale);
  gl.vertexAttribPointer(i_scale, 2, gl.FLOAT, false, FLOATS_PER_INSTANCE * 4, 12);
  gl.vertexAttribDivisor(i_scale, 1);

  gl.enableVertexAttribArray(i_alpha);
  gl.vertexAttribPointer(i_alpha, 1, gl.FLOAT, false, FLOATS_PER_INSTANCE * 4, 20);
  gl.vertexAttribDivisor(i_alpha, 1);

  gl.enableVertexAttribArray(i_frameUV);
  gl.vertexAttribPointer(i_frameUV, 2, gl.FLOAT, false, FLOATS_PER_INSTANCE * 4, 24);
  gl.vertexAttribDivisor(i_frameUV, 1);

  gl.bindVertexArray(null);

  // Blending for transparency
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  initialized = true;
  console.log('[Field2GPU] WebGL2 instanced renderer initialized');
  return true;
}

// Build a texture atlas from loaded sprite images.
// Takes a Map of url → Image and packs them into a single GPU texture.
// Returns a mapping of url → {u, v} in the atlas.
var atlasMap = new Map(); // url → { u, v }
var atlasDirty = true;
var lastAtlasSize = 0;

export function buildAtlas(frameCache) {
  if (!gl) return;
  // Only rebuild if cache grew
  var cacheSize = 0;
  frameCache.forEach(function(v) { if (v) cacheSize++; });
  if (cacheSize === lastAtlasSize && !atlasDirty) return;
  lastAtlasSize = cacheSize;
  atlasDirty = false;

  // Collect all valid images
  var images = [];
  frameCache.forEach(function(img, url) {
    if (img && img.complete && img.naturalWidth) {
      images.push({ url: url, img: img });
    }
  });
  if (images.length === 0) return;

  // Determine atlas layout
  atlasFrameWidth = images[0].img.naturalWidth || 32;
  atlasFrameHeight = images[0].img.naturalHeight || 32;
  atlasColumns = Math.ceil(Math.sqrt(images.length));
  atlasRows = Math.ceil(images.length / atlasColumns);
  atlasWidth = atlasColumns * atlasFrameWidth;
  atlasHeight = atlasRows * atlasFrameHeight;

  // Cap at max texture size
  var maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (atlasWidth > maxSize || atlasHeight > maxSize) {
    // Truncate to fit
    var maxFrames = Math.floor(maxSize / atlasFrameWidth) * Math.floor(maxSize / atlasFrameHeight);
    images = images.slice(0, maxFrames);
    atlasColumns = Math.ceil(Math.sqrt(images.length));
    atlasRows = Math.ceil(images.length / atlasColumns);
    atlasWidth = atlasColumns * atlasFrameWidth;
    atlasHeight = atlasRows * atlasFrameHeight;
  }

  // Draw all frames into an offscreen canvas
  var oc = document.createElement('canvas');
  oc.width = atlasWidth;
  oc.height = atlasHeight;
  var octx = oc.getContext('2d');

  atlasMap.clear();
  for (var i = 0; i < images.length; i++) {
    var col = i % atlasColumns;
    var row = Math.floor(i / atlasColumns);
    var x = col * atlasFrameWidth;
    var y = row * atlasFrameHeight;
    octx.drawImage(images[i].img, x, y);
    atlasMap.set(images[i].url, {
      u: x / atlasWidth,
      v: y / atlasHeight
    });
  }

  // Upload to GPU
  if (!textureAtlas) textureAtlas = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, textureAtlas);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, oc);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  console.log('[Field2GPU] Atlas built:', atlasWidth, 'x', atlasHeight, images.length, 'frames');
}

// Render all sprites in one instanced draw call.
// sprites: array of { sx, sy, rotation, scaleX, scaleY, alpha, frameUrl }
export function renderField2GPU(w, h, sprites) {
  if (!gl || !textureAtlas || sprites.length === 0) return;

  // Resize canvas to match viewport
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }

  gl.viewport(0, 0, w, h);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(program);
  gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), w, h);
  gl.uniform2f(gl.getUniformLocation(program, 'u_frameSize'),
    atlasFrameWidth / atlasWidth,
    atlasFrameHeight / atlasHeight
  );

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, textureAtlas);
  gl.uniform1i(gl.getUniformLocation(program, 'u_atlas'), 0);

  // Fill instance buffer
  var count = Math.min(sprites.length, maxInstances);
  for (var i = 0; i < count; i++) {
    var s = sprites[i];
    var uv = atlasMap.get(s.frameUrl);
    if (!uv) continue;
    var off = i * FLOATS_PER_INSTANCE;
    instanceData[off + 0] = s.sx;
    instanceData[off + 1] = s.sy;
    instanceData[off + 2] = s.rotation;
    instanceData[off + 3] = s.scaleX;
    instanceData[off + 4] = s.scaleY;
    instanceData[off + 5] = s.alpha;
    instanceData[off + 6] = uv.u;
    instanceData[off + 7] = uv.v;
  }

  gl.bindVertexArray(quadVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData.subarray(0, count * FLOATS_PER_INSTANCE));

  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
  gl.bindVertexArray(null);
}

export function isGPUReady() { return initialized && textureAtlas !== null; }
export function getAtlasMap() { return atlasMap; }
