"""Coarse, nominal CFD bodies; fractions of the catalogue's mm envelope.

These independent obstruction recipes do not change measured fit geometry.
Footprints use x=width/y=back-to-front; z is height above the asset origin.
"""

import math
from dataclasses import dataclass
from itertools import product

Point = tuple[float, float]
Box = tuple[float, float, float, float, float, float]


@dataclass(frozen=True)
class Prism:
    footprint: tuple[Point, ...]
    bottom: float
    top: float


@dataclass(frozen=True)
class Profile:
    label: str
    boxes: tuple[Box, ...] = ()
    prisms: tuple[Prism, ...] = ()
    notes: tuple[str, ...] = ()

    def solids(self) -> tuple[Prism, ...]:
        return (*self.prisms, *(Prism(((x, y), (u, y), (u, v), (x, v)), z, w) for x, y, z, u, v, w in self.boxes))


def legs(top: float) -> tuple[Box, ...]:
    return tuple((x, y, 0, round(x + 0.12, 10), round(y + 0.12, 10), top) for x, y in product((0.08, 0.8), repeat=2))


def sofa_legs(left: bool) -> tuple[Box, ...]:
    # Keep all four feet beneath the L, not floating in the missing front corner.
    return tuple(
        (x, y, 0, round(x + 0.12, 10), round(y + 0.12, 10), 0.25)
        for x, front in ((0.08, 0.8 if left else 0.4), (0.8, 0.4 if left else 0.8))
        for y in (0.08, front)
    )


ELLIPSE = tuple(
    (round(0.5 + 0.5 * math.cos(i * math.pi / 6), 10), round(0.5 + 0.5 * math.sin(i * math.pi / 6), 10))
    for i in range(12)
)
QUADRANT = (
    (0.0, 0.0),
    *((round(math.cos(i * math.pi / 12), 10), round(math.sin(i * math.pi / 12), 10)) for i in range(7)),
)
# The inset corner bath clips one corner of a square deck. It is not the
# quarter-circle footprint used by a quadrant shower (render rotation included).
BATH_CORNER = (
    (0.0, 1.0),
    (1.0, 1.0),
    (1.0, 0.6),
    *((1 - 0.6 * (i / 4) ** 2, 0.6 * (1 - i / 4) ** 2) for i in range(1, 5)),
    (0.0, 0.0),
)
PANEL_NOTE = (
    "Panels are deliberately thickened to 4% of the footprint; confirm actual glass, door state and room walls."
)
SEALED_NOTE = (
    "Small cavities, feet and decorative curves are sealed/omitted; this is not a heat-transfer surface model."
)
OPEN_BACK_NOTE = (
    "Fine chair spindles/slats are omitted; the large back opening is retained, not replaced by a solid panel."
)
SOFA_NOTE = (
    "The broad under-seat passage and chaise outline are retained; cushion seams and small fittings are omitted."
)

