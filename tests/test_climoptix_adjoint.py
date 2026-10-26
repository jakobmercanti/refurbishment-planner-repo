"""Preparation and analytic mathematics only: never claim a CFD adjoint test."""

import math
from copy import deepcopy

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.climoptix_adjoint import fixed_port, prepare_optimisation
from backend.app.climoptix_provider import PreparationOnlyProvider
from backend.app.openfoam_smoke import fixture
from geometry.climoptix_adjoint import AdjointStudy
from geometry.climoptix_models import Scenario
from geometry.vent_position_gradient import normalised_flux_derivative, perimeter_gradient


def setup(request=None):
    request = fixture() if request is None else request
    report = PreparationOnlyProvider().validate_scenario(request.project, request.scenario, request.clientRevision)
    ports = []
    for v in request.scenario.vents:
        host = next(p["host"] for p in report["patches"] if p["id"] == v.host.patchId)
        u, w = v.host.u * host["widthMm"], v.host.v * host["heightMm"]
        ports.append(
            {
                "ventId": v.id,
                "movable": True,
                "bounds": {"uMinMm": u - 20, "uMaxMm": u + 20, "vMinMm": w - 20, "vMaxMm": w + 20},
            }
        )
    study = AdjointStudy.model_validate(
        {
            "id": "position-study",
            "name": "Local study",
            "ports": ports,
            "baseline": {k: report["validation"][k] for k in ("sourceHash", "configurationHash", "clientRevision")},
        }
    )
    study = AdjointStudy.model_validate(
        {
            **study.model_dump(),
            "baseline": {
                **study.baseline.model_dump(),
                "ports": [
                    fixed_port(v, next(p["host"] for p in report["patches"] if p["id"] == v.host.patchId))
                    for v in request.scenario.vents
                ],
            },
        }
    )
    return request, report, study


@pytest.mark.parametrize("shape", ["rectangle", "circle"])
@pytest.mark.parametrize("angle", [0, 31, 90])
def test_perimeter_constant_cancels_linear_density_known_translation_sign(shape, angle):
    kwargs = dict(
        shape=shape, centre_m=(0.7, -0.2), width_m=0.4, height_m=0.4 if shape == "circle" else 0.2, angle_deg=angle
    )
    assert perimeter_gradient(lambda u, v: 9.0, **kwargs) == pytest.approx((0, 0), abs=2e-14)
    area = math.pi * 0.2**2 if shape == "circle" else 0.08
    grad = perimeter_gradient(lambda u, v: 3 * u - 7 * v + 4, **kwargs)
    assert grad == pytest.approx((3 * area, -7 * area), abs=2e-14)
    # J=integral_A g dA = area*g(centre) for an affine g. Central differences
    # test the convention, not a fabricated primal or adjoint.
    for epsilon in (1e-2, 1e-3, 1e-4, 1e-5):
        fd = tuple(
            (
                area * (3 * (0.7 + (epsilon if k == 0 else 0)) - 7 * (-0.2 + (epsilon if k == 1 else 0)) + 4)
                - area * (3 * (0.7 - (epsilon if k == 0 else 0)) - 7 * (-0.2 - (epsilon if k == 1 else 0)) + 4)
            )
            / (2 * epsilon)
            for k in (0, 1)
        )
        assert grad == pytest.approx(fd, rel=1e-9)
        assert not np.allclose(-np.array(grad), fd, rtol=0.1)  # reversed sign cannot pass


def test_circle_quadrature_refinement_for_nonpolynomial_density():
    kwargs = dict(shape="circle", centre_m=(0.2, 0.4), width_m=0.6, height_m=0.6)
    reference = np.array(perimeter_gradient(lambda u, v: math.exp(10 * u + 4 * v), order=128, **kwargs))
    errors = [
        np.linalg.norm(
            np.array(perimeter_gradient(lambda u, v: math.exp(10 * u + 4 * v), order=n, **kwargs)) - reference
        )
        for n in (4, 8, 16)
    ]
    assert errors[-1] < 1e-10
    assert errors[-1] < errors[0]


