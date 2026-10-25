import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.app.openfoam_case import compile_case
from backend.app.openfoam_service import authenticate, create_app
from backend.app.openfoam_smoke import fixture
from backend.app.openfoam_telemetry import telemetry
from backend.app.openfoam_runtime import convergence, flow_balance
from backend.app.supabase_rest import VerifiedUser


def native(root, path, text):
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding='ascii')
    return target


def metadata(root, **values):
    native(root, 'manifest.json', json.dumps(values))


def test_empty_native_case_never_fabricates_samples(tmp_path):
    data = telemetry(tmp_path)
    assert data['balance'] is None and data['probes'] == []


def test_flux_uses_only_complete_common_iterations_and_outward_sign(tmp_path):
    metadata(tmp_path, flowPatchNames=['p_a', 'p_b'], balanceTolerance=.05)
    native(tmp_path, 'postProcessing/flux_p_a/0/surfaceFieldValue.dat', '# Time sum(phi)\n1 -.005\n2 -.006\n')
    native(tmp_path, 'postProcessing/flux_p_b/0/surfaceFieldValue.dat', '# Time sum(phi)\n1 .0045\n')
    balance = telemetry(tmp_path)['balance']
    assert balance['samples'][-1]['iteration'] == 1
    assert balance['samples'][-1]['incomingM3S'] == .005
    assert balance['samples'][-1]['outgoingM3S'] == .0045
    assert balance['samples'][-1]['relativeImbalance'] == pytest.approx(.0005 / .00475)
    assert balance['fluxM3S'] == {'p_a': -.005, 'p_b': .0045}
    assert balance['tolerance'] == .05


def test_missing_expected_patch_cannot_report_a_false_balanced_case(tmp_path):
    metadata(tmp_path, flowPatchNames=['p_a', 'p_b'])
    native(tmp_path, 'postProcessing/flux_p_a/0/surfaceFieldValue.dat', '1 0\n')
    assert telemetry(tmp_path)['balance'] is None


def test_probes_preserve_xyz_mm_units_and_do_not_mix_different_times(tmp_path):
    metadata(tmp_path, probePositionsMm=[[1000, 500, 250], [1500, 500, 250]])
    native(tmp_path, 'postProcessing/probes/0/U', '# Probe 0 (1 .5 .25)\n1 (1 2 3) (4 5 6)\n2 (2 3 4) (5 6 7)\n')
    native(tmp_path, 'postProcessing/probes/0/p', '# kinematic pressure\n1 .1 .2\n')
    probes = telemetry(tmp_path)['probes']
    assert len(probes) == 2 and probes[0]['positionMm'] == [1000, 500, 250]
    assert probes[0]['samples'][0] == {'iteration': 1, 'velocityMS': [1, 2, 3], 'pressureM2S2': .1}
    assert probes[0]['samples'][1]['pressureM2S2'] is None
    assert probes[1]['samples'][1]['velocityMS'] == [5, 6, 7]


def test_partial_lines_and_invalid_native_values_are_omitted_with_warning(tmp_path):
    native(tmp_path, 'postProcessing/probes/0/U', '1 (1 2 3)\n2 (nan 0 0)\n3 (-1e300 0 0)\n4 (0 0)\n5 (9 8 7)')
    data = telemetry(tmp_path)
    assert len(data['probes'][0]['samples']) == 1
    assert data['probes'][0]['samples'][0]['iteration'] == 1
    assert data['warnings']


def test_recent_history_is_bounded_and_older_time_folders_do_not_win_lexically(tmp_path):
    native(tmp_path, 'postProcessing/probes/9/p', '9 999\n')
    native(tmp_path, 'postProcessing/probes/10/p', ''.join(f'{i} {i / 10}\n' for i in range(10, 110)))
    data = telemetry(tmp_path)
    assert data['truncated']
    assert len(data['probes'][0]['samples']) == 32
    assert data['probes'][0]['samples'][-1]['iteration'] == 109


def test_native_acceptance_uses_numeric_restart_folders_and_bounded_complete_rows(tmp_path):
    for name, flux in [('a', -.005), ('b', .005)]:
        native(tmp_path, f'postProcessing/flux_{name}/2/surfaceFieldValue.dat', '2 999\n')
        native(tmp_path, f'postProcessing/flux_{name}/10/surfaceFieldValue.dat',
               '# historic data\n' * 2000 + f'10 {flux}\n')
    balance = flow_balance(tmp_path, ['a', 'b'], .05)
    assert balance['passed'] and balance['fluxM3S'] == {'a': -.005, 'b': .005}
    with pytest.raises(ValueError, match='final solver iteration'):
        flow_balance(tmp_path, ['a', 'b'], .05, expected_iteration=11)
    assert flow_balance(tmp_path, ['a', 'b'], .05, expected_iteration=10)['passed']
    native(tmp_path, 'postProcessing/flux_b/10/surfaceFieldValue.dat', '10 .005\n11 999')
    with pytest.raises(ValueError, match='Incomplete native telemetry'):
        flow_balance(tmp_path, ['a', 'b'], .05)
    native(tmp_path, 'postProcessing/flux_b/10/surfaceFieldValue.dat', '11 .005\n')
    with pytest.raises(ValueError, match='different iteration timestamps'):
        flow_balance(tmp_path, ['a', 'b'], .05)


