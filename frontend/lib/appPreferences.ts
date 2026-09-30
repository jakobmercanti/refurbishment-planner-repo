import type { DisplayUnits } from "@/lib/units";

export type ThemePreference = "SYSTEM" | "LIGHT" | "DARK";
export type WorkspaceDensity = "COMFORTABLE" | "COMPACT";
export const CURRENCY_OPTIONS = [
  { code: "GBP", name: "Pound sterling", symbol: "£" },
  { code: "USD", name: "US dollar", symbol: "$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "CAD", name: "Canadian dollar", symbol: "CA$" },
  { code: "AUD", name: "Australian dollar", symbol: "A$" },
  { code: "NZD", name: "New Zealand dollar", symbol: "NZ$" },
  { code: "CHF", name: "Swiss franc", symbol: "CHF" },
  { code: "JPY", name: "Japanese yen", symbol: "¥" },
  { code: "CNY", name: "Chinese yuan", symbol: "CN¥" },
  { code: "INR", name: "Indian rupee", symbol: "₹" },
  { code: "SGD", name: "Singapore dollar", symbol: "S$" },
  { code: "HKD", name: "Hong Kong dollar", symbol: "HK$" },
  { code: "ZAR", name: "South African rand", symbol: "R" },
  { code: "SEK", name: "Swedish krona", symbol: "kr" },
  { code: "NOK", name: "Norwegian krone", symbol: "kr" },
  { code: "DKK", name: "Danish krone", symbol: "kr" },
  { code: "PLN", name: "Polish złoty", symbol: "zł" },
  { code: "AED", name: "UAE dirham", symbol: "AED" },
] as const;
export type CurrencyCode = typeof CURRENCY_OPTIONS[number]["code"];

export interface AppPreferences {
  theme: ThemePreference;
  density: WorkspaceDensity;
  confirmBeforeOpen: boolean;
  units: DisplayUnits;
  currency: CurrencyCode;
}

export interface PersistedAppearancePreferences {
  theme: ThemePreference;
  density: WorkspaceDensity;
  currency: CurrencyCode;
}

export const APP_APPEARANCE_STORAGE_KEY = "freefloorplan3d:appearance-preferences:v1";

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  theme: "SYSTEM",
  density: "COMFORTABLE",
  confirmBeforeOpen: true,
  units: "MM",
  currency: "GBP",
};

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
let currencyPreferenceSnapshot: CurrencyCode = DEFAULT_APP_PREFERENCES.currency;
const currencyPreferenceSubscribers = new Set<() => void>();

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

function parseCurrency(value: unknown): CurrencyCode | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toUpperCase();
  return CURRENCY_OPTIONS.find((currency) => currency.code === normalized)?.code;
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
      ...(parseCurrency(record.currency) ? { currency: parseCurrency(record.currency) } : {}),
    };
  } catch {
    return {};
  }
}

function readBrowserCurrency(): CurrencyCode | undefined {
  try {
    return readAppearancePreferences(window.localStorage).currency;
  } catch {
    return undefined;
  }
}

export function writeAppearancePreferences(
  preferences: Pick<AppPreferences, "theme" | "density" | "currency">,
  storage: PreferenceStorage,
): void {
  currencyPreferenceSnapshot = preferences.currency;
  try {
    storage.setItem(APP_APPEARANCE_STORAGE_KEY, JSON.stringify({
      theme: preferences.theme.toLowerCase(),
      density: preferences.density.toLowerCase(),
      currency: preferences.currency,
    }));
  } catch {
    // Private browsing and storage quotas may make persistence unavailable;
    // the in-memory preference still applies for the current session.
  }
  currencyPreferenceSubscribers.forEach((subscriber) => subscriber());
}

export function subscribeCurrencyPreference(subscriber: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  currencyPreferenceSubscribers.add(subscriber);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== APP_APPEARANCE_STORAGE_KEY) return;
    currencyPreferenceSnapshot = readBrowserCurrency() ?? DEFAULT_APP_PREFERENCES.currency;
    subscriber();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    currencyPreferenceSubscribers.delete(subscriber);
    window.removeEventListener("storage", onStorage);
  };
}

export function getCurrencyPreferenceSnapshot(): CurrencyCode {
  if (typeof window === "undefined") return DEFAULT_APP_PREFERENCES.currency;
  currencyPreferenceSnapshot = readBrowserCurrency() ?? currencyPreferenceSnapshot;
  return currencyPreferenceSnapshot;
}

export function getServerCurrencyPreferenceSnapshot(): CurrencyCode {
  return DEFAULT_APP_PREFERENCES.currency;
}

export function currencySymbol(currency: string): string {
  const code = currency.trim().toUpperCase();
  const known = CURRENCY_OPTIONS.find((option) => option.code === code);
  if (known) return known.symbol;
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" })
      .formatToParts(0).find((part) => part.type === "currency")?.value ?? code;
  } catch {
    return code || "GBP";
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
