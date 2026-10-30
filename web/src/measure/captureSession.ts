import {
  CLOSE_ROOM_M,
  floorPlaneDistanceM,
  isValidCorner,
  MAX_ROOM_HEIGHT_M,
  MIN_ROOM_HEIGHT_M,
  pairCornersToNewWall,
  type Vec3,
} from "./cornerMath";
import type { SceneOp } from "../scene/store";

/**
 * Mode A walls capture session (mission ar-capture-walls, W1-W3 + F1/F2/F6).
 *
 * Pure state machine: every walls-flow behavior lives here so it is
 * unit-testable without a phone. The React component only wires XR hits and
 * taps to `captureReducer` and projects the result with `toSceneOps`.
 *
 * Flow (decided with the user): wall 1 = floor base tap (corner A), floor
 * base tap (corner B), ceiling tap (that wall's own height). Each next wall
 * chains from the previous end: one base tap + one ceiling tap. A base tap
 * within CLOSE_ROOM_M of corner A snaps to A and (after that wall's ceiling
 * tap) closes the room. Each wall stores its own measured height; a height
 * outside 2.0-4.0 m is KEPT with `flaggedHeight`, never dropped (F7 feeds on
 * the flag in part 2).
 *
 * F1: the floor datum comes only from a horizontal `floorHit`; every corner
 * is projected onto y = floorY (tap y is dropped, never plan geometry). The
 * close check runs on the floor plane for the same reason: a corner-A tap
 * from chest height must still close the room.
 */
export interface CapturedCorner {
  x: number;
  z: number;
}

export interface CapturedWall {
  id: string;
  start: CapturedCorner;
  end: CapturedCorner;
  /** Raw measured height in meters, NEVER clamped — flagged, not dropped. */
  heightM: number | null;
  /** True when the height fell outside MIN/MAX_ROOM_HEIGHT_M. */
  flaggedHeight: boolean;
}

/** Walls flow only: door/window unlock after closing or "Finish walls" (W3). */
export type CaptureMode = "walls" | "door" | "window";

export interface CaptureState {
  /** Floor datum in meters, from the first horizontal hit only. */
  floorY: number | null;
  /** Completed walls, in tap order (ids wall-1, wall-2, ...). */
  walls: CapturedWall[];
  /** Chained start of the pending wall (null until the first base tap). */
  pendingStart: CapturedCorner | null;
  /** Far end of the pending wall (null until its base tap; ceiling pending). */
  pendingEnd: CapturedCorner | null;
  /**
   * True while the pending end was snapped to corner A. Consumed by the next
   * ceiling tap (which then sets `closed`). Internal — not in the PLAN shape,
   * added so the snap and the close stay one gesture apart.
   */
  closePending: boolean;
  closed: boolean;
  finished: boolean;
  done: boolean;
  mode: CaptureMode;
  /** Walls-flow openings captured after close/finish. */
  openings: CapturedOpening[];
  /** Pending opening: first diagonal corner, until second tap completes it. */
  pendingOpening: PendingOpening | null;
  /** Bounded undo stack of snapshots (states, not events). */
  past: CaptureSnapshot[];
}

export interface CapturedOpening {
  id: string;
  wall_id: string;
  kind: "door" | "window";
  offset_m: number;
  width_m: number;
  height_m: number;
  sill_m: number | null;
  flagged: boolean;
}

export interface PendingOpening {
  first: Vec3;
  wallId: string;
  kind: "door" | "window";
}

export type CaptureSnapshot = Omit<CaptureState, "past">;

export type CaptureEvent =
  | { type: "floorHit"; point: Vec3; horizontal: boolean }
  | { type: "baseTap"; point: Vec3 }
  | { type: "ceilingTap"; point: Vec3 }
  | { type: "ceilingConfirm"; heightM: number }
  | { type: "finishWalls" }
  | { type: "modeChange"; mode: CaptureMode }
  | { type: "openingTap"; point: Vec3 }
  | { type: "openingManual"; wallId: string; kind: "door" | "window"; offsetM: number; widthM: number; heightM: number; sillM: number | null }
  | { type: "undo" }
  | { type: "startOver" }
  | { type: "done" };

/** Rejection codes for the HUD pill: the event changed nothing. */
export type CaptureError =
  | "floor-first"
  | "mode-locked"
  | "no-pending"
  | "bad-tap"
  | "opening-no-wall"
  | "opening-outside"
  | "opening-degenerate";

export interface CaptureResult {
  state: CaptureState;
  error: CaptureError | null;
}

export function initialCaptureState(): CaptureState {
  return {
    floorY: null,
    walls: [],
    pendingStart: null,
    pendingEnd: null,
    closePending: false,
    closed: false,
    finished: false,
    done: false,
    mode: "walls",
    openings: [],
    pendingOpening: null,
    past: [],
  };
}

