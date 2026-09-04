"use client";

import type { InputHTMLAttributes } from "react";
import { EditableNumberInput } from "@/components/EditableNumberInput";
import { fromDisplayNumber, toDisplayInputNumber, toDisplayNumber, type DisplayUnits } from "@/lib/units";

interface DisplayNumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "min" | "max" | "step"> {
  valueMm: number;
  onMmChange: (value: number) => void;
  units: DisplayUnits;
  minMm?: number;
  maxMm?: number;
  stepMm?: number;
}

export function DisplayNumberInput({ valueMm, onMmChange, units, minMm, maxMm, stepMm, ...props }: DisplayNumberInputProps) {
  return <EditableNumberInput {...props} value={toDisplayInputNumber(valueMm, units)} min={minMm === undefined ? undefined : toDisplayNumber(minMm, units)} max={maxMm === undefined ? undefined : toDisplayNumber(maxMm, units)} step={stepMm === undefined ? undefined : toDisplayNumber(stepMm, units)} onValueChange={(value) => onMmChange(fromDisplayNumber(value, units))} />;
}
