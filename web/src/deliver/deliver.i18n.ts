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
  "flag.generic": "Another flagged condition",
  "action.exportCsv": "Export CSV",
  "footer.preliminary": "Preliminary: not a structural certification",
  "empty": "No quantities yet.",
  "stage.items": "{n} items",
  "stage.estimatedCount": "{n} guessed",
  "action.dxf": "Download DXF",
  "action.preparing": "Preparing…",
  "action.retry": "Try again",
  "dxf.error.title": "Could not prepare the file",
  "dxf.hint": "The DXF carries measured walls and openings for a professional.",
  "walls.estimated.title": "{n} walls have a guessed length",
  "walls.estimated.body": "Measure them on the Capture step to firm up the list.",
  "walls.confirmed.title": "All lengths are confirmed",
  "walls.confirmed.body": "Quantities come from written or measured walls.",
  "snapshot.alt": "Plan snapshot",
  "csv.error.title": "Could not prepare the CSV",
  "unit.piece": "pcs",
  "unit.m3": "m³",
  "unit.m2": "m²",
  "unit.m": "m",
  "unit.kg": "kg",
  "unit.bag": "bags",
  "unit.bar": "bars",
  "unit.unit": "units",
  "steps.title": "Next steps",
  "step.measure": "Measure the walls marked as guessed to firm up the list.",
  "step.professional": "Have a licensed engineer or architect check the flagged conditions on site before building.",
  "step.dxf": "Hand the DXF and the materials list to a professional to review.",
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
  "flag.generic": "Otra condición señalada",
  "action.exportCsv": "Exportar CSV",
  "footer.preliminary": "Preliminar: no es una certificación estructural",
  "empty": "Todavía no hay cantidades.",
  "stage.items": "{n} ítems",
  "stage.estimatedCount": "{n} estimados",
  "action.dxf": "Descargar DXF",
  "action.preparing": "Preparando…",
  "action.retry": "Reintentar",
  "dxf.error.title": "No se pudo preparar el archivo",
  "dxf.hint": "El DXF lleva paredes y aberturas medidas para un profesional.",
  "walls.estimated.title": "{n} paredes tienen un largo estimado",
  "walls.estimated.body": "Medilas en el paso Captura para afinar la lista.",
  "walls.confirmed.title": "Todos los largos están confirmados",
  "walls.confirmed.body": "Las cantidades salen de paredes escritas o medidas.",
  "snapshot.alt": "Vista del plano",
  "csv.error.title": "No se pudo preparar el CSV",
  "unit.piece": "u.",
  "unit.m3": "m³",
  "unit.m2": "m²",
  "unit.m": "m",
  "unit.kg": "kg",
  "unit.bag": "bolsas",
  "unit.bar": "barras",
  "unit.unit": "u.",
  "steps.title": "Próximos pasos",
  "step.measure": "Medí las paredes marcadas como estimadas para afinar la lista.",
  "step.professional": "Pedí a un ingeniero o arquitecto matriculado que revise en obra las condiciones señaladas antes de construir.",
  "step.dxf": "Llevá el DXF y la lista de materiales a un profesional para que los revise.",
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
