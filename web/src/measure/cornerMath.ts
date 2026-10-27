import type { Wall } from "../scene/types";

/** A corner tapped in AR space: [x, y, z] in meters. */
export type Vec3 = [number, number, number];

/** Result of pairing two AR corners into a wall measurement update. */
export interface CornerWallUpdate {
  lengthM: number;
  provenance: NonNullable<Wall["provenance"]>;
}

function isValidCoord(v: number): boolean {
  return Number.isFinite(v);
}

/** True when every component is a finite number. */
export function isValidCorner(c: Vec3): boolean {
  return (
    Array.isArray(c) &&
    c.length === 3 &&
    c.every((v) => typeof v === "number" && isValidCoord(v))
  );
}

/** Euclidean distance in meters between two AR corners. NaN when invalid. */
export function distanceM(a: Vec3, b: Vec3): number {
  if (!isValidCorner(a) || !isValidCorner(b)) return NaN;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Length in meters of the wall segment between two tapped corners.
 * Returns null for degenerate pairs (zero-length, non-finite) — the caller
 * keeps the wall estimated and asks the user to tap again.
 */
export function wallLengthFromCorners(a: Vec3, b: Vec3): number | null {
  const d = distanceM(a, b);
  if (!Number.isFinite(d) || d <= 0) return null;
  return d;
}

/**
 * Build the measurement payload for a `setWallLength` Scene op.
 * Returns null when the corner pair is degenerate (no op is emitted).
 */
export function pairCornersToWallUpdate(
  corners: [Vec3, Vec3],
  wallId: string,
): (CornerWallUpdate & { wallId: string }) | null {
  const lengthM = wallLengthFromCorners(corners[0], corners[1]);
  if (lengthM === null) return null;
  return { wallId, lengthM, provenance: "measured_ar" };
}
