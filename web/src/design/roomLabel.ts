import type { Locale } from "../i18n";

const FUNCTIONS: Record<string, { en: string; es: string }> = {
  bedroom: { en: "Bedroom", es: "Dormitorio" },
  living: { en: "Living room", es: "Living" },
  kitchen: { en: "Kitchen", es: "Cocina" },
  bath: { en: "Bathroom", es: "Baño" },
  bathroom: { en: "Bathroom", es: "Baño" },
  dining: { en: "Dining room", es: "Comedor" },
  study: { en: "Study", es: "Estudio" },
};

const ID_LIKE = /^(?:room|r|habitacion|ambiente)?[\s_-]*\d+$/i;

export interface RoomLike {
  id: string;
  name: string;
  function?: string | null;
}

/** Human label for a room: its own name when it reads like one, else its function, else "Room N". Never an id. */
export function roomLabel(room: RoomLike, index: number, locale: Locale): string {
  const name = room.name.trim();
  if (name !== "" && !ID_LIKE.test(name) && name !== room.id) return name;
  const fn = FUNCTIONS[(room.function ?? "").toLowerCase()];
  if (fn !== undefined) return locale === "es-AR" ? fn.es : fn.en;
  return locale === "es-AR" ? `Ambiente ${index + 1}` : `Room ${index + 1}`;
}