/** Undo depth: a room session is a handful of taps; 64 is plenty. */
const MAX_PAST = 64;

function pushPast(state: CaptureState): CaptureSnapshot[] {
  const { past, ...snapshot } = state;
  void past;
  const next: CaptureSnapshot[] = [...state.past, snapshot];
  return next.length > MAX_PAST
    ? next.slice(next.length - MAX_PAST)
    : next;
}

function accepted(state: CaptureState, patch: Partial<CaptureSnapshot>): CaptureResult {
  return { state: { ...state, ...patch, past: pushPast(state) }, error: null };
}

function rejected(state: CaptureState, error: CaptureError): CaptureResult {
  return { state, error };
}

/** Floor projection: tap y is dropped, plan position is x/z (F1). */
function projectToFloor(point: Vec3): CapturedCorner {
  return { x: point[0], z: point[2] };
}

/** Close-gesture check on the floor plane (tap height must not matter, F1). */
function isCloseTap(tap: CapturedCorner, first: CapturedCorner): boolean {
  const d = floorPlaneDistanceM(
    [tap.x, 0, tap.z],
    [first.x, 0, first.z],
  );
  return Number.isFinite(d) && d <= CLOSE_ROOM_M;
}

export function captureReducer(
  state: CaptureState,
  event: CaptureEvent,
): CaptureResult {
  switch (event.type) {
    case "floorHit": {
      // Geometry comes from the hit pose; the caller carries the horizontal
      // flag (adapter types extended per bed decision). A vertical-surface
      // hit before the floor is known changes nothing.
      if (!event.horizontal) return { state, error: null };
      if (!isValidCorner(event.point)) return rejected(state, "bad-tap");
      // First datum wins: the floor must not drift mid-session.
      if (state.floorY !== null) return { state, error: null };
      return accepted(state, { floorY: event.point[1] });
    }

    case "baseTap": {
      if (!isValidCorner(event.point)) return rejected(state, "bad-tap");
      if (state.floorY === null) return rejected(state, "floor-first");
      if (state.closed || state.finished || state.done) {
        return { state, error: null };
      }
      const corner = projectToFloor(event.point);
      // Finger-bounce guard: a tap exactly on the chained start opens
      // nothing. Without it the next ceiling tap completes a zero-length
      // wall that toSceneOps drops but that still consumes a wall id,
      // shifting every later wall's id.
      if (
        state.pendingStart !== null &&
        corner.x === state.pendingStart.x &&
        corner.z === state.pendingStart.z
      ) {
        return { state, error: null };
      }
      if (state.pendingStart === null) {
        return accepted(state, {
          pendingStart: corner,
          pendingEnd: null,
          closePending: false,
        });
      }
      // A base tap while the ceiling is pending re-taps the far end.
      // 3+ walls traced: a tap near corner A snaps to it (W2) — still
      // followed by that wall's ceiling tap. Earlier near-A taps are
      // accidental (legacy traceCornerTap rule): dropped, never a stub wall.
      let pendingEnd = corner;
      let closePending = false;
      const first = state.walls[0]?.start;
      if (first !== undefined && isCloseTap(corner, first)) {
        if (state.walls.length >= 3) {
          pendingEnd = { ...first };
          closePending = true;
        } else {
          return { state, error: null };
        }
      }
      return accepted(state, { pendingEnd, closePending });
    }

    case "ceilingTap": {
      if (!isValidCorner(event.point)) return rejected(state, "bad-tap");
      if (state.floorY === null) return rejected(state, "floor-first");
      // Done means done: taps after done change nothing (same treatment as
      // closed/finished — the session's content is final).
      if (state.closed || state.finished || state.done) {
        return { state, error: null };
      }
      if (state.pendingStart === null || state.pendingEnd === null) {
        return rejected(state, "no-pending");
      }
      // Raw height, never clamped: implausible values are KEPT with a flag.
      const heightM = event.point[1] - state.floorY;
      const flaggedHeight = !(
        heightM >= MIN_ROOM_HEIGHT_M && heightM <= MAX_ROOM_HEIGHT_M
      );
      const wall: CapturedWall = {
        id: `wall-${state.walls.length + 1}`,
        start: state.pendingStart,
        end: state.pendingEnd,
        heightM,
        flaggedHeight,
      };
      return accepted(state, {
        walls: [...state.walls, wall],
        pendingStart: state.pendingEnd,
        pendingEnd: null,
        closePending: false,
        closed: state.closePending || state.closed,
      });
    }

    case "ceilingConfirm": {
      if (!Number.isFinite(event.heightM) || event.heightM <= 0)
        return rejected(state, "bad-tap");
      if (state.floorY === null) return rejected(state, "floor-first");
      if (state.closed || state.finished || state.done) {
        return { state, error: null };
      }
      if (state.pendingStart === null || state.pendingEnd === null) {
        return rejected(state, "no-pending");
      }
      const heightM = event.heightM;
      const flaggedHeight = !(
        heightM >= MIN_ROOM_HEIGHT_M && heightM <= MAX_ROOM_HEIGHT_M
      );
      const wall: CapturedWall = {
        id: `wall-${state.walls.length + 1}`,
        start: state.pendingStart,
        end: state.pendingEnd,
        heightM,
        flaggedHeight,
      };
      return accepted(state, {
        walls: [...state.walls, wall],
        pendingStart: state.pendingEnd,
        pendingEnd: null,
        closePending: false,
        closed: state.closePending || state.closed,
      });
    }

    case "finishWalls": {
      if (state.done) return { state, error: null };
      return accepted(state, { finished: true });
    }

    case "modeChange": {
      // W3: door/window unlock only after closing or "Finish walls".
      if (
        (event.mode === "door" || event.mode === "window") &&
        !state.closed &&
        !state.finished
      ) {
        return rejected(state, "mode-locked");
      }
      // Tool selection is not content: it costs no undo depth, or a
      // door->walls->Undo walk reverts invisible state and the user thinks
      // Undo is broken.
      if (event.mode === state.mode) return { state, error: null };
      return { state: { ...state, mode: event.mode }, error: null };
    }

    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (previous === undefined) return { state, error: null };
      return {
        state: { ...previous, past: state.past.slice(0, -1) },
        error: null,
      };
    }

    case "startOver": {
      // Bed decision: the confirm step is component-local UI; the reducer
      // clears immediately.
      return { state: initialCaptureState(), error: null };
    }

    case "openingTap": {
      if (!isValidCorner(event.point)) return rejected(state, "bad-tap");
      if (state.floorY === null) return rejected(state, "floor-first");
      if (state.done) return { state, error: null };
      if (state.mode !== "door" && state.mode !== "window") return { state, error: null };
      if (!state.closed && !state.finished) return rejected(state, "mode-locked");
      // Build wall lookup for projection (pure geometry in openingMath helpers inline)
      const kind = state.mode;
      if (state.pendingOpening === null) {
        // First tap: find nearest wall
        const nearest = nearestCapturedWall(state.walls, event.point);
        if (!nearest) return rejected(state, "opening-no-wall");
        return accepted(state, { pendingOpening: { first: event.point, wallId: nearest.id, kind } });
      }
      // Second tap: project both taps onto wall plane
      const pending = state.pendingOpening;
      const wall = state.walls.find((w) => w.id === pending.wallId);
      if (!wall) return accepted(state, { pendingOpening: null });
      const proj = projectOpeningOnWall(wall, pending.first, event.point);
      if (!proj) {
        return rejected(state, "opening-degenerate");
      }
      // Clamp check
      const wallLen = wallLength(wall);
      if (proj.offset_m < -1e-6 || proj.offset_m + proj.width_m > wallLen + 1e-6 || proj.width_m <= 1e-6) {
        // Keep first corner, show why
        return rejected(state, "opening-outside");
      }
      // Compute height/sill from diagonal taps
      const floorY = state.floorY;
      let height_m: number;
      let sill_m: number | null;
      const y1 = pending.first[1], y2 = event.point[1];
      const lowY = Math.min(y1, y2), highY = Math.max(y1, y2);
      if (kind === "door") {
        height_m = highY - floorY;
        sill_m = null;
      } else {
        height_m = highY - lowY;
        sill_m = lowY - floorY;
        if (sill_m < 0) sill_m = 0;
      }
      if (!Number.isFinite(height_m) || height_m <= 0) return rejected(state, "opening-degenerate");
      const flagged = kind === "door" && proj.width_m < 0.8;
      const opening: CapturedOpening = {
        id: `opening-${state.openings.length + 1}`,
        wall_id: wall.id,
        kind,
        offset_m: proj.offset_m,
        width_m: proj.width_m,
        height_m,
        sill_m,
        flagged,
      };
      return accepted(state, { openings: [...state.openings, opening], pendingOpening: null });
    }

    case "openingManual": {
      if (state.floorY === null) return rejected(state, "floor-first");
      if (state.done) return { state, error: null };
      const wall = state.walls.find((w) => w.id === event.wallId);
      if (!wall) return rejected(state, "opening-no-wall");
      const wallLen = wallLength(wall);
      if (event.offsetM < 0 || event.widthM <= 0 || event.offsetM + event.widthM > wallLen + 1e-6) return rejected(state, "opening-outside");
      if (!Number.isFinite(event.heightM) || event.heightM <= 0) return rejected(state, "opening-degenerate");
      if (event.kind === "window" && event.sillM !== null && (!Number.isFinite(event.sillM) || event.sillM < 0)) return rejected(state, "opening-degenerate");
      const flagged = event.kind === "door" && event.widthM < 0.8;
      const opening: CapturedOpening = {
        id: `opening-${state.openings.length + 1}`,
        wall_id: event.wallId,
        kind: event.kind,
        offset_m: event.offsetM,
        width_m: event.widthM,
        height_m: event.heightM,
        sill_m: event.kind === "door" ? null : (event.sillM ?? 0),
        flagged,
      };
      return accepted(state, { openings: [...state.openings, opening], pendingOpening: null });
    }

    case "done": {
      return accepted(state, { done: true });
    }
  }
}

