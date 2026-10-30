import type { Wall } from "../scene/types";
import { isWallEstimated } from "../scene/store";

/** Smallest rendered font (screen px) for a wall length label, at any zoom. */
export const MIN_PILL_PX = 14;
const CHAR_EM = 0.62;
const PAD_X_PX = 8;
const PAD_Y_PX = 5;

export type ProvenanceKind = "written" | "measured" | "estimated";

export function provenanceKind(wall: Wall): ProvenanceKind {
  if (isWallEstimated(wall)) return "estimated";
  return wall.provenance === "written_on_sketch" ? "written" : "measured";
}

export interface PillMetrics {
  fontUnits: number;
  widthUnits: number;
  heightUnits: number;
  padXUnits: number;
}

/**
 * Pill size in SVG viewBox units. `unitsPerPx` is viewBox units per screen
 * pixel, so the label keeps MIN_PILL_PX on screen however far the photo is
 * scaled to fit.
 */
export function pillMetrics(label: string, unitsPerPx: number): PillMetrics {
  const k = unitsPerPx > 0 ? unitsPerPx : 1;
  const fontUnits = MIN_PILL_PX * k;
  const padXUnits = PAD_X_PX * k;
  return {
    fontUnits,
    padXUnits,
    widthUnits: label.length * fontUnits * CHAR_EM + padXUnits * 2,
    heightUnits: fontUnits + PAD_Y_PX * 2 * k,
  };
}
