# Milestone 1 limitations

- Project/room mutation endpoints currently use process-local storage; SQLAlchemy records define the
  PostgreSQL persistence boundary, but a repository/session adapter is not wired yet.
- The room editor visualises the validated fixture and placement scenarios; drag-to-edit polygon
  vertices and dimension-constrained wall editing are the next frontend slice.
- The fit kernel uses deterministic 2.5D footprints and explicit Z intervals. Curved or freeform
  solids are deferred until a product requires them.
- Cylinders use a 32-segment Shapely approximation for footprint predicates.
- The shower operational envelope is a documented parametric quarter sweep. Manufacturer-specific
  door kinematics require a versioned product rule.
- CAD generation is verified against FreeCAD 26.3 on Windows. A Linux worker/container image remains
  to be supplied before deployment.
- Generated FCStd files and browser meshes are evidence visualisations, not authoritative inputs.
- Authentication, catalogue ingestion, AI extraction, scans, photorealistic rendering, checkout,
  supplier workflows, and building-code certification are outside this milestone.

