import type { Scene } from "../scene/types";
import { floorMesh, roomLevel, storeyHeightM, type FloorMesh, type WallSegment } from "./sceneToMeshes";

/**
 * View-only second floor (ADR-001: the Scene is untouched). Rooms with level >= 2 are lifted onto the ground-floor
 * wall height times (level - 1); their walls are derived here from the room polygon, because the Scene's walls carry
 * no level.
 */
export interface ElevatedFloor extends FloorMesh {
  /** Height of the floor plane above the ground, meters. */
  elevationM: number;
}

export interface UpperLevelMeshes {
  walls: WallSegment[];
  floors: ElevatedFloor[];
}

const UPPER_WALL_THICKNESS_M = 0.2;

export function upperLevelMeshes(scene: Scene): UpperLevelMeshes {
  const storey = storeyHeightM(scene);
  const walls: WallSegment[] = [];
  const floors: ElevatedFloor[] = [];
  for (const room of scene.rooms ?? []) {
    const level = roomLevel(room);
    if (level < 2) continue;
    const floor = floorMesh(room);
    if (floor === null) continue;
    const base = (level - 1) * storey;
    floors.push({ ...floor, elevationM: base });
    const pts = floor.points;
    pts.forEach(([x1, y1], i) => {
      const [x2, y2] = pts[(i + 1) % pts.length];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.hypot(dx, dy);
      if (!(length > 1e-6)) return;
      walls.push({
        kind: "wall-segment",
        id: `${room.id}:upper-wall-${i}`,
        wallId: `${room.id}:upper-wall-${i}`,
        center: [(x1 + x2) / 2, (y1 + y2) / 2, base + storey / 2],
        size: [length, UPPER_WALL_THICKNESS_M, storey],
        rotationZ: Math.atan2(dy, dx),
        wallKind: "exterior",
      });
    });
  }
  return { walls, floors };
}
