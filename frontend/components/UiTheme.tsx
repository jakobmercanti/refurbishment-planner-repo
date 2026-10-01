"use client";

import { useEffect } from "react";

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
    // Keep administrator-configured colours as inputs to the Light palette.
    // Appearance preferences can then supply Dark semantic values without
    // fighting inline styles or changing the saved programmer configuration.
    for (const [key, value] of Object.entries(theme.colours)) properties[`--configured-${key}`] = value;
    properties["--font-sans"] = theme.typography.sans;
    properties["--font-mono"] = theme.typography.controls;
    for (const [key, value] of Object.entries(theme.buttons)) properties[`--configured-ui-button-${key}`] = value;
    for (const [key, value] of Object.entries(theme.windows)) properties[`--configured-ui-window-${key}`] = value;
    for (const [key, value] of Object.entries(properties)) root.style.setProperty(key, value);
    return () => {
      delete document.body.dataset.uiStyle;
      Object.keys(properties).forEach((key) => root.style.removeProperty(key));
    };
  }, [settings]);
  return null;
}
