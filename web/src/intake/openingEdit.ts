import type { Opening } from "../scene/types";
import type { SceneOp } from "../scene/store";

export interface OpeningEdit {
  width: number;
  height: number;
  /** Windows only; ignored for doors. */
  sill: number | null;
}

/** Edit an opening by removing it and marking it again under the same id. */
export function editOpeningOps(opening: Opening, edit: OpeningEdit): SceneOp[] {
  const next: Opening = {
    id: opening.id,
    wall_id: opening.wall_id,
    kind: opening.kind,
    offset_m: opening.offset_m,
    width_m: edit.width,
    height_m: edit.height,
    ...(opening.kind === "window" ? { sill_m: edit.sill ?? opening.sill_m ?? 0.8 } : {}),
  };
  return [
    { type: "removeOpening", openingId: opening.id },
    { type: "markOpening", opening: next },
  ];
}
