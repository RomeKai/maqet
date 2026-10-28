import type { Locale } from "../i18n";

/**
 * Deliver-screen strings, en + es-AR with identical keys. Kept local until the
 * shared dictionary in web/src/i18n/ absorbs them.
 */
const en = {
  "title": "Staged takeoff",
  "subtitle": "Materials to buy, stage by stage",
  "stage.foundations": "Foundations",
  "stage.walls": "Walls",
  "stage.bond_beams_roof": "Bond beams & roof",
  "stage.openings": "Openings",
  "stage.finishes": "Finishes",
  "line.estimated": "Estimated",
  "line.source": "Recipe source",
  "line.waste": "Waste factor",
  "flags.title": "Requires a licensed professional",
  "flag.second_floor": "A second floor",
  "flag.load_bearing_wall_removed": "Removing a load-bearing wall",
  "flag.span_over_limit": "A span over the limit",
  "flag.unknown_soil": "Foundations on unknown soil",
  "action.exportCsv": "Export CSV",
  "footer.preliminary": "Preliminary: not a structural certification",
  "empty": "No quantities yet.",
  "unit.piece": "pcs",
  "unit.m3": "m³",
  "unit.m2": "m²",
  "unit.m": "m",
  "unit.kg": "kg",
  "unit.bag": "bags",
  "unit.bar": "bars",
  "unit.unit": "units",
} as const;

export type DeliverKey = keyof typeof en;
export type DeliverStrings = Record<DeliverKey, string>;

const esAR: DeliverStrings = {
  "title": "Cómputo por etapas",
  "subtitle": "Materiales para comprar, etapa por etapa",
  "stage.foundations": "Cimientos",
  "stage.walls": "Muros",
  "stage.bond_beams_roof": "Encadenados y techo",
  "stage.openings": "Aberturas",
  "stage.finishes": "Terminaciones",
  "line.estimated": "Estimado",
  "line.source": "Fuente de la receta",
  "line.waste": "Desperdicio",
  "flags.title": "Requiere profesional matriculado",
  "flag.second_floor": "Una planta alta",
  "flag.load_bearing_wall_removed": "Quitar un muro portante",
  "flag.span_over_limit": "Una luz mayor al límite",
  "flag.unknown_soil": "Cimientos sobre suelo desconocido",
  "action.exportCsv": "Exportar CSV",
  "footer.preliminary": "Preliminar: no es una certificación estructural",
  "empty": "Todavía no hay cantidades.",
  "unit.piece": "u.",
  "unit.m3": "m³",
  "unit.m2": "m²",
  "unit.m": "m",
  "unit.kg": "kg",
  "unit.bag": "bolsas",
  "unit.bar": "barras",
  "unit.unit": "u.",
};

const dictionaries: Record<Locale, DeliverStrings> = { en, "es-AR": esAR };

export function getDeliverStrings(locale: Locale): DeliverStrings {
  return dictionaries[locale];
}

/** Localised catalog unit; unknown units are shown as the catalog wrote them. */
export function unitLabel(unit: string, locale: Locale): string {
  const strings = getDeliverStrings(locale);
  const key = `unit.${unit}`;
  return key in strings ? strings[key as DeliverKey] : unit;
}
