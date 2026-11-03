import type { Opening, Room, Scene, Wall } from "../scene/types";
import { finishColor, furnitureColor, furnitureKind } from "../design/catalog";
import { furnitureParts, type FurniturePart } from "../design/furnitureShapes";

/**
 * Scene -> declarative mesh descriptors (pure, no three.js here).
 *
 * Units are meters. Convention: plan coords are [x east, y north] and every
 * descriptor is Z-up ([x east, y north, z up]). The renderer maps Z-up onto
 * its own up-axis (three.js is Y-up: position [x, z, -y]).
 *
 * Covered (ADR-001, scene-model skill): wall boxes from the a->b centerline
 * (length, plan angle), thickness_m, height (height_m ?? ceiling_height_m ??
 * 2.6); openings split the wall run into solid segments around each
 * [offset_m, offset_m+width_m] interval; room floors as plan polygons.
 * Furniture GLBs come later with the catalog — NOT built here.
 *
 * P0 simplification (documented tradeoff): an opening subtracts the FULL wall
 * height over its run interval (doors and windows both become full-height
 * gaps). Vertical subdivision into sill/lintel boxes from sill_m/height_m is
 * the follow-up once real openings render.
 */

/** Plan-space point in meters: [x east, y north]. */
export type PlanPoint = readonly [number, number];

/** 3D point in meters, Z-up: [x east, y north, z up]. */
export type WorldPoint = readonly [number, number, number];

/**
 * three.js world point in meters, Y-up: [x east, z up, -y north].
 * The renderer mapping lives here (not in the component) so tests pin it:
 * plan [x, y] at height zUp -> world [x, zUp, -y]. A plan rotation about Z
 * by θ is a three.js rotation about +Y by the SAME θ — never about Z
 * (that tips the wall sideways; it renders tilted and corners never meet).
 */
export type ThreePoint = readonly [number, number, number];

/** Plan [x east, y north] at height zUp -> three.js Y-up world point. */
export function planToThree(
  plan: PlanPoint,
  zUp: number,
): ThreePoint {
  return [plan[0], zUp, -plan[1]];
}

/** Fallback wall height in meters (ADR-023: ceiling 2.60 m). */
export const DEFAULT_CEILING_HEIGHT_M = 2.6;

/** Run lengths at or below this are degenerate (skipped, never rendered). */
const EPS_M = 1e-6;

export interface WallSegment {
  kind: "wall-segment";
  id: string;
  wallId: string;
  /** Box center in meters, Z-up. */
  center: WorldPoint;
  /** Box size in meters: [length along wall, thickness, height]. */
  size: readonly [number, number, number];
  /** Plan rotation about Z in radians, from +X (east) toward +Y (north). */
  rotationZ: number;
  wallKind: Wall["kind"];
}

export interface FloorMesh {
  kind: "floor";
  id: string;
  roomId: string;
  /**
   * Room polygon in plan meters. Triangulation choice: the renderer feeds
   * these points to THREE.Shape / ShapeGeometry, which triangulates with
   * earcut (THREE.ShapeUtils.triangulateShape) — either winding is accepted.
   */
  points: PlanPoint[];
  /** Floor planes always face up: [0, 0, 1]. */
  normal: WorldPoint;
  /** Flat finish color when the room has a floor surface. */
  color?: string;
}

/** Door leaf or window pane, set into its wall (colors come from openingTheme). */
export interface OpeningMesh {
  kind: "opening";
  id: string;
  openingId: string;
  wallId: string;
  openingKind: "door" | "window";
  /** Box center in meters, Z-up. */
  center: WorldPoint;
  /** Box size in meters: [width along wall, thickness, height]. */
  size: readonly [number, number, number];
  rotationZ: number;
}

/** Furniture as a simple box labelled by catalog type (CC0 primitives; real models later). */
export interface FurnitureMesh {
  id: string;
  type: string;
  center: WorldPoint;
  size: readonly [number, number, number];
  rotationZ: number;
  color: string;
  concept: boolean;
  /** Low-poly parts in the item local frame (shared by r3f and the AR GLB). */
  parts: FurniturePart[];
}

