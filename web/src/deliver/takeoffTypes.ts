/**
 * Staged construction takeoff (ADR-021, ADR-024). Mirrors the planned server
 * pydantic model in server/export/takeoff.py; swap for generated types once the
 * route lands. There is deliberately no price field: Maqet never ships prices.
 */

/** Construction stages in purchase order. */
export const TAKEOFF_STAGES = ["foundations", "walls", "bond_beams_roof", "openings", "finishes"] as const;
export type TakeoffStage = (typeof TAKEOFF_STAGES)[number];

/** Conditions that need a licensed professional (ADR-023). */
export const PROFESSIONAL_FLAG_CODES = [
  "second_floor",
  "load_bearing_wall_removed",
  "span_over_limit",
  "unknown_soil",
] as const;
export type ProfessionalFlagCode = (typeof PROFESSIONAL_FLAG_CODES)[number];

export interface TakeoffLine {
  /** Catalog material id (assets/catalog.json). */
  material_id: string;
  name: string;
  /** Net quantity as computed from the Scene geometry and the catalog recipe. */
  quantity: number;
  /** Catalog unit: piece, m3, m2, bag, bar, unit... Unknown units render as-is. */
  unit: string;
  /** Catalog waste multiplier (1.05 = 5%). Informational: `quantity` is not pre-multiplied. */
  waste_factor: number;
  /** Where the recipe value comes from, as written in the catalog. */
  recipe_source: string;
  /** True when the recipe is a provisional estimate rather than a verified yield. */
  estimated: boolean;
}

export interface ProfessionalFlag {
  code: ProfessionalFlagCode;
}

export interface Takeoff {
  /** Every takeoff is preliminary; the literal keeps that from being dropped by accident. */
  preliminary: true;
  flags: ProfessionalFlag[];
  stages: Partial<Record<TakeoffStage, TakeoffLine[]>>;
}
