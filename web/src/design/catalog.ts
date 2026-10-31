import type { Locale } from "../i18n";

/** Furniture types and finishes of assets/catalog.json (parity is tested), with the flat colors the 3D view uses. */
export interface FurnitureKind {
  id: string;
  type: string;
  en: string;
  es: string;
  color: string;
}

export const FURNITURE: readonly FurnitureKind[] = [
  { id: "bed-single-90x190", type: "bed", en: "Single bed", es: "Cama de una plaza", color: "#8fa8c8" },
  { id: "table-120x75", type: "table", en: "Table", es: "Mesa", color: "#c9a27a" },
  { id: "chair-45x45", type: "chair", en: "Chair", es: "Silla", color: "#b08968" },
  { id: "stove-60x60", type: "stove", en: "Cooker", es: "Cocina", color: "#9aa0a6" },
  { id: "wardrobe-120x60", type: "wardrobe", en: "Wardrobe", es: "Placard", color: "#a1887f" },
  { id: "sofa-3seat-200x90", type: "sofa", en: "Sofa", es: "Sofá", color: "#7f9c8a" },
  { id: "desk-120x60", type: "desk", en: "Desk", es: "Escritorio", color: "#bfa27f" },
];

export interface Finish {
  id: string;
  surface: "floor" | "wall";
  en: string;
  es: string;
  color: string;
}

export const FINISHES: readonly Finish[] = [
  { id: "floor-cement-screed", surface: "floor", en: "Cement screed", es: "Cemento alisado", color: "#9a9892" },
  { id: "floor-ceramic-light", surface: "floor", en: "Light ceramic", es: "Cerámico claro", color: "#d8d2c4" },
  { id: "floor-porcelain-dark", surface: "floor", en: "Dark porcelain", es: "Porcelanato oscuro", color: "#5f5b57" },
  { id: "floor-wood-laminate", surface: "floor", en: "Wood laminate", es: "Símil madera", color: "#b58a5a" },
  { id: "wall-paint-white", surface: "wall", en: "White paint", es: "Pintura blanca", color: "#f6f3ec" },
  { id: "wall-paint-warm", surface: "wall", en: "Warm sand", es: "Arena cálida", color: "#e6d5b3" },
  { id: "wall-paint-sage", surface: "wall", en: "Sage green", es: "Verde salvia", color: "#a9b8a0" },
  { id: "wall-paint-terracotta", surface: "wall", en: "Terracotta", es: "Terracota", color: "#c47a5a" },
  { id: "wall-tile-white", surface: "wall", en: "White tile", es: "Cerámico blanco", color: "#e9ecee" },
];

const FALLBACK_FURNITURE_COLOR = "#c9b79c";

export function furnitureKind(catalogId: string | null | undefined): FurnitureKind | null {
  return FURNITURE.find((f) => f.id === catalogId) ?? null;
}

export function furnitureLabel(catalogId: string | null | undefined, locale: Locale): string {
  const k = furnitureKind(catalogId);
  return k === null ? "?" : locale === "es-AR" ? k.es : k.en;
}

export function furnitureColor(catalogId: string | null | undefined): string {
  return furnitureKind(catalogId)?.color ?? FALLBACK_FURNITURE_COLOR;
}

export function finishColor(materialId: string): string | null {
  return FINISHES.find((f) => f.id === materialId)?.color ?? null;
}

export function finishLabel(f: Finish, locale: Locale): string {
  return locale === "es-AR" ? f.es : f.en;
}
