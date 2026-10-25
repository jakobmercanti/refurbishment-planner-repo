import type { Measurement } from './types';

/** Restoring a plan is not a new measurement or a loss of verification. */
export function roomMeasurement(previous:Measurement|undefined,value:number,edited=false):Measurement {
  if(previous&&(!edited||previous.value===value))return previous;
  return {value,uncertainty_mm:5,verified:false,source_type:'USER_MEASURED'};
}
