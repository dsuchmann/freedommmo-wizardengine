// sim/test/floor-view-state.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildingNode } from '../world/buildings/blueprint-node.js';
import * as FV from '../../src/render/floor-view-state.js';

const TOWER = { bx: 0, by: 8, typeId: 'commercial', category: 'commercial', tier: 'town', centrality: 0.85 }; // has lift, floors -1..4
const HOUSE = { bx: 0, by: 0, typeId: 'house', category: 'house', tier: 'village', centrality: 0.1 };          // 1 floor, no lift

test('enterBuilding starts on the lowest above-ground floor and clears on exit', () => {
  const fv = FV.enterBuilding(buildingNode(1337, TOWER), 'b1');
  assert.equal(fv.floorIndex, 0, 'ground = lowest index >= 0 (basement is -1)');
  assert.ok(FV.isFloorViewActive());
  FV.exitFloorView();
  assert.equal(FV.isFloorViewActive(), false);
  assert.equal(FV.getFloorView(), null);
});

test('changeFloor moves by ±1 and clamps to the floor range', () => {
  FV.enterBuilding(buildingNode(1337, TOWER), 'b1'); // keys -1..4, start 0
  assert.equal(FV.changeFloor(-1), true); assert.equal(FV.getFloorView().floorIndex, -1); FV.clearTransition();
  assert.equal(FV.changeFloor(-1), false, 'cannot go below the basement'); FV.clearTransition?.();
  assert.equal(FV.getFloorView().floorIndex, -1);
  for (let i = 0; i < 5; i++) { FV.changeFloor(1); FV.clearTransition(); }
  assert.equal(FV.getFloorView().floorIndex, 4, 'clamped at the top floor');
  assert.equal(FV.changeFloor(1), false, 'cannot go above the top');
  FV.exitFloorView();
});

test('lift gating: lift only available when the building has a lift', () => {
  FV.enterBuilding(buildingNode(1337, TOWER), 'b1');
  assert.equal(FV.liftAvailable(), true);
  assert.equal(FV.gotoFloor(3, 'lift'), true); FV.clearTransition();
  assert.equal(FV.getFloorView().floorIndex, 3);
  FV.exitFloorView();
  FV.enterBuilding(buildingNode(1337, HOUSE), 'b2');
  assert.equal(FV.liftAvailable(), false);
  assert.equal(FV.gotoFloor(0, 'lift'), false, 'no lift jumps without a lift');
  FV.exitFloorView();
});

test('a transition records {kind, from, dir} and blocks further moves until cleared', () => {
  FV.enterBuilding(buildingNode(1337, TOWER), 'b1');
  assert.equal(FV.changeFloor(1), true);
  const tr = FV.getFloorView().transition;
  assert.equal(tr.kind, 'stair'); assert.equal(tr.from, 0); assert.equal(tr.dir, 1);
  assert.equal(FV.changeFloor(1), false, 'blocked mid-transition');
  FV.clearTransition();
  assert.equal(FV.getFloorView().transition, null);
  assert.equal(FV.changeFloor(1), true, 'moves again once cleared'); FV.clearTransition();
  FV.exitFloorView();
});

test('enter/exit unit toggles enteredUnitId', () => {
  FV.enterBuilding(buildingNode(1337, TOWER), 'b1');
  FV.enterUnit('u-1'); assert.equal(FV.getFloorView().enteredUnitId, 'u-1');
  FV.exitUnit(); assert.equal(FV.getFloorView().enteredUnitId, null);
  FV.exitFloorView();
});
