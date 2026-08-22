# Regression fixtures

The mandatory L-shaped bathroom fixture is defined in `geometry/fixtures.py` with fixed UUIDs and
versioned engineering inputs. Keeping its construction in validated domain models prevents a raw
JSON fixture from bypassing unit, provenance, uncertainty, and topology validation.

`GET /demo` returns its serialised representation. `python -m cad.generator --demo <output>` sends
the same validated snapshot to FreeCAD. The expected placement outcomes are `FIT`, `VERIFY`, and
`FAIL`.

