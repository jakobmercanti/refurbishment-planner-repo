import json
import struct
import threading
import time
from itertools import product
from uuid import uuid4

import anyio
import numpy as np
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app.cfd_mesh_inspection import (
    VolumeMesh,
    geometry_bytes,
    inspection,
    inspection_response,
    mesh_revision,
    retain_mesh,
    section_polygons,
)
from backend.app.openfoam_service import authenticate, create_app
from backend.app.openfoam_smoke import fixture
from backend.app.supabase_rest import VerifiedUser


def native_mesh(root, points, cells):
    """Write actual face/owner/neighbour topology, with internal faces first."""
    faces = {}
    for cell, polygons in enumerate(cells):
        for polygon in polygons:
            key = tuple(sorted(polygon))
            if key in faces:
                faces[key][2] = cell
            else:
                faces[key] = [polygon, cell, None]
    ordered = sorted(faces.values(), key=lambda item: item[2] is None)
    internal = [face for face in ordered if face[2] is not None]
    base = root / 'constant/polyMesh'
    base.mkdir(parents=True)

    def write(name, count, body):
        (base / name).write_text(f'FoamFile {{ format ascii; object {name}; }}\n{count}\n(\n{body}\n)\n')

    write('points', len(points), '\n'.join('(' + ' '.join(map(str, point)) + ')' for point in points))
    write('faces', len(ordered), '\n'.join(str(len(face[0])) + '(' + ' '.join(map(str, face[0])) + ')'
                                         for face in ordered))
    write('owner', len(ordered), '\n'.join(str(face[1]) for face in ordered))
    write('neighbour', len(internal), '\n'.join(str(face[2]) for face in internal))
    write('boundary', 1, f'walls {{ type wall; nFaces {len(ordered) - len(internal)}; startFace {len(internal)}; }}')
    return root


def grid_mesh(root, n=2, omit=None):
    points = list(product(range(n + 1), repeat=3))
    lookup = {point: index for index, point in enumerate(points)}
    cells = []
    for x, y, z in product(range(n), repeat=3):
        if omit and omit(x, y, z):
            continue
        a, b, c, d, e, f, g, h = [lookup[point] for point in [
            (x, y, z), (x+1, y, z), (x+1, y+1, z), (x, y+1, z),
            (x, y, z+1), (x+1, y, z+1), (x+1, y+1, z+1), (x, y+1, z+1)]]
        cells.append([[a, d, c, b], [e, f, g, h], [a, b, f, e], [d, h, g, c], [a, e, h, d], [b, c, g, f]])
    return native_mesh(root, points, cells)


def area(geometry):
    points, triangles, _, _ = geometry
    vertices = points[triangles]
    return np.linalg.norm(np.cross(vertices[:, 1] - vertices[:, 0], vertices[:, 2] - vertices[:, 0]), axis=1).sum()/2


@pytest.mark.parametrize('axis', [0, 1, 2])
@pytest.mark.parametrize('position', [0, .5, 1, 1.0000001, 2])
def test_structured_sections_show_four_real_cells_without_duplicate_coincident_faces(tmp_path, axis, position):
    mesh = VolumeMesh(grid_mesh(tmp_path))
    geometry = mesh.section(axis, position*1000)
    points, _, edges, cells = geometry
    assert cells == 4
    assert area(geometry) == pytest.approx(4e6)
    assert np.all(points[:, axis] == position*1000)
    assert len(edges) == len(set(map(tuple, edges)))
    # At least one actual internal partition crosses the square's interior.
    assert any(np.allclose(points[edge][:, (axis+1) % 3], 1000) for edge in edges)
    assert mesh.cells == 8 and mesh.bounds.tolist() == [[0, 0, 0], [2000, 2000, 2000]]


def test_tetrahedron_section_is_filled_volume_triangle_not_clipped_shell(tmp_path):
    root = native_mesh(tmp_path, [[0, 0, 0], [2, 0, 0], [0, 2, 0], [0, 0, 2]],
                       [[[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]]])
    mesh = VolumeMesh(root)
    section = mesh.section(0, 500)
    assert section[3] == 1
    assert area(section) == pytest.approx(1.125e6)
    assert len(mesh.section(0, 2000)[1]) == 0  # plane through a single vertex
    assert len(mesh.section(0, 2500)[0]) == 0


