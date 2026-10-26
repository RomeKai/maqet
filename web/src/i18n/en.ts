import type { esAR } from "./es-AR";

/**
 * English dictionary. Same keys as es-AR (enforced by type).
 */
export const en: Record<keyof typeof esAR, string> = {
  "app.name": "Maqet",
  "nav.back": "Back",
  "project.defaultName": "My home",
  "action.ar": "AR",
  "locale.es": "Español",
  "locale.en": "English",
  "stage.capture": "Capture",
  "stage.reform": "Reform",
  "stage.design": "Design",
  "stage.present": "Present",
  "stage.deliver": "Deliver",
  "stage.skip": "Skip",
  "badge.measured": "Measured · 1:1",
  "badge.notToScale": "Not to scale",
  "notice.preliminary": "Preliminary: not a structural certification",
  "sheet.receipt": "Upload a plan photo to start.",
  "sheet.placeholder": "Ask or describe the change…",
  "sheet.mic": "Hold to talk",
  "sheet.hint": "Tap a wall, then describe the change.",
};