export function furnitureMeshes(scene: Scene): FurnitureMesh[] {
  return (scene.furniture ?? []).map((f) => {
    const type = furnitureKind(f.catalog_id)?.type ?? (f.concept ? "concept" : "item");
    return {
    id: f.id,
    type,
    parts: furnitureParts(f.concept ? "concept" : type, f.size_m),
    center: [f.position[0], f.position[1], f.size_m[2] / 2] as const,
    size: [f.size_m[0], f.size_m[1], f.size_m[2]] as const,
    rotationZ: ((f.rotation_deg ?? 0) * Math.PI) / 180,
    color: furnitureColor(f.catalog_id),
    concept: f.concept === true,
    };
  });
}

/** Thin flat-color slab on the chosen side of a wall (side "left" = normal (-dy, dx) of a->b). */
export interface SurfaceOverlay {
  id: string;
  wallId: string;
  center: WorldPoint;
  size: readonly [number, number, number];
  rotationZ: number;
  color: string;
}

const OVERLAY_M = 0.012;

export function surfaceOverlays(scene: Scene): SurfaceOverlay[] {
  const out: SurfaceOverlay[] = [];
  for (const s of scene.surfaces ?? []) {
    if (s.target.type !== "wall") continue;
    const target = s.target as { wall_id: string; side: string };
    const color = finishColor(s.material_id);
    const wall = (scene.walls ?? []).find((w) => w.id === target.wall_id);
    if (color === null || wall === undefined) continue;
    const length = wallRunLengthM(wall);
    if (!(length > EPS_M)) continue;
    const dx = (wall.b[0] - wall.a[0]) / length;
    const dy = (wall.b[1] - wall.a[1]) / length;
    const sign = target.side === "left" ? 1 : -1;
    const off = wall.thickness_m / 2 + OVERLAY_M / 2;
    const height = wallHeightM(wall, scene);
    out.push({
      id: s.id,
      wallId: wall.id,
      center: [(wall.a[0] + wall.b[0]) / 2 - dy * off * sign, (wall.a[1] + wall.b[1]) / 2 + dx * off * sign, height / 2],
      size: [length, OVERLAY_M, height],
      rotationZ: Math.atan2(dy, dx),
      color,
    });
  }
  return out;
}

export interface SceneMeshes {
  walls: WallSegment[];
  floors: FloorMesh[];
  openings: OpeningMesh[];
}

const DOOR_LEAF_THICKNESS_M = 0.05;
const WINDOW_GLASS_THICKNESS_M = 0.03;

/** Door leaves and window panes for every opening that fits on its wall. */
export function openingMeshes(scene: Scene): OpeningMesh[] {
  const out: OpeningMesh[] = [];
  for (const wall of scene.walls ?? []) {
    const length = wallRunLengthM(wall);
    if (!(length > EPS_M) || !(wall.thickness_m > 0)) continue;
    const dx = (wall.b[0] - wall.a[0]) / length;
    const dy = (wall.b[1] - wall.a[1]) / length;
    const rotationZ = Math.atan2(dy, dx);
    for (const o of scene.openings ?? []) {
      if (o.wall_id !== wall.id) continue;
      const t0 = Math.max(0, o.offset_m);
      const t1 = Math.min(length, o.offset_m + o.width_m);
      if (t1 - t0 <= EPS_M || !Number.isFinite(o.height_m) || !(o.height_m > 0)) continue;
      const sill = o.sill_m ?? 0;
      const mid = (t0 + t1) / 2;
      const thickness = Math.min(
        o.kind === "door" ? DOOR_LEAF_THICKNESS_M : WINDOW_GLASS_THICKNESS_M,
        wall.thickness_m,
      );
      out.push({
        kind: "opening",
        id: `${wall.id}:opening:${o.id}`,
        openingId: o.id,
        wallId: wall.id,
        openingKind: o.kind,
        center: [wall.a[0] + dx * mid, wall.a[1] + dy * mid, sill + o.height_m / 2],
        size: [t1 - t0, thickness, o.height_m],
        rotationZ,
      });
    }
  }
  return out;
}

