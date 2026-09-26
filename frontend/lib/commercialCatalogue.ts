export type PlanKey = "free" | "starter" | "pro" | "studio";

export type CommercialPlan = {
  plan_key: PlanKey;
  name: string;
  monthly_price_pence: number;
  storage_limit_bytes: number;
  asset_limit: number;
  project_limit: number;
  included_medium: number;
  included_high: number;
  max_electrical_elements_per_project: number | null;
  description: string;
};

export type RenderPack = {
  pack_key: string;
  quality_class: "medium" | "high";
  quantity: number;
  price_pence: number;
};

export type CommercialCatalogue = {
  plans: CommercialPlan[];
  packs: RenderPack[];
  serviceAvailable: boolean;
  billingEnabled: boolean;
  cloudEnabled: boolean;
  availablePlanKeys: ReadonlySet<PlanKey>;
};

const gibibyte = 1024 ** 3;

/**
 * Display fallback for when online product/account services are unreachable.
 * A successful catalogue response remains authoritative and overrides these
 * values; checkout itself is always verified against the server catalogue.
 */
export const FALLBACK_PLANS: CommercialPlan[] = [
  {
    plan_key: "free",
    name: "Free",
    monthly_price_pence: 0,
    storage_limit_bytes: 0,
    asset_limit: 0,
    project_limit: 0,
    included_medium: 0,
    included_high: 0,
    max_electrical_elements_per_project: 5,
    description: "Everything you need to create and save floorplans locally.",
  },
  {
    plan_key: "starter",
    name: "Starter",
    monthly_price_pence: 990,
    storage_limit_bytes: 10 * gibibyte,
    asset_limit: 100,
    project_limit: 50,
    included_medium: 10,
    included_high: 0,
    max_electrical_elements_per_project: null,
    description: "For occasional cloud backup and rendering.",
  },
  {
    plan_key: "pro",
    name: "Pro",
    monthly_price_pence: 1999,
    storage_limit_bytes: 50 * gibibyte,
    asset_limit: 500,
    project_limit: 250,
    included_medium: 30,
    included_high: 5,
    max_electrical_elements_per_project: null,
    description: "For regular projects and larger asset libraries.",
  },
  {
    plan_key: "studio",
    name: "Studio",
    monthly_price_pence: 2999,
    storage_limit_bytes: 100 * gibibyte,
    asset_limit: 1000,
    project_limit: 1000,
    included_medium: 60,
    included_high: 15,
    max_electrical_elements_per_project: null,
    description: "For frequent rendering and large project libraries.",
  },
];

