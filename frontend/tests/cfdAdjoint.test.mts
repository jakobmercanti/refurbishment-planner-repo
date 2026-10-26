import assert from 'node:assert/strict';
import test from 'node:test';
import {adjointStudySchema} from '../lib/cfdAdjointDocument';
import {adjointConfigurationCSV,newAdjointStudy,validateAdjoint} from '../lib/cfdAdjoint';
import {newCFDScenario,duplicateCFDScenario} from '../lib/climoptixDocument';
import {preparationInput,preparationRequestBody} from '../lib/climoptix';
import {workerInput} from '../lib/climoptixJobs';
import {parseProject} from '../lib/projectDocument';
import {cfdProject,realDefaultSetup,realPreparation} from './climoptixFixtures';

function setup(){
  const p=cfdProject(false);p.cfdScenarios[0]=realDefaultSetup({project:p,scenario:p.cfdScenarios[0],clientRevision:'a'.repeat(64)});
  const s=p.cfdScenarios[0],report=realPreparation({project:p,scenario:s,clientRevision:'a'.repeat(64)});
  return{p,s,report,study:newAdjointStudy(s,report)};
}
test('old project schemas remain compatible; saved configurations roundtrip without changing worker fingerprints',()=>{
  const {p,s,report,study}=setup(),before=preparationInput(p,s),worker=workerInput(p,s);
  assert.equal(newCFDScenario(p.projectId).adjointStudies,undefined);
  s.adjointStudies=[study];
  assert.equal(preparationInput(p,s),before);assert.equal(workerInput(p,s),worker);
  assert.equal(JSON.parse(preparationRequestBody(p,s,report.validation.clientRevision)).scenario.adjointStudies,undefined);
  const reloaded=parseProject(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(reloaded.cfdScenarios[0].adjointStudies,JSON.parse(JSON.stringify([study])));
  assert.equal(duplicateCFDScenario(s).adjointStudies,undefined);
  assert.ok(study.ports.every(v=>!v.movable));
});
test('numeric bounds, integers, budgets and unknown executable expressions are strictly rejected',()=>{
  const {study}=setup();
  for(const n of [0,1.5,51,NaN,Infinity])assert.equal(adjointStudySchema.safeParse({...study,strategy:{...study.strategy,maxAcceptedSteps:n}}).success,false);
  for(const value of [true,'3'])assert.equal(adjointStudySchema.safeParse({...study,strategy:{...study.strategy,maxAcceptedSteps:value}}).success,false);
  assert.equal(adjointStudySchema.safeParse({...study,strategy:{...study.strategy,maxPrimalSolves:1}}).success,false);
  assert.equal(adjointStudySchema.safeParse({...study,objective:{...study.objective,expression:'run()'}}).success,false);
  assert.equal(adjointStudySchema.safeParse({...study,ports:[study.ports[0],study.ports[0]]}).success,false);
  assert.equal(adjointStudySchema.safeParse({...study,ports:[{...study.ports[0],bounds:{uMinMm:10,uMaxMm:1,vMinMm:1,vMaxMm:2}}]}).success,false);
});
test('CSV is actual configuration data, never claimed iteration results',()=>{
  const {study}=setup();study.name='=1+1';const csv=adjointConfigurationCSV(study);
  assert.match(csv,/preparation only — no CFD iterations/);assert.ok(csv.includes(study.ports[0].ventId));assert.match(csv,/uMinMm/);
});
test('readiness transport rejects foreign provenance, executable claims and API failures',async()=>{
  const {p,s,study}=setup(),original=globalThis.fetch;
  try{
    const response={version:1,kind:'AdjointPreparation',studyId:study.id,units:'mm',state:'adjointUnavailable',configurationReady:true,canRun:false,
      binding:{sourceHash:study.baseline.sourceHash,configurationHash:study.baseline.configurationHash,clientRevision:study.baseline.clientRevision},capability:{version:1,preparation:true,canRun:false,fixedMeshMovement:false,adjoint:false,reason:'unavailable'},issues:[],ports:[],iterations:[],meshHash:null,limitations:[]};
    globalThis.fetch=async()=>new Response(JSON.stringify({...response,canRun:true}));
    await assert.rejects(()=>validateAdjoint('/api',p,s,'a'.repeat(64),study,new AbortController().signal));
    globalThis.fetch=async()=>new Response(JSON.stringify({...response,studyId:'foreign'}));
    await assert.rejects(()=>validateAdjoint('/api',p,s,'a'.repeat(64),study,new AbortController().signal),/different study/);
    globalThis.fetch=async()=>new Response(JSON.stringify({detail:'Release the new API'}),{status:503});
    await assert.rejects(()=>validateAdjoint('/api',p,s,'a'.repeat(64),study,new AbortController().signal),/Release the new API/);
  }finally{globalThis.fetch=original;}
});
