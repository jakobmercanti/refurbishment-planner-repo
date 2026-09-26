import type { PlannerBuildActivityType } from "./plannerBuild";

export interface PlannerBuildActivityTemplate {
  id: string;
  name: string;
  category: string;
  type: PlannerBuildActivityType;
  trade?: string;
  colour: string;
}

const PHASES: Array<{ category: string; colour: string; activities: string[] }> = [
  { category: "PRE-CONSTRUCTION", colour: "#287FB8", activities: [
    "Site survey / measurements", "Measured survey", "Design development", "Design freeze", "Structural design",
    "Planning application", "Planning approval", "Building Control application", "Party Wall process",
    "Tender / quotations", "Contractor selection", "Contract award", "Construction programme setup", "Pre-start meeting",
  ] },
  { category: "PROCUREMENT", colour: "#8059A5", activities: [
    "Order windows", "Order external doors", "Order internal doors", "Order kitchen", "Order bathroom fittings",
    "Order sanitaryware", "Order tiles", "Order flooring", "Order lighting", "Order electrical fittings",
    "Order plumbing fittings", "Order appliances", "Order radiators", "Order HVAC equipment", "Order bespoke joinery",
    "Order worktops", "Order paint", "Order ironmongery", "Order structural steel", "Order insulation",
    "Order plasterboard", "Order roofing materials",
  ] },
  { category: "SITE SETUP", colour: "#68746E", activities: [
    "Site setup", "Protect existing finishes", "Temporary power", "Temporary water", "Welfare setup",
    "Skip delivery", "Scaffolding", "Hoarding / site security", "Access preparation", "Material storage setup",
  ] },
  { category: "STRIP-OUT / DEMOLITION", colour: "#C54C4C", activities: [
    "Strip out kitchen", "Strip out bathroom", "Remove floor finishes", "Remove ceilings", "Remove wall finishes",
    "Remove non-loadbearing partitions", "Remove services", "Demolition", "Waste removal", "Asbestos survey/removal if applicable",
  ] },
  { category: "STRUCTURAL", colour: "#D97832", activities: [
    "Excavation", "Foundations", "Concrete works", "Structural steel installation", "Create structural opening",
    "Install lintel", "Alter/loadbearing wall", "Joist works", "Floor structure", "Roof structure", "Structural inspection",
  ] },
  { category: "BUILDING ENVELOPE", colour: "#3F8C66", activities: [
    "External wall construction", "Roofing", "Roof waterproofing", "Insulation", "Airtightness work",
    "Window installation", "External door installation", "Cladding", "External render", "Flashing",
    "Weather sealing", "Watertight milestone",
  ] },
  { category: "FIRST FIX", colour: "#287FB8", activities: [
    "Electrical first fix", "Plumbing first fix", "Heating first fix", "HVAC first fix", "Ventilation ducting",
    "Data/network cabling", "Alarm wiring", "Lighting wiring", "Underfloor heating installation", "Drainage first fix",
  ] },
  { category: "INTERNAL CONSTRUCTION", colour: "#68746E", activities: [
    "Partition framing", "Wall insulation", "Ceiling framing", "Plasterboard / drylining", "Screed",
    "Floor levelling", "Plastering", "Skimming", "Internal carpentry first fix",
  ] },
  { category: "WATERPROOFING / WET AREAS", colour: "#287FB8", activities: [
    "Bathroom waterproofing", "Wet-room tanking", "Shower tray installation", "Waterproof membrane",
    "Waterproofing inspection", "Waterproofing curing",
  ] },
  { category: "FINISHES", colour: "#C29A27", activities: [
    "Wall tiling", "Floor tiling", "Painting preparation", "Primer", "Painting", "Wallpaper",
    "Flooring installation", "Wood flooring", "Carpet", "Skirting boards", "Architraves", "Internal doors", "Decorative finishes",
  ] },
  { category: "SECOND FIX", colour: "#3F8C66", activities: [
    "Electrical second fix", "Install sockets", "Install switches", "Install lights", "Install consumer unit / final connections",
    "Plumbing second fix", "Install sanitaryware", "Install taps", "Install shower fittings", "Install radiators",
    "Install thermostats", "Install ventilation grilles", "Install ironmongery", "Final joinery",
  ] },
  { category: "KITCHEN / FITTED FURNITURE", colour: "#8059A5", activities: [
    "Kitchen delivery", "Kitchen installation", "Worktop templating", "Worktop delivery", "Worktop installation",
    "Splashback installation", "Appliance installation", "Wardrobe installation", "Bespoke joinery", "Cabinet adjustment",
  ] },
  { category: "EXTERNAL WORKS", colour: "#3F8C66", activities: [
    "External drainage", "Paving", "Patio", "Landscaping", "Fencing", "External lighting",
    "External sockets", "External painting", "Render/cladding completion", "Final external clean",
  ] },
  { category: "TESTING & COMMISSIONING", colour: "#287FB8", activities: [
    "Electrical testing", "Electrical certificate", "Plumbing pressure test", "Leak test", "Heating system commissioning",
    "Boiler commissioning", "Underfloor heating commissioning", "Ventilation commissioning", "HVAC commissioning",
    "Smoke alarm test", "CO alarm test", "Lighting test", "Controls setup", "Appliance commissioning",
  ] },
  { category: "COMPLIANCE / INSPECTIONS", colour: "#D97832", activities: [
    "Building Control inspection", "Structural inspection", "Electrical inspection", "Gas inspection",
    "Ventilation commissioning inspection", "Fire/smoke alarm check", "Insulation inspection",
    "Waterproofing inspection", "Final Building Control inspection", "Completion certificate",
  ] },
  { category: "COMPLETION", colour: "#3F8C66", activities: [
    "Snagging", "Defect correction", "Final decorating touch-ups", "Final clean", "Builders clean",
    "Remove temporary protection", "Remove skips", "Remove scaffolding", "Waste removal", "Final inspection", "Practical completion",
  ] },
  { category: "HANDOVER", colour: "#287FB8", activities: [
    "Client handover", "Handover manuals", "Certificates handover", "Warranty handover", "Keys handover",
    "As-built drawings", "Photographic record", "O&M documentation", "Completion sign-off",
  ] },
];