/** Values mirror the currently approved server-seeded render-pack offer. */
export const FALLBACK_RENDER_PACKS: RenderPack[] = [
  { pack_key: "medium_1", quality_class: "medium", quantity: 1, price_pence: 50 },
  { pack_key: "medium_10", quality_class: "medium", quantity: 10, price_pence: 449 },
  { pack_key: "medium_50", quality_class: "medium", quantity: 50, price_pence: 1999 },
  { pack_key: "medium_100", quality_class: "medium", quantity: 100, price_pence: 3499 },
  { pack_key: "high_1", quality_class: "high", quantity: 1, price_pence: 99 },
  { pack_key: "high_10", quality_class: "high", quantity: 10, price_pence: 899 },
  { pack_key: "high_50", quality_class: "high", quantity: 50, price_pence: 3999 },
  { pack_key: "high_100", quality_class: "high", quantity: 100, price_pence: 6999 },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNonNegative(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function isValidRemotePlan(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()) return false;
  const numericFields = [
    "monthly_price_pence", "storage_limit_bytes", "asset_limit", "project_limit", "included_medium", "included_high",
  ];
  if (!numericFields.every((field) => typeof value[field] === "number" && Number.isFinite(value[field]) && (value[field] as number) >= 0)) return false;
  const electricalLimit = value.max_electrical_elements_per_project;
  return electricalLimit === null || electricalLimit === undefined || (typeof electricalLimit === "number" && Number.isFinite(electricalLimit) && electricalLimit >= 0);
}

function planFromRemote(fallback: CommercialPlan, remote: unknown): CommercialPlan {
  if (!isRecord(remote)) return fallback;
  const rawLimit = remote.max_electrical_elements_per_project;
  const electricalLimit = rawLimit === null
    ? null
    : rawLimit === undefined
      ? fallback.max_electrical_elements_per_project
      : finiteNonNegative(rawLimit, fallback.max_electrical_elements_per_project ?? 0);
  return {
    ...fallback,
    name: typeof remote.name === "string" && remote.name.trim() ? remote.name : fallback.name,
    monthly_price_pence: finiteNonNegative(remote.monthly_price_pence, fallback.monthly_price_pence),
    storage_limit_bytes: finiteNonNegative(remote.storage_limit_bytes, fallback.storage_limit_bytes),
    asset_limit: finiteNonNegative(remote.asset_limit, fallback.asset_limit),
    project_limit: finiteNonNegative(remote.project_limit, fallback.project_limit),
    included_medium: finiteNonNegative(remote.included_medium, fallback.included_medium),
    included_high: finiteNonNegative(remote.included_high, fallback.included_high),
    max_electrical_elements_per_project: electricalLimit,
  };
}

export function resolveCommercialCatalogue(value: unknown): CommercialCatalogue {
  const remote = isRecord(value) ? value : null;
  const remotePlans = remote && Array.isArray(remote.plans) ? remote.plans : null;
  const remotePacks = remote && Array.isArray(remote.packs) ? remote.packs : null;
  const serviceAvailable = Boolean(remote && remotePlans && remotePacks);
  const availablePlanKeys = new Set<PlanKey>();

  const plans = FALLBACK_PLANS.map((fallback) => {
    const current = remotePlans?.find((candidate) => isValidRemotePlan(candidate) && candidate.plan_key === fallback.plan_key);
    if (current) availablePlanKeys.add(fallback.plan_key);
    return planFromRemote(fallback, current);
  });
  const packs = remotePacks
    ? remotePacks.flatMap((candidate): RenderPack[] => {
      if (!isRecord(candidate) || (candidate.quality_class !== "medium" && candidate.quality_class !== "high")) return [];
      if (typeof candidate.pack_key !== "string" || !candidate.pack_key) return [];
      const quantity = finiteNonNegative(candidate.quantity, 0);
      const price = finiteNonNegative(candidate.price_pence, 0);
      return quantity > 0 && price > 0
        ? [{ pack_key: candidate.pack_key, quality_class: candidate.quality_class, quantity, price_pence: price }]
        : [];
    })
    : FALLBACK_RENDER_PACKS;

  return {
    plans,
    packs,
    serviceAvailable,
    billingEnabled: serviceAvailable && remote?.billing_enabled === true,
    cloudEnabled: serviceAvailable && remote?.cloud_enabled === true,
    availablePlanKeys,
  };
}

export type PlanComparisonRow = {
  label: string;
  values: Record<PlanKey, string>;
  help?: "saving" | "storage" | "assets" | "renders" | "electrical";
};

export type PlanComparisonSection = { title: string; rows: PlanComparisonRow[] };

export function buildPlanComparison(plans: CommercialPlan[], renderPacksAvailable = true): PlanComparisonSection[] {
  const byKey = Object.fromEntries(plans.map((plan) => [plan.plan_key, plan])) as Record<PlanKey, CommercialPlan>;
  const value = (select: (plan: CommercialPlan) => string): Record<PlanKey, string> => ({
    free: select(byKey.free),
    starter: select(byKey.starter),
    pro: select(byKey.pro),
    studio: select(byKey.studio),
  });
  const yesNo = (included: (plan: CommercialPlan) => boolean) => value((plan) => included(plan) ? "Included" : "—");
  const count = (number: number) => number > 0 ? number.toLocaleString("en-GB") : "—";

  return [
    {
      title: "Free core planner",
      rows: [
        { label: "Floorplan editor", values: yesNo(() => true) },
        { label: "Local project saving", values: yesNo(() => true), help: "saving" },
        { label: "Portable project files", values: yesNo(() => true) },
      ],
    },
    {
      title: "Cloud",
      rows: [
        { label: "Private cloud storage", values: value((plan) => plan.storage_limit_bytes ? `${Math.round(plan.storage_limit_bytes / gibibyte)} GB` : "—"), help: "storage" },
        { label: "Cloud projects", values: value((plan) => count(plan.project_limit)) },
        { label: "Private cloud assets", values: value((plan) => count(plan.asset_limit)), help: "assets" },
        { label: "Project backup and sync", values: yesNo((plan) => plan.plan_key !== "free") },
      ],
    },
    {
      title: "AI rendering",
      rows: [
        { label: "Medium renders / month", values: value((plan) => count(plan.included_medium)) },
        { label: "High renders / month", values: value((plan) => count(plan.included_high)) },
        { label: "Additional render packs", values: value((plan) => plan.plan_key !== "free" && renderPacksAvailable ? "Available" : "—") },
      ],
    },
    {
      title: "Other",
      rows: [
        { label: "Electrical elements / project", values: value((plan) => plan.max_electrical_elements_per_project === null ? "Unlimited" : plan.max_electrical_elements_per_project.toLocaleString("en-GB")), help: "electrical" },
      ],
    },
  ];
}

export function formatPounds(pricePence: number): string {
  return `£${(pricePence / 100).toFixed(2)}`;
}
