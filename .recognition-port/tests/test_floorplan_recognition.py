from __future__ import annotations

from pathlib import Path

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


def test_recognise_rooms_bridges_a_door_gap_between_rooms() -> None:
    image = np.full((500, 700, 3), 255, dtype=np.uint8)
    cv2.rectangle(image, (80, 70), (620, 430), (0, 0, 0), thickness=12)
    cv2.line(image, (350, 70), (350, 210), (0, 0, 0), thickness=12)
    cv2.line(image, (350, 275), (350, 430), (0, 0, 0), thickness=12)
    success, encoded = cv2.imencode(".png", image)

    assert success
    _width, _height, rooms = recognise_rooms(encoded.tobytes(), "two-rooms.png")

    assert len(rooms) == 2
    assert all(room.confidence >= 0.8 for room in rooms)


def test_ground_floor_plan_excludes_exterior_space_and_cleans_return_loop() -> None:
    source = Path(__file__).parents[1] / "floorplans" / "GroundFloorOriginal.png"

    _width, _height, rooms = recognise_rooms(source.read_bytes(), source.name, gap_closure=0.15)

    assert len(rooms) == 4
    # The kitchen outline previously contained a narrow out-and-back spike.
    assert max(len(room.vertices) for room in rooms) <= 6
