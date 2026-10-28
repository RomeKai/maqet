import type { Scene } from "../scene/types";

/**
 * Runtime check for the Scene the server returns after a turn. The generated type is compile-time only,
 * so a malformed or version-skewed payload must be rejected here, before it reaches the store and the 3D view.
 * Checks structure (arrays, tuples) and numeric sanity (finite); domain rules stay on the server (ADR-002).
 */

export class SceneValidationError extends Error {
  constructor(path: string, expected: string) {
    super(`Malformed scene: ${path} must be ${expected}`);
    this.name = "SceneValidationError";
  }
}

const COLLECTIONS = ["walls", "openings", "rooms", "surfaces", "furniture", "materials"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function requireFinite(value: unknown, path: string): void {
  if (!isFiniteNumber(value)) throw new SceneValidationError(path, "a finite number");
}

function requireOptionalFinite(record: Record<string, unknown>, key: string, path: string): void {
  if (record[key] !== undefined && record[key] !== null) requireFinite(record[key], `${path}.${key}`);
}

function requireTuple(value: unknown, length: number, path: string): void {
  if (!Array.isArray(value) || value.length !== length || !value.every(isFiniteNumber)) {
    throw new SceneValidationError(path, `an array of ${length} finite numbers`);
  }
}

function requireString(record: Record<string, unknown>, key: string, path: string): void {
  if (typeof record[key] !== "string") throw new SceneValidationError(`${path}.${key}`, "a string");
}

function eachItem(scene: Record<string, unknown>, key: string, check: (item: Record<string, unknown>, path: string) => void): void {
  const list = scene[key];
  if (list === undefined) return;
  if (!Array.isArray(list)) throw new SceneValidationError(`scene.${key}`, "an array");
  list.forEach((item: unknown, index) => {
    const path = `scene.${key}[${index}]`;
    if (!isRecord(item)) throw new SceneValidationError(path, "an object");
    check(item, path);
  });
}

function checkWall(wall: Record<string, unknown>, path: string): void {
  requireString(wall, "id", path);
  requireTuple(wall.a, 2, `${path}.a`);
  requireTuple(wall.b, 2, `${path}.b`);
  requireFinite(wall.thickness_m, `${path}.thickness_m`);
  requireOptionalFinite(wall, "height_m", path);
  requireOptionalFinite(wall, "measured_length_m", path);
}

function checkOpening(opening: Record<string, unknown>, path: string): void {
  requireString(opening, "id", path);
  requireString(opening, "wall_id", path);
  requireFinite(opening.offset_m, `${path}.offset_m`);
  requireFinite(opening.width_m, `${path}.width_m`);
  requireFinite(opening.height_m, `${path}.height_m`);
  requireOptionalFinite(opening, "sill_m", path);
}

function checkRoom(room: Record<string, unknown>, path: string): void {
  requireString(room, "id", path);
  if (!Array.isArray(room.polygon)) throw new SceneValidationError(`${path}.polygon`, "an array of vertices");
  room.polygon.forEach((vertex: unknown, index) => requireTuple(vertex, 2, `${path}.polygon[${index}]`));
}

function checkFurniture(piece: Record<string, unknown>, path: string): void {
  requireString(piece, "id", path);
  requireTuple(piece.position, 2, `${path}.position`);
  requireTuple(piece.size_m, 3, `${path}.size_m`);
  requireOptionalFinite(piece, "rotation_deg", path);
}

/** Throws `SceneValidationError` with the offending path; returns the payload typed as `Scene` once it passes. */
export function validateScene(value: unknown): Scene {
  if (!isRecord(value)) throw new SceneValidationError("scene", "an object");
  requireString(value, "id", "scene");
  requireOptionalFinite(value, "version", "scene");
  requireOptionalFinite(value, "ceiling_height_m", "scene");

  for (const key of COLLECTIONS) {
    if (value[key] !== undefined && !Array.isArray(value[key])) throw new SceneValidationError(`scene.${key}`, "an array");
  }
  eachItem(value, "walls", checkWall);
  eachItem(value, "openings", checkOpening);
  eachItem(value, "rooms", checkRoom);
  eachItem(value, "furniture", checkFurniture);
  eachItem(value, "surfaces", (surface, path) => requireString(surface, "id", path));
  eachItem(value, "materials", (material, path) => requireString(material, "id", path));

  return value as unknown as Scene;
}
