import assert from 'node:assert/strict';
import test from 'node:test';
import {readPendingCFD,savePendingCFD,removePendingCFD} from '../lib/cfdSubmissionJournal';
import type {CFDSubmission} from '../lib/climoptixJobs';

test('pending submissions survive workspace replacement without crossing account/project scopes',t=>{
  const originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  const originalStorage=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
  const values=new Map<string,string>();
  Object.defineProperty(globalThis,'window',{configurable:true,value:{}});
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)};
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:storage});
  t.after(()=>{
    if(originalWindow)Object.defineProperty(globalThis,'window',originalWindow);else Reflect.deleteProperty(globalThis,'window');
    if(originalStorage)Object.defineProperty(globalThis,'sessionStorage',originalStorage);else Reflect.deleteProperty(globalThis,'sessionStorage');
  });
  const project='11111111-1111-4111-8111-111111111111',submission='22222222-2222-4222-8222-222222222222';
  const request={contractVersion:1,dialect:'OpenCFD-v2312',sourceUnits:'mm',submissionId:submission,operation:'run',studyId:'study',
    clientRevision:'a'.repeat(64),sourceHash:'b'.repeat(64),configurationHash:'c'.repeat(64),thermalApplication:null,
    project:{projectId:project},scenario:{id:'study'}} as CFDSubmission;
  const record={input:'original immutable input',request};
  savePendingCFD('account-a',project,record);
  assert.deepEqual(readPendingCFD('account-a',project),[record]);
  assert.deepEqual(readPendingCFD('account-b',project),[]);
  assert.deepEqual(readPendingCFD('account-a','33333333-3333-4333-8333-333333333333'),[]);
  removePendingCFD('account-a',project,'study','44444444-4444-4444-8444-444444444444');
  assert.equal(readPendingCFD('account-a',project).length,1,'A stale response cannot remove a newer submission');
  removePendingCFD('account-a',project,'study',submission);
  assert.deepEqual(readPendingCFD('account-a',project),[]);
  storage.setItem=()=>{throw new Error('Quota exceeded');};
  assert.throws(()=>savePendingCFD('account-a',project,record),/No job was sent/);
  values.set(`freefloorplan3d:cfd-pending:v1:account-a:${project}`,'broken');
  assert.throws(()=>readPendingCFD('account-a',project),/Do not start a replacement job/);
});