/** Numbered badge anchor per wall: number = 1-based scene index (the label the agent uses). */
export interface WallBadge {
  wallId: string;
  number: number;
  /** Z-up point just above the wall top, at the wall midpoint. */
  position: WorldPoint;
}

export function wallBadges(scene: Scene): WallBadge[] {
  return (scene.walls ?? []).flatMap((wall, index): WallBadge[] => {
    if (!(wallRunLengthM(wall) > EPS_M)) return [];
    return [
      {
        wallId: wall.id,
        number: index + 1,
        position: [
          (wall.a[0] + wall.b[0]) / 2,
          (wall.a[1] + wall.b[1]) / 2,
          wallHeightM(wall, scene) + 0.35,
        ],
      },
    ];
  });
}

export interface BadgeLayout {
  /** Sprite edge in meters: scaled to the scene, capped so it never dominates. */
  size: number;
  badges: WallBadge[];
}

const BADGE_MIN_M = 0.12;
const BADGE_MAX_M = 0.45;
const BADGE_SCENE_FRACTION = 0.09;

/** Badge size follows the scene size (0.5 m2 room: small), and badges that would overlap are stacked upward. */
export function wallBadgeLayout(scene: Scene): BadgeLayout {
  const box = sceneBoundingBox(scene);
  const extent = box === null ? 0 : Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1]);
  const size = Math.min(BADGE_MAX_M, Math.max(BADGE_MIN_M, extent * BADGE_SCENE_FRACTION));
  const placed: WallBadge[] = [];
  for (const b of wallBadges(scene)) {
    let z = b.position[2] - 0.35 + size * 0.6;
    const clash = (): boolean =>
      placed.some(
        (o) =>
          Math.hypot(o.position[0] - b.position[0], o.position[1] - b.position[1]) < size * 1.15 &&
          Math.abs(o.position[2] - z) < size * 1.15,
      );
    while (clash()) z += size * 1.2;
    placed.push({ ...b, position: [b.position[0], b.position[1], z] });
  }
  return { size, badges: placed };
}

/** Effective wall height: wall override, else scene ceiling, else 2.6 m. */
export function wallHeightM(wall: Wall, scene: Scene): number {
  const h = wall.height_m ?? scene.ceiling_height_m ?? DEFAULT_CEILING_HEIGHT_M;
  return typeof h === "number" && Number.isFinite(h) && h > 0
    ? h
    : DEFAULT_CEILING_HEIGHT_M;
}

/** Geometric run length of a wall centerline in meters. */
export function wallRunLengthM(wall: Wall): number {
  return Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
}

/**
 * Solid run intervals after subtracting openings, in meters from wall.a.
 * Each opening interval is clamped to [0, length]; out-of-range or
 * zero-width openings are ignored; overlapping openings merge.
 */
export function solidIntervalsM(
  wallLengthM: number,
  openings: readonly Opening[],
): Array<readonly [number, number]> {
  const blocked: Array<[number, number]> = [];
  for (const o of openings) {
    if (!Number.isFinite(o.offset_m) || !Number.isFinite(o.width_m)) continue;
    if (!(o.width_m > 0)) continue;
    const t0 = Math.max(0, o.offset_m);
    const t1 = Math.min(wallLengthM, o.offset_m + o.width_m);
    if (t1 - t0 > EPS_M) blocked.push([t0, t1]);
  }
  blocked.sort((p, q) => p[0] - q[0]);
  const merged: Array<[number, number]> = [];
  for (const [t0, t1] of blocked) {
    const last = merged[merged.length - 1];
    if (last !== undefined && t0 <= last[1] + EPS_M) {
      last[1] = Math.max(last[1], t1);
    } else {
      merged.push([t0, t1]);
    }
  }
  const solids: Array<[number, number]> = [];
  let cursor = 0;
  for (const [t0, t1] of merged) {
    if (t0 - cursor > EPS_M) solids.push([cursor, t0]);
    cursor = Math.max(cursor, t1);
  }
  if (wallLengthM - cursor > EPS_M) solids.push([cursor, wallLengthM]);
  return solids;
}

