import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {workerTelemetrySchema,workerTelemetryCSV} from '../lib/cfdWorkerTelemetry';
import {CFDWorkerTelemetry} from '../components/CFDWorkerTelemetry';

test('probe/flow histories retain explicit native units and missing values, and export the same measurements',()=>{
  const data=workerTelemetrySchema.parse({version:1,truncated:false,warnings:[],
    balance:{tolerance:.05,fluxM3S:{p_a:-.005,p_b:.005},samples:[{iteration:2,relativeImbalance:0,incomingM3S:.005,outgoingM3S:.005,netM3S:0}]},
    probes:[{index:0,positionMm:[1000,500,250],samples:[{iteration:2,velocityMS:[1,2,3],pressureM2S2:null}]}]});
  const csv=workerTelemetryCSV(data);
  assert.match(csv,/probe,1,2,1000,500,250,1,2,3,/);
  assert.match(csv,/balance,,2,,,,,,,,0.005,0.005,0,0/);
  assert.ok(csv.split('\r\n').filter(Boolean).every(row=>row.split(',').length===14));
  const markup=renderToStaticMarkup(createElement(CFDWorkerTelemetry,{data,result:null,jobId:'job'}));
  assert.match(markup,/Relative flow imbalance history \(fraction\)/);
  assert.match(markup,/Probe 1 speed history \(m\/s\)/);
  assert.match(markup,/X 1000.0 mm/);
  assert.match(markup,/Pressure p \(m²\/s²\)/);
  assert.ok(!markup.includes('NaN'));
  assert.equal(workerTelemetrySchema.safeParse({...data,probes:[{...data.probes[0],samples:[{iteration:2,velocityMS:[Infinity,0,0],pressureM2S2:0}]}]}).success,false);
});
