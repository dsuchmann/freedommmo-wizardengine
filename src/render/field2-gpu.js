// GPU-instanced sprite renderer for Field 2 vegetation.
// Renders thousands of sprites in 1-2 draw calls using WebGL2 instancing.
// Output is composited onto the main 2D canvas via drawImage.

var gl = null;
var program = null;
var quadVAO = null;
var instanceBuffer = null;
var textureAtlas = null;
var atlasWidth = 0;
var atlasHeight = 0;
var atlasFrameW = 0;
var atlasFrameH = 0;
var atlasColumns = 0;
var maxInstances = 20000;
var instanceData = null;
var glCanvas = null;
var initialized = false;
var FLOATS_PER_INSTANCE = 8; // x, y, rot, scaleX, scaleY, alpha, uvX, uvY

var VERT = `#version 300 es
precision highp float;
in vec2 a_pos;
in vec2 a_uv;
in vec2 i_pos;
in float i_rot;
in vec2 i_scale;
in float i_alpha;
in vec2 i_uv;
uniform vec2 u_res;
uniform vec2 u_frameSz;
out vec2 v_uv;
out float v_alpha;
void main() {
  vec2 s = a_pos * i_scale;
  vec2 a = vec2(s.x, s.y - i_scale.y * 0.5);
  float c = cos(i_rot), sn = sin(i_rot);
  vec2 r = vec2(a.x*c - a.y*sn, a.x*sn + a.y*c);
  vec2 p = (i_pos + r) / u_res * 2.0 - 1.0;
  gl_Position = vec4(p.x, -p.y, 0, 1);
  v_uv = i_uv + a_uv * u_frameSz;
  v_alpha = i_alpha;
}`;

var FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
in float v_alpha;
uniform sampler2D u_tex;
out vec4 fc;
void main() {
  vec4 t = texture(u_tex, v_uv);
  if (t.a < 0.02) discard;
  fc = vec4(t.rgb, t.a * v_alpha);
}`;

function makeShader(type, src) {
  var s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('[F2GPU] shader:', gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}

export function initField2GPU() {
  if (initialized) return true;
  glCanvas = document.createElement('canvas');
  gl = glCanvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) { console.warn('[F2GPU] No WebGL2'); return false; }

  var vs = makeShader(gl.VERTEX_SHADER, VERT);
  var fs = makeShader(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return false;
  program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[F2GPU] link:', gl.getProgramInfoLog(program));
    return false;
  }

  // Unit quad (bottom-center anchor)
  var q = new Float32Array([
    -0.5,0, 0,1,  0.5,0, 1,1,  0.5,1, 1,0,
    -0.5,0, 0,1,  0.5,1, 1,0, -0.5,1, 0,0,
  ]);
  quadVAO = gl.createVertexArray();
  gl.bindVertexArray(quadVAO);
  var qb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, qb);
  gl.bufferData(gl.ARRAY_BUFFER, q, gl.STATIC_DRAW);
  var aPos = gl.getAttribLocation(program, 'a_pos');
  var aUv = gl.getAttribLocation(program, 'a_uv');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

  instanceBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  instanceData = new Float32Array(maxInstances * FLOATS_PER_INSTANCE);
  gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW);

  var attrs = ['i_pos','i_rot','i_scale','i_alpha','i_uv'];
  var sizes = [2,1,2,1,2];
  var offsets = [0,8,12,20,24];
  for (var i = 0; i < attrs.length; i++) {
    var loc = gl.getAttribLocation(program, attrs[i]);
    if (loc < 0) continue;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, sizes[i], gl.FLOAT, false, FLOATS_PER_INSTANCE * 4, offsets[i]);
    gl.vertexAttribDivisor(loc, 1);
  }
  gl.bindVertexArray(null);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha
  initialized = true;
  console.log('[F2GPU] Ready');
  return true;
}

// Atlas: pack loaded images into one GPU texture
var atlasMap = new Map(); // url → { u, v }
var lastAtlasCount = 0;

export function buildAtlas(frameCache) {
  if (!gl) return;
  var count = 0;
  frameCache.forEach(function(v) { if (v && v.complete && (v.naturalWidth || v.width)) count++; });
  if (count === lastAtlasCount || count === 0) return;
  lastAtlasCount = count;

  var imgs = [];
  frameCache.forEach(function(img, url) {
    if (img && img.complete && (img.naturalWidth || img.width)) imgs.push({ url: url, img: img });
  });

  atlasFrameW = imgs[0].img.naturalWidth || imgs[0].img.width || 32;
  atlasFrameH = imgs[0].img.naturalHeight || imgs[0].img.height || 32;
  atlasColumns = Math.ceil(Math.sqrt(imgs.length));
  var rows = Math.ceil(imgs.length / atlasColumns);
  atlasWidth = atlasColumns * atlasFrameW;
  atlasHeight = rows * atlasFrameH;

  var maxSz = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (atlasWidth > maxSz || atlasHeight > maxSz) {
    var maxFrames = Math.floor(maxSz / atlasFrameW) * Math.floor(maxSz / atlasFrameH);
    imgs = imgs.slice(0, maxFrames);
    atlasColumns = Math.ceil(Math.sqrt(imgs.length));
    rows = Math.ceil(imgs.length / atlasColumns);
    atlasWidth = atlasColumns * atlasFrameW;
    atlasHeight = rows * atlasFrameH;
  }

  var oc = document.createElement('canvas');
  oc.width = atlasWidth;
  oc.height = atlasHeight;
  var octx = oc.getContext('2d');
  atlasMap.clear();
  for (var i = 0; i < imgs.length; i++) {
    var col = i % atlasColumns;
    var row = Math.floor(i / atlasColumns);
    octx.drawImage(imgs[i].img, col * atlasFrameW, row * atlasFrameH);
    atlasMap.set(imgs[i].url, { u: col * atlasFrameW / atlasWidth, v: row * atlasFrameH / atlasHeight });
  }

  if (!textureAtlas) textureAtlas = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, textureAtlas);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, oc);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  console.log('[F2GPU] Atlas:', atlasWidth, 'x', atlasHeight, imgs.length, 'frames');
}

// Render sprites. Returns the canvas to composite onto the main 2D canvas.
// sprites: [{ sx, sy, rot, w, h, alpha, url }]
export function renderField2GPU(w, h, sprites) {
  if (!gl || !textureAtlas || sprites.length === 0) return null;
  if (glCanvas.width !== w || glCanvas.height !== h) {
    glCanvas.width = w;
    glCanvas.height = h;
  }
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);
  gl.uniform2f(gl.getUniformLocation(program, 'u_res'), w, h);
  gl.uniform2f(gl.getUniformLocation(program, 'u_frameSz'), atlasFrameW / atlasWidth, atlasFrameH / atlasHeight);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, textureAtlas);
  gl.uniform1i(gl.getUniformLocation(program, 'u_tex'), 0);

  var count = Math.min(sprites.length, maxInstances);
  var written = 0;
  for (var i = 0; i < count; i++) {
    var s = sprites[i];
    var uv = atlasMap.get(s.url);
    if (!uv) continue;
    var off = written * FLOATS_PER_INSTANCE;
    instanceData[off] = s.sx;
    instanceData[off+1] = s.sy;
    instanceData[off+2] = s.rot;
    instanceData[off+3] = s.w;
    instanceData[off+4] = s.h;
    instanceData[off+5] = s.alpha;
    instanceData[off+6] = uv.u;
    instanceData[off+7] = uv.v;
    written++;
  }
  if (written === 0) return null;

  gl.bindVertexArray(quadVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData.subarray(0, written * FLOATS_PER_INSTANCE));
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, written);
  gl.bindVertexArray(null);
  return glCanvas;
}

export function getAtlasMap() { return atlasMap; }
export function isGPUReady() { return initialized && textureAtlas !== null; }
export { glCanvas as gpuCanvas };
