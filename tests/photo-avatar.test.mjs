import test from 'node:test';
import assert from 'node:assert/strict';
import { audioPose, atlasCell } from '../public/photo-avatar.js';
test('quiet/invalid audio closes the mouth; spectral cues select actual generated poses',()=>{
  assert.equal(audioPose(0),0); assert.equal(audioPose(NaN),0);
  assert.equal(audioPose(.2),1); assert.equal(audioPose(.08,100,20,10),3);
  assert.equal(audioPose(.06,20,90,20),2); assert.equal(audioPose(.04,70,60,20),5);
});
test('six mouth/eyelid cells map to the atlas and invalid indices remain bounded',()=>{
  assert.deepEqual(Array.from({length:6},(_,i)=>atlasCell(i)),[[0,1],[1,1],[2,1],[0,0],[1,0],[2,0]]);
  assert.deepEqual(atlasCell(-9),[0,1]); assert.deepEqual(atlasCell(99),[2,0]);
});
