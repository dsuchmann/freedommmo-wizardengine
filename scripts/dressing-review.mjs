// scripts/dressing-review.mjs — the BELIEVABLE-PLACEMENT review gate for dressing props.
// A prop that looks fine on a transparent background can be unplaceable in situ (e.g. an awning whose back
// drape covers the door). This composites a prop onto a real grassland wall mock — a door tile (ground
// storey) under an upper storey — at its ACTUAL placement (socket v + size + anchor), so you can judge
// whether it reads believably ON the building before generating the prop at scale.
//   usage: node scripts/dressing-review.mjs <propPng> <socketV> <sizeTiles> [anchor=center|top|bottom] [out=review.png] [material=timber_frame]
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

const [propPng, vArg, szArg, anchor = 'center', out = 'review.png', material = 'timber_frame'] = process.argv.slice(2);
const V = +vArg, SZ = +szArg;
const TILE = 48, WH = TILE * 4;                       // wallHeight = 4 tiles
const D = `assets/pixelab/buildings/tiles/grassland/${material}/`;

const door = await loadImage(D + 'ground_door__v0.png');
const upper = await loadImage(D + 'upper_plain__v0.png').catch(() => null);
const prop = await loadImage(propPng);

const colW = TILE * 4;                                // aperture tiles are 4 tiles wide
const H = Math.round(WH * 2.4);
const cv = createCanvas(colW, H), x = cv.getContext('2d');
x.imageSmoothingEnabled = false;
// grass-ish checker so transparent areas of the prop are obvious
for (let yy = 0; yy < H; yy += 16) for (let xx = 0; xx < colW; xx += 16) { x.fillStyle = ((xx / 16 + yy / 16) % 2) ? '#5f7d35' : '#6f8d40'; x.fillRect(xx, yy, 16, 16); }

const groundTop = H - WH;                             // ground storey occupies the bottom band
if (upper) x.drawImage(upper, 0, 0, upper.width, upper.height, 0, groundTop - WH, colW, WH);
x.drawImage(door, 0, 0, door.width, door.height, 0, groundTop, colW, WH);

// placement mirrors d3-props/projectSocket: v measured from the storey ground line (band bottom).
const groundLine = groundTop + WH;
const py = groundLine - V * WH;                        // socket point (the door is centred at colW/2)
const sz = Math.round(TILE * SZ), half = sz / 2;
const dy = anchor === 'top' ? Math.round(py) : anchor === 'bottom' ? Math.round(py - sz) : Math.round(py - half);
x.drawImage(prop, 0, 0, prop.width, prop.height, Math.round(colW / 2 - half), dy, sz, sz);

fs.writeFileSync(out, cv.toBuffer('image/png'));
console.log(`wrote ${out} — prop @ v=${V} size=${SZ} anchor=${anchor} over a ${material} door`);
