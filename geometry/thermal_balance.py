"""Deterministic sensible-only screening and a non-executable thermal handoff.

Positive Q enters the selected air domain. Overall U belongs to the screening
model; the Robin handoff removes Rsi once because CFD resolves room convection.
No wall storage, latent load, geometric shading or radiation solver is implied.
"""

from copy import deepcopy
from typing import Any

from geometry.climoptix_domain import canonical_hash, discover_domain
from geometry.thermal_envelope import energy_floors, envelope_records, insulation_source
from geometry.thermal_models import ThermalPackage, ThermalSetup
from geometry.thermal_solar import irradiance, sun_position

LIMITATIONS = [
    "Sensible-only, single well-mixed steady air zone; not a CFD solution, annual peak or regulatory design day.",
    "No thermal mass, latent loads, bridges, coupled solids or inter-surface radiation/view factors.",
    "Ground and adjacent-zone exchange use explicit temperatures and planar U*A; "
    "no soil/attic field or 2D ground model is solved.",
    "Isotropic sky and manual shading factors; surroundings, furniture and roof self-shadowing are not ray traced.",
    "Glazing transmission and all declared sensible/radiant gains use labelled lumped air deposition; "
    "radiation is not resolved.",
    "Overall U includes films for the preview. Robin removes declared Rsi once; no extra exterior resistance is added.",
    "OpenCFD v2312 contract only: exact temperature dictionary and worker integration require separate review. "
    "Not executed or runnable.",
]


def _exchange(setup: ThermalSetup, scenario: Any, report: dict[str, Any]) -> dict[str, Any]:
    air = setup.airExchange
    mode, flow, temperature = air.mode, 0.0, air.supplyTemperatureC
    if mode == "unspecified":
        raise ValueError("Choose air exchange explicitly, including None if the zone is sealed.")
    if mode in ("ach", "volume", "mass"):
        flow = (
            air.value * report["domain"]["volumeM3"] / 3600
            if mode == "ach"
            else (air.value / setup.rhoKgM3 if mode == "mass" else air.value)
        )
        if air.extractValue is None or abs(air.extractValue - air.value) > max(1e-9, air.value * 1e-6):
            raise ValueError("Supply and extract must be explicitly balanced in the selected airflow units.")
    if mode == "devices":
        if any(v.recirculationPair for v in scenario.vents):
            raise ValueError(
                "Recirculated HVAC is off in this no-HVAC model. Use independently defined outdoor air exchange."
            )
        values = {v.id: v for v in scenario.vents}
        if not values or len(values) != len(report["vents"]):
            raise ValueError("Device air exchange requires valid supply and extract apertures.")
        supply, extract, enthalpy = 0.0, 0.0, 0.0
        for vent in report["vents"]:
            source = values[vent["id"]]
            q = source.valueSI / setup.rhoKgM3 if source.control == "massFlow" else vent["volumeFlowM3S"]
            if q is None or q <= 0:
                raise ValueError("Pressure-controlled devices do not define a known thermal airflow.")
            if vent["role"] == "supply":
                supply += q
                enthalpy += q * (values[vent["id"]].temperatureK - 273.15)
            else:
                extract += q
        if supply <= 0 or abs(supply - extract) > max(1e-9, supply * 1e-6):
            raise ValueError("Device supply and extract flows must balance for a determinate sealed-zone energy model.")
        flow, temperature = supply, enthalpy / supply
    if flow > 0 and temperature is None:
        raise ValueError("Specify the supply air temperature; outdoor temperature is not silently substituted.")
    if mode != "none" and not air.source.strip():
        raise ValueError("Describe the airflow source and assumptions.")
    return {"mode": mode, "volumeFlowM3S": flow, "massFlowKgS": setup.rhoKgM3 * flow, "supplyTemperatureC": temperature}


