import type { SceneOp } from "../scene/store";
import type { Opening } from "../scene/types";

export function wallEditOps(wallId: string, newLengthM: number, newHeightM: number, _prevLength: number, _prevHeight: number): SceneOp[] {
  const ops: SceneOp[] = [];
  if (Number.isFinite(newLengthM) && newLengthM > 0) ops.push({ type: "setWallLength", wallId, lengthM: newLengthM, provenance: "measured_tape" });
  if (Number.isFinite(newHeightM) && newHeightM > 0) ops.push({ type: "setWallHeight", wallId, heightM: newHeightM });
  return ops;
}

export function openingEditOps(prev: Opening, patch: Partial<Pick<Opening, "offset_m" | "width_m" | "height_m" | "sill_m">>): SceneOp[] {
  const next: Opening = { ...prev, ...patch };
  return [
    { type: "removeOpening", openingId: prev.id },
    { type: "markOpening", opening: next },
  ];
}
