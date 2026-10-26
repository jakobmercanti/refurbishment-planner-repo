import assert from 'node:assert/strict';
import test from 'node:test';
import { resultProbeMesh, intersectResultPlane, sampleResultPoint, probeNumber } from '../lib/cfdPointProbe';
import type { ResultField } from '../lib/cfdResultData';

const points=[0,0,0,1,0,0,1,1,0,0,1,0],polys=[4,0,1,2,3];
const field=(name='p',components=1,cell=false):ResultField=>({name,key:`${cell?'cell':'point'}:${name}`,cell,components,range:[0,10],componentRanges:Array.from({length:components},()=>[0,10])});
test('plane picks interpolate actual scalar tuples at the selected location, not nearest nodes or colours',()=>{
  const mesh=resultProbeMesh(points,polys),hit=intersectResultPlane(mesh,[.25,.25,1],[.25,.25,-1]);assert.ok(hit);
  const result=sampleResultPoint(mesh,hit.triangle,hit.position,field(),[0,1,3,2]);assert.ok(result);
  assert.equal(result.value,.75);assert.deepEqual(result.position,[.25,.25,0]);assert.equal(result.cell,false);
  assert.deepEqual(points,[0,0,0,1,0,0,1,1,0,0,1,0]);assert.deepEqual(polys,[4,0,1,2,3]);
});
test('vector components and magnitude use the interpolated vector, and cell fields keep their original cell index',()=>{
  const mesh=resultProbeMesh(points,polys,2),hit=intersectResultPlane(mesh,[.25,.25,1],[.25,.25,-1]);assert.ok(hit);
  const values=[1,0,3,2,0,3,2,2,3,1,2,3];
  assert.equal(sampleResultPoint(mesh,hit.triangle,hit.position,field('U',3),values,0)?.value,1.25);
  assert.equal(sampleResultPoint(mesh,hit.triangle,hit.position,field('U',3),values,1)?.value,.5);
  assert.equal(sampleResultPoint(mesh,hit.triangle,hit.position,field('U',3),values)?.value,Math.hypot(1.25,.5,3));
  assert.equal(sampleResultPoint(mesh,hit.triangle,hit.position,field('q',1,true),[999,888,42])?.value,42);
});
test('concave polygons, triangle strips and clipped/missed rays do not produce false picks',()=>{
  const mesh=resultProbeMesh([0,0,0,2,0,0,2,1,0,1,1,0,1,2,0,0,2,0],[6,0,1,2,3,4,5]);
  assert.equal(intersectResultPlane(mesh,[1.5,1.5,1],[1.5,1.5,-1]),null);
  assert.ok(intersectResultPlane(mesh,[.5,1.5,1],[.5,1.5,-1]));
  assert.equal(intersectResultPlane(mesh,[.5,.5,2],[.5,.5,1]),null);
  assert.equal(intersectResultPlane(mesh,[NaN,0,0],[0,0,0]),null);
  const strip=resultProbeMesh(points,[],4,[4,0,1,3,2]);assert.deepEqual(strip.cells,[4,4]);assert.ok(intersectResultPlane(strip,[.5,.5,1],[.5,.5,-1]));
});
test('invalid/degenerate samples are unavailable rather than fabricated numeric values',()=>{
  const mesh=resultProbeMesh(points,polys);
  assert.equal(sampleResultPoint(mesh,-1,[.25,.25,0],field(),[0,1,3,2]),null);
  assert.equal(sampleResultPoint(mesh,0,[10,10,0],field(),[0,1,3,2]),null);
  assert.equal(sampleResultPoint(mesh,0,[.25,.25,0],field(),[NaN,NaN,NaN,NaN]),null);
  assert.equal(sampleResultPoint(mesh,0,[.25,.25,0],field('U',3),[],3),null);
  assert.equal(probeNumber(0),'0');assert.equal(probeNumber(1e-12),'1e-12');
});