def _sources(
    setup: ThermalSetup,
    scenario: Any,
    report: dict[str, Any],
    errors: list[str],
    warnings: list[str],
    project: dict[str, Any],
) -> list[dict[str, Any]]:
    sources, referenced = [], set()
    objects = {obj["id"]: obj for obj in report["objects"]}
    selected = set(report["domain"]["includedRoomIds"])
    hvac = {
        obj["id"]
        for floor in energy_floors(project).values()
        for room in floor["content"].get("rooms", [])
        for obj in room.get("obstacles", [])
        if obj.get("fixture_kind") in ("HEATING", "RADIATOR", "HEATER")
        or obj.get("representation_key", "").startswith("heating-")
        or obj.get("heating_spec")
    }
    for gain in setup.gains:
        if not gain.enabled:
            continue
        if gain.id in referenced:
            errors.append("Internal gain IDs must be unique.")
        referenced.add(gain.id)
        if gain.roomId is not None and gain.roomId not in selected:
            errors.append(f"{gain.name}: source room is outside the selected connected domain.")
        if gain.objectId:
            if gain.objectId in hvac:
                errors.append(f"{gain.name}: linked HVAC heat output must be off for a no-HVAC study.")
            if gain.objectId in referenced:
                errors.append(f"{gain.name}: this object already supplies heat; avoid duplicate sources.")
            referenced.add(gain.objectId)
            if gain.objectId not in objects or objects[gain.objectId]["mode"] in ("none", "sourceOnly"):
                warnings.append(
                    f"{gain.name}: heat source has no active airflow obstruction; "
                    "confirm the source-only approximation."
                )
        if not gain.source.strip():
            errors.append(f"{gain.name}: provide source/provenance for the sensible gain.")
        sources.append(
            {
                "id": gain.id,
                "name": gain.name,
                "powerW": gain.count * gain.powerW * gain.sensibleFraction * gain.operatingFraction,
                "radiantFraction": gain.radiantFraction,
                "roomId": gain.roomId,
                "objectId": gain.objectId,
                "source": gain.source,
                "deposition": "lumped_sensible_air",
            }
        )
    overrides = {o.objectId: o for o in scenario.assetOverrides}
    for obj in report["objects"]:
        override = overrides.get(obj["id"])
        if obj["id"] in hvac:
            if obj["heatW"] > 0 or (override and override.temperatureK is not None):
                warnings.append(f"{obj['name']}: HVAC output is disabled in this no-HVAC screening model.")
                if setup.includeCFDSources:
                    errors.append(f"{obj['name']}: turn off its CFD HVAC source before applying no-HVAC conditions.")
            continue
        if setup.includeCFDSources and override and override.schedule != "constant":
            errors.append(f"{obj['name']}: schedules are unsupported; choose an explicit constant sensible power.")
        if override and override.temperatureK is not None:
            errors.append(
                f"{obj['name']}: fixed-temperature equipment has an unknown sensible power. "
                "Disable that source for no-HVAC screening."
            )
        if setup.includeCFDSources and obj["heatW"] > 0:
            if obj["mode"] == "sourceOnly":
                warnings.append(f"{obj['name']}: source-only heat is enabled; no airflow obstruction is represented.")
            if override and override.count > 1 and obj["mode"] in ("solidProxy", "porousProxy"):
                warnings.append(
                    f"{obj['name']}: source count scales heat, not obstruction geometry. "
                    "Place individual instances if repeated bodies should block airflow."
                )
            if obj["id"] in referenced:
                errors.append(f"{obj['name']}: both a manual gain and a CFD object source are enabled.")
            sources.append(
                {
                    "id": f"object:{obj['id']}",
                    "name": obj["name"],
                    "powerW": obj["heatW"],
                    "radiantFraction": override.radiantFraction if override else 0,
                    "roomId": obj["roomId"],
                    "objectId": obj["id"],
                    "source": "Explicit CFD instance sensible-power override (constant schedule)",
                    "deposition": "lumped_sensible_air",
                }
            )
        elif obj["mode"] in ("solidProxy", "porousProxy") and obj["id"] not in referenced:
            warnings.append(
                f"{obj['name']}: retained as an airflow obstruction; its heat source is off in this scenario."
            )
    return sources


