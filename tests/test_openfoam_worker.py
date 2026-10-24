import hashlib
import json
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app.openfoam_case import Submission, compile_case, validate_submission
from backend.app.openfoam_runtime import convergence, flow_balance, mesh_metrics
from backend.app.openfoam_service import Store, authenticate, create_app
from backend.app.openfoam_smoke import fixture
from backend.app.supabase_rest import VerifiedUser


def test_generated_case_has_canonical_vent_regions_and_si_units(tmp_path):
    request = fixture()
    report = validate_submission(request)
    manifest = compile_case(tmp_path / 'case', request, report)
    assert len(manifest['patches']) == 8
    assert manifest['pressureUnit'] == 'm2/s2'
    stl = (tmp_path / 'case/constant/triSurface/boundary.stl').read_text()
    assert 'vertex 2 ' in stl and 'vertex 2000 ' not in stl
    assert 'flowRateInletVelocity' in (tmp_path / 'case/0/U').read_text()
    assert 'volumetricFlowRate constant 0.005' in (tmp_path / 'case/0/U').read_text()
    assert 'point (1 0.5 0.5)' in (tmp_path / 'case/system/controlDict').read_text()
    assert all(name.startswith('p_') for name in manifest['patches'].values())


@pytest.mark.parametrize('section,key,value', [
    ('resources', 'cpu', 3), ('resources', 'memoryGb', 5), ('resources', 'wallTimeMinutes', 16),
    ('mesh', 'maxCells', 600000), ('physics', 'energy', True), ('physics', 'mode', 'transient'),
    ('outputs', 'comfort', True), ('mesh', 'alignmentDeg', 30),
])
def test_policy_rejects_unsupported_or_unbounded_input(section, key, value):
    request = fixture().model_dump(mode='json')
    request['scenario'][section][key] = value
    with pytest.raises(ValueError):
        validate_submission(Submission.model_validate(request))


def test_stale_fingerprints_rejected():
    request = fixture()
    request.sourceHash = '0'*64
    with pytest.raises(ValueError, match='fingerprint'):
        validate_submission(request)


def test_store_idempotency_conflict_owner_isolation_restart(tmp_path):
    store = Store(tmp_path)
    request, owner = fixture(), str(uuid4())
    job = store.submit(owner, request)
    assert store.submit(owner, request)['id'] == job['id']
    request.scenario.name = 'Different immutable payload'
    with pytest.raises(HTTPException) as conflict:
        store.submit(owner, request)
    assert conflict.value.status_code == 409
    with pytest.raises(HTTPException) as missing:
        store.get(str(uuid4()), job['id'])
    assert missing.value.status_code == 404
    store.update(job['id'], 'Running', 'runtime')
    store.recover()
    assert store.get(owner, job['id'])['phase'] == 'Failed'
    assert Store(tmp_path).get(owner, job['id'])['revision'] == request.clientRevision


def test_live_log_cursor_cancel_and_artifact_integrity(tmp_path):
    app = create_app(tmp_path, start_runner=False)
    owner = VerifiedUser(uuid4(), 'allowed@example.com', True)
    app.dependency_overrides[authenticate] = lambda: owner
    app.state.worker['ready'] = True
    request = fixture()
    with TestClient(app) as client:
        job = client.post('/climoptix/worker/jobs', json=request.model_dump(mode='json')).json()
        root = app.state.store.path(job['id'])
        root.mkdir()
        (root / 'solver.log').write_bytes(b'Time = 1\n')
        response = client.get(f"/climoptix/worker/jobs/{job['id']}/logs?cursor=0")
        assert response.json()['nextCursor'] == 9
        assert response.json()['clientRevision'] == request.clientRevision
        assert client.get(f"/climoptix/worker/jobs/{job['id']}/logs?cursor=10").status_code == 409
        assert client.post(f"/climoptix/worker/jobs/{job['id']}/cancel", json={}).json()['phase'] == 'Cancelled'
        artifact = root / 'native-case.zip'
        artifact.write_bytes(b'original')
        (root / 'result.json').write_text(json.dumps({'artifacts': [{'id': 'native-case', 'path': 'native-case.zip',
            'kind': 'zip', 'size': 8, 'sha256': hashlib.sha256(b'original').hexdigest()}]}))
        assert client.get(f"/climoptix/worker/jobs/{job['id']}/artifacts/native-case").content == b'original'
        artifact.write_bytes(b'modified')
        assert client.get(f"/climoptix/worker/jobs/{job['id']}/artifacts/native-case").status_code == 409
        app.dependency_overrides[authenticate] = lambda: VerifiedUser(uuid4(), 'other@example.com', True)
        assert client.get(f"/climoptix/worker/jobs/{job['id']}").status_code == 404


