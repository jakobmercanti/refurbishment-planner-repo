"use client";

import { type InputHTMLAttributes, useState } from "react";

interface EditableNumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type" | "value"> {
  value: number;
  onValueChange: (value: number) => void;
}

export function EditableNumberInput({ value, onValueChange, onBlur, ...props }: EditableNumberInputProps) {
  const [draft, setDraft] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);

  if (value !== lastValue) {
    setLastValue(value);
    setDraft(String(value));
  }

  return (
    <input
      {...props}
      type="number"
      value={draft}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (next === "") return;
        const parsed = event.target.valueAsNumber;
        if (Number.isFinite(parsed)) onValueChange(parsed);
      }}
      onBlur={(event) => {
        if (draft === "") setDraft(String(value));
        onBlur?.(event);
      }}
    />
  );
}