def test_concave_polyhedron_and_sliver_are_preserved(tmp_path):
    polygon = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]
    points = [[x, y, z] for z in [0, .000001] for x, y in polygon]
    cells = [[list(reversed(range(6))), list(range(6, 12)),
              *[[i, (i+1) % 6, (i+1) % 6+6, i+6] for i in range(6)]]]
    mesh = VolumeMesh(native_mesh(tmp_path, points, cells))
    section = mesh.section(2, .0005)
    assert section[3] == 1 and area(section) == pytest.approx(3e6)
    assert area(mesh.section(0, 1500)) == pytest.approx(1)
    assert len(mesh.section(2, .002)[0]) == 0


def test_holes_and_disconnected_regions_are_not_filled(tmp_path):
    mesh = VolumeMesh(grid_mesh(tmp_path, n=3, omit=lambda x, y, z: x == y == 1))
    section = mesh.section(2, 500)
    assert section[3] == 8 and area(section) == pytest.approx(8e6)
    points, triangles, _, _ = section
    centers = points[triangles].mean(axis=1)
    assert not any(1000 < point[0] < 2000 and 1000 < point[1] < 2000 for point in centers)


def test_nested_section_loops_preserve_holes_and_disconnected_parts():
    segments = []
    for ring in [[(0, 0), (4, 0), (4, 4), (0, 4)], [(1, 1), (3, 1), (3, 3), (1, 3)],
                 [(5, 0), (6, 0), (6, 1), (5, 1)]]:
        segments.extend(zip(ring, ring[1:] + ring[:1], strict=True))
    polygons = section_polygons(segments, 1e-9)
    assert len(polygons) == 2 and sum(polygon.area for polygon in polygons) == pytest.approx(13)
    assert sum(len(polygon.interiors) for polygon in polygons) == 1


def test_section_cancellation_does_not_modify_mesh(tmp_path):
    mesh = VolumeMesh(grid_mesh(tmp_path))
    with pytest.raises(HTTPException) as failure:
        mesh.section(2, 500, lambda: True)
    assert failure.value.status_code == 499
    assert mesh.section(2, 500)[3] == 4


def test_disconnected_browser_stops_section_work():
    stopped = threading.Event()

    class Disconnected:
        async def is_disconnected(self):
            return True

    def compute(cancelled):
        deadline = time.monotonic() + 2
        while not cancelled() and time.monotonic() < deadline:
            time.sleep(.001)
        if cancelled():
            stopped.set()
        return b'geometry'

    with pytest.raises(HTTPException) as failure:
        anyio.run(inspection_response, Disconnected(), compute)
    assert failure.value.status_code == 499
    assert stopped.wait(1), 'An obsolete section must release its worker slot promptly'


def test_retained_legacy_mesh_recovers_and_source_changes_invalidate_cache(tmp_path):
    request = fixture()
    root = grid_mesh(tmp_path / 'case')
    proof = {key: getattr(request, key) for key in ('studyId', 'clientRevision', 'sourceHash', 'configurationHash')}
    proof['mesh'] = {'cells': 8}
    (root / 'result.json').write_text(json.dumps(proof))

    class RetainedStore:
        def get(self, *_):
            return {'project': 'project', 'expires': time.time()+100, 'payload': json.dumps(proof),
                    'id': 'job', 'study': request.studyId, 'revision': request.clientRevision}

        def path(self, *_):
            return root

    store = RetainedStore()
    metadata = inspection(store, 'owner', 'job', 'project', metadata_only=True)
    assert metadata['cells'] == 8 and metadata['meshId'] == mesh_revision(root)
    # Upgrade proof carries a stable mesh checksum; a changed native source must
    # be rejected even if a geometry response with that checksum is cached.
    retain_mesh(root, proof)
    inspection(store, 'owner', 'job', 'project', mesh_id=metadata['meshId'], axis='Z', coordinate=500)
    owner = root / 'constant/polyMesh/owner'
    owner.write_text(owner.read_text() + '\n// source changed\n')
    with pytest.raises(HTTPException) as failure:
        inspection(store, 'owner', 'job', 'project', mesh_id=metadata['meshId'], axis='Z', coordinate=500)
    assert failure.value.status_code == 422 and 'integrity' in failure.value.detail


