// scripts/bench-offscreen-roof.mjs — throwaway de-risk benchmark (Task 1 of the
// building-bake-worker plan). Answers: does worker OffscreenCanvas 2D GPU-accelerate
// the roof's sheared drawImage, or fall back to software like main-thread Offscreen?
// Renders the SAME 216-facet sheared-drawImage workload in three contexts and reports
// median ms. Not shipped. ALWAYS run wrapped: timeout 90 node scripts/bench-offscreen-roof.mjs
import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage();
p.on('console', m => console.log('PAGE:', m.text().slice(0, 200)));
p.on('pageerror', e => console.log('PAGEERROR:', e.message.slice(0, 200)));
await p.setContent('<!doctype html><body></body>');
const res = await p.evaluate(async () => {
  const W = 1374, H = 1998, FACETS = 216, RUNS = 5;
  function mkTex() {
    const c = new OffscreenCanvas(256, 256); const x = c.getContext('2d');
    x.fillStyle = '#8a6'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 40; i++) { x.fillStyle = `hsl(${i * 9},50%,${30 + i}%)`; x.fillRect((i * 37) % 256, (i * 53) % 256, 24, 18); }
    return c.transferToImageBitmap();
  }
  function workload(ctx, tex) {
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < FACETS; i++) {
      const px = (i * 61) % (W - 120), py = (i * 47) % (H - 90);
      ctx.save(); ctx.setTransform(1, 0.28, -0.14, 1, px, py); ctx.drawImage(tex, 0, 0, 256, 256, 0, 0, 118, 86); ctx.restore();
    }
  }
  function med(a) { a = [...a].sort((x, y) => x - y); return a[a.length >> 1]; }
  const tex = mkTex();
  // A: DOM canvas (today's roof path)
  const dom = document.createElement('canvas'); dom.width = W; dom.height = H; const dctx = dom.getContext('2d');
  const A = []; for (let r = 0; r < RUNS; r++) { const t = performance.now(); workload(dctx, tex); dctx.getImageData(0, 0, 1, 1); A.push(performance.now() - t); }
  // B: main-thread OffscreenCanvas
  const off = new OffscreenCanvas(W, H); const octx = off.getContext('2d');
  const B = []; for (let r = 0; r < RUNS; r++) { const t = performance.now(); workload(octx, tex); octx.getImageData(0, 0, 1, 1); B.push(performance.now() - t); }
  // C: worker OffscreenCanvas
  const src = `self.onmessage = async () => {
    const W=${W},H=${H},FACETS=${FACETS},RUNS=${RUNS};
    const c=new OffscreenCanvas(256,256),x=c.getContext('2d');x.fillStyle='#8a6';x.fillRect(0,0,256,256);
    for(let i=0;i<40;i++){x.fillStyle='hsl('+(i*9)+',50%,'+(30+i)+'%)';x.fillRect((i*37)%256,(i*53)%256,24,18);}
    const tex=c.transferToImageBitmap();
    const off=new OffscreenCanvas(W,H),ctx=off.getContext('2d');
    function wl(){ctx.clearRect(0,0,W,H);for(let i=0;i<FACETS;i++){const px=(i*61)%(W-120),py=(i*47)%(H-90);ctx.save();ctx.setTransform(1,0.28,-0.14,1,px,py);ctx.drawImage(tex,0,0,256,256,0,0,118,86);ctx.restore();}}
    const C=[];for(let r=0;r<RUNS;r++){const t=performance.now();wl();ctx.getImageData(0,0,1,1);C.push(performance.now()-t);}
    postMessage(C); };`;
  const wURL = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const w = new Worker(wURL);
  const C = await new Promise(res => { w.onmessage = e => res(e.data); w.postMessage(1); });
  return { A: med(A), B: med(B), C: med(C), A_all: A, B_all: B, C_all: C };
});
console.log('MEDIAN ms  A(DOM):', res.A.toFixed(1), ' B(main-Offscreen):', res.B.toFixed(1), ' C(worker-Offscreen):', res.C.toFixed(1));
console.log('RAW', JSON.stringify(res));
await b.close();
