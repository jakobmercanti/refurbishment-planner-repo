"use client";

import { useEffect } from "react";
import "@/app/ui-theme.css";

export interface SoftwareUi {
  style: "DEFAULT" | "MODERN";
  themes: Record<string, {
    name: string;
    colours: Record<string, string>;
    typography: { sans: string; controls: string };
    buttons: Record<string, string>;
    windows: Record<string, string>;
  }>;
}

export function UiTheme({ settings }: { settings: SoftwareUi | null }) {
  useEffect(() => {
    if (!settings) return;
    const theme = settings.themes[settings.style];
    if (!theme) return;
    const root = document.documentElement;
    document.body.dataset.uiStyle = settings.style.toLowerCase();
    const properties: Record<string, string> = {};
    for (const [key, value] of Object.entries(theme.colours)) properties[`--${key}`] = value;
    properties["--font-sans"] = theme.typography.sans;
    properties["--font-mono"] = theme.typography.controls;
    for (const [key, value] of Object.entries(theme.buttons)) properties[`--ui-button-${key}`] = value;
    for (const [key, value] of Object.entries(theme.windows)) properties[`--ui-window-${key}`] = value;
    for (const [key, value] of Object.entries(properties)) root.style.setProperty(key, value);
    return () => {
      delete document.body.dataset.uiStyle;
      Object.keys(properties).forEach((key) => root.style.removeProperty(key));
    };
  }, [settings]);
  return null;
}
