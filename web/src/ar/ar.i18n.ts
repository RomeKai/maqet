import type { Locale } from "../i18n";

/**
 * AR-viewer strings, en + es-AR with identical keys. Kept local until the
 * shared dictionary in web/src/i18n/ absorbs them.
 */
const en = {
  "viewer.alt": "Maquette of the home",
  "viewer.unavailable": "AR viewer unavailable",
  "viewer.unavailableHint": "The 3D model viewer is not loaded on this device.",
  "viewer.loading": "Building the maquette…",
  "viewer.arButton": "View in AR",
  "viewer.arNotAvailable": "AR is not available on this device. Open this page in Chrome on Android or Safari on iPhone.",
  "viewer.scale": "Scale",
  "scale.label": "Maquette scale",
  "caption.preliminary": "Preliminary: not a structural certification",
} as const;

export type ArKey = keyof typeof en;
export type ArStrings = Record<ArKey, string>;

const esAR: ArStrings = {
  "viewer.alt": "Maqueta de la vivienda",
  "viewer.unavailable": "Visor de AR no disponible",
  "viewer.unavailableHint": "El visor de modelos 3D no está cargado en este dispositivo.",
  "viewer.loading": "Armando la maqueta…",
  "viewer.arButton": "Ver en AR",
  "viewer.arNotAvailable": "La AR no está disponible en este dispositivo. Abrí esta página en Chrome en Android o en Safari en iPhone.",
  "viewer.scale": "Escala",
  "scale.label": "Escala de la maqueta",
  "caption.preliminary": "Preliminar: no es una certificación estructural",
};

const dictionaries: Record<Locale, ArStrings> = { en, "es-AR": esAR };

export function getArStrings(locale: Locale): ArStrings {
  return dictionaries[locale];
}