function wallLength(w: CapturedWall): number {
  const dx = w.end.x - w.start.x, dz = w.end.z - w.start.z;
  return Math.hypot(dx, dz);
}

function nearestCapturedWall(walls: CapturedWall[], tap: Vec3): CapturedWall | null {
  if (walls.length === 0) return null;
  let best: CapturedWall | null = null;
  let bestD = Infinity;
  for (const w of walls) {
    const d = pointToSegmentM([tap[0], -tap[2]], [w.start.x, -w.start.z], [w.end.x, -w.end.z]);
    if (d < bestD) { bestD = d; best = w; }
  }
  return best;
}
function pointToSegmentM(p: [number, number], a: [number, number], b: [number, number]): number {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby));
}
function projectOpeningOnWall(wall: CapturedWall, e1: Vec3, e2: Vec3): { offset_m: number; width_m: number } | null {
  // Plan: [x, -z]
  const axP = wall.start.x, ayP = -wall.start.z;
  const bxP = wall.end.x, byP = -wall.end.z;
  const wdx = bxP - axP, wdy = byP - ayP;
  const wLen = Math.hypot(wdx, wdy);
  if (wLen <= 1e-9) return null;
  const wux = wdx / wLen, wuy = wdy / wLen;
  const p1x = e1[0], p1y = -e1[2];
  const p2x = e2[0], p2y = -e2[2];
  const t1 = (p1x - axP) * wux + (p1y - ayP) * wuy;
  const t2 = (p2x - axP) * wux + (p2y - ayP) * wuy;
  const lo = Math.min(t1, t2), hi = Math.max(t1, t2);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const width = hi - lo;
  if (width <= 1e-6) return null;
  return { offset_m: lo, width_m: width };
}

