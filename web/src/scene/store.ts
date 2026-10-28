import type { Opening, Scene, Wall } from "./types";

/**
 * Minimal Scene op history for intake (web).
 * Ops are pure Scene -> Scene; undo replays by restoring the previous Scene.
 * Mirrors server/scene/ops.py semantics: every edit bumps `version`.
 */

export type WallProvenance = NonNullable<Wall["provenance"]>;

export type SceneOp =
  | { type: "addWall"; wall: Wall }
  | { type: "removeWall"; wallId: string }
  | { type: "moveWallEndpoint"; wallId: string; end: "a" | "b"; point: [number, number] }
  | { type: "markOpening"; opening: Opening }
  | { type: "removeOpening"; openingId: string }
  | { type: "setWallLength"; wallId: string; lengthM: number; provenance: WallProvenance }
  | { type: "setWallHeight"; wallId: string; heightM: number }
  | { type: "confirmScale" };

export function createEmptyScene(id = "intake"): Scene {
  return {
    id,
    version: 0,
    units: "m",
    scale_confirmed: false,
    ceiling_height_m: 2.6,
    walls: [],
    openings: [],
    rooms: [],
  };
}

/** Geometric length of a wall in meters (fallback when no measure was confirmed). */
export function wallGeometryLengthM(wall: Wall): number {
  return Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
}

/** Display length: the confirmed measure when present, else the geometry. */
export function wallDisplayLengthM(wall: Wall): number {
  const measured = wall.measured_length_m;
  if (typeof measured === "number" && Number.isFinite(measured) && measured > 0) {
    return measured;
  }
  return wallGeometryLengthM(wall);
}

/** True when the wall still needs a human-confirmed measure (ADR-025 mode C). */
export function isWallEstimated(wall: Wall): boolean {
  return wall.provenance === undefined || wall.provenance === "estimated";
}

/** True when every wall carries a human-confirmed measure. */
export function allWallsMeasured(scene: Scene): boolean {
  const walls = scene.walls ?? [];
  return walls.length > 0 && walls.every((w) => !isWallEstimated(w));
}

export function applySceneOp(scene: Scene, op: SceneOp): Scene {
  const version = (scene.version ?? 0) + 1;
  const walls = [...(scene.walls ?? [])];
  const openings = [...(scene.openings ?? [])];

  switch (op.type) {
    case "addWall":
      return { ...scene, version, walls: [...walls, op.wall] };

    case "removeWall":
      return {
        ...scene,
        version,
        walls: walls.filter((w) => w.id !== op.wallId),
        openings: openings.filter((o) => o.wall_id !== op.wallId),
      };

    case "moveWallEndpoint":
      return {
        ...scene,
        version,
        walls: walls.map((w) => {
          if (w.id !== op.wallId) return w;
          return op.end === "a" ? { ...w, a: op.point } : { ...w, b: op.point };
        }),
      };

    case "markOpening":
      return { ...scene, version, openings: [...openings, op.opening] };

    case "removeOpening":
      return {
        ...scene,
        version,
        openings: openings.filter((o) => o.id !== op.openingId),
      };

    case "setWallLength": {
      if (!Number.isFinite(op.lengthM) || op.lengthM <= 0) return scene;
      return {
        ...scene,
        version,
        walls: walls.map((w) => {
          if (w.id !== op.wallId) return w;
          const geoLen = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
          if (!(geoLen > 0)) {
            return { ...w, measured_length_m: op.lengthM, provenance: op.provenance };
          }
          const dir: [number, number] = [(w.b[0] - w.a[0]) / geoLen, (w.b[1] - w.a[1]) / geoLen];
          const b: [number, number] = [w.a[0] + dir[0] * op.lengthM, w.a[1] + dir[1] * op.lengthM];
          return { ...w, b, measured_length_m: op.lengthM, provenance: op.provenance };
        }),
      };
    }

    case "setWallHeight": {
      if (!Number.isFinite(op.heightM) || op.heightM <= 0) return scene;
      return {
        ...scene,
        version,
        walls: walls.map((w) =>
          w.id !== op.wallId
            ? w
            : { ...w, height_m: op.heightM, provenance: "measured_ar" as WallProvenance },
        ),
      };
    }

    case "confirmScale":
      return { ...scene, version, scale_confirmed: true };
  }
}

export class SceneHistory {
  private past: Scene[] = [];
  private current: Scene;

  constructor(initial: Scene) {
    this.current = initial;
  }

  get scene(): Scene {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  apply(op: SceneOp): Scene {
    const next = applySceneOp(this.current, op);
    this.past.push(this.current);
    this.current = next;
    return next;
  }

  /** Replace the draft (e.g. with the Scene returned by POST /intake). */
  reset(next: Scene): Scene {
    this.past = [];
    this.current = next;
    return next;
  }

  undo(): Scene {
    const previous = this.past.pop();
    if (previous !== undefined) this.current = previous;
    return this.current;
  }
}
