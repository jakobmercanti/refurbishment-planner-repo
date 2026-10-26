import assert from 'node:assert/strict';
import test from 'node:test';
import {autoDeltaRange,availablePlanes,nearestPlane,inPlaneAxes,restoreSliceState,defaultSliceState,rangeFor,sliceCSV,sliceDataSchema,type SliceManifest,type SlicePlane} from '../lib/cfdSlices';
import {sliceColour} from '../components/CFDSlicePlot';

const plane=(axis,coordinate,time='100')=>({id:`${axis}:${coordinate}:${time}`,axis,coordinate,time}) as SlicePlane;
test('physical irregular navigation uses real coordinates, one time and per-axis frames',()=>{
  const manifest={planes:[plane('X',.1),plane('X',.9),plane('X',.35),plane('X',.5,'200'),plane('Y',.8),plane('Z',1.2)]} as SliceManifest;
  const planes=availablePlanes(manifest,'X','100');assert.deepEqual(planes.map(p=>p.coordinate),[.1,.35,.9]);
  assert.equal(nearestPlane(planes,.4)?.coordinate,.35);assert.equal(nearestPlane([],0),undefined);
  assert.deepEqual(inPlaneAxes('X'),[1,2]);assert.deepEqual(inPlaneAxes('Y'),[0,2]);assert.deepEqual(inPlaneAxes('Z'),[0,1]);
  assert.deepEqual(availablePlanes(manifest,'X','').map(p=>p.time),['200']);
});
test('persisted state is bounded and validated; legends retain math-independent display preferences',()=>{
  const state={...defaultSliceState,mode:'compare',baseline:'a',option:'b',coordinates:{X:.35,Z:1.2},legends:{U:{shared:{auto:false,min:0,max:20,palette:'viridis',bands:5,ticks:5,precision:3},delta:{auto:false,min:-2,max:4,palette:'coolwarm',bands:9,ticks:5,precision:2}}}};
  assert.deepEqual(restoreSliceState(JSON.stringify(state)),state);
  assert.deepEqual(restoreSliceState('{invalid'),defaultSliceState);assert.deepEqual(restoreSliceState(JSON.stringify({...state,size:100000})),defaultSliceState);
  assert.deepEqual(rangeFor([null,-3,0,2,null]),[-3,2]);
});
test('diverging zero, asymmetric clipping and constant fields do not corrupt numeric data',()=>{
  assert.deepEqual(sliceColour(0,-2,4,'coolwarm'),[240,240,235]);
  assert.deepEqual(sliceColour(-20,-2,4,'coolwarm'),sliceColour(-2,-2,4,'coolwarm'));
  assert.deepEqual(sliceColour(10,10,10,'viridis'),[33,145,140]);
  assert.deepEqual(autoDeltaRange([0,0,null]),[-1,1]);assert.deepEqual(autoDeltaRange([null]),[-1,1]);assert.deepEqual(autoDeltaRange([1e-9,-2e-9]),[-2e-9,2e-9]);
  assert.notDeepEqual(sliceColour(1,-2,4,'coolwarm',5),sliceColour(1,-2,4,'coolwarm',0));
});
test('CSV uses physical area-centre coordinates, masked blanks and explicit sign/provenance',()=>{
  const data={axis:'X',coordinate:3,field:'U',component:-1,unit:'m/s',deltaUnit:'m/s',deltaMode:'absolute',epsilon:1e-6,definition:'Option − Baseline',method:'real cell data',baseline:{run:'a',asset:'hash',time:'100'},option:{run:'b',asset:'hash2',time:'100'},bounds:[0,10,2,14],size:2,a:[10,null,10,10],b:[12,12,null,12],delta:[2,null,null,2],notes:[]};
  const csv=sliceCSV(data as never);assert.match(csv,/Option − Baseline/);assert.match(csv,/3,0.5,11,10,12,2,1/);assert.match(csv,/3,1.5,11,,12,,0/);
  assert.equal(data.a[0],10);assert.equal(data.delta[0],2);
});
test('network contract rejects nonfinite values, wrong shapes and oversized numeric rasters',()=>{
  assert.equal(sliceDataSchema.safeParse({a:[NaN]}).success,false);
  assert.equal(sliceDataSchema.safeParse({size:513}).success,false);
});