const EVENT_TYPES: Record<string, PlannerBuildActivityType> = {
  "Design freeze": "milestone", "Planning approval": "milestone", "Contract award": "milestone",
  "Pre-start meeting": "appointment", "Party Wall process": "waiting",
  "Skip delivery": "delivery", "Kitchen delivery": "delivery", "Worktop delivery": "delivery",
  "Watertight milestone": "milestone", "Structural inspection": "inspection", "Waterproofing inspection": "inspection",
  "Electrical inspection": "inspection", "Gas inspection": "inspection", "Building Control inspection": "inspection",
  "Ventilation commissioning inspection": "inspection", "Fire/smoke alarm check": "inspection", "Insulation inspection": "inspection",
  "Final Building Control inspection": "inspection", "Final inspection": "inspection", "Completion certificate": "milestone",
  "Practical completion": "milestone", "Completion sign-off": "milestone",
};
const TRADE_BY_KEYWORD: Array<[RegExp, string]> = [
  [/electrical|lighting|socket|switch|alarm|consumer unit/i, "Electrical"],
  [/plumb|bathroom|sanitary|tap|shower|drainage|sink/i, "Plumbing"],
  [/heating|radiator|boiler|thermostat|underfloor/i, "Heating"],
  [/HVAC|ventilation|ducting/i, "Heating / HVAC"],
  [/kitchen|worktop|cabinet|appliance/i, "Kitchen fitting"],
  [/tiling|tile|waterproof|wet-room/i, "Tiling"],
  [/paint|primer|wallpaper|decorat/i, "Decorator"],
  [/floor|carpet|screed|levelling/i, "Flooring"],
  [/window|door|ironmongery/i, "Joinery"],
  [/roof|cladding|render|flashing|weather seal|external wall/i, "Building envelope"],
  [/steel|structur|lintel|joist|foundation|concrete|excavat/i, "Structural"],
  [/plaster|drylining|skimming/i, "Plastering"],
];

export const PLANNER_BUILD_ACTIVITY_LIBRARY: readonly PlannerBuildActivityTemplate[] = PHASES.flatMap(({ category, colour, activities }) =>
  activities.map((name) => ({
    id: category.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ":" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    category,
    type: EVENT_TYPES[name] ?? "task",
    ...(TRADE_BY_KEYWORD.find(([pattern]) => pattern.test(name))?.[1] ? { trade: TRADE_BY_KEYWORD.find(([pattern]) => pattern.test(name))![1] } : {}),
    colour,
  })),
);

export function searchPlannerBuildActivityLibrary(query: string, category = "ALL"): PlannerBuildActivityTemplate[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return PLANNER_BUILD_ACTIVITY_LIBRARY.filter((template) =>
    (category === "ALL" || template.category === category) &&
    (!normalizedQuery || (template.name + " " + template.category + " " + (template.trade ?? "")).toLocaleLowerCase().includes(normalizedQuery)),
  );
}
