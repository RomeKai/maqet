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
  "viewer.arFailed": "AR could not show the maquette. If an AR app opened and reported an error, try again with WebXR (it runs inside this page).",
  "viewer.retryWebXr": "Try again with WebXR",
  "viewer.hostHint": "AR apps like Scene Viewer refuse pages whose HTTPS certificate is not trusted (a self-signed dev certificate, or an IP address). WebXR does not need it.",
  "viewer.hostedPending": "Preparing the model for AR apps...",
  "viewer.hostedFailed": "The model could not be hosted for AR apps, so only WebXR is offered.",
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
  "viewer.arFailed": "La AR no pudo mostrar la maqueta. Si se abrió una app de AR y mostró un error, probá de nuevo con WebXR (corre dentro de esta página).",
  "viewer.retryWebXr": "Probar de nuevo con WebXR",
  "viewer.hostHint": "Las apps de AR como Scene Viewer rechazan páginas con un certificado HTTPS no confiable (certificado de desarrollo autofirmado, o una dirección IP). WebXR no lo necesita.",
  "viewer.hostedPending": "Preparando el modelo para las apps de AR...",
  "viewer.hostedFailed": "No se pudo alojar el modelo para las apps de AR, así que solo se ofrece WebXR.",
  "viewer.scale": "Escala",
  "scale.label": "Escala de la maqueta",
  "caption.preliminary": "Preliminar: no es una certificación estructural",
};

const dictionaries: Record<Locale, ArStrings> = { en, "es-AR": esAR };

export function getArStrings(locale: Locale): ArStrings {
  return dictionaries[locale];
}