/**
 * Wall run split into solid box segments. Returns [] for degenerate walls
 * (zero length, non-positive thickness) — skipped, never crashed on.
 */
/** Endpoints closer than this (m) are the same corner. */
const JOIN_EPS_M = 1e-3;

/**
 * How far to extend a wall past one endpoint so corners close: half the
 * thickness of the thickest non-collinear wall that shares that endpoint.
 */
export function cornerExtensionM(wall: Wall, end: "a" | "b", scene: Scene): number {
  const p = end === "a" ? wall.a : wall.b;
  const len = wallRunLengthM(wall);
  if (!(len > EPS_M)) return 0;
  const ux = (wall.b[0] - wall.a[0]) / len;
  const uy = (wall.b[1] - wall.a[1]) / len;
  let ext = 0;
  for (const other of scene.walls ?? []) {
    if (other.id === wall.id) continue;
    const oLen = wallRunLengthM(other);
    if (!(oLen > EPS_M) || !(other.thickness_m > 0)) continue;
    const touches = [other.a, other.b].some(
      (q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= JOIN_EPS_M,
    );
    if (!touches) continue;
    const ox = (other.b[0] - other.a[0]) / oLen;
    const oy = (other.b[1] - other.a[1]) / oLen;
    if (Math.abs(ux * ox + uy * oy) > 0.999) continue; // collinear: no overlap needed
    ext = Math.max(ext, other.thickness_m / 2);
  }
  return ext;
}

export function wallSegments(wall: Wall, scene: Scene): WallSegment[] {
  const length = wallRunLengthM(wall);
  if (!(length > EPS_M)) return [];
  if (!Number.isFinite(wall.thickness_m) || !(wall.thickness_m > 0)) return [];
  const height = wallHeightM(wall, scene);
  const openings = (scene.openings ?? []).filter((o) => o.wall_id === wall.id);
  const dx = (wall.b[0] - wall.a[0]) / length;
  const dy = (wall.b[1] - wall.a[1]) / length;
  const rotationZ = Math.atan2(dy, dx);
  const extA = cornerExtensionM(wall, "a", scene);
  const extB = cornerExtensionM(wall, "b", scene);
  const solids = solidIntervalsM(length, openings).map(
    ([t0, t1]): readonly [number, number] => [
      t0 <= EPS_M ? t0 - extA : t0,
      length - t1 <= EPS_M ? t1 + extB : t1,
    ],
  );
  // When lintel/sill are present, use side-only solids (full-height sides stay).
  // P0 expectation: 2 side segments + lintel + sill remain separate for tests
  // that assert lintel/sill identity. Existing 2-segment expectation adapts
  // to 4 when lintel/sill exist (see updated test).
  const segments: WallSegment[] = solids.map(([t0, t1], i) => {
    const mid = (t0 + t1) / 2;
    const center: WorldPoint = [wall.a[0] + dx * mid, wall.a[1] + dy * mid, height / 2];
    const size: readonly [number, number, number] = [t1 - t0, wall.thickness_m, height];
    return { kind: "wall-segment", id: `${wall.id}:seg:${i}`, wallId: wall.id, center, size, rotationZ, wallKind: wall.kind };
  });
  for (const o of openings) {
    const t0 = Math.max(0, o.offset_m);
    const t1 = Math.min(length, o.offset_m + o.width_m);
    if (t1 - t0 <= EPS_M) continue;
    const mid = (t0 + t1) / 2;
    const w = t1 - t0;
    const cx = wall.a[0] + dx * mid, cy = wall.a[1] + dy * mid;
    if (Number.isFinite(o.height_m) && Number.isFinite(o.sill_m ?? 0)) {
      const sill = o.sill_m ?? 0;
      const top = sill + o.height_m;
      const lintelH = height - top;
      if (lintelH > EPS_M) {
        segments.push({
          kind: "wall-segment",
          id: `${wall.id}:lintel:${o.id}`,
          wallId: wall.id,
          center: [cx, cy, top + lintelH / 2],
          size: [w, wall.thickness_m, lintelH],
          rotationZ,
          wallKind: wall.kind,
        });
      }
      if (sill > EPS_M) {
        segments.push({
          kind: "wall-segment",
          id: `${wall.id}:sill:${o.id}`,
          wallId: wall.id,
          center: [cx, cy, sill / 2],
          size: [w, wall.thickness_m, sill],
          rotationZ,
          wallKind: wall.kind,
        });
      }
    }
  }
  return segments;
}

/**
 * Room floor polygon. Returns null when the room has no usable polygon
 * (< 3 finite points) — and when rooms are missing entirely the Scene simply
 * gets no floor meshes (rooms are derived server-side after intake; the view
 * stays honest instead of inventing a floor).
 */
export function floorMesh(room: Room, color?: string): FloorMesh | null {
  const raw = room.polygon ?? [];
  const points: PlanPoint[] = [];
  for (const p of raw) {
    if (
      Array.isArray(p) &&
      Number.isFinite(p[0]) &&
      Number.isFinite(p[1])
    ) {
      points.push([p[0], p[1]]);
    }
  }
  if (points.length < 3) return null;
  return {
    kind: "floor",
    id: `${room.id}:floor`,
    roomId: room.id,
    points,
    normal: [0, 0, 1],
    ...(color !== undefined ? { color } : {}),
  };
}

/** One storey: the tallest ground wall, else the scene ceiling, else 2.6 m. */
export function storeyHeightM(scene: Scene): number {
  let tallest = 0;
  for (const wall of scene.walls ?? []) tallest = Math.max(tallest, wallHeightM(wall, scene));
  return tallest > 0 ? tallest : (scene.ceiling_height_m ?? DEFAULT_CEILING_HEIGHT_M);
}

export function roomLevel(room: Room): number {
  return Number.isFinite(room.level) ? Math.floor(room.level as number) : 1;
}

/** Highest point of any upper storey above the ground, or 0 when there is none. */
function upperTopM(scene: Scene): number {
  const storey = storeyHeightM(scene);
  let top = 0;
  for (const room of scene.rooms ?? []) {
    if (roomLevel(room) >= 2 && floorMesh(room) !== null) top = Math.max(top, roomLevel(room) * storey);
  }
  return top;
}

/** Whole-Scene mapping. Never throws on empty/partial scenes. */
export function sceneToMeshes(scene: Scene): SceneMeshes {
  const walls: WallSegment[] = [];
  for (const wall of scene.walls ?? []) {
    walls.push(...wallSegments(wall, scene));
  }
  const floors: FloorMesh[] = [];
  for (const room of scene.rooms ?? []) {
    const surface = (scene.surfaces ?? []).find(
      (x) => x.target.type === "room" && x.target.room_id === room.id && x.target.part === "floor",
    );
    const floor = floorMesh(room, surface ? (finishColor(surface.material_id) ?? undefined) : undefined);
    if (floor !== null) floors.push(floor);
  }
  return { walls, floors, openings: openingMeshes(scene) };
}

/** Axis-aligned bounding box in meters, Z-up. Null when the scene is empty. */
export interface SceneBoundingBox {
  min: WorldPoint;
  max: WorldPoint;
}

/**
 * Bounding box over wall boxes (plan a/b, thickness) and the wall height band
 * (0..height). Pure geometry in meters, Z-up — the renderer maps it onto its
 * own up-axis the same way it maps wall centers. Returns null for
 * empty/degenerate scenes so callers can use a fixed fallback camera.
 */
export function sceneBoundingBox(scene: Scene): SceneBoundingBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let found = false;
  for (const wall of scene.walls ?? []) {
    const length = wallRunLengthM(wall);
    if (!(length > EPS_M)) continue;
    if (!Number.isFinite(wall.thickness_m) || !(wall.thickness_m > 0)) continue;
    const height = wallHeightM(wall, scene);
    const half = wall.thickness_m / 2;
    const xs = [wall.a[0], wall.b[0]];
    const ys = [wall.a[1], wall.b[1]];
    for (const x of xs) {
      if (!Number.isFinite(x)) continue;
      minX = Math.min(minX, x - half);
      maxX = Math.max(maxX, x + half);
    }
    for (const y of ys) {
      if (!Number.isFinite(y)) continue;
      minY = Math.min(minY, y - half);
      maxY = Math.max(maxY, y + half);
    }
    minZ = Math.min(minZ, 0);
    maxZ = Math.max(maxZ, height);
    found = true;
  }
  if (!found) return null;
  maxZ = Math.max(maxZ, upperTopM(scene)); // view-only upper storeys
  for (const room of scene.rooms ?? []) {
    if (roomLevel(room) < 2) continue;
    for (const p of floorMesh(room)?.points ?? []) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
  }
  if (
    !(
      Number.isFinite(minX) &&
      Number.isFinite(minY) &&
      Number.isFinite(minZ) &&
      Number.isFinite(maxX) &&
      Number.isFinite(maxY) &&
      Number.isFinite(maxZ)
    )
  ) {
    return null;
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

/** Camera distance margin over the bbox sphere. */
const FIT_HEADROOM = 1.25;

/** Default vertical field of view in degrees (matches the <Canvas> camera). */
export const DEFAULT_FOV_DEG = 50;

/**
 * Iso camera framing for a bounding box, in meters, Z-up (renderer maps it
 * the same way as wall centers). Target is the bbox center; the camera sits
 * on the (1, 1, ~0.7) iso direction, pushed out to fit the bbox sphere at
 * fov 50 with margin — horizontally too when a (phone-portrait) viewport is
 * given. Null bbox → fixed fallback [6, 6, 6] on origin.
 */
export function cameraForBoundingBox(
  bbox: SceneBoundingBox | null,
  viewport?: { width: number; height: number },
): {
  position: WorldPoint;
  target: WorldPoint;
} {
  if (bbox === null) {
    return { position: [6, 6, 6], target: [0, 0, 0] };
  }
  const target: WorldPoint = [
    (bbox.min[0] + bbox.max[0]) / 2,
    (bbox.min[1] + bbox.max[1]) / 2,
    (bbox.min[2] + bbox.max[2]) / 2,
  ];
  const dx = bbox.max[0] - bbox.min[0];
  const dy = bbox.max[1] - bbox.min[1];
  const dz = bbox.max[2] - bbox.min[2];
  const radius = Math.sqrt(dx * dx + dy * dy + dz * dz) / 2;
  const halfV = ((DEFAULT_FOV_DEG / 2) * Math.PI) / 180;
  let halfMin = halfV;
  const w = viewport?.width;
  const h = viewport?.height;
  if (
    typeof w === "number" &&
    typeof h === "number" &&
    Number.isFinite(w) &&
    Number.isFinite(h) &&
    w > 0 &&
    h > 0
  ) {
    halfMin = Math.min(halfV, Math.atan(Math.tan(halfV) * (w / h)));
  }
  // Fit the bbox sphere with 25% headroom (the card has overlay buttons in its corners) so the whole scene stays in frame
  // on narrow phone viewports too.
  const distance = Math.max((radius / Math.sin(halfMin)) * FIT_HEADROOM, 1);
  const dir: readonly [number, number, number] = [1, 1, 0.75];
  const dirLen = Math.sqrt(dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2);
  const position: WorldPoint = [
    target[0] + (dir[0] / dirLen) * distance,
    target[1] + (dir[1] / dirLen) * distance,
    target[2] + (dir[2] / dirLen) * distance,
  ];
  return { position, target };
}
