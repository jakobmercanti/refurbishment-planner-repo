"use client";

import { type InputHTMLAttributes, useState } from "react";

interface EditableNumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type" | "value"> {
  value: number;
  onValueChange: (value: number) => void;
  onInvalidValue?: (rawValue: string) => void;
}

export function EditableNumberInput({ value, onValueChange, onInvalidValue, onBlur, ...props }: EditableNumberInputProps) {
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
        if (next === "") {
          onInvalidValue?.(next);
          return;
        }
        const parsed = event.target.valueAsNumber;
        if (Number.isFinite(parsed)) onValueChange(parsed);
        else onInvalidValue?.(next);
      }}
      onBlur={(event) => {
        if (draft === "") {
          onInvalidValue?.(draft);
          setDraft(String(value));
        }
        onBlur?.(event);
      }}
    />
  );
}
