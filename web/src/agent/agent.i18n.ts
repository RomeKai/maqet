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
  "chat.details": "Details",
  "chat.errorFallback": "That did not work. Try a smaller change or another wall?",
  "chat.sending": "Working on it…",
  "chat.retry": "Try again",
  "chat.error.server": "The assistant could not finish that, and your home was not changed. Try again?",
  "chat.error.timeout": "The assistant is taking too long, and your home was not changed. Try again?",
  "chat.error.offline": "No connection right now. Your message is kept: try again when you are back online.",
  "chip.applied": "Applied",
  "chip.violation": "Rule",
  "chip.warning": "Warning",
  "chip.rejected": "Rejected",
  "flag.needs_professional:second_floor": "Needs a licensed professional: second floor",
  "flag.needs_professional:load_bearing_wall": "Needs a licensed professional: load-bearing wall",
  "flag.needs_professional:span_over_limit": "Needs a licensed professional: span over the limit",
  "flag.needs_professional:unknown_soil": "Needs a licensed professional: foundations on unknown soil",
  "flag.generic": "Needs a licensed professional",
  "tool.add_room": "Add room",
  "tool.add_wall": "Add wall",
  "tool.remove_wall": "Remove wall",
  "tool.add_opening": "Add door or window",
  "tool.move_opening": "Move opening",
  "tool.resize_room": "Resize room",
  "tool.set_wall_length": "Set wall length",
  "tool.move_wall": "Move wall",
  "tool.set_opening_size": "Set opening size",
  "tool.split_room": "Split room",
  "tool.rename_room": "Rename room",
  "tool.undo": "Undo",
  "tool.set_surface_material": "Set finish",
  "tool.list_catalog": "Look up catalog",
  "tool.place_furniture": "Place furniture",
  "tool.furnish_room": "Furnish room",
  "tool.move_item": "Move item",
  "tool.rotate_item": "Rotate item",
  "tool.remove_item": "Remove item",
  "tool.create_variant": "Create variant",
  "tool.render_view": "Render view",
  "ptt.hold": "Hold to talk",
  "ptt.recording": "Listening… release to send",
  "ptt.denied": "Microphone permission denied. Allow it in the browser settings.",
  "ptt.unsupported": "Voice is not supported on this device. Type instead.",
  "ptt.error": "Could not use the microphone. Try again or type.",
  "bar.hint": "Hold to talk, or tap once",
  "bar.hintRecording": "Release or tap to send",
  "bar.next": "Next",
  "bar.keyboard": "Type a message",
  "suggest.label": "Quick requests",
  "suggest.reform.bedroom": "Add a 3x4 bedroom",
  "suggest.reform.window": "Add a window to the new room",
  "suggest.reform.door": "Make the door 1 m wide",
  "suggest.reform.split": "Split the big room in two",
  "suggest.design.furnishBedroom": "Furnish a bedroom for two",
  "suggest.design.study": "Make this a study",
  "suggest.design.livingDining": "Living and dining for 4",
  "suggest.design.bed": "Put a bed in the bedroom",
  "suggest.design.fits": "What furniture fits here?",
  "suggest.design.remove": "Remove the last item",
  "suggest.design.brighter": "Make the bedroom brighter",
  "suggest.design.move": "Move the bed to wall 2",
  "suggest.design.rotate": "Turn the last item 90 degrees",
  "card.area": "Floor area",
  "card.undo": "Undo last change",
  "variants.now": "Now",
  "variants.nowCaption": "Current home, no changes",
  "variants.optionCaption": "Option {label} · {area}",
  "caption.preliminary": "Preliminary: not a structural certification",
  "variants.nowReadOnly": "Now is read-only: pick A, B or C to make changes.",
  "edit.open": "Edit measures",
  "edit.title": "Edit measures",
  "edit.wall": "Wall length (m)",
  "edit.room": "Room",
  "edit.width": "Width (m)",
  "edit.depth": "Depth (m)",
  "edit.apply": "Apply",
  "edit.cancel": "Cancel",
  "edit.invalid": "Type a number of meters greater than zero.",
  "edit.preliminary": "Preliminary measures: not a structural certification",
} as const;

export type AgentKey = keyof typeof en;
export type AgentStrings = Record<AgentKey, string>;

