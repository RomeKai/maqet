import type { Opening, Scene, Wall } from "./types";

/**
 * Minimal Scene op history for intake (web).
 * Ops are pure Scene -> Scene; undo replays by restoring the previous Scene.
 * Mirrors server/scene/ops.py semantics: every edit bumps `version`.
 */

export type SceneOp =
  | { type: "addWall"; wall: Wall }
  | { type: "removeWall"; wallId: string }
  | { type: "moveWallEndpoint"; wallId: string; end: "a" | "b"; point: [number, number] }
  | { type: "markOpening"; opening: Opening }
  | { type: "removeOpening"; openingId: string }
  | { type: "rescale"; ratio: number }
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

function scalePoint(point: [number, number], ratio: number): [number, number] {
  return [point[0] * ratio, point[1] * ratio];
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

    case "rescale": {
      if (!Number.isFinite(op.ratio) || op.ratio <= 0) return scene;
      return {
        ...scene,
        version,
        walls: walls.map((w) => ({
          ...w,
          a: scalePoint(w.a, op.ratio),
          b: scalePoint(w.b, op.ratio),
        })),
        openings: openings.map((o) => ({
          ...o,
          offset_m: o.offset_m * op.ratio,
          width_m: o.width_m * op.ratio,
        })),
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

  undo(): Scene {
    const previous = this.past.pop();
    if (previous !== undefined) this.current = previous;
    return this.current;
  }
}
