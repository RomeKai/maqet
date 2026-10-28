import type { Locale } from "../i18n";

/**
 * Agent chat strings, en + es-AR with identical keys. Kept local until the
 * shared dictionary in web/src/i18n/ absorbs them.
 */
const en = {
  "chat.title": "Design with the assistant",
  "chat.empty": "Tell the assistant what you want to change in the home.",
  "chat.input": "Message to the assistant",
  "chat.placeholder": "e.g. add a bedroom next to the kitchen",
  "chat.send": "Send",
  "chat.sending": "Working on it…",
  "chip.applied": "Applied",
  "chip.violation": "Rule",
  "chip.warning": "Warning",
  "flag.needs_professional:second_floor": "Needs a licensed professional: second floor",
  "flag.needs_professional:load_bearing_wall": "Needs a licensed professional: load-bearing wall",
  "flag.needs_professional:span_over_limit": "Needs a licensed professional: span over the limit",
  "flag.needs_professional:unknown_soil": "Needs a licensed professional: foundations on unknown soil",
  "flag.generic": "Needs a licensed professional",
  "ptt.hold": "Hold to talk",
  "ptt.recording": "Listening… release to send",
  "ptt.denied": "Microphone permission denied. Allow it in the browser settings.",
  "ptt.unsupported": "Voice is not supported on this device. Type instead.",
  "ptt.error": "Could not use the microphone. Try again or type.",
  "caption.preliminary": "Preliminary: not a structural certification",
} as const;

export type AgentKey = keyof typeof en;
export type AgentStrings = Record<AgentKey, string>;

const esAR: AgentStrings = {
  "chat.title": "Diseñá con el asistente",
  "chat.empty": "Contale al asistente qué querés cambiar en la casa.",
  "chat.input": "Mensaje para el asistente",
  "chat.placeholder": "ej. agregá un dormitorio al lado de la cocina",
  "chat.send": "Enviar",
  "chat.sending": "Trabajando en eso…",
  "chip.applied": "Aplicado",
  "chip.violation": "Regla",
  "chip.warning": "Aviso",
  "flag.needs_professional:second_floor": "Requiere un profesional matriculado: planta alta",
  "flag.needs_professional:load_bearing_wall": "Requiere un profesional matriculado: muro portante",
  "flag.needs_professional:span_over_limit": "Requiere un profesional matriculado: luz mayor al límite",
  "flag.needs_professional:unknown_soil": "Requiere un profesional matriculado: fundaciones en suelo desconocido",
  "flag.generic": "Requiere un profesional matriculado",
  "ptt.hold": "Mantené para hablar",
  "ptt.recording": "Escuchando… soltá para enviar",
  "ptt.denied": "Permiso de micrófono denegado. Habilitalo en los ajustes del navegador.",
  "ptt.unsupported": "La voz no está disponible en este dispositivo. Escribí en su lugar.",
  "ptt.error": "No se pudo usar el micrófono. Probá de nuevo o escribí.",
  "caption.preliminary": "Preliminar: no es una certificación estructural",
};

const dictionaries: Record<Locale, AgentStrings> = { en, "es-AR": esAR };

export function getAgentStrings(locale: Locale): AgentStrings {
  return dictionaries[locale];
}

/** Localized label for a professional-required flag; unknown codes get the generic label. */
export function professionalFlagLabel(locale: Locale, flag: string): string {
  const t = dictionaries[locale];
  const key = `flag.${flag}`;
  return key in t ? t[key as AgentKey] : t["flag.generic"];
}