def thermal_package(
    project: dict[str, Any], scenario: Any, report: dict[str, Any], *, calculate: bool
) -> ThermalPackage:
    """Source report MUST be freshly prepared on the server, never supplied by the client."""
    setup = scenario.thermalEnvelope or ThermalSetup()
    domain = discover_domain(project, scenario)
    records = envelope_records(project, scenario, domain, report)
    errors, warnings, projection = [], [], []
    sun = None
    cardinal: dict[str, float] = {}
    preview: dict[str, Any] = {}
    exchange = {"mode": setup.airExchange.mode, "volumeFlowM3S": 0.0, "massFlowKgS": 0.0, "supplyTemperatureC": None}
    sources = []
    if not report["surface"]["closed"] or any(
        d["severity"] == "error" and d["group"] in ("geometry", "connectivity") for d in report["diagnostics"]
    ):
        errors.append(
            "The selected geometry is not a valid closed air domain. Repair source geometry before thermal calculation."
        )
    if calculate:
        if setup.weather.epwRecord and setup.location.fixedUtcOffsetMinutes is None:
            warnings.append(
                "EPW forcing has been retimed using manual timezone rules. "
                "This is a user-defined representative forcing, not the original EPW standard-time instant."
            )
        unmatched = set(setup.overrides) - {face["surfaceId"] for face in records}
        if unmatched:
            errors.append(
                f"{len(unmatched)} surface overrides no longer map to the selected geometry. "
                "Review and reset the unavailable overrides before calculating."
            )
        if setup.weather.forcingBasis == "hourlyMean":
            warnings.append(
                "Hourly-mean radiation is transposed at the selected interval midpoint; "
                "GHI is retained for ground reflection, without an instantaneous component-consistency check."
            )
        if not setup.assumptionsAccepted:
            errors.append("Review and accept the displayed screening assumptions and air-property defaults.")
        if setup.weather.temperatureC is None or not setup.weather.source.strip():
            errors.append("Outdoor temperature and weather provenance are required.")
        try:
            sun = sun_position(setup)
            if setup.weather.solarMode != "perSurface":
                cardinal = {
                    name: irradiance(90, angle, setup, sun)["totalWm2"]
                    for name, angle in (("North", 0), ("East", 90), ("South", 180), ("West", 270))
                }
        except ValueError as error:
            errors.append(str(error))
        try:
            exchange = _exchange(setup, scenario, report)
        except ValueError as error:
            errors.append(str(error))
        sources = _sources(setup, scenario, report, errors, warnings, project)
        envelope_patches = {face["patchId"] for face in records}
        if any(
            p["id"] in envelope_patches and p["boundary"]["thermal"]["type"] != "adiabatic" for p in report["patches"]
        ):
            projection.append(
                "Existing envelope thermal boundary conditions are active. "
                "Reset those legacy thermal fields to Adiabatic/inherit before applying this package; "
                "flow and scalar conditions can remain unchanged."
            )
        total_h, weighted, transmitted, opaque_solar, fixed_q = 0.0, 0.0, 0.0, 0.0, 0.0
        for face in records:
            label = f"{face['roomName']} · {face['elementId']}"
            override = setup.overrides.get(face["surfaceId"])
            if face["status"] == "stale":
                errors.append(f"{label}: review stale geometry/override and confirm its current construction.")
            if override and not override.reason.strip():
                errors.append(f"{label}: record a reason/source for the override.")
            if face["exposure"] in ("internal", "adiabatic") or face["method"] == "adiabatic":
                face.update(
                    incidentWm2=0,
                    absorbedWm2=0,
                    transmittedW=0,
                    conductanceWK=0,
                    fluxWm2=0,
                    heatW=0,
                    cfdBC={"model": "adiabatic"},
                )
                continue
            try:
                u = face["uWm2K"]
                if u is None or face["source"] == "heatingEstimate":
                    raise ValueError("verified overall U is missing; no Heating fallback is permitted")
                incident = 0.0
                if face["exposure"] == "outdoors":
                    ambient = setup.weather.temperatureC
                    if ambient is None:
                        raise ValueError("outdoor temperature is missing")
                    if setup.weather.solarMode == "perSurface":
                        if not override or override.incidentWm2 is None:
                            raise ValueError("enter per-face incident irradiance explicitly")
                        incident = override.incidentWm2
                    elif sun:
                        incident = irradiance(face["tiltDeg"], face["azimuthDeg"], setup, sun)["totalWm2"]
                    elif setup.weather.solarMode != "none":
                        raise ValueError("valid sun position is required for solar transposition")
                else:
                    ambient = face["ambientC"]
                    if ambient is None and face["exposure"] == "ground":
                        ambient = setup.groundTemperatureC
                    if ambient is None:
                        raise ValueError("enter an explicit ground/adjacent-zone temperature")
                incident *= face["shadingFactor"]
                equivalent, absorbed, solar = ambient, 0.0, 0.0
                if face["kind"] == "window":
                    g = face["gValue"]
                    if incident > 0:
                        if not isinstance(g, (int, float)) or isinstance(g, bool) or not 0 <= g <= 1:
                            raise ValueError("glazing solar gain g/SHGC in 0–1 is required")
                        solar = face["areaM2"] * g * incident
                elif face["exposure"] == "outdoors":
                    lw = override.longwaveWm2 if override and override.longwaveWm2 is not None else setup.longwaveWm2
                    if incident > 0:
                        if face["alpha"] is None:
                            raise ValueError("enter opaque solar absorptance explicitly")
                        absorbed = face["alpha"] * incident
                    if absorbed != 0 or lw != 0:
                        h = (
                            override.externalH
                            if override and override.externalH is not None
                            else setup.weather.externalH
                        )
                        if h is None:
                            raise ValueError("external h is required for the sol-air approximation")
                        if face["rse"] and abs(h - 1 / face["rse"]) > max(0.1, h * 0.05):
                            warnings.append(
                                f"{label}: sol-air h differs from 1/Rse. "
                                "It changes equivalent forcing only; declared assembly resistance is retained. "
                                "Review the film/forcing assumption or explicitly revise Rse."
                            )
                        equivalent += (absorbed - lw) / h
                conductance = u * face["areaM2"]
                method = face["method"]
                if method == "temperature":
                    if not override or override.fixedTemperatureC is None or face["rsi"] is None or face["rsi"] <= 0:
                        raise ValueError(
                            "prescribed inner-surface temperature needs a value and declared positive Rsi for screening"
                        )
                    equivalent = override.fixedTemperatureC
                    conductance = face["areaM2"] / face["rsi"]
                    bc = {"model": "fixedTemperature", "temperatureK": equivalent + 273.15}
                elif method == "fixedFlux":
                    flux = (
                        override.fixedFluxWm2
                        if override and override.fixedFluxWm2 is not None
                        else u * (equivalent - setup.referenceIndoorC)
                    )
                    bc = {
                        "model": "fixedFlux",
                        "fluxIntoRoomWm2": flux,
                        "referenceIndoorK": setup.referenceIndoorC + 273.15,
                    }
                    # The preview remains a self-consistent U*A balance unless an
                    # independent constant flux was explicitly imposed by the user.
                    if override and override.fixedFluxWm2 is not None:
                        conductance = 0.0
                        fixed_q += flux * face["areaM2"]
                else:
                    rsi = face["rsi"]
                    rout = 1 / u - rsi if rsi is not None else None
                    if rout is None or rout <= 0:
                        projection.append(
                            f"{label}: Robin requires declared Rsi and positive Rtotal − Rsi; "
                            "use a reviewed fixed-flux method instead."
                        )
                        bc = None
                    else:
                        bc = {"model": "externalRobin", "rOutwardM2KW": rout, "tEqOutsideK": equivalent + 273.15}
                if not -100 <= equivalent <= 200:
                    raise ValueError(
                        "equivalent surface forcing is outside the supported −100–200 °C range; "
                        "review h and solar/longwave inputs"
                    )
                face.update(
                    ambientC=ambient,
                    equivalentC=equivalent,
                    incidentWm2=incident,
                    absorbedWm2=absorbed,
                    transmittedW=solar,
                    conductanceWK=conductance,
                    cfdBC=bc,
                )
                total_h += conductance
                weighted += conductance * equivalent
                transmitted += solar
                opaque_solar += conductance * (equivalent - ambient) if method != "temperature" else 0
            except ValueError as error:
                face["status"] = "incomplete" if face["status"] != "stale" else "stale"
                face["warnings"].append(str(error))
                errors.append(f"{label}: {error}.")
        hv = exchange["massFlowKgS"] * setup.cpJKgK
        gains = sum(s["powerW"] for s in sources)
        h = total_h + hv
        numerator = weighted + hv * (exchange["supplyTemperatureC"] or 0) + gains + transmitted + fixed_q
        if h <= 1e-12:
            errors.append(
                "No positive heat-removal conductance: equilibrium is indeterminate or cannot balance the load. "
                "No finite temperature is returned."
            )
        ti = numerator / h if h > 1e-12 and not errors else None
        if ti is not None and not -100 <= ti <= 200:
            errors.append(
                "Equilibrium is outside the supported −100–200 °C screening range. "
                "Review assumptions and heat-removal routes."
            )
            ti = None
        residual = None
        if ti is not None:
            for face in records:
                if face["conductanceWK"] is None or (
                    face["conductanceWK"] == 0 and face["cfdBC"] and face["cfdBC"]["model"] == "fixedFlux"
                ):
                    if face["cfdBC"] and face["cfdBC"]["model"] == "fixedFlux":
                        face["heatW"] = face["cfdBC"]["fluxIntoRoomWm2"] * face["areaM2"]
                    else:
                        continue
                elif face["conductanceWK"]:
                    face["heatW"] = face["conductanceWK"] * (face["equivalentC"] - ti)
                face["fluxWm2"] = (face["heatW"] or 0) / face["areaM2"]
            air_q = hv * ((exchange["supplyTemperatureC"] or 0) - ti)
            residual = sum(f["heatW"] or 0 for f in records) + air_q + gains + transmitted
            if abs(residual) > setup.balanceToleranceW:
                errors.append("The calculated sensible balance exceeds the declared residual tolerance.")
        preview = {
            "equilibriumAirTempC": ti,
            "heatBalanceResidualW": residual,
            "envelopeConductanceWK": total_h,
            "airConductanceWK": hv,
            "totalConductanceWK": h,
            "transmittedSolarW": transmitted,
            "internalGainsW": gains,
            "opaqueSolarEquivalentW": opaque_solar,
            "airExchangeW": hv * ((exchange["supplyTemperatureC"] or 0) - ti) if ti is not None else None,
            "netAtReferenceW": numerator - h * setup.referenceIndoorC if not errors else None,
        }
        if scenario.vents and setup.airExchange.mode != "devices":
            projection.append(
                "CFD vents exist: reconcile their actual flows and temperatures "
                "using Device air exchange before applying."
            )
        if exchange["volumeFlowM3S"] > 0 and (
            abs(scenario.physics.densityKgM3 - setup.rhoKgM3) > 1e-9
            or abs(scenario.physics.heatCapacityJKgK - setup.cpJKgK) > 1e-9
        ):
            projection.append(
                "Match the explicit thermal air density and heat capacity with CFD Physics "
                "before applying airflow enthalpy."
            )
        if any(p["boundary"]["flow"]["type"] in ("opening", "pressure") for p in report["patches"]):
            warnings.append(
                "Pressure/opening flow is not resolved by the lumped model; "
                "the declared air-exchange assumption controls this estimate."
            )
            projection.append(
                "Pressure/opening boundaries have unspecified advective heat exchange. "
                "Close them or define a reviewed airflow/thermal adapter "
                "before applying this sealed-zone contract."
            )
        # Separate source deposition for transmitted solar: never duplicate this
        # power as window convection or include it twice in internalGainsW.
        sources.extend(
            {
                "id": f"solar:{face['surfaceId']}",
                "name": f"{face['roomName']} · transmitted glazing solar",
                "powerW": face["transmittedW"],
                "radiantFraction": 1.0,
                "roomId": face["roomId"],
                "objectId": None,
                "source": "A × g/SHGC × incident × solar multiplier; simplified lumped deposition",
                "deposition": "lumped_sensible_air",
            }
            for face in records
            if face["kind"] == "window" and (face["transmittedW"] or 0) > 0
        )
    config = scenario.model_dump(
        mode="json",
        exclude={
            "validation", "thermalSnapshots", "name", "description", "group", "archived", "createdAt", "updatedAt"
        },
    )
    # Provenance timestamps are retained in the snapshot, not physical hash keys.
    for override in (config.get("thermalEnvelope") or {}).get("overrides", {}).values():
        override.pop("updatedAt", None)
    configuration_hash = canonical_hash(config)
    construction_hash = canonical_hash(insulation_source(project))
    case_hash = canonical_hash(
        {
            "geometry": report["validation"]["sourceHash"],
            "construction": construction_hash,
            "configuration": configuration_hash,
            "engine": "thermal-1-pvlib-0.16.1",
        }
    )
    compatible = scenario.physics.energy and scenario.physics.mode == "steady"
    if not compatible:
        projection.append(
            "Thermal Apply requires an explicitly selected steady energy/buoyant physics mode; "
            "isothermal flow has no energy equation."
        )
    if not calculate:
        errors.append("Not calculated. Review inputs, then Calculate & preview.")
    warnings.extend(w for f in records for w in f["warnings"])
    return ThermalPackage.model_validate(
        {
            "projectId": project["projectId"],
            "domainId": scenario.id,
            "sourceRevision": report["validation"]["clientRevision"],
            "caseHash": case_hash,
            "geometryHash": report["validation"]["sourceHash"],
            "constructionHash": construction_hash,
            "configurationHash": configuration_hash,
            "scenario": deepcopy(setup.model_dump(mode="json")),
            "surfaces": records,
            "internalSources": sources,
            "airExchange": exchange,
            "sun": sun,
            "cardinalIrradianceWm2": cardinal,
            "preview": preview,
            "validation": {
                "errors": list(dict.fromkeys(errors)),
                "warnings": list(dict.fromkeys(warnings)),
                "projectionErrors": list(dict.fromkeys(projection)),
                "previewReady": calculate and not errors,
                "applyReady": calculate and not errors and not projection,
                "energyCompatible": bool(compatible),
            },
            "limitations": LIMITATIONS,
        }
    )