def test_final_convergence_requires_a_finite_solver_iteration():
    rows = '\n'.join(f'Solving for {field}, Initial residual = 1e-6' for field in ['Ux', 'Uy', 'Uz', 'p'])
    measured = convergence('Time = 9\nSolving for p, Initial residual = .1\nTime = 10\n' + rows, 1e-5, 'laminar')
    assert measured['converged'] and measured['finalIteration'] == 10
    for prefix in ['', 'Time = nan\n', 'Time = -1\n', 'Time = invalid\n']:
        result = convergence(prefix + rows, 1e-5, 'laminar')
        assert not result['converged'] and result['finalIteration'] is None


def test_out_of_policy_probe_count_is_not_sent_to_the_browser(tmp_path):
    native(tmp_path, 'postProcessing/probes/0/p', '1 ' + ' '.join('1' for _ in range(101)) + '\n')
    data = telemetry(tmp_path)
    assert data['probes'] == [] and data['warnings']


def test_maximum_probe_view_remains_smaller_than_transport_limit(tmp_path):
    metadata(tmp_path, probePositionsMm=[[1000, 500, 250]] * 100)
    native(tmp_path, 'postProcessing/probes/0/U',
           ''.join(f'{i} ' + ' '.join('(1 2 3)' for _ in range(100)) + '\n' for i in range(35)))
    native(tmp_path, 'postProcessing/probes/0/p',
           ''.join(f'{i} ' + ' '.join('.123456789' for _ in range(100)) + '\n' for i in range(35)))
    data = telemetry(tmp_path)
    assert len(data['probes']) == 100
    assert len(json.dumps(data).encode()) < 512 * 1024


def test_compiler_records_probe_and_balance_metadata_in_authoritative_units(tmp_path):
    request = fixture()
    request.scenario.outputs.probesMm = [(1000, 500, 250)]
    from backend.app.climoptix_provider import PreparationOnlyProvider
    report = PreparationOnlyProvider().validate_scenario(request.project, request.scenario, request.clientRevision)
    manifest = compile_case(tmp_path, request, report)
    assert manifest['probePositionsMm'] == [(1000, 500, 250)]
    assert len(manifest['flowPatchNames']) == 2
    assert 'probeLocations ((1 0.5 0.25))' in (tmp_path / 'system/controlDict').read_text()


def test_logs_attach_owner_scoped_telemetry_not_another_jobs_files(tmp_path):
    app = create_app(tmp_path, start_runner=False)
    owner = VerifiedUser(uuid4(), 'owner@example.com', True)
    app.dependency_overrides[authenticate] = lambda: owner
    app.state.worker['ready'] = True
    with TestClient(app) as client:
        job = client.post('/climoptix/worker/jobs', json=fixture().model_dump(mode='json')).json()
        root = app.state.store.path(job['id'])
        native(root, 'postProcessing/probes/0/p', '1 .25\n')
        response = client.get(f"/climoptix/worker/jobs/{job['id']}/logs?cursor=0")
        assert response.json()['telemetry']['probes'][0]['samples'][0]['pressureM2S2'] == .25
        assert response.headers['cache-control'] == 'no-store'
        app.dependency_overrides[authenticate] = lambda: VerifiedUser(uuid4(), 'other@example.com', True)
        assert client.get(f"/climoptix/worker/jobs/{job['id']}/logs?cursor=0").status_code == 404


def test_native_startup_acceptance_rejects_missing_probe_and_flux_evidence(tmp_path, monkeypatch):
    from backend.app.openfoam_smoke import acceptance
    monkeypatch.setattr('backend.app.openfoam_smoke.execute', lambda *args: {
        'accepted': True, 'artifacts': [{'kind': 'vtk'}], 'mesh': {}, 'convergence': {}, 'conservation': {},
    })
    with pytest.raises(ValueError, match='telemetry acceptance failed'):
        acceptance(tmp_path / 'acceptance')


def test_native_startup_acceptance_records_all_three_models_telemetry(tmp_path, monkeypatch):
    from backend.app.openfoam_smoke import acceptance
    def executed(case, *args):
        metadata(case, flowPatchNames=['p_a', 'p_b'], probePositionsMm=[[1000, 500, 500]], balanceTolerance=.05)
        native(case, 'postProcessing/flux_p_a/0/surfaceFieldValue.dat', '1 -.005\n')
        native(case, 'postProcessing/flux_p_b/0/surfaceFieldValue.dat', '1 .005\n')
        native(case, 'postProcessing/probes/0/U', '1 (.01 0 0)\n')
        native(case, 'postProcessing/probes/0/p', '1 .001\n')
        return {'accepted': True, 'artifacts': [{'kind': 'vtk'}], 'mesh': {}, 'convergence': {}, 'conservation': {}}
    monkeypatch.setattr('backend.app.openfoam_smoke.execute', executed)
    acceptance(tmp_path / 'acceptance')
    results = json.loads((tmp_path / 'acceptance/acceptance.json').read_text())
    assert {result['turbulence'] for result in results} == {'laminar', 'kEpsilon', 'kOmegaSST'}
    assert all(result['telemetry']['probes'][0]['samples'][0]['velocityMS'] == [.01, 0, 0] for result in results)