def test_auth_and_finite_body_are_fail_closed(tmp_path, monkeypatch):
    app = create_app(tmp_path, start_runner=False)
    with TestClient(app) as client:
        assert client.get('/climoptix/worker/capabilities').status_code == 401
        assert client.post('/climoptix/worker/jobs', content='{"x":NaN}',
                           headers={'Content-Type': 'application/json'}).status_code == 422
        assert client.post('/climoptix/worker/jobs', content='{"x":1e400}',
                           headers={'Content-Type': 'application/json'}).status_code == 422
        assert client.post('/climoptix/worker/jobs', content='['*1100+'0'+']'*1100,
                           headers={'Content-Type': 'application/json'}).status_code == 422
        assert client.post('/climoptix/worker/jobs', content='x'*(4*1024**2+1),
                           headers={'Content-Type': 'application/json'}).status_code == 413
    monkeypatch.setenv('CFD_ALLOWED_EMAIL', 'allowed@example.com')
    monkeypatch.setattr('backend.app.openfoam_service.SupabaseREST.verify_user',
                        lambda self, token, **kwargs: VerifiedUser(UUID(int=1), 'other@example.com', True))
    with pytest.raises(HTTPException) as rejected:
        authenticate('Bearer token')
    assert rejected.value.status_code == 403


def test_quality_and_convergence_require_actual_measured_evidence(tmp_path):
    request = fixture()
    text = ('cells: 100\nMesh non-orthogonality Max: 3 average: 1\nMax skewness = 0.2\n'
            'Max aspect ratio = 2\nMin volume = 1e-6\nMesh OK.\n')
    assert mesh_metrics(text, 'p_1 {type patch; nFaces 3; startFace 0;}', {'p_1'}, request.scenario)['cells'] == 100
    with pytest.raises(ValueError):
        mesh_metrics(text.replace('Mesh OK.', 'Failed 1 mesh checks.'), '', {'p_1'}, request.scenario)
    assert not convergence('Time = 1\nSolving for p, Initial residual = 0.1', 1e-5, 'laminar')['converged']
    for name, flux in [('a', -.005), ('b', .005)]:
        folder = tmp_path / f'postProcessing/flux_{name}/0'
        folder.mkdir(parents=True)
        (folder / 'surfaceFieldValue.dat').write_text(f'# Time flux\n10 {flux}\n')
    assert flow_balance(tmp_path, ['a', 'b'], .05)['passed']


def test_worker_requires_email_confirmation_not_only_phone_confirmation(monkeypatch):
    from backend.app.supabase_rest import SupabaseREST

    monkeypatch.setenv('SUPABASE_URL', 'https://auth.example')
    monkeypatch.setenv('SUPABASE_PUBLISHABLE_KEY', 'public-test-key')
    monkeypatch.setenv('REQUIRE_VERIFIED_EMAIL', 'true')
    user = {'id': str(uuid4()), 'email': 'allowed@example.com', 'confirmed_at': '2026-10-24T00:00:00Z',
            'email_confirmed_at': None}
    client = SupabaseREST()
    monkeypatch.setattr(client, '_read', lambda *args, **kwargs: (json.dumps(user).encode(), 200))
    with pytest.raises(PermissionError):
        client.verify_user('opaque', require_confirmed_email=True)
    user['email_confirmed_at'] = '2026-10-24T00:00:00Z'
    assert client.verify_user('opaque', require_confirmed_email=True).email_confirmed


def test_expired_artifacts_keep_idempotency_tombstone(tmp_path):
    store = Store(tmp_path)
    request, owner = fixture(), str(uuid4())
    job = store.submit(owner, request)
    case = store.path(job['id'])
    case.mkdir()
    (case / 'solver.log').write_text('old log')
    store.update(job['id'], 'Completed', 'done')
    with store.connect() as db:
        db.execute('UPDATE jobs SET expires=0 WHERE id=?', (job['id'],))
    store.cleanup()
    assert not case.exists()
    retry = store.submit(owner, request)
    assert retry['id'] == job['id'] and retry['phase'] == 'Stale' and retry['payload'] == ''
