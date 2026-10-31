import type { Locale } from "../i18n";

const en = {
  "design.title": "Design",
  "design.add": "Add",
  "design.undo": "Undo",
  "design.sheet": "Furniture and finishes",
  "design.close": "Close",
  "design.tab.furniture": "Furniture",
  "design.tab.finishes": "Finishes",
  "design.tab.items": "Placed",
  "design.room": "Room",
  "design.floor": "Floor",
  "design.walls": "Walls",
  "design.noItems": "Nothing placed yet. Add a piece from the Furniture tab.",
  "design.noRooms": "Capture a room first.",
  "design.moveLeft": "Move west",
  "design.moveRight": "Move east",
  "design.moveUp": "Move north",
  "design.moveDown": "Move south",
  "design.rotate": "Turn 90 degrees",
  "design.remove": "Remove",
  "design.prelim": "Preliminary. Placeholder boxes, real sizes.",
  "design.render": "Render this room (concept, about $0.01)",
  "design.rendering": "Rendering…",
  "design.renderLabel": "Concept image, preliminary. Not to scale.",
  "design.brighterHint": "Want it brighter? Pick a light wall finish, or add a window in Reform.",
} as const;

const esAR: Record<keyof typeof en, string> = {
  "design.title": "Diseño",
  "design.add": "Agregar",
  "design.undo": "Deshacer",
  "design.sheet": "Muebles y acabados",
  "design.close": "Cerrar",
  "design.tab.furniture": "Muebles",
  "design.tab.finishes": "Acabados",
  "design.tab.items": "Colocados",
  "design.room": "Ambiente",
  "design.floor": "Piso",
  "design.walls": "Muros",
  "design.noItems": "Todavía no hay nada. Agregá un mueble desde la pestaña Muebles.",
  "design.noRooms": "Primero capturá un ambiente.",
  "design.moveLeft": "Mover al oeste",
  "design.moveRight": "Mover al este",
  "design.moveUp": "Mover al norte",
  "design.moveDown": "Mover al sur",
  "design.rotate": "Girar 90 grados",
  "design.remove": "Quitar",
  "design.prelim": "Preliminar. Cajas de referencia, medidas reales.",
  "design.render": "Renderizar este ambiente (concepto, unos US$ 0,01)",
  "design.rendering": "Generando…",
  "design.renderLabel": "Imagen conceptual, preliminar. No está a escala.",
  "design.brighterHint": "¿Más luz? Elegí un acabado de muro claro, o sumá una ventana en Reforma.",
};

export type DesignKey = keyof typeof en;

export function getDesignStrings(locale: Locale): Record<DesignKey, string> {
  return locale === "es-AR" ? esAR : en;
}