PROFILES: dict[str, Profile] = {
    "balustrade-open": Profile(
        "Open balustrade — posts and handrail",
        ((0, 0, 0, 0.08, 1, 1), (0.92, 0, 0, 1, 1, 1), (0, 0, 0.95, 1, 1, 1)),
        notes=("Fine spindles are omitted rather than replaced by a solid screen. The main open flow path remains.",
               "Omitted spindle drag is not modelled. Use a calibrated porous screen or finer resolved geometry "
               "when pressure loss across guarding matters. Nominal single section, not an assembled opening guard."),
    ),
    "balustrade-rails": Profile(
        "Horizontal balustrade — coarse rails and posts",
        ((0, 0, 0, 0.08, 1, 1), (0.92, 0, 0, 1, 1, 1), (0, 0, 0.95, 1, 1, 1),
         (0.08, 0.25, 0.48, 0.92, 0.75, 0.52)),
        notes=("Three fine intermediate rails are reduced to one coarse middle rail; main openings remain.",
               "This changes local drag. Resolve actual rails or calibrate a porous model for pressure-loss studies. "
               "Nominal single section, not an assembled opening guard."),
    ),
    "balustrade-glass": Profile(
        "Glass balustrade — panel, posts and handrail",
        ((0, 0, 0, 0.08, 1, 1), (0.92, 0, 0, 1, 1, 1), (0, 0, 0.95, 1, 1, 1),
         (0.08, 0.4, 0.11, 0.92, 0.6, 0.95)),
        notes=("Glass is a closed panel, not porous; the broad under-panel passage remains open.",
               "Panel thickness is coarsened to 20% of the section depth (20 mm for the nominal section). "
               "Confirm actual glass, gaps and refinements. Nominal single section, not an assembled opening guard."),
    ),
    "balustrade-solid": Profile(
        "Closed balustrade — continuous obstruction",
        ((0, 0, 0, 1, 1, 1),),
        notes=("Parapet finishes and cappings are omitted; the full solid envelope is sealed, not porous.",
               "Nominal section depth includes posts. Confirm actual panel thickness and end gaps in the solver. "
               "Nominal single section, not an assembled opening guard."),
    ),
    "people-standing": Profile(
        "Standing occupant — coarse joined body",
        (
            (0.18, 0.25, 0, 0.42, 1, 0.06),
            (0.58, 0.25, 0, 0.82, 1, 0.06),
            (0.20, 0.20, 0.06, 0.42, 0.65, 0.5),
            (0.58, 0.20, 0.06, 0.80, 0.65, 0.5),
            (0, 0.18, 0.5, 1, 0.72, 0.83),
            (0.30, 0.12, 0.83, 0.70, 0.82, 1),
        ),
        notes=(
            "Arms are merged into the coarse torso; the main leg gap remains open. No face or clothing details.",
            "Occupant obstruction only: heat flux, respiration and metabolic loads "
            "must be defined separately in the solver.",
        ),
    ),
    "people-seated": Profile(
        "Seated occupant — coarse joined body",
        (
            (0.18, 0.67, 0, 0.40, 1, 0.06),
            (0.60, 0.67, 0, 0.82, 1, 0.06),
            (0.20, 0.67, 0.06, 0.40, 0.85, 0.36),
            (0.60, 0.67, 0.06, 0.80, 0.85, 0.36),
            (0.19, 0.20, 0.32, 0.81, 0.86, 0.42),
            (0, 0.08, 0.42, 1, 0.296, 0.83),
            (0.31, 0.04, 0.83, 0.69, 0.32, 1),
        ),
        notes=(
            "Nominal seat contact is at 32% of posed height. Furniture is not part of this exported occupant surface.",
            "Arms are merged into the torso/lap. Check actual stature, seat datum and origin "
            "when assembling a CFD case. No thermal/metabolic loads are assigned.",
        ),
    ),
    "people-lying": Profile(
        "Supine occupant — coarse joined body",
        (
            (0.30, 0.01, 0.05, 0.70, 0.15, 0.80),
            (0.20, 0.15, 0, 0.80, 0.62, 0.80),
            (0, 0.22, 0.25, 1, 0.52, 0.55),
            (0.20, 0.60, 0, 0.42, 1, 0.42),
            (0.58, 0.60, 0, 0.80, 1, 0.42),
            (0.20, 0.93, 0.42, 0.42, 1, 1),
            (0.58, 0.93, 0.42, 0.80, 1, 1),
        ),
        notes=(
            "Supine body with joined limbs; mattress/bedding and small anatomical details are omitted.",
            "Local z=0 is the support surface, not the room floor. "
            "No thermal/metabolic boundary condition is assigned.",
        ),
    ),
    "block": Profile(
        "Conservative solid envelope",
        ((0, 0, 0, 1, 1, 1),),
        notes=(
            "Open shelves and appliance internals are sealed; model them separately if internal recirculation matters.",
        ),
    ),
    "table": Profile("Table with four coarse supports", (*legs(0.88), (0, 0, 0.88, 1, 1, 1))),
    "stool": Profile("Stool with four coarse supports", (*legs(0.88), (0, 0, 0.88, 1, 1, 1))),
    "chair": Profile(
        "Solid-back chair with lower back opening",
        (
            *legs(0.44),
            (0, 0, 0.44, 1, 1, 0.54),
            (0.15, 0.14, 0.54, 0.27, 0.26, 0.66),
            (0.73, 0.14, 0.54, 0.85, 0.26, 0.66),
            (0, 0, 0.66, 1, 0.26, 1),
        ),
        notes=("The broad slot below the solid back is retained; fine stretchers and back curvature are omitted.",),
    ),
    "chair-open": Profile(
        "Open-back timber chair",
        (
            *legs(0.44),
            (0, 0, 0.44, 1, 1, 0.54),
            (0.08, 0.02, 0.54, 0.2, 0.14, 1),
            (0.8, 0.02, 0.54, 0.92, 0.14, 1),
            (0.2, 0.02, 0.88, 0.8, 0.14, 1),
        ),
        notes=(OPEN_BACK_NOTE,),
    ),
    "sofa": Profile(
        "Sealed upholstered sofa",
        (
            *legs(0.25),
            (0, 0, 0.25, 1, 1, 0.56),
            (0, 0, 0.56, 1, 0.14, 1),
            (0, 0.14, 0.56, 0.12, 1, 0.75),
            (0.88, 0.14, 0.56, 1, 1, 0.75),
        ),
        notes=(SOFA_NOTE,),
    ),
    "sofa-left": Profile(
        "Left-hand L-shaped sofa",
        (
            *sofa_legs(True),
            (0, 0, 0.25, 1, 0.6, 0.56),
            (0, 0.6, 0.25, 0.34, 1, 0.56),
            (0, 0, 0.56, 1, 0.12, 1),
            (0, 0.12, 0.56, 0.1, 1, 0.75),
            (0.9, 0.12, 0.56, 1, 0.6, 0.75),
        ),
        notes=(SOFA_NOTE,),
    ),
    "sofa-right": Profile(
        "Right-hand L-shaped sofa",
        (
            *sofa_legs(False),
            (0, 0, 0.25, 1, 0.6, 0.56),
            (0.66, 0.6, 0.25, 1, 1, 0.56),
            (0, 0, 0.56, 1, 0.12, 1),
            (0, 0.12, 0.56, 0.1, 0.6, 0.75),
            (0.9, 0.12, 0.56, 1, 1, 0.75),
        ),
        notes=(SOFA_NOTE,),
    ),
    "armchair": Profile(
        "Armchair with under-seat airflow",
        (
            *legs(0.25),
            (0, 0, 0.25, 1, 1, 0.54),
            (0, 0, 0.54, 1, 0.16, 1),
            (0, 0.16, 0.54, 0.16, 1, 0.75),
            (0.84, 0.16, 0.54, 1, 1, 0.75),
        ),
        notes=("Fine arm supports, seams and curved backs are coarsened; the broad under-seat passage remains open.",),
    ),
    "bed": Profile(
        "Bed with full-height headboard",
        (*legs(0.08), (0, 0.08, 0.08, 1, 1, 0.66), (0, 0, 0, 1, 0.08, 1)),
        notes=(
            "The rear headboard reaches the base. The broad under-bed passage is retained; "
            "resolve or deliberately close it in the mesher.",
        ),
    ),
    "basin": Profile(
        "Wall/vessel basin with clear space below",
        ((0, 0, 0.70, 1, 1, 0.93),),
        notes=(
            "Bowl cavities and taps are omitted. Nominal vertical position follows the catalogue's "
            "floor-referenced fixture; verify mounting height.",
        ),
    ),
    "basin-corner": Profile("Corner basin with clear space below", prisms=(Prism(QUADRANT, 0.70, 0.93),)),
    "pedestal-basin": Profile(
        "Sealed basin with broad pedestal", ((0.3, 0.3, 0, 0.7, 0.7, 0.75), (0, 0, 0.75, 1, 1, 0.93))
    ),
    "toilet": Profile(
        "Sealed WC and cistern",
        ((0.16, 0, 0, 0.84, 0.35, 1), (0.16, 0.35, 0, 0.84, 0.85, 0.45), (0, 0.25, 0.45, 1, 1, 0.64)),
    ),
    "toilet-low": Profile("Floor-standing sealed WC", ((0.16, 0, 0, 0.84, 0.85, 0.5), (0, 0, 0.5, 1, 1, 1))),
    "toilet-wall": Profile(
        "Wall-hung WC with no invented pedestal",
        ((0, 0, 0.25, 1, 1, 1),),
        notes=(
            "The underside remains open. Local origin and actual mounting elevation must be checked "
            "before assembling a room case.",
        ),
    ),
    "bath": Profile("Sealed inset bath", ((0, 0, 0, 1, 1, 0.93),), notes=(SEALED_NOTE,)),
    "bath-oval": Profile(
        "Twelve-sided sealed freestanding bath", prisms=(Prism(ELLIPSE, 0, 0.93),), notes=(SEALED_NOTE,)
    ),
    "bath-raised": Profile(
        "Raised slipper bath with under-bath airflow",
        boxes=tuple((x, y, 0, x + 0.12, y + 0.12, 0.18) for x, y in product((0.22, 0.66), repeat=2)),
        prisms=(Prism(ELLIPSE, 0.18, 0.93),),
        notes=(
            "The under-bath passage is retained on four coarse feet. "
            "Bowl cavity, taps and slipper-end curvature are sealed/omitted.",
        ),
    ),
    "bath-corner": Profile(
        "Faceted clipped-corner inset bath", prisms=(Prism(BATH_CORNER, 0, 0.93),), notes=(SEALED_NOTE,)
    ),
    "shower-alcove": Profile(
        "Alcove tray and front screen",
        ((0, 0, 0, 1, 1, 0.04), (0, 0.96, 0.04, 1, 1, 1)),
        notes=(
            PANEL_NOTE,
            "No extra side/back walls are invented. The represented front screen is closed; "
            "use room geometry for the surrounding walls.",
        ),
    ),
    "shower-corner": Profile(
        "Corner tray, side panels and front screen",
        ((0, 0, 0, 1, 1, 0.04), (0, 0, 0.04, 0.04, 0.96, 1), (0.96, 0, 0.04, 1, 0.96, 1), (0, 0.96, 0.04, 1, 1, 1)),
        notes=(PANEL_NOTE, "Back is open to the host room wall; the front screen is closed."),
    ),
    "shower-screen": Profile(
        "Walk-in tray with retained entrance",
        ((0, 0, 0, 1, 1, 0.04), (0, 0, 0.04, 0.04, 1, 1), (0.04, 0.96, 0.04, 0.68, 1, 1)),
        notes=(PANEL_NOTE, "Front entrance on the right is retained; no rear wall is invented."),
    ),
    "shower-wet-room": Profile(
        "Wet-room tray and partial front screen",
        ((0, 0, 0, 1, 1, 0.04), (0.17, 0.96, 0.04, 0.83, 1, 1)),
        notes=(PANEL_NOTE, "Both side passages around the front screen remain open."),
    ),
    "shower-enclosed": Profile(
        "Freestanding enclosed shower shell",
        (
            (0, 0, 0, 1, 1, 0.04),
            (0, 0, 0.04, 1, 0.04, 1),
            (0, 0.04, 0.04, 0.04, 0.96, 1),
            (0.96, 0.04, 0.04, 1, 0.96, 1),
            (0, 0.96, 0.04, 1, 1, 1),
        ),
        notes=(PANEL_NOTE, "All four screens are closed; the top remains open. No fictitious side door is cut."),
    ),
    "shower-quadrant": Profile(
        "Six-facet continuous quadrant screen",
        prisms=(
            Prism(QUADRANT, 0, 0.04),
            *(
                Prism(
                    (
                        (math.cos(i * math.pi / 12), math.sin(i * math.pi / 12)),
                        (math.cos((i + 1) * math.pi / 12), math.sin((i + 1) * math.pi / 12)),
                        (0.96 * math.cos((i + 1) * math.pi / 12), 0.96 * math.sin((i + 1) * math.pi / 12)),
                        (0.96 * math.cos(i * math.pi / 12), 0.96 * math.sin(i * math.pi / 12)),
                    ),
                    0.04,
                    1,
                )
                for i in range(6)
            ),
        ),
        notes=(
            PANEL_NOTE,
            "The curved front is represented by six facets, not an L-shaped opening. "
            "Rear straight edges meet the host room walls.",
        ),
    ),
}