def test_normalisation_chain_rule_retains_total_flow_and_zero_flux_derivative():
    m = np.array([0.1, 0.4, 0.8, 0.9])
    dm = np.array([[0.1, -0.2], [0.4, 0.3], [-0.2, 0.3], [0.1, -0.1]])
    areas = np.array([0.1, 0.2, 0.3, 0.5])
    flux, derivative = normalised_flux_derivative(m, dm, areas, 0.05)
    assert flux.sum() == pytest.approx(0.05, abs=1e-15)
    assert derivative.sum(axis=0) == pytest.approx([0, 0], abs=1e-15)
    for k in (0, 1):
        epsilon = 1e-5
        fp, _ = normalised_flux_derivative(m + epsilon * dm[:, k], dm, areas, 0.05)
        fm, _ = normalised_flux_derivative(m - epsilon * dm[:, k], dm, areas, 0.05)
        np.testing.assert_allclose(derivative[:, k], (fp - fm) / (2 * epsilon), rtol=1e-9, atol=1e-12)
    for scale in (1e-200, 1e200):
        scaled_flux, scaled_derivative = normalised_flux_derivative(m, dm, areas * scale, 0.05)
        np.testing.assert_allclose(scaled_flux, flux, rtol=1e-14, atol=1e-15)
        np.testing.assert_allclose(scaled_derivative, derivative, rtol=1e-14, atol=1e-15)


def test_empty_nonfinite_or_invalid_footprints_and_masks_fail_closed():
    with pytest.raises(ValueError):
        normalised_flux_derivative(np.zeros(2), np.zeros((2, 2)), np.ones(2), 0.05)
    with pytest.raises(ValueError):
        perimeter_gradient(lambda u, v: float("nan"), shape="circle", centre_m=(0, 0), width_m=1, height_m=1)
    with pytest.raises(ValueError):
        perimeter_gradient(lambda u, v: 1, shape="circle", centre_m=(0, 0), width_m=1, height_m=2)


def test_current_feasible_configuration_has_no_runner_or_fake_iterations_and_never_mutates_geometry():
    request, report, study = setup()
    before = request.model_dump_json()
    value = prepare_optimisation(request.scenario, study, report)
    assert value["configurationReady"], value["issues"]
    assert value["state"] == "adjointUnavailable"
    assert value["canRun"] is False and value["iterations"] == [] and value["meshHash"] is None
    assert value["capability"]["fixedMeshMovement"] is False
    assert request.model_dump_json() == before
    assert {p["role"] for p in value["ports"]} == {"supply", "extract"}
    assert all(p["frame"]["normal"] for p in value["ports"])


def test_ten_requested_steps_and_chosen_translation_are_configuration_not_ten_adjoint_solves():
    request, report, study = setup()
    study.strategy.maxAcceptedSteps = 10
    study.strategy.initialStepMm = 17
    study.strategy.minimumStepMm = 17
    study.strategy.maximumStepMm = 17
    before = request.model_dump_json()
    result = prepare_optimisation(request.scenario, study, report)
    assert result["configurationReady"]
    assert study.strategy.maxAcceptedSteps == 10 and study.strategy.initialStepMm == 17
    assert result["canRun"] is False and result["capability"]["adjoint"] is False
    assert result["iterations"] == []  # No fabricated execution count/history.
    assert request.model_dump_json() == before  # No inlet movement happened.


@pytest.mark.parametrize(
    "change,code",
    [
        ("edge", "sweptFootprint"),
        ("locks", "locked"),
        ("stale", "baselineChanged"),
        ("none", "noMovablePorts"),
        ("thermal", "physics"),
        ("missing", "portSetChanged"),
        ("outside", "outsideRegion"),
        ("zero", "zeroRange"),
    ],
)
def test_actionable_readiness_failures(change, code):
    request, report, study = setup()
    if change == "edge":
        study.ports[0].bounds.uMinMm = 0
    if change == "locks":
        study.ports[0].lockU = study.ports[0].lockV = True
    if change == "stale":
        study.baseline.configurationHash = "b" * 64
    if change == "none":
        for port in study.ports:
            port.movable = False
    if change == "thermal":
        request.scenario.physics.energy = True
    if change == "missing":
        study.ports.pop()
    if change == "outside":
        study.ports[0].bounds.uMaxMm = 1
    if change == "zero":
        study.ports[0].bounds.uMinMm = study.ports[0].bounds.uMaxMm
    value = prepare_optimisation(request.scenario, study, report)
    assert value["configurationReady"] is False
    assert any(i["code"] == code and i["repair"] for i in value["issues"])
    assert value["canRun"] is False


def test_all_movement_region_corners_and_holes_not_just_centres_are_checked():
    request, report, study = setup()
    p = next(p for p in report["patches"] if p["id"] == request.scenario.vents[0].host.patchId)
    u, v = study.ports[0].bounds.uMaxMm, study.ports[0].bounds.vMaxMm
    p["host"]["polygonsMm"][0].append(
        [[u + 30, v + 30], [u + 40, v + 30], [u + 40, v + 40], [u + 30, v + 40], [u + 30, v + 30]]
    )
    value = prepare_optimisation(request.scenario, study, report)
    assert any(i["code"] == "sweptFootprint" for i in value["issues"])