/** HUD pill selector (F6): which tap comes next. */
export type StepKey = "floor" | "base" | "end" | "ceiling" | "finished";

export function stepKey(state: CaptureState): StepKey {
  if (state.done || state.closed || state.finished) return "finished";
  if (state.floorY === null) return "floor";
  if (state.pendingEnd !== null) return "ceiling";
  // Wall 1's first base leaves the other end pending; later walls chain, so
  // a lone pending start means the next corner.
  if (state.pendingStart !== null && state.walls.length === 0) return "end";
  return "base";
}

export interface SceneOpsResult {
  ops: SceneOp[];
  /** Ids of walls whose kept height fell outside 2.0-4.0 m. */
  flaggedWallIds: string[];
  flaggedOpeningIds: string[];
}

/**
 * Project the captured walls to SceneOps (bed decision: a single `addWall`
 * per wall with length + raw height + provenance, never `setWallHeight`).
 * Degenerate pairs emit nothing — `pairCornersToNewWall` is the single
 * geometry implementation (cornerMath stays the only one).
 */
export function toSceneOps(state: CaptureState): SceneOpsResult {
  const ops: SceneOp[] = [];
  const flaggedWallIds: string[] = [];
  const flaggedOpeningIds: string[] = [];
  for (const captured of state.walls) {
    const created = pairCornersToNewWall(
      [
        [captured.start.x, 0, captured.start.z],
        [captured.end.x, 0, captured.end.z],
      ],
      captured.id,
    );
    if (created === null) continue;
    ops.push({
      type: "addWall",
      wall: { ...created.wall, height_m: captured.heightM },
    });
    if (captured.flaggedHeight) flaggedWallIds.push(captured.id);
  }
  for (const o of state.openings) {
    ops.push({ type: "markOpening", opening: { id: o.id, wall_id: o.wall_id, kind: o.kind, offset_m: o.offset_m, width_m: o.width_m, height_m: o.height_m, sill_m: o.sill_m } });
    if (o.flagged) flaggedOpeningIds.push(o.id);
  }
  return { ops, flaggedWallIds, flaggedOpeningIds };
}
