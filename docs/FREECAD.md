# FreeCAD integration

FreeCAD is invoked headlessly through `FreeCADCmd`. The regular Python application serialises a
validated, versioned engineering snapshot to JSON and launches `cad/freecad_worker.py` in FreeCAD's
Python runtime. The worker has no dependency on FastAPI, Pydantic, Shapely, or a GUI.

The generated document groups are `Room`, `Walls`, `Openings`, `FixedObjects`, `Products`,
`Clearances`, and `CollisionMarkers`. Wall solids are built to the exterior of the finished internal
polygon. Door and window volumes are subtracted from their parent wall solids.

The adapter fails explicitly if FreeCAD is missing or returns an error. It never substitutes a fake
CAD file. FreeCAD 26.3 is available on the current development machine at
`C:\Program Files\FreeCAD 26.3\bin\freecadcmd.exe`.

