# Unit policy

`INTERNAL_LENGTH_UNIT = "mm"`. Every authoritative coordinate, length, clearance, tolerance, and
uncertainty is represented in millimetres. Input models reject other units, non-finite numbers,
negative physical dimensions, and implausibly large room/product dimensions.

The frontend receives millimetres from the API. `DISPLAY_MM_TO_SCENE = 0.001` converts them to
Three.js scene units at the rendering boundary only. Values returned from the viewer are converted
back to millimetres and revalidated by the backend; scene units are never persisted as engineering
measurements.

`GEOMETRY_EPSILON_MM = 0.01` handles floating-point noise from geometric predicates. It is one
hundredth of a millimetre: much smaller than realistic site measurement uncertainty and never a
substitute for measurement tolerance. User/manufacturer uncertainty is modelled separately.

