import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ElectricalScheduleWindow } from '../components/ElectricalScheduleWindow';
import { DEFAULT_ELECTRICAL_LAYOUT } from '../lib/electricalLayout';
import { newAssembly, newEnergyProject } from '../lib/energyDocument';
import { insertConstructionLayer, setWallAssembly } from '../lib/energyWallConstruction';
import { energyElements, resolveThermalOverrides, sameWallGeometry } from '../lib/energyCalculations';
import { newHeatingProject } from '../lib/heatingDocument';
import { windowHelpSteps } from '../lib/windowHelp';
import type { Room } from '../lib/types';

test('insertion boundaries support first, last and between rows without mutating layer data', () => {
  const a = newAssembly({name:'Wall',category:'wall',materials:[['brick-english-red',100],['pir-tw55',50],['plasterboard',12.5]]});
  const [one,two,three] = a.layers;
  assert.deepEqual(insertConstructionLayer(a,one.layerId,3).layers,[two,three,one]);
  assert.deepEqual(insertConstructionLayer(a,three.layerId,0).layers,[three,one,two]);
  assert.deepEqual(insertConstructionLayer(a,three.layerId,1).layers,[one,three,two]);
  for (const boundary of [0,1]) assert.equal(insertConstructionLayer(a,one.layerId,boundary),a);
  for (const boundary of [-1,4,1.5,NaN]) assert.equal(insertConstructionLayer(a,one.layerId,boundary),a);
  assert.equal(insertConstructionLayer(a,'unknown',1),a);
  assert.deepEqual(a.layers,[one,two,three]);
});

test('insulation material and thickness changes keep exact wall signature; moved walls still invalidate it', () => {
  const m=(value:number)=>({value,verified:true,uncertainty_mm:0,source_type:'USER_MEASURED'});
  const room:Room={id:'room',name:'Room',version:1,vertices:[{x:.123456,y:.654321},{x:5450.123456,y:.654321},{x:5450.123456,y:4300.654321},{x:.123456,y:4300.654321}],wall_height:m(2500),wall_thickness:m(100),openings:[],obstacles:[]};
  const heating=newHeatingProject(),data=newEnergyProject(),wall=energyElements([room],heating,data)[0];
  const next=setWallAssembly(data,wall,newAssembly({name:'Insulated',category:'wall',materials:[['brick-english-red',200],['pir-tw55',50]]}));
  assert.ok(resolveThermalOverrides(next,[room])[wall.elementId].uValue! < .5);
  assert.equal(resolveThermalOverrides(next,[room])[wall.elementId].warning,undefined);
  const moved={...room,vertices:room.vertices.map((p,i)=>i===1?{...p,x:p.x+1}:p)};
  assert.match(resolveThermalOverrides(next,[moved])[wall.elementId].warning!,/no longer matches/);
});

test('thickness-only editor changes and undo restore snapshots without re-solving wall lengths', () => {
  const source=readFileSync(new URL('../components/FullFloorplanEditor.tsx',import.meta.url),'utf8');
  const apply=source.slice(source.indexOf('  function applyEnergyLayout('),source.indexOf('  function undoEnergy('));
  assert.doesNotMatch(apply,/setWallsRespectingMeasurements/);
  assert.match(apply,/setWalls\(nextWalls\)/);
  assert.match(apply,/setWalls\(value.walls\)/);
});

test('BOM rows expose a popup action, not inline commercial form fields', () => {
  const layout={...DEFAULT_ELECTRICAL_LAYOUT,documentation:{...DEFAULT_ELECTRICAL_LAYOUT.documentation,manualBomItems:[{bomRowId:'manual',description:'Test item',quantity:1}]}};
  const html=renderToStaticMarkup(createElement(ElectricalScheduleWindow,{rooms:[],assets:[],instances:[],layout,projectName:'Test',onLayoutChange(){}}));
  assert.match(html,/Edit · notes &amp; photos<\/button>/);
  assert.doesNotMatch(html,/electrical-bom-detail|electrical-bom-fields/);
});

test('pipe guidance is in Heating help, not a second inline explanation', () => {
  const help=windowHelpSteps('Heating Layout').map(step=>step.text).join(' ');
  assert.match(help,/not mains cold water/);assert.match(help,/schematic routing only/);assert.match(help,/double-click/);
  const source=readFileSync(new URL('../components/HeatingLayoutPanel.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/How to connect and edit pipes/);
  assert.match(source,/className=\{styles.pipeRouting\}/);assert.match(source,/styles.temperaturePresets/);
});

test('wall signature comparison ignores serialization order and machine round-off, not measured movement', () => {
  const saved='[{"y":0,"x":0},{"y":0,"x":5450.123456}]';
  assert.ok(sameWallGeometry(saved,'[{"x":0,"y":0},{"x":5450.123456000001,"y":0}]'));
  assert.equal(sameWallGeometry(saved,'[{"x":0,"y":0},{"x":5450.123457,"y":0}]'),false);
  assert.equal(sameWallGeometry(saved,'[{"x":5450.123456,"y":0},{"x":0,"y":0}]'),false);
  assert.equal(sameWallGeometry(saved,'Removed wall'),false);
});
