import type { DisplayUnits } from "@/lib/units";

export type ThemePreference = "SYSTEM" | "LIGHT" | "DARK";
export type WorkspaceDensity = "COMFORTABLE" | "COMPACT";

export interface AppPreferences {
  theme: ThemePreference;
  density: WorkspaceDensity;
  confirmBeforeOpen: boolean;
  units: DisplayUnits;
}

export interface PersistedAppearancePreferences {
  theme: ThemePreference;
  density: WorkspaceDensity;
}

export const APP_APPEARANCE_STORAGE_KEY = "freefloorplan3d:appearance-preferences:v1";

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  theme: "SYSTEM",
  density: "COMFORTABLE",
  confirmBeforeOpen: true,
  units: "MM",
};

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

function parseTheme(value: unknown): ThemePreference | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toUpperCase();
  return normalized === "SYSTEM" || normalized === "LIGHT" || normalized === "DARK" ? normalized : undefined;
}

function parseDensity(value: unknown): WorkspaceDensity | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toUpperCase();
  return normalized === "COMFORTABLE" || normalized === "COMPACT" ? normalized : undefined;
}

export function readAppearancePreferences(storage: PreferenceStorage): Partial<PersistedAppearancePreferences> {
  try {
    const saved = storage.getItem(APP_APPEARANCE_STORAGE_KEY);
    if (!saved) return {};
    const value: unknown = JSON.parse(saved);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const record = value as Record<string, unknown>;
    return {
      ...(parseTheme(record.theme) ? { theme: parseTheme(record.theme) } : {}),
      ...(parseDensity(record.density) ? { density: parseDensity(record.density) } : {}),
    };
  } catch {
    return {};
  }
}

export function writeAppearancePreferences(
  preferences: Pick<AppPreferences, "theme" | "density">,
  storage: PreferenceStorage,
): void {
  try {
    storage.setItem(APP_APPEARANCE_STORAGE_KEY, JSON.stringify({
      theme: preferences.theme.toLowerCase(),
      density: preferences.density.toLowerCase(),
    }));
  } catch {
    // Private browsing and storage quotas may make persistence unavailable;
    // the in-memory preference still applies for the current session.
  }
}

export function resolveTheme(theme: ThemePreference, systemPrefersDark: boolean): "light" | "dark" {
  if (theme === "DARK") return "dark";
  if (theme === "LIGHT") return "light";
  return systemPrefersDark ? "dark" : "light";
}

export function watchThemePreference(
  theme: ThemePreference,
  root: HTMLElement,
  media: MediaQueryList,
): () => void {
  root.dataset.themeMode = theme.toLowerCase();
  const updateResolvedTheme = () => {
    root.dataset.theme = resolveTheme(theme, media.matches);
  };
  updateResolvedTheme();

  if (theme !== "SYSTEM") return () => {};
  media.addEventListener("change", updateResolvedTheme);
  return () => media.removeEventListener("change", updateResolvedTheme);
}
