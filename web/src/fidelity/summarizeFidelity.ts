import type { Scene, Wall } from "../scene/types";

/** How a wall's length was obtained (ADR-025). */
export type Provenance = NonNullable<Wall["provenance"]>;

export const PROVENANCES: readonly Provenance[] = ["measured_ar", "measured_tape", "written_on_sketch", "estimated"];

export interface FidelityReport {
  /** Wall count per provenance; every provenance is present, possibly 0. */
  counts: Record<Provenance, number>;
  /** True when any furniture piece or material in the Scene is imagined (`concept`). */
  hasConcept: boolean;
  /**
   * "measured" only when there is at least one wall and none of them is estimated. It speaks for walls
   * only: openings carry no provenance, so the UI labels it "Walls measured", never the whole Scene.
   */
  label: "measured" | "preliminary";
  /** Ids of the estimated walls, in Scene order. */
  estimatedWallIds: string[];
}

/** A wall with no recorded provenance cannot be claimed as measured, so it counts as estimated. */
export function wallProvenance(wall: Wall): Provenance {
  return wall.provenance ?? "estimated";
}

/**
 * Fidelity of a Scene for the badges: wall provenance counts, concept presence and the overall label.
 * Measurements written on a sketch count as measured; only `estimated` walls make the Scene preliminary.
 */
export function summarizeFidelity(scene: Scene): FidelityReport {
  const walls = scene.walls ?? [];
  const provenances = walls.map(wallProvenance);

  const counts = Object.fromEntries(
    PROVENANCES.map((p) => [p, provenances.filter((wp) => wp === p).length]),
  ) as Record<Provenance, number>;

  const estimatedWallIds = walls.filter((w) => wallProvenance(w) === "estimated").map((w) => w.id);
  const hasConcept =
    (scene.furniture ?? []).some((f) => f.concept === true) || (scene.materials ?? []).some((m) => m.concept === true);

  return {
    counts,
    hasConcept,
    label: walls.length > 0 && estimatedWallIds.length === 0 ? "measured" : "preliminary",
    estimatedWallIds,
  };
}
