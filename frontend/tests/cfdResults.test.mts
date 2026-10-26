import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { archiveEntries, archiveFile, postprocessingArchive } from '../lib/cfdArchive';
import { CFDJobProgress } from '../components/CFDJobProgress';
import { ClimoptixConvergence } from '../components/ClimoptixConvergence';
import { newCFDScenario } from '../lib/climoptixDocument';
import { preparationInput, preparationRequestBody } from '../lib/climoptix';
import { cfdProject } from './climoptixFixtures';
import type { CFDWorkerJob } from '../lib/climoptixJobs';
import { checkVTKText } from '../lib/climoptixVTK';
import { parseResidualLog } from '../lib/climoptixWorkflow';

test('native folders inspect without extracting all data; filtered post-processing preserves files',async()=>{
  const bytes=zipSync({'system/controlDict':strToU8('settings'),'postProcessing/probes/0/U':strToU8('native probes'),'postProcessing/slices/20/xy.vtk':strToU8('slice')});
  assert.equal(archiveEntries(bytes).length,3);
  assert.equal(await archiveFile(bytes,'system/controlDict').text(),'settings');
  const zip=unzipSync(new Uint8Array(await postprocessingArchive(bytes).arrayBuffer()));
  assert.deepEqual(Object.keys(zip).sort(),['postProcessing/probes/0/U','postProcessing/slices/20/xy.vtk']);
  assert.throws(()=>archiveFile(bytes,'../../private'),/not found/);
  assert.throws(()=>archiveEntries(zipSync({'../private':strToU8('x')})),/Unsafe/);
  assert.throws(()=>postprocessingArchive(zipSync({'0/U':strToU8('x')})),/no post-processing/);
});

test('phase progress labels show measured phase values, not a fake percentage for missing telemetry',()=>{
  const job={id:'job',studyId:'study',clientRevision:'a'.repeat(64),phase:'Running',progress:25,progressBasis:'iterationBudget',message:''} as CFDWorkerJob;
  const html=renderToStaticMarkup(createElement(CFDJobProgress,{job,name:'Office'}));
  assert.match(html,/Running · 25% of iteration budget/);assert.match(html,/aria-valuenow="25"/);
  const unknown=renderToStaticMarkup(createElement(CFDJobProgress,{job:{...job,progress:null},name:'Office'}));
  assert.match(unknown,/progress not reported/);assert.doesNotMatch(unknown,/aria-valuenow=/);
  const idle=renderToStaticMarkup(createElement(CFDJobProgress,{name:'Office'}));
  assert.match(idle,/Not submitted · 0%/);assert.match(idle,/aria-valuenow="0"/);assert.doesNotMatch(idle,/indeterminate/);
  const submitting=renderToStaticMarkup(createElement(CFDJobProgress,{name:'Office',pending:'Checking & submitting…'}));
  assert.match(submitting,/progress not reported/);assert.doesNotMatch(submitting,/aria-valuenow=/);
});

test('residual graphs use per-field panels and one outer-step value per pressure field',()=>{
  const samples=[{field:'p',time:1,iteration:1,initial:.1,final:.01},{field:'p',time:1,iteration:1,initial:.001,final:.0001},{field:'p',time:2,iteration:2,initial:.08,final:.008}];
  const html=renderToStaticMarkup(createElement(ClimoptixConvergence,{name:'Office',state:{samples,file:null,reading:false,error:'',truncated:false},onImport:()=>{},onClear:()=>{}}));
  assert.match(html,/Residuals to display/);assert.match(html,/Final linear-solver residuals/);
  const polylines=[...html.matchAll(/<polyline points="([^"]+)"/g)];assert.equal(polylines.length,1);
  assert.ok(polylines.every(line=>line[1].split(' ').length===2));
});

test('cleared list presentation never changes preparation revision or older-worker contracts',()=>{
  const project=cfdProject(),scenario=newCFDScenario(project.projectId);
  const before=preparationInput(project,scenario);scenario.boundaries.hideDefaultGroup=true;
  assert.equal(preparationInput(project,scenario),before);
  const body=JSON.parse(preparationRequestBody(project,scenario,'a'.repeat(64)));
  assert.ok(!Object.hasOwn(body.scenario.boundaries,'hideDefaultGroup'));
});

test('native OpenFOAM FIELD slices normalize safely without losing pressure or velocity values',()=>{
  const native='# vtk DataFile Version 2.0\ntime=161\nASCII\nDATASET POLYDATA\nFIELD FieldData 1\nTimeValue 1 1 float\n161\nPOINTS 3 float\n0 0 0 1 0 0 0 1 0\nPOLYGONS 1 4\n3 0 1 2\nCELL_DATA 1\nFIELD attributes 2\np 1 1 float\n0.002\nU 3 1 float\n.1 .2 .3\n';
  const safe=checkVTKText(native,false);
  assert.ok(!safe.includes('FIELD'));assert.match(safe,/SCALARS p double 1\nLOOKUP_TABLE default\n0.002/);assert.match(safe,/VECTORS U double\n.1 .2 .3/);
  assert.throws(()=>checkVTKText(native.replace('p 1 1 float','p 1 999999999 float'),false),/limit|oversized/);
  assert.throws(()=>checkVTKText(native.replace('TimeValue 1 1 float','TimeValue 1 1 string'),false),/Unsupported/);
  assert.throws(()=>checkVTKText(native.replace('.1 .2 .3','.1 .2'),false),/Incomplete/);
});

test('meshing Time headings are not counted as solver iterations',()=>{
  const log='Time = 0\nCreating mesh\nTime = 1\nSolving for p, Initial residual = .1, Final residual = .01\nTime = 2\nSolving for p, Initial residual = .05, Final residual = .005\n';
  assert.deepEqual(parseResidualLog(log).samples.map(sample=>sample.iteration),[1,2]);
});
