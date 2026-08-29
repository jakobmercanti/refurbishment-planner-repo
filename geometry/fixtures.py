"""Mandatory non-rectangular milestone fixture."""

from __future__ import annotations

from uuid import UUID

from geometry.models import (
    Dimensions3D,
    DoorType,
    FixtureBundle,
    GenericOpening,
    HingeSide,
    Measurement,
    MeasurementRange,
    ObstacleDefinition,
    OpeningKind,
    Placement,
    Point2D,
    ProductDefinition,
    RoomDefinition,
    SourceType,
    VerificationStatus,
)


def measured(value: float, uncertainty: float = 1.0) -> Measurement:
    return Measurement(
        value=value,
        source_type=SourceType.MANUALLY_VERIFIED,
        source_reference="mandatory L-shaped regression fixture",
        verified=True,
        uncertainty_mm=uncertainty,
    )


def manufacturer(value: float, uncertainty: float = 1.0) -> Measurement:
    return Measurement(
        value=value,
        source_type=SourceType.MANUFACTURER_DATASHEET,
        source_reference="Acme Shower Engineering Sheet AC-1200 rev 1",
        verified=True,
        uncertainty_mm=uncertainty,
    )


def build_l_shaped_fixture() -> FixtureBundle:
    door = GenericOpening(
        id="door-001",
        kind=OpeningKind.DOOR,
        parent_wall_id="wall-001",
        offset_mm=100.0,
        width=measured(800.0, 2.0),
        height=measured(2040.0, 2.0),
        hinge_side=HingeSide.START,
        door_type=DoorType.SINGLE,
        swing_angle_deg=90.0,
        opens_inward=True,
    )
    window = GenericOpening(
        id="window-001",
        kind=OpeningKind.WINDOW,
        parent_wall_id="wall-005",
        offset_mm=400.0,
        width=measured(1000.0, 2.0),
        height=measured(900.0, 2.0),
        sill_height_mm=900.0,
        reveal_depth_mm=100.0,
    )
    vanity = ObstacleDefinition(
        id="vanity-001",
        name="Existing vanity",
        center=Point2D(x=1500.0, y=500.0),
        dimensions=Dimensions3D(
            width=measured(600.0, 3.0),
            depth=measured(500.0, 3.0),
            height=measured(850.0, 3.0),
        ),
        source_type=SourceType.USER_MEASURED,
        verified=True,
        rotation_deg=180.0,
        fixture_kind="BASIN",
        model_id="basin-vanity-600",
        wall_lock=True,
    )
    room = RoomDefinition(
        id=UUID("00000000-0000-0000-0000-000000000101"),
        project_id=UUID("00000000-0000-0000-0000-000000000100"),
        name="Mandatory L-shaped bathroom",
        vertices=[
            Point2D(x=0.0, y=0.0),
            Point2D(x=3200.0, y=0.0),
            Point2D(x=3200.0, y=1800.0),
            Point2D(x=2200.0, y=1800.0),
            Point2D(x=2200.0, y=2800.0),
            Point2D(x=0.0, y=2800.0),
        ],
        wall_height=measured(2400.0, 2.0),
        wall_thickness=measured(100.0, 1.0),
        openings=[door, window],
        obstacles=[vanity],
    )
    product = ProductDefinition(
        id=UUID("00000000-0000-0000-0000-000000000201"),
        manufacturer="Acme Shower Engineering",
        sku="AC-1200-LH",
        name="1200 mm left-handed shower enclosure",
        category="shower_enclosure",
        nominal_dimensions=Dimensions3D(
            width=manufacturer(1200.0, 1.0),
            depth=manufacturer(900.0, 1.0),
            height=manufacturer(2000.0, 1.0),
        ),
        installation_width_range=MeasurementRange(
            minimum_mm=1195.0,
            maximum_mm=1205.0,
            source_type=SourceType.MANUFACTURER_DATASHEET,
            source_reference="Acme Shower Engineering Sheet AC-1200 rev 1",
            verified=True,
        ),
        installation_clearance_mm=75.0,
        service_clearance_mm=50.0,
        operational_swing_radius_mm=650.0,
        handedness="LEFT",
        source_documents=["Acme Shower Engineering Sheet AC-1200 rev 1"],
        verification_status=VerificationStatus.VERIFIED,
    )
    fit = Placement(
        id=UUID("00000000-0000-0000-0000-000000000301"),
        product_id=product.id,
        center=Point2D(x=2500.0, y=1150.0),
        rotation_deg=0.0,
        available_installation_width=measured(1200.0, 1.0),
    )
    verify = Placement(
        id=UUID("00000000-0000-0000-0000-000000000302"),
        product_id=product.id,
        center=Point2D(x=2500.0, y=1150.0),
        rotation_deg=0.0,
        available_installation_width=Measurement(
            value=1207.0,
            source_type=SourceType.ROOM_SCAN,
            source_reference="phone room scan",
            verified=False,
            uncertainty_mm=12.0,
        ),
    )
    fail = Placement(
        id=UUID("00000000-0000-0000-0000-000000000303"),
        product_id=product.id,
        center=Point2D(x=1500.0, y=500.0),
        rotation_deg=0.0,
        available_installation_width=measured(1200.0, 1.0),
    )
    return FixtureBundle(room=room, product=product, placements={"FIT": fit, "VERIFY": verify, "FAIL": fail})