def test_drafts_roundtrip_without_changing_physical_fingerprint():
    request, report, study = setup()
    request.scenario.adjointStudies = [study]
    restored = Scenario.model_validate_json(request.scenario.model_dump_json())
    after = PreparationOnlyProvider().validate_scenario(request.project, restored, request.clientRevision)
    assert restored.adjointStudies[0] == study
    assert after["validation"]["configurationHash"] == report["validation"]["configurationHash"]


def test_snapshot_tampering_or_current_port_changes_do_not_rewrite_historical_footprint():
    request, report, study = setup()
    captured = study.baseline.ports[0].model_dump()
    request.scenario.vents[0].widthMm = 300
    value = prepare_optimisation(request.scenario, study, report)
    assert study.baseline.ports[0].model_dump() == captured
    assert any(i["code"] == "baselinePortChanged" for i in value["issues"])
    study.baseline.ports.clear()
    assert prepare_optimisation(request.scenario, study, report)["canRun"] is False


def test_adjacent_movable_and_fixed_ports_respect_the_entire_joint_region():
    request = fixture()
    a, b = request.scenario.vents
    b.host.patchId = a.host.patchId
    a.host.u, b.host.u = 0.35, 0.65
    a.widthMm = a.heightMm = b.widthMm = b.heightMm = 100
    request, report, study = setup(request)
    assert prepare_optimisation(request.scenario, study, report)["configurationReady"]
    study.ports[0].bounds.uMaxMm = 600
    study.ports[1].movable = False
    value = prepare_optimisation(request.scenario, study, report)
    assert any(i["code"] == "collision" for i in value["issues"])


def test_inclined_ceiling_support_uses_its_true_3d_tangent_frame():
    from types import SimpleNamespace

    from tests.test_climoptix import building, project, scenario

    p = building(project(), "MONO")
    s = scenario(p)
    raw = s.model_dump()
    raw["vents"] = [
        {
            "id": f"v{i}",
            "name": f"Port {i}",
            "role": role,
            "widthMm": 100,
            "heightMm": 100,
            "host": {"patchId": "floor-ground:a:ceiling:0", "u": u, "v": 0.5},
        }
        for i, (role, u) in enumerate((("supply", 0.3), ("extract", 0.7)))
    ]
    request, report, study = setup(
        SimpleNamespace(project=p, scenario=Scenario.model_validate(raw), clientRevision="a" * 64)
    )
    value = prepare_optimisation(request.scenario, study, report)
    assert value["configurationReady"], value["issues"]
    normal = study.baseline.ports[0].normal
    assert 0.01 < abs(normal[0]) < 0.9
    assert sum(v * v for v in normal) == pytest.approx(1)
    assert study.baseline.ports[0].vAxis == list(value["ports"][0]["frame"]["vAxis"])


@pytest.mark.parametrize(
    "field,value",
    [
        ("maxAcceptedSteps", 0),
        ("maxAcceptedSteps", 1.5),
        ("maxAcceptedSteps", True),
        ("maxAcceptedSteps", 51),
        ("initialStepMm", float("inf")),
        ("budgetSeconds", 3601),
        ("maxPrimalSolves", 1),
    ],
)
def test_strict_server_numerics_and_budgets(field, value):
    _, _, study = setup()
    raw = study.model_dump()
    raw["strategy"][field] = value
    with pytest.raises(ValidationError):
        AdjointStudy.model_validate(raw)


def test_boolean_or_text_contract_versions_cannot_alias_version_one():
    raw = setup()[2].model_dump()
    for value in (True, "1", 1.0):
        with pytest.raises(ValidationError):
            AdjointStudy.model_validate({**raw, "version": value})


def test_http_preparation_is_real_stateless_and_no_run_route_exists():
    from backend.app.main import app

    request, _report, study = setup()
    body = {
        "project": request.project,
        "scenario": request.scenario.model_dump(mode="json"),
        "clientRevision": request.clientRevision,
        "study": study.model_dump(),
    }
    with TestClient(app) as client:
        response = client.post("/climoptix/optimisation/prepare", json=body)
        assert response.status_code == 200, response.text
        assert response.json()["configurationReady"] and response.json()["canRun"] is False
        bad = deepcopy(body)
        bad["study"]["objective"]["expression"] = "__import__('os').system('bad')"
        assert client.post("/climoptix/optimisation/prepare", json=bad).status_code == 422
        assert client.post("/climoptix/optimisation/run", json=body).status_code == 404
