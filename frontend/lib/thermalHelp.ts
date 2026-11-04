export const THERMAL_HELP = [
  {
    heading: "One construction source",
    text: "Refresh imports exact selected-domain surfaces and saved constructions per floor. Missing data stays missing. Edit in Insulation uses the existing source editor; return here to refresh. CFD overrides never rewrite those assemblies.",
  },
  {
    heading: "Screening, not CFD",
    text: "The preliminary estimate balances a single well-mixed sensible-only zone at one instant with HVAC off. It does not model thermal mass, annual peaks, latent heat, ray-traced shading or interior radiation. Positive heat enters the selected air domain.",
  },
  {
    heading: "Explicit inputs",
    text: "Enter location/timezone, date, weather provenance and outdoor temperature, choose air exchange including None, and review the assumptions. Solar needs DNI/DHI and albedo or per-face forcing. Ground and adjacent zones need their own temperatures. Enter or Tab commits a valid number. Optional fields may be blank; Escape restores the saved value.",
  },
  {
    heading: "Films and handoff",
    text: "Screening uses overall U including films. Robin removes declared Rsi exactly once and is blocked when the film split is unknown. Fixed flux is an approximation at the stated reference temperature. Glazing solar and internal gains are separate lumped air sources, not duplicated glass convection.",
  },
  {
    heading: "Apply, save and history",
    text: "Calculate explicitly after changing inputs. Apply stores a versioned immutable contract with source hashes, preserving flow and scalar conditions. Changes make previous results stale; up to three applied packages are retained in the project. Native thermal execution is unavailable; these thermal exports are preparation handoffs and do not represent a solver run.",
  },
  {
    heading: "Location, weather and sun",
    text: "No location is detected or fetched. At 0°, plan +X is east and +Y north; the north angle is the clockwise true-north bearing of plan +Y, without moving geometry. Preset names are labels, not regulatory design conditions. Representative means one selected hour, not a full-day or peak prediction. A saved EPW record retains the selected hour; reimport the file to choose another after reopening. EPW uses a fixed standard-time offset without DST; editing IANA timezone returns to timezone rules. For manual per-surface solar, use Envelope → Advanced surface override to enter irradiance on every outdoor face, including zero on unlit faces; the multiplier is applied once.",
  },
  {
    heading: "Gains and balance",
    text: "HVAC is off in this screening calculation: do not include heater/chiller output as an internal gain. No infiltration is assumed; known supply and extract must balance. Each gain is count × heat per item × sensible fraction × operating fraction. Radiant share is included once as lumped sensible heat, not resolved radiation. Envelope bars include equivalent sol-air forcing; glazing solar is counted separately once and residual includes every term. A finite equilibrium requires all inputs and heat-removal routes.",
  },
  {
    heading: "Modelling defaults",
    text: "Overall U is for the lumped balance; Robin uses Rtotal − Rsi and is blocked if the film split is unknown. Sol-air exterior h changes forcing, not exterior resistance. Defaults are review inputs, not validated project values: 20 °C reference, 1.2 kg/m³, 1005 J/kgK, unshaded multiplier 1, no longwave correction and 0.01 W residual tolerance. Emissivity is metadata and does not activate radiation. The visible controls retain the actual saved values.",
  },
];
