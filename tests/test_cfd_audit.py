import pytest

from scripts.audit_cfd_assets import tetrahedra_summary


@pytest.mark.parametrize("vertices,valid", [("1 2 3 4", True), ("1 3 2 4", False), ("1 2 3 3", False)])
def test_optional_mesh_audit_counts_volume_cells_and_rejects_inverted_or_degenerate_cells(tmp_path, vertices, valid):
    mesh = tmp_path / "audit.msh"
    mesh.write_text(
        "$MeshFormat\n2.2 0 8\n$EndMeshFormat\n"
        "$Nodes\n4\n1 0 0 0\n2 1 0 0\n3 0 1 0\n4 0 0 1\n$EndNodes\n"
        f"$Elements\n2\n1 2 0 1 2 3\n2 4 0 {vertices}\n$EndElements\n",
        encoding="utf8",
    )
    if valid:
        result = tetrahedra_summary(mesh)
        assert result["tetrahedra"] == 1, "The surface triangle must not count as a volume cell"
        assert result["volume_mm3"] == pytest.approx(1 / 6)
    else:
        with pytest.raises(ValueError, match="Non-positive tetrahedron"):
            tetrahedra_summary(mesh)


def test_optional_mesh_audit_does_not_accept_an_empty_volume_mesh(tmp_path):
    mesh = tmp_path / "empty.msh"
    mesh.write_text("$Nodes\n0\n$EndNodes\n$Elements\n0\n$EndElements\n", encoding="utf8")
    with pytest.raises(ValueError, match="No volume tetrahedra"):
        tetrahedra_summary(mesh)
