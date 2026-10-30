import type { CaptureMode, StepKey } from "./captureSession";

export type MeasureLocale = "en" | "es-AR";

const EN: Record<string, string> = {
  "step.floor": "Move the phone slowly to find the floor",
  "step.base": "Tap the base of the wall",
  "step.end": "Tap the other end",
  "step.ceiling": "Tap where the wall meets the ceiling",
  "step.finished": "Room captured",
  "step.base.nth": "Wall {n}: tap the next corner",
  "step.ceiling.nth": "Wall {n}: tap the ceiling",
  "pill.floorFirst": "Point at the floor first",
  "pill.badTap": "Try again",
  "pill.modeLocked": "Finish the walls first",
  "pill.checkHeight": "Check this height",
  "selector.walls": "Walls",
  "selector.door": "Door",
  "selector.window": "Window",
  "action.undo": "Undo",
  "action.startOver": "Start over",
  "action.done": "Done",
  "confirm.startOver.title": "Start over?",
  "confirm.startOver.body": "This clears all mapped walls.",
  "confirm.startOver.confirm": "Start over",
  "confirm.startOver.cancel": "Cancel",
  "review.title": "Review measurements",
  "review.flagged": "Check this",
  "review.apply": "Apply",
  "mode.done.title": "Ready to apply",
  "mode.done.body": "Tap Done to add the walls to the plan.",
  "ceiling.typeLabel": "Type height",
  "ceiling.typePlaceholder": "Height in m",
  "ceiling.useDefault": "Use 2.60 m",
  "ceiling.confirm": "Confirm height",
};

const ES_AR: Record<string, string> = {
  "step.floor": "Mové el teléfono despacio para encontrar el piso",
  "step.base": "Tocá la base de la pared",
  "step.end": "Tocá el otro extremo",
  "step.ceiling": "Tocá donde la pared toca el techo",
  "step.finished": "Cuarto capturado",
  "step.base.nth": "Pared {n}: tocá la próxima esquina",
  "step.ceiling.nth": "Pared {n}: tocá el techo",
  "pill.floorFirst": "Apuntá primero al piso",
  "pill.badTap": "Probá de nuevo",
  "pill.modeLocked": "Terminá las paredes primero",
  "pill.checkHeight": "Revisá esta altura",
  "selector.walls": "Paredes",
  "selector.door": "Puerta",
  "selector.window": "Ventana",
  "action.undo": "Deshacer",
  "action.startOver": "Empezar de cero",
  "action.done": "Listo",
  "confirm.startOver.title": "¿Empezar de cero?",
  "confirm.startOver.body": "Esto borra todas las paredes mapeadas.",
  "confirm.startOver.confirm": "Empezar de cero",
  "confirm.startOver.cancel": "Cancelar",
  "review.title": "Revisar medidas",
  "review.flagged": "Revisar este valor",
  "review.apply": "Aplicar",
  "mode.done.title": "Listo para aplicar",
  "mode.done.body": "Tocá Listo para agregar las paredes al plano.",
  "ceiling.typeLabel": "Escribí la altura",
  "ceiling.typePlaceholder": "Altura en m",
  "ceiling.useDefault": "Usar 2,60 m",
  "ceiling.confirm": "Confirmar altura",
};

const DICTS: Record<MeasureLocale, Record<string, string>> = {
  en: EN,
  "es-AR": ES_AR,
};

export function tMeasure(
  locale: MeasureLocale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const dict = DICTS[locale] ?? EN;
  let s = dict[key] ?? EN[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(`{${k}}`, String(v));
    }
  }
  return s;
}

export function stepKeyLabel(
  locale: MeasureLocale,
  step: StepKey,
  wallIndex?: number,
): string {
  if (step === "base" && wallIndex !== undefined && wallIndex > 1) {
    return tMeasure(locale, "step.base.nth", { n: wallIndex });
  }
  if (step === "ceiling" && wallIndex !== undefined && wallIndex > 1) {
    return tMeasure(locale, "step.ceiling.nth", { n: wallIndex });
  }
  return tMeasure(locale, `step.${step}`);
}

export function modeLabel(locale: MeasureLocale, mode: CaptureMode): string {
  if (mode === "walls") return tMeasure(locale, "selector.walls");
  if (mode === "door") return tMeasure(locale, "selector.door");
  return tMeasure(locale, "selector.window");
}
