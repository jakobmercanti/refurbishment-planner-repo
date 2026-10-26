import assert from 'node:assert/strict';
import test from 'node:test';
import { engineeringDisplay, fromTemperature, toTemperature } from '../lib/cfdUnits';
import { parseEngineeringUnits } from '../lib/appPreferences';

test('absolute temperature round trips leave stored kelvin authoritative', () => {
  for (const unit of ['C','K','F'] as const) for (const kelvin of [0,273.15,293.15,310.25]) {
    assert.ok(Math.abs(fromTemperature(toTemperature(kelvin,unit),unit)-kelvin)<1e-9);
  }
  const d=engineeringDisplay('Boundary temperature (K)',{temperatureUnit:'C'});
  assert.equal(d.label,'Boundary temperature (°C)'); assert.equal(d.to(293.15),20); assert.equal(d.from(25),298.15);
  assert.equal(engineeringDisplay('Heat capacity (J/kg·K)',{temperatureUnit:'F'}).to(1005),1005);
});
test('length and volume flow display convert only at the UI boundary', () => {
  const d=engineeringDisplay('Vent width (mm)',{units:'INCHES'}); assert.equal(d.to(254),10); assert.equal(d.from(10),254);
  const q=engineeringDisplay('Boundary flow value (m³/s)',{cfdFlowUnit:'L/s'}); assert.equal(q.to(.005),5); assert.equal(q.from(5),.005);
  assert.deepEqual(parseEngineeringUnits('{"temperatureUnit":"bogus","units":"bogus"}'),{});
});