def test_packet_contains_only_original_boundary_edges_and_valid_indexed_buffers(tmp_path):
    mesh = VolumeMesh(grid_mesh(tmp_path))
    geometry = mesh.surface()
    packet = geometry_bytes('a'*64, geometry)
    size = struct.unpack_from('<I', packet, 4)[0]
    header = json.loads(packet[8:8+size])
    assert packet[:4] == b'CMI1' and header['units'] == 'mm'
    assert len(packet) == 8+size+header['points']*24+header['triangles']*12+header['edges']*8
    points, _, edges, _ = geometry
    # Cube boundary cell edges have no artificial face-triangulation diagonals.
    assert np.all(np.count_nonzero(points[edges[:, 0]] - points[edges[:, 1]], axis=1) == 1)


def test_checked_mesh_is_inspectable_before_solving_and_survives_restart(tmp_path):
    request = fixture()
    app = create_app(tmp_path, start_runner=False)
    user = VerifiedUser(uuid4(), 'mesh@example.com', True)
    app.dependency_overrides[authenticate] = lambda: user
    store = app.state.store
    job = store.submit(str(user.id), request)
    root = grid_mesh(store.path(job['id']))
    proof = {key: getattr(request, key) for key in ('studyId', 'clientRevision', 'sourceHash', 'configurationHash')}
    proof['mesh'] = {'cells': 8}
    retain_mesh(root, proof)
    store.update(job['id'], 'Running', 'solver running')
    url = f"/climoptix/worker/jobs/{job['id']}/mesh"
    project = str(request.project['projectId'])
    before = {file: file.read_bytes() for file in root.rglob('*') if file.is_file()}
    with TestClient(app) as client:
        response = client.get(url, params={'projectId': project})
        assert response.status_code == 200, response.text
        meta = response.json()
        assert meta['cells'] == 8 and meta['meshId'] == mesh_revision(root)
        body = {'projectId': project, 'jobId': job['id'], 'meshId': meta['meshId'], 'axis': 'Z', 'coordinateMm': 500}
        response = client.post('/climoptix/worker/mesh-section', json=body)
        assert response.status_code == 200 and response.content[:4] == b'CMI1'
        assert client.get(url, params={'projectId': str(uuid4())}).status_code == 404
        assert client.post('/climoptix/worker/mesh-section', json={**body, 'meshId': '0'*64}).status_code == 409
        assert client.post('/climoptix/worker/mesh-section', json={**body, 'coordinateMm': 1e12}).status_code == 422
        assert client.get(url+'-geometry', params={'projectId': project, 'meshId': meta['meshId']}).status_code == 200
        app.dependency_overrides[authenticate] = lambda: VerifiedUser(uuid4(), 'other@example.com', True)
        assert client.get(url, params={'projectId': project}).status_code == 404
    assert all(path.read_bytes() == contents for path, contents in before.items())
    # Recovery marks interrupted jobs failed, but their checked mesh remains valid.
    store.recover()
    assert inspection(store, str(user.id), job['id'], project, metadata_only=True)['cells'] == 8
    payload = json.loads((root / 'mesh-inspection.json').read_text())
    payload['configurationHash'] = '0'*64
    (root / 'mesh-inspection.json').write_text(json.dumps(payload))
    with pytest.raises(HTTPException) as failure:
        inspection(store, str(user.id), job['id'], project, metadata_only=True)
    assert failure.value.status_code == 422


def test_missing_expired_binary_and_damaged_sources_fail_closed(tmp_path):
    root = grid_mesh(tmp_path)
    path = root / 'constant/polyMesh/points'
    original = path.read_text()
    path.write_text(original.replace('format ascii', 'format binary'))
    with pytest.raises(ValueError, match='ASCII'):
        VolumeMesh(root)
    path.write_text(original.replace('(0 0 0)', '(0 0 0junk)'))
    with pytest.raises(ValueError):
        VolumeMesh(root)
    path.write_text(original)
    face = root / 'constant/polyMesh/faces'
    face.write_text(face.read_text().replace('4(', '999999(', 1))
    with pytest.raises(ValueError, match='topology'):
        VolumeMesh(root)

    class MissingStore:
        def get(self, *_):
            return {'project': 'project', 'expires': time.time()-1}

        def path(self, *_):
            return root

    with pytest.raises(HTTPException) as failure:
        inspection(MissingStore(), 'owner', 'job', 'project', metadata_only=True)
    assert failure.value.status_code == 410
