# Testing

Run the authoritative suite with:

```powershell
uv run pytest
```

The regression suite covers polygon validity, CCW/outward walls, unchanged internal dimensions,
openings, door swing, obstacles, product containment/rotation, tolerance boundaries, uncertainty,
units, API serialisation, and the mandatory L-shaped fixture. FreeCAD generation is additionally
verified with the installed `FreeCADCmd` because its Python modules are not importable in a normal
virtual environment.

Tests compare floating-point geometry with `GEOMETRY_EPSILON_MM` or a tighter purpose-specific
absolute tolerance. They do not round inputs or use a large epsilon to conceal errors.

