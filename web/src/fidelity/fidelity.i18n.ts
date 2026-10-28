import type { Locale } from "../i18n";

/**
 * Fidelity-badge strings, en + es-AR with identical keys. Kept local until the
 * shared dictionary in web/src/i18n/ absorbs them.
 */
const en = {
  "summary.title": "Fidelity",
  "summary.estimatedWalls": "Estimated walls: confirm them with a tape measure",
  "label.measured": "Walls measured",
  "label.preliminary": "Preliminary",
  "chip.concept": "Concept",
  "provenance.measured_ar": "AR measured",
  "provenance.measured_tape": "Tape measured",
  "provenance.written_on_sketch": "Written on sketch",
  "provenance.estimated": "Estimated",
} as const;

export type FidelityKey = keyof typeof en;
export type FidelityStrings = Record<FidelityKey, string>;

const esAR: FidelityStrings = {
  "summary.title": "Fidelidad",
  "summary.estimatedWalls": "Muros estimados: conviene confirmarlos con cinta métrica",
  "label.measured": "Muros medidos",
  "label.preliminary": "Preliminar",
  "chip.concept": "Concepto",
  "provenance.measured_ar": "Medido con AR",
  "provenance.measured_tape": "Medido con cinta",
  "provenance.written_on_sketch": "Anotado en el croquis",
  "provenance.estimated": "Estimado",
};

const dictionaries: Record<Locale, FidelityStrings> = { en, "es-AR": esAR };

export function getFidelityStrings(locale: Locale): FidelityStrings {
  return dictionaries[locale];
}
