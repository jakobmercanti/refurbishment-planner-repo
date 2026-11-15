export type CFDLegendStyle = "horizontal" | "vertical" | "hidden";

export function CFDLegendStyleSelect({ value, onChange }: {
  value: CFDLegendStyle;
  onChange: (style: CFDLegendStyle) => void;
}) {
  return <label>Legend style<select value={value} onChange={event => onChange(event.target.value as CFDLegendStyle)}>
    <option value="horizontal">Horizontal</option>
    <option value="vertical">Vertical</option>
    <option value="hidden">Hidden</option>
  </select></label>;
}