const esAR: AgentStrings = {
  "chat.title": "Diseñá con el asistente",
  "chat.empty": "Contale al asistente qué querés cambiar en la casa.",
  "chat.input": "Mensaje para el asistente",
  "chat.placeholder": "ej. agregá un dormitorio al lado de la cocina",
  "chat.send": "Enviar",
  "chat.details": "Detalles",
  "chat.errorFallback": "Eso no funcionó. ¿Probamos un cambio más chico u otro muro?",
  "chat.sending": "Trabajando en eso…",
  "chat.retry": "Reintentar",
  "chat.error.server": "El asistente no pudo terminar eso y tu casa no se modificó. ¿Probamos de nuevo?",
  "chat.error.timeout": "El asistente está tardando demasiado y tu casa no se modificó. ¿Probamos de nuevo?",
  "chat.error.offline": "No hay conexión ahora. Tu mensaje quedó guardado: probá de nuevo cuando vuelva la señal.",
  "chip.applied": "Aplicado",
  "chip.violation": "Regla",
  "chip.warning": "Aviso",
  "chip.rejected": "Rechazado",
  "flag.needs_professional:second_floor": "Requiere un profesional matriculado: planta alta",
  "flag.needs_professional:load_bearing_wall": "Requiere un profesional matriculado: muro portante",
  "flag.needs_professional:span_over_limit": "Requiere un profesional matriculado: luz mayor al límite",
  "flag.needs_professional:unknown_soil": "Requiere un profesional matriculado: fundaciones en suelo desconocido",
  "flag.generic": "Requiere un profesional matriculado",
  "tool.add_room": "Agregar ambiente",
  "tool.add_wall": "Agregar muro",
  "tool.remove_wall": "Quitar muro",
  "tool.add_opening": "Agregar puerta o ventana",
  "tool.move_opening": "Mover abertura",
  "tool.resize_room": "Cambiar tamaño del ambiente",
  "tool.set_wall_length": "Fijar largo del muro",
  "tool.move_wall": "Mover muro",
  "tool.set_opening_size": "Cambiar tamaño de abertura",
  "tool.split_room": "Dividir ambiente",
  "tool.rename_room": "Renombrar ambiente",
  "tool.undo": "Deshacer",
  "tool.set_surface_material": "Elegir acabado",
  "tool.list_catalog": "Consultar catálogo",
  "tool.place_furniture": "Colocar mueble",
  "tool.furnish_room": "Amoblar ambiente",
  "tool.move_item": "Mover objeto",
  "tool.rotate_item": "Girar objeto",
  "tool.remove_item": "Quitar objeto",
  "tool.create_variant": "Crear variante",
  "tool.render_view": "Generar vista",
  "ptt.hold": "Mantené para hablar",
  "ptt.recording": "Escuchando… soltá para enviar",
  "ptt.denied": "Permiso de micrófono denegado. Habilitalo en los ajustes del navegador.",
  "ptt.unsupported": "La voz no está disponible en este dispositivo. Escribí en su lugar.",
  "ptt.error": "No se pudo usar el micrófono. Probá de nuevo o escribí.",
  "bar.hint": "Mantené para hablar, o tocá una vez",
  "bar.hintRecording": "Soltá o tocá para enviar",
  "bar.next": "Siguiente",
  "bar.keyboard": "Escribir un mensaje",
  "suggest.label": "Pedidos rápidos",
  "suggest.reform.bedroom": "Agregá un dormitorio de 3x4",
  "suggest.reform.window": "Agregá una ventana al ambiente nuevo",
  "suggest.reform.door": "Hacé la puerta de 1 m de ancho",
  "suggest.reform.split": "Dividí el ambiente grande en dos",
  "suggest.design.furnishBedroom": "Amoblá un dormitorio para dos",
  "suggest.design.study": "Convertí esto en un escritorio de estudio",
  "suggest.design.livingDining": "Living y comedor para 4",
  "suggest.design.bed": "Poné una cama en el dormitorio",
  "suggest.design.fits": "¿Qué muebles entran acá?",
  "suggest.design.remove": "Sacá el último mueble",
  "suggest.design.brighter": "Hacé el dormitorio más luminoso",
  "suggest.design.move": "Mové la cama al muro 2",
  "suggest.design.rotate": "Girá 90 grados el último mueble",
  "card.area": "Superficie",
  "card.undo": "Deshacer el último cambio",
  "variants.now": "Hoy",
  "variants.nowCaption": "Casa actual, sin cambios",
  "variants.optionCaption": "Opción {label} · {area}",
  "caption.preliminary": "Preliminar: no es una certificación estructural",
  "variants.nowReadOnly": "Hoy es solo lectura: elegí A, B o C para hacer cambios.",
  "edit.open": "Editar medidas",
  "edit.title": "Editar medidas",
  "edit.wall": "Largo del muro (m)",
  "edit.room": "Ambiente",
  "edit.width": "Ancho (m)",
  "edit.depth": "Fondo (m)",
  "edit.apply": "Aplicar",
  "edit.cancel": "Cancelar",
  "edit.invalid": "Escribí un número de metros mayor que cero.",
  "edit.preliminary": "Medidas preliminares: no es una certificación estructural",
};

const dictionaries: Record<Locale, AgentStrings> = { en, "es-AR": esAR };

export function getAgentStrings(locale: Locale): AgentStrings {
  return dictionaries[locale];
}

/** Localized label for a professional-required flag; unknown codes get the generic label. */
/** Server flags may carry a trailing detail ("code:wall_id"); the stable code is the first two segments. */
export function professionalFlagCode(flag: string): string {
  const [prefix, name] = flag.split(":");
  return name === undefined ? flag : `${prefix}:${name}`;
}

/** Stable codes only, each once, in first-seen order. */
export function normalizeProfessionalFlags(flags: readonly string[]): string[] {
  return [...new Set(flags.map(professionalFlagCode))];
}

/** Localized tool name; unknown tools keep the raw name. */
export function toolLabel(locale: Locale, name: string): string {
  const t = dictionaries[locale];
  const key = `tool.${name}`;
  return key in t ? t[key as AgentKey] : name;
}

export function professionalFlagLabel(locale: Locale, flag: string): string {
  const t = dictionaries[locale];
  const key = `flag.${professionalFlagCode(flag)}`;
  return key in t ? t[key as AgentKey] : t["flag.generic"];
}
