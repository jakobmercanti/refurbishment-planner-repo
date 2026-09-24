"use client";

export type WindowIconName = "build" | "elements" | "view" | "annotations" | "marker" | "coordinates" | "object" | "settings" | "save" | "dialog";

function iconNameForTitle(title: string): WindowIconName {
  const value = title.toLowerCase();
  if (value.includes("build") || value.includes("outline") || value.includes("floorplan")) return "build";
  if (value.includes("element") || value.includes("door") || value.includes("window") || value.includes("object")) return "elements";
  if (value.includes("view") || value.includes("visibility")) return "view";
  if (value.includes("annotation") || value.includes("line") || value.includes("text") || value.includes("callout")) return "annotations";
  if (value.includes("marker")) return "marker";
  if (value.includes("coordinate")) return "coordinates";
  if (value.includes("setting") || value.includes("appearance")) return "settings";
  if (value.includes("save")) return "save";
  return "dialog";
}

export function WindowIcon({ title, name }: { title: string; name?: WindowIconName }) {
  const icon = name ?? iconNameForTitle(title);
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return <svg className="window-icon" viewBox="0 0 24 24" aria-hidden="true">
    {icon === "build" && <><path {...common} d="M4 18.5 18.5 4" /><path {...common} d="m5 5 14 14" /><path {...common} d="M6.5 3.5v4M3.5 6.5h4M17.5 16.5v4M15.5 18.5h4" /></>}
    {icon === "elements" && <><path {...common} d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path {...common} d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>}
    {icon === "view" && <><path {...common} d="M3 12s3.2-5 9-5 9 5 9 5-3.2 5-9 5-9-5-9-5Z" /><circle {...common} cx="12" cy="12" r="2.2" /></>}
    {icon === "annotations" && <><path {...common} d="m4 17.5-.8 3.3 3.3-.8L18.7 8a2.3 2.3 0 0 0-3.3-3.3L4 17.5Z" /><path {...common} d="m13.8 6.2 4 4M4 4.5h4M4 8h2.5" /></>}
    {icon === "marker" && <><circle {...common} cx="12" cy="12" r="7.5" /><circle {...common} cx="12" cy="12" r="2.4" /><path {...common} d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>}
    {icon === "coordinates" && <><path {...common} d="M12 3v18M3 12h18" /><circle {...common} cx="12" cy="12" r="5" /><path {...common} d="m12 7 1.5 5-1.5 5-1.5-5L12 7Z" /></>}
    {icon === "settings" && <><path {...common} d="M4 6h16M4 12h16M4 18h16" /><circle {...common} cx="9" cy="6" r="2" /><circle {...common} cx="15" cy="12" r="2" /><circle {...common} cx="11" cy="18" r="2" /></>}
    {icon === "save" && <><path {...common} d="M5 3h11l3 3v15H5V3Z" /><path {...common} d="M8 3v6h7V3M8 21v-6h8v6" /></>}
    {icon === "dialog" && <><rect {...common} x="4" y="4" width="16" height="16" rx="3" /><path {...common} d="M8 9h8M8 13h5" /></>}
  </svg>;
}
