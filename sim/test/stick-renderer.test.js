import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPose, renderStrip } from '../../src/life/eval/stick-renderer.js';
import { readFileSync } from 'node:fs';

const rig = JSON.parse(readFileSync('src/life/rigs/humanoid.json', 'utf8'));

test('renderPose returns a PNG buffer for rest pose', async () => {
  const buf = await renderPose(rig, {}, { width: 400, height: 600 });
  assert.ok(Buffer.isBuffer(buf), 'should return a Buffer');
  assert.ok(buf.length > 100, 'buffer should contain image data');
  assert.ok(buf[0] === 0x89 && buf[1] === 0x50, 'should be a PNG');
});

test('renderPose with joints produces different image than rest', async () => {
  const rest = await renderPose(rig, {}, { width: 400, height: 600 });
  const wave = await renderPose(rig, { arm_u_r: 150 }, { width: 400, height: 600 });
  assert.ok(!rest.equals(wave), 'posed image should differ from rest');
});

test('renderStrip produces a wide image from multiple frames', async () => {
  const frames = [
    { joints: {}, label: 'rest' },
    { joints: { arm_u_r: 150 }, label: 'arm up' },
    { joints: {}, label: 'rest' },
  ];
  const buf = await renderStrip(rig, frames, { frameWidth: 200, frameHeight: 400, title: 'wave test' });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 100);
});
