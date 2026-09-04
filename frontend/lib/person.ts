import type { PersonMockup, Room } from "@/lib/types";

export function bodyDimensions(heightMm: number) {
  return {
    shoulder_width_mm: Math.max(201, Math.round(heightMm * 0.263)),
    body_depth_mm: Math.max(101, Math.round(heightMm * 0.16)),
  };
}

export function normalizePerson(person: PersonMockup | null | undefined) {
  if (!person) return person;
  const dimensions = bodyDimensions(person.height_mm);
  if (person.shoulder_width_mm === dimensions.shoulder_width_mm && person.body_depth_mm === dimensions.body_depth_mm) return person;
  return { ...person, ...dimensions };
}

export function normalizeRoomPerson(room: Room): Room {
  const person = normalizePerson(room.person_mockup);
  return person === room.person_mockup ? room : { ...room, person_mockup: person };
}
