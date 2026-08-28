from __future__ import annotations

import cv2
import numpy as np

from backend.app.floorplan_recognition import recognise_rooms


def test_recognise_rooms_finds_an_enclosed_drawing_room() -> None:
    image = np.full((500, 700, 3), 255, dtype=np.uint8)
    cv2.rectangle(image, (120, 100), (580, 400), (0, 0, 0), thickness=12)
    success, encoded = cv2.imencode(".png", image)

    assert success
    width, height, rooms = recognise_rooms(encoded.tobytes(), "bathroom.png")

    assert (width, height) == (700, 500)
    assert len(rooms) == 1
    assert rooms[0].area_px2 > 100_000
    assert len(rooms[0].vertices) == 4
