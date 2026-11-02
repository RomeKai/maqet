import type { Opening, Room, Scene, Wall } from "./types";

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
  | { type: "confirmScale" }
  | { type: "addRoom"; room: Room }
  /** Several ops applied as one history step (e.g. dragging a shared corner). */
  | { type: "batch"; ops: SceneOp[] };

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
  const geometry = wallGeometryLengthM(wall);
  // A measure that no longer matches the drawn wall is stale: what the Scene (3D, takeoff, DXF) uses is the geometry.
  if (typeof measured === "number" && Number.isFinite(measured) && measured > 0 && Math.abs(measured - geometry) <= MEASURE_TOLERANCE_M) {
    return measured;
  }
  return geometry;
}

/** A confirmed measure within this of the geometry is the same length (rounding in the stored coordinates). */
const MEASURE_TOLERANCE_M = 0.02;

const SAME_POINT_M = 1e-6;

/** Room outlines are derived from wall endpoints: a vertex sitting on the old endpoint follows it. */
function moveRoomVertices(rooms: Room[] | undefined, from: [number, number], to: [number, number]): Room[] | undefined {
  if (rooms === undefined) return rooms;
  return rooms.map((r) => ({
    ...r,
    polygon: r.polygon.map((v) => (Math.hypot(v[0] - from[0], v[1] - from[1]) <= SAME_POINT_M ? to : v)),
  }));
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
    case "batch":
      return op.ops.reduce(applySceneOp, scene);

    case "addWall":
      return { ...scene, version, walls: [...walls, op.wall] };

    case "removeWall":
      return {
        ...scene,
        version,
        walls: walls.filter((w) => w.id !== op.wallId),
        openings: openings.filter((o) => o.wall_id !== op.wallId),
      };

    case "moveWallEndpoint": {
      const target = walls.find((w) => w.id === op.wallId);
      if (target === undefined) return { ...scene, version, walls };
      const from = op.end === "a" ? target.a : target.b;
      return {
        ...scene,
        version,
        walls: walls.map((w) => {
          if (w.id !== op.wallId) return w;
          const moved = op.end === "a" ? { ...w, a: op.point } : { ...w, b: op.point };
          const measured = moved.measured_length_m;
          // Dragging a corner invalidates the wall's written/measured length: back to estimated until re-confirmed.
          if (typeof measured === "number" && Math.abs(measured - wallGeometryLengthM(moved)) > MEASURE_TOLERANCE_M) {
            const { measured_length_m: _stale, ...rest } = moved;
            return { ...rest, provenance: "estimated" as WallProvenance };
          }
          return moved;
        }),
        rooms: moveRoomVertices(scene.rooms, from, op.point),
      };
    }

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
      const target = walls.find((w) => w.id === op.wallId);
      if (target === undefined) return scene;
      const geoLen = wallGeometryLengthM(target);
      if (!(geoLen > 0)) {
        return { ...scene, version, walls: walls.map((w) => (w.id === op.wallId ? { ...w, measured_length_m: op.lengthM, provenance: op.provenance } : w)) };
      }
      const b: [number, number] = [
        target.a[0] + ((target.b[0] - target.a[0]) / geoLen) * op.lengthM,
        target.a[1] + ((target.b[1] - target.a[1]) / geoLen) * op.lengthM,
      ];
      return {
        ...scene,
        version,
        walls: walls.map((w) => (w.id === op.wallId ? { ...w, b, measured_length_m: op.lengthM, provenance: op.provenance } : w)),
        rooms: moveRoomVertices(scene.rooms, target.b, b),
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

    case "addRoom":
      return {
        ...scene,
        version,
        rooms: [...(scene.rooms ?? []).filter((r) => r.id !== op.room.id), op.room],
      };

    case "confirmScale":
      return { ...scene, version, scale_confirmed: true };
  }
}

export class SceneHistory {
  private past: Scene[] = [];
  /** Scenes taken back by undo, newest first; any new edit drops them. */
  private future: Scene[] = [];
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

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  apply(op: SceneOp): Scene {
    const next = applySceneOp(this.current, op);
    this.past.push(this.current);
    this.future = [];
    this.current = next;
    return next;
  }

  /** Replace the scene with `next` as an undoable step (e.g. "reset to sketch reading"). */
  restore(next: Scene): Scene {
    this.past.push(this.current);
    this.future = [];
    this.current = next;
    return next;
  }

  /** Replace the draft (e.g. with the Scene returned by POST /intake). */
  reset(next: Scene): Scene {
    this.past = [];
    this.future = [];
    this.current = next;
    return next;
  }

  undo(): Scene {
    const previous = this.past.pop();
    if (previous !== undefined) {
      this.future.push(this.current);
      this.current = previous;
    }
    return this.current;
  }

  redo(): Scene {
    const next = this.future.pop();
    if (next !== undefined) {
      this.past.push(this.current);
      this.current = next;
    }
    return this.current;
  }
}
