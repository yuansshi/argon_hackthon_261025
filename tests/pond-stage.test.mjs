import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PondStage, buildPondPlan, describePondPlan } from '../public/pond-stage.js';

test('the original loop has ten distinct trees and ten exact six-metre curved gaps', () => {
  const plan = buildPondPlan({ nodeId: 'gaps' });
  assert.equal(plan.trees.length, 10);
  assert.equal(plan.gaps.length, 10);
  assert.equal(new Set(plan.trees.map(tree => `${tree.x},${tree.z}`)).size, 10);
  for (const gap of plan.gaps) assert.ok(Math.abs((gap.endAngle - gap.startAngle) * plan.radius - 6) < 1e-12);
  assert.deepEqual(plan.gaps.at(-1).end, 0);
});

test('each gap contains exactly two evenly spaced interior shrubs, including the closing pair', () => {
  const plan = buildPondPlan({ nodeId: 'solution', reveal: true });
  assert.equal(plan.shrubs.length, 20);
  for (const gap of plan.gaps) assert.deepEqual(plan.shrubs.filter(shrub => shrub.gapIndex === gap.index).map(shrub => shrub.fraction), [1 / 3, 2 / 3]);
  assert.deepEqual(plan.shrubs.slice(-2).map(shrub => shrub.index), [18, 19]);
  assert.equal(plan.shrubs.at(-1).gapIndex, 9);
});

test('the separate transfer loop uses six trees and twelve shrubs, not the original counts', () => {
  const plan = buildPondPlan({ nodeId: 'transfer', reveal: true });
  assert.equal(plan.circumference, 36);
  assert.equal(plan.trees.length, 6);
  assert.equal(plan.shrubs.length, 12);
  assert.equal(plan.visibleGaps, 6);
  assert.equal(plan.visibleShrubs, 12);
});

test('model controls are clamped and support both renderer and backend aliases', () => {
  const plan = buildPondPlan({ nodeId: 'pairs', focus: 30, tracedGaps: -2, shrubPairs: 2 });
  assert.equal(plan.focusGap, 9);
  assert.equal(plan.visibleGaps, 0);
  assert.equal(plan.visibleShrubs, 4);
  const direct = buildPondPlan({ nodeId: 'transfer', focusGap: 3, visibleGaps: 20, visibleShrubs: 3 });
  assert.equal(direct.focusGap, 3);
  assert.equal(direct.visibleGaps, 6);
  assert.equal(direct.visibleShrubs, 3);
});

test('visual focus and progressive reveals never change the underlying planting arithmetic', () => {
  const first = buildPondPlan({ nodeId: 'situation' });
  const last = buildPondPlan({ nodeId: 'solution', focusGap: 9, visibleGaps: 2, visibleShrubs: 19, reveal: true });
  assert.deepEqual(first.trees, last.trees);
  assert.deepEqual(first.gaps, last.gaps);
  assert.deepEqual(first.shrubs, last.shrubs);
});

test('accessible descriptions preserve provided quantities but do not reveal totals before checking', () => {
  const description = describePondPlan(buildPondPlan({ nodeId: 'gaps' }));
  assert.match(description, /60-metre/);
  assert.match(description, /6 metres/);
  assert.doesNotMatch(description, /10 equal gaps|10 distinct|20 shrubs/);
  assert.match(describePondPlan(buildPondPlan({ nodeId: 'solution', reveal: true })), /10 equal gaps and 10 distinct willows/);
});

test('invalid inputs produce a bounded original-lesson plan, never NaN geometry', () => {
  const plan = buildPondPlan({ nodeId: 'unknown', focusGap: 'nonsense', visibleGaps: NaN, visibleShrubs: Infinity });
  assert.equal(plan.nodeId, 'situation');
  assert.equal(plan.focusGap, 0);
  assert.equal(plan.visibleGaps, 0);
  assert.equal(plan.visibleShrubs, 0);
  assert.ok(plan.trees.every(tree => Number.isFinite(tree.x) && Number.isFinite(tree.z)));
});

test('a detailed willow uses two draw objects, with instanced leaves hanging down from curved branches', () => {
  const stage = Object.create(PondStage.prototype);
  stage.THREE = THREE;
  stage.materials = { bark: new THREE.MeshStandardMaterial(), leaf: new THREE.MeshStandardMaterial() };
  const tree = stage._willowTemplate();
  assert.equal(tree.children.length, 2);
  const foliage = tree.children.find(object => object.isInstancedMesh);
  assert.ok(foliage);
  assert.equal(foliage.count, 760);
  const matrix = new THREE.Matrix4();
  const heights = [];
  for (let index = 0; index < foliage.count; index++) { foliage.getMatrixAt(index, matrix); heights.push(matrix.elements[13]); }
  assert.ok(Math.min(...heights) < 1.6);
  assert.ok(Math.max(...heights) > 2.8);
  stage._disposeObject(tree, false);
});

test('a flowering shrub merges its foliage and flowers into two draw objects', () => {
  const stage = Object.create(PondStage.prototype);
  stage.THREE = THREE;
  stage.materials = { shrub: new THREE.MeshStandardMaterial(), flower: new THREE.MeshStandardMaterial() };
  const shrub = stage._shrubTemplate();
  assert.equal(shrub.children.length, 2);
  assert.ok(shrub.children.every(object => object.isMesh && object.geometry.attributes.position.count > 0));
  stage._disposeObject(shrub, false);
});
