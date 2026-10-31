import { useEffect, useRef } from "react";
import type { Locale } from "../i18n";
import { formatMeasureM } from "../intake/ScaleTool";
import {
  floorPlaneDistanceM,
  shouldCloseRoom,
  type Vec3,
} from "./cornerMath";
import { centerRayFromViewInverse, ceilingHeightFromCenterRay, floorPointFromRay } from "./ceilingRay";
import { projectToScreen } from "./projectToScreen";
import type { OverlayFrame } from "./xrAdapter";
import type { CapturedWall, CapturedCorner, CapturedOpening, PendingOpening } from "./captureSession";

/**
 * One projected dot: a planted corner, or the live reticle. x/y are
 * overlay pixels; visible is false when the world point is on/behind the
 * camera plane (projectToScreen contract) — then the caller hides the SVG
 * element instead of drawing it at a stale position.
 */
export interface OverlayDot {
  x: number;
  y: number;
  visible: boolean;
}

/** One projected line segment between two overlay dots, positional: one slot
 * per corner pair, null when the pair cannot draw (a corner behind the
 * camera). Null slots keep edge indexing stable so the rAF loop hides that
 * line instead of misassigning later edges. */
export interface OverlayEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Floor-plane length in meters — plan geometry, never screen pixels. */
  lengthM: number;
  /** Locale-formatted length for the SVG edge label. */
  label: string;
}

/** The dashed rubber band: last corner to the live reticle. */
export interface OverlayBand extends OverlayEdge {
  lengthM: number;
  label: string;
}

/** Projected vertical quad for one wall (floor line + translucent fill). */
export interface OverlayQuad {
  /** SVG polygon points attribute: "x1,y1 x2,y2 x3,y3 x4,y4". */
  points: string;
  visible: boolean;
  /** Floor edge length label for this wall. */
  lengthM: number;
  label: string;
}

function vec3(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}


/**
 * Everything ArOverlay draws for one overlay frame + wall list. Pure
 * data, no DOM: the rAF loop writes it straight into SVG attributes via
 * element refs, never through React state. Unit-tested (the loop itself
 * needs a device).
 */
export interface OverlayLayout {
  reticle: OverlayDot | null;
  corners: OverlayDot[];
  /** Positional per wall: floor edge per captured wall. */
  edges: (OverlayEdge | null)[];
  band: OverlayBand | null;
  /** Translucent quads: one per captured wall (floor->ceiling). */
  quads: (OverlayQuad | null)[];
  /** Rubber-band quad while ceiling tap pending (pending wall preview). */
  rubberQuad: OverlayQuad | null;
  /** True when the world reticle is within CLOSE_ROOM_M of the first corner. */
  closeLoop: boolean;
  /** Live camera-ray ceiling height (m) while the height step is pending. */
  ceilingPreviewM: number | null;
  /** Captured doors / windows projected onto their walls. */
  openingQuads: OverlayOpeningQuad[];
  /** First edge of an opening waiting for its second tap. */
  openingMarker: OverlayDot | null;
}

export interface OverlayOpeningQuad {
  points: string;
  kind: "door" | "window";
  visible: boolean;
}

/** Extra capture context for the walls layout (all optional: old callers still work). */
export interface OverlayExtras {
  openings?: readonly CapturedOpening[];
  pendingOpening?: PendingOpening | null;
  /** Active Door / Window tool: the floor reticle and band are hidden. */
  openingTool?: boolean;
}

/** A hit-test reticle this far from the floor plane is a wall or ceiling hit, not the floor. */
const FLOOR_HIT_TOLERANCE_M = 0.15;

const HIDDEN_DOT: OverlayDot = { x: 0, y: 0, visible: false };

/**
 * Build a projected quad for one wall segment: floor edge (aFloor->bFloor)
 * bottom, ceiling edge (aCeil->bCeil) top. Returns null when any of the four
 * projected corners is behind the camera — the wall hides instead of smearing.
 */
function wallQuad(
  a: CapturedCorner,
  b: CapturedCorner,
  floorY: number,
  heightM: number,
  frame: OverlayFrame,
  locale: Locale,
): OverlayQuad | null {
  const view = {
    projectionMatrix: frame.view.projection,
    viewInverse: frame.view.viewInverse,
  };
  const viewport = { width: frame.viewportW, height: frame.viewportH };
  const aFloor = vec3(a.x, floorY, a.z);
  const bFloor = vec3(b.x, floorY, b.z);
  const aCeil = vec3(a.x, floorY + heightM, a.z);
  const bCeil = vec3(b.x, floorY + heightM, b.z);
  const pAF = projectToScreen(aFloor, view, viewport);
  const pBF = projectToScreen(bFloor, view, viewport);
  const pAC = projectToScreen(aCeil, view, viewport);
  const pBC = projectToScreen(bCeil, view, viewport);
  if (!pAF.visible || !pBF.visible || !pAC.visible || !pBC.visible) {
    return { points: "", visible: false, lengthM: 0, label: "" };
  }
  const ceilY = floorY + heightM;
  if (!Number.isFinite(ceilY)) return null;
  const lengthM = floorPlaneDistanceM([a.x, 0, a.z] as Vec3, [b.x, 0, b.z] as Vec3);
  return {
    points: `${pAF.x},${pAF.y} ${pBF.x},${pBF.y} ${pBC.x},${pBC.y} ${pAC.x},${pAC.y}`,
    visible: true,
    lengthM,
    label: formatMeasureM(locale, lengthM),
  };
}

function wallEdge(
  a: CapturedCorner,
  b: CapturedCorner,
  floorY: number,
  frame: OverlayFrame,
  locale: Locale,
): OverlayEdge | null {
  const view = {
    projectionMatrix: frame.view.projection,
    viewInverse: frame.view.viewInverse,
  };
  const viewport = { width: frame.viewportW, height: frame.viewportH };
  const aW = vec3(a.x, floorY, a.z);
  const bW = vec3(b.x, floorY, b.z);
  const pa = projectToScreen(aW, view, viewport);
  const pb = projectToScreen(bW, view, viewport);
  if (!pa.visible || !pb.visible) return null;
  const lengthM = floorPlaneDistanceM([a.x, 0, a.z] as Vec3, [b.x, 0, b.z] as Vec3);
  return {
    x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y,
    lengthM,
    label: formatMeasureM(locale, lengthM),
  };
}

/**
 * Pure layout for the AR DOM overlay: projects captured walls as floor lines +
 * translucent vertical quads (floorY -> floorY+height), the rubber-band quad
 * while the ceiling tap is pending, the reticle ring, planted corners, and the
 * close-loop highlight. A null frame hides everything; a null reticle hides the
 * ring/band/rubber-quad but keeps planted walls. Walls stay visible in every
 * HUD mode (F3: context never lost on mode switch).
 */
export function computeOverlayLayout(
  frame: OverlayFrame | null,
  corners: Vec3[],
  locale: Locale,
): OverlayLayout {
  const empty: OverlayLayout = {
    reticle: null,
    corners: [],
    edges: [],
    band: null,
    quads: [],
    rubberQuad: null,
    closeLoop: false,
    ceilingPreviewM: null,
    openingQuads: [],
    openingMarker: null,
  };
  if (frame === null) return empty;
  const view = {
    projectionMatrix: frame.view.projection,
    viewInverse: frame.view.viewInverse,
  };
  const viewport = { width: frame.viewportW, height: frame.viewportH };
  const reticle: OverlayDot | null =
    frame.reticle === null
      ? null
      : projectToScreen(frame.reticle, view, viewport);
  const dots: OverlayDot[] = corners.map((corner) =>
    projectToScreen(corner, view, viewport),
  );
  const edges: (OverlayEdge | null)[] = [];
  for (let i = 0; i + 1 < dots.length; i++) {
    const a = dots[i] ?? HIDDEN_DOT;
    const b = dots[i + 1] ?? HIDDEN_DOT;
    if (a.visible && b.visible) {
      const lengthM = floorPlaneDistanceM(
        corners[i] as Vec3,
        corners[i + 1] as Vec3,
      );
      edges.push({
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        lengthM,
        label: formatMeasureM(locale, lengthM),
      });
    } else {
      edges.push(null);
    }
  }
  const lastIndex = dots.length - 1;
  const lastDot = lastIndex >= 0 ? (dots[lastIndex] ?? HIDDEN_DOT) : null;
  const band: OverlayBand | null =
    lastDot !== null && reticle !== null && lastDot.visible && reticle.visible
      ? {
          x1: lastDot.x, y1: lastDot.y, x2: reticle.x, y2: reticle.y,
          lengthM: floorPlaneDistanceM(
            corners[lastIndex] as Vec3,
            frame.reticle as Vec3,
          ),
          label: formatMeasureM(
            locale,
            floorPlaneDistanceM(corners[lastIndex] as Vec3, frame.reticle as Vec3),
          ),
        }
      : null;
  const closeLoop =
    frame.reticle !== null &&
    corners.length > 0 &&
    shouldCloseRoom(corners[0] as Vec3, frame.reticle);
  return { ...empty, reticle, corners: dots, edges, band, closeLoop };
}

/** Point on a wall at `along` meters from its start and height y. */
function wallPoint(w: CapturedWall, along: number, y: number): Vec3 {
  const dx = w.end.x - w.start.x;
  const dz = w.end.z - w.start.z;
  const len = Math.hypot(dx, dz) || 1;
  return [w.start.x + (dx / len) * along, y, w.start.z + (dz / len) * along];
}

/**
 * Full wall-aware layout for F3: captured walls as floor line + translucent
 * quad, rubber-band quad while the ceiling tap is pending. `corners` is kept
 * for corner dots (derived from walls + pending corners) so legacy tests stay
 * green. The rAF loop in ArOverlay calls this variant.
 */
export function computeWallsOverlayLayout(
  frame: OverlayFrame | null,
  walls: CapturedWall[],
  pendingStart: CapturedCorner | null,
  pendingEnd: CapturedCorner | null,
  floorY: number | null,
  locale: Locale,
  extras: OverlayExtras = {},
): OverlayLayout {
  const base = computeOverlayLayout(
    frame,
    walls.flatMap((w) => [vec3(w.start.x, 0, w.start.z)] as Vec3[])
      .concat(pendingStart ? [vec3(pendingStart.x, 0, pendingStart.z)] : [])
      .concat(pendingEnd ? [vec3(pendingEnd.x, 0, pendingEnd.z)] : []),
    locale,
  );
  if (frame === null) return base;
  const view = {
    projectionMatrix: frame.view.projection,
    viewInverse: frame.view.viewInverse,
  };
  const viewport = { width: frame.viewportW, height: frame.viewportH };

  // Corners for dots: all wall endpoints + pending corners, de-duplicated.
  const cornerWorlds: Vec3[] = [];
  for (const w of walls) {
    if (cornerWorlds.length === 0) cornerWorlds.push([w.start.x, 0, w.start.z]);
    cornerWorlds.push([w.end.x, 0, w.end.z]);
  }
  if (pendingStart && cornerWorlds.length === 0) {
    cornerWorlds.push([pendingStart.x, 0, pendingStart.z]);
  } else if (pendingStart && walls.length === 0) {
    // Already added above
  }
  if (pendingEnd) cornerWorlds.push([pendingEnd.x, 0, pendingEnd.z]);

  // Build dots for these corners at floorY when known, else y=0.
  const yForDots = floorY ?? 0;
  const dots: OverlayDot[] = cornerWorlds.map((c) =>
    projectToScreen([c[0], yForDots, c[2]], view, viewport),
  );

  // Edges: floor line per captured wall at its floorY.
  const edges: (OverlayEdge | null)[] = [];
  const quads: (OverlayQuad | null)[] = [];
  if (floorY !== null) {
    for (const w of walls) {
      const height = w.heightM ?? 2.6;
      edges.push(wallEdge(w.start, w.end, floorY, frame, locale));
      quads.push(wallQuad(w.start, w.end, floorY, height, frame, locale));
    }
    // Pending wall floor edge (while ceiling pending, show band as edge too).
    if (pendingStart && pendingEnd) {
      const e = wallEdge(pendingStart, pendingEnd, floorY, frame, locale);
      if (e) edges.push(e);
    }
  } else {
    // No floor datum yet: no wall geometry to draw at height.
    for (let i = 0; i < walls.length; i++) {
      edges.push(null);
      quads.push(null);
    }
  }

  // Rubber-band quad (fix 2): pending wall extruded to the camera-ray height.
  // No hit-test needed: aiming at the wall/ceiling junction yields no reticle,
  // but the frame still carries the viewer matrices for the center ray.
  let rubberQuad: OverlayQuad | null = null;
  if (floorY !== null && pendingStart !== null && pendingEnd !== null) {
    const h = ceilingHeightFromCenterRay(
      pendingStart,
      pendingEnd,
      floorY,
      centerRayFromViewInverse(frame.view.viewInverse),
    );
    if (h !== null && Number.isFinite(h) && h > 0.05) {
      rubberQuad = wallQuad(pendingStart, pendingEnd, floorY, h, frame, locale);
    }
  }

  // The reticle always lives on the FLOOR plane at the floor corner's y. A hit-test pose on a
  // wall or the ceiling (what the camera sees after the height step) is replaced by the
  // center ray's intersection with the floor, so the next corner and the band start on the floor.
  const ray = centerRayFromViewInverse(frame.view.viewInverse);
  let floorReticle: Vec3 | null = null;
  if (floorY !== null) {
    floorReticle =
      frame.reticle !== null && Math.abs(frame.reticle[1] - floorY) <= FLOOR_HIT_TOLERANCE_M
        ? ([frame.reticle[0], floorY, frame.reticle[2]] as Vec3)
        : floorPointFromRay(ray, floorY);
  } else {
    floorReticle = frame.reticle;
  }
  const heightPending = pendingStart !== null && pendingEnd !== null;
  const showFloorAids = !heightPending && extras.openingTool !== true;
  const reticleDot =
    floorReticle !== null && showFloorAids ? projectToScreen(floorReticle, view, viewport) : null;

  let band: OverlayBand | null = null;
  if (dots.length > 0 && reticleDot !== null && reticleDot.visible && floorReticle !== null) {
    const lastDot = dots[dots.length - 1] ?? HIDDEN_DOT;
    if (lastDot.visible) {
      const lastWorld = cornerWorlds[cornerWorlds.length - 1] as Vec3;
      const len = floorPlaneDistanceM(lastWorld, floorReticle);
      band = {
        x1: lastDot.x, y1: lastDot.y, x2: reticleDot.x, y2: reticleDot.y,
        lengthM: len,
        label: formatMeasureM(locale, len),
      };
    }
  }

  const firstCorner: Vec3 | null =
    walls[0] ? [walls[0].start.x, 0, walls[0].start.z] : pendingStart ? [pendingStart.x, 0, pendingStart.z] : null;
  const closeLoop =
    floorReticle !== null && showFloorAids && firstCorner !== null && shouldCloseRoom(firstCorner, floorReticle);

  // Live ceiling height from the camera ray (height step only).
  const ceilingPreviewM =
    floorY !== null && heightPending
      ? ceilingHeightFromCenterRay(pendingStart, pendingEnd, floorY, ray)
      : null;

  // Captured openings drawn on their wall quads (door terracotta, window light blue via CSS).
  const openingQuads: OverlayOpeningQuad[] = [];
  if (floorY !== null) {
    for (const o of extras.openings ?? []) {
      const w = walls.find((x) => x.id === o.wall_id);
      if (w === undefined) {
        openingQuads.push({ points: "", kind: o.kind, visible: false });
        continue;
      }
      const y0 = floorY + (o.sill_m ?? 0);
      const y1 = y0 + o.height_m;
      const pts = [
        wallPoint(w, o.offset_m, y0),
        wallPoint(w, o.offset_m + o.width_m, y0),
        wallPoint(w, o.offset_m + o.width_m, y1),
        wallPoint(w, o.offset_m, y1),
      ].map((p) => projectToScreen(p, view, viewport));
      openingQuads.push(
        pts.every((p) => p.visible)
          ? { points: pts.map((p) => `${p.x},${p.y}`).join(" "), kind: o.kind, visible: true }
          : { points: "", kind: o.kind, visible: false },
      );
    }
  }
  let openingMarker: OverlayDot | null = null;
  if (extras.pendingOpening) {
    openingMarker = projectToScreen(extras.pendingOpening.first, view, viewport);
  }

  return {
    reticle: reticleDot,
    corners: dots,
    edges,
    band,
    quads,
    rubberQuad,
    closeLoop,
    ceilingPreviewM,
    openingQuads,
    openingMarker,
  };
}

/** Live frame written by the adapter's onOverlayFrame (plain assignment, no setState). */
export interface OverlayFrameRef {
  current: OverlayFrame | null;
}

interface ArOverlayProps {
  frameRef: OverlayFrameRef;
  corners: Vec3[];
  locale: Locale;
  /** F3 walls path: when provided, overlay draws quads per wall + rubber-band quad. */
  walls?: CapturedWall[];
  pendingStart?: CapturedCorner | null;
  pendingEnd?: CapturedCorner | null;
  floorY?: number | null;
  openings?: readonly CapturedOpening[];
  pendingOpening?: PendingOpening | null;
  openingTool?: boolean;
}

/**
 * DOM/SVG AR feedback: an <svg> filling the HUD root, driven by a rAF loop
 * with ZERO React state per frame. Each tick reads the latest frame ref, runs
 * the pure layout, and writes attributes DIRECTLY via element refs. Draws:
 * translucent vertical quads per wall + floor lines (F3, in every mode),
 * rubber-band quad while the ceiling tap is pending, reticle ring, corner
 * dots, rubber band, and close-loop highlight.
 */
export function ArOverlay({ frameRef, corners, locale, walls, pendingStart, pendingEnd, floorY, openings, pendingOpening, openingTool }: ArOverlayProps) {
  const reticleRef = useRef<SVGCircleElement | null>(null);
  const cornerRefs = useRef<Array<SVGCircleElement | null>>([]);
  const edgeRefs = useRef<Array<SVGLineElement | null>>([]);
  const edgeLabelRefs = useRef<Array<SVGTextElement | null>>([]);
  const quadRefs = useRef<Array<SVGPolygonElement | null>>([]);
  const rubberQuadRef = useRef<SVGPolygonElement | null>(null);
  const bandRef = useRef<SVGLineElement | null>(null);
  const bandLabelRef = useRef<SVGTextElement | null>(null);
  const openingQuadRefs = useRef<Array<SVGPolygonElement | null>>([]);
  const markerRef = useRef<SVGCircleElement | null>(null);
  const liveHeightRef = useRef<SVGTextElement | null>(null);
  const latest = useRef({ frameRef, corners, locale, walls, pendingStart, pendingEnd, floorY, openings, pendingOpening, openingTool });
  latest.current = { frameRef, corners, locale, walls, pendingStart, pendingEnd, floorY, openings, pendingOpening, openingTool };

  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const { frameRef: ref, corners: taps, locale: loc, walls: ws, pendingStart: ps, pendingEnd: pe, floorY: fy, openings: os, pendingOpening: po, openingTool: ot } = latest.current;
      const layout = ws !== undefined
        ? computeWallsOverlayLayout(ref.current, ws, ps ?? null, pe ?? null, fy ?? null, loc, { openings: os, pendingOpening: po, openingTool: ot })
        : computeOverlayLayout(ref.current, taps, loc);
      const oqs = openingQuadRefs.current;
      for (let i = 0; i < oqs.length; i++) {
        const poly = oqs[i];
        if (poly === null || poly === undefined) continue;
        const q = layout.openingQuads[i];
        if (q === undefined || !q.visible) {
          poly.style.display = "none";
        } else {
          poly.setAttribute("points", q.points);
          poly.style.display = "";
        }
      }
      const marker = markerRef.current;
      if (marker !== null) {
        if (layout.openingMarker !== null && layout.openingMarker.visible) {
          marker.setAttribute("cx", String(layout.openingMarker.x));
          marker.setAttribute("cy", String(layout.openingMarker.y));
          marker.style.display = "";
        } else {
          marker.style.display = "none";
        }
      }
      const live = liveHeightRef.current;
      if (live !== null) {
        if (layout.ceilingPreviewM !== null) {
          live.textContent = formatMeasureM(loc, layout.ceilingPreviewM);
          live.style.display = "";
        } else {
          live.style.display = "none";
        }
      }
      const ring = reticleRef.current;
      if (ring !== null) {
        if (layout.reticle !== null && layout.reticle.visible) {
          ring.setAttribute("cx", String(layout.reticle.x));
          ring.setAttribute("cy", String(layout.reticle.y));
          ring.style.display = "";
        } else {
          ring.style.display = "none";
        }
      }
      const dots = cornerRefs.current;
      for (let i = 0; i < dots.length; i++) {
        const dot = dots[i];
        if (dot === null || dot === undefined) continue;
        const placed = layout.corners[i] ?? HIDDEN_DOT;
        if (placed.visible) {
          dot.setAttribute("cx", String(placed.x));
          dot.setAttribute("cy", String(placed.y));
          dot.style.display = "";
          if (i === 0 && layout.closeLoop) {
            dot.setAttribute("class", "ar-overlay-dot ar-overlay-dot-close");
          } else {
            dot.setAttribute("class", "ar-overlay-dot");
          }
        } else {
          dot.style.display = "none";
        }
      }
      const lines = edgeRefs.current;
      const edgeLabels = edgeLabelRefs.current;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === null || line === undefined) continue;
        const edge = layout.edges[i];
        if (edge === undefined || edge === null) {
          line.style.display = "none";
          const hiddenLabel = edgeLabels[i];
          if (hiddenLabel !== null && hiddenLabel !== undefined) hiddenLabel.style.display = "none";
          continue;
        }
        line.setAttribute("x1", String(edge.x1));
        line.setAttribute("y1", String(edge.y1));
        line.setAttribute("x2", String(edge.x2));
        line.setAttribute("y2", String(edge.y2));
        line.style.display = "";
        const label = edgeLabels[i];
        if (label !== null && label !== undefined) {
          label.setAttribute("x", String((edge.x1 + edge.x2) / 2));
          label.setAttribute("y", String((edge.y1 + edge.y2) / 2 - 8));
          label.textContent = edge.label;
          label.style.display = "";
        }
      }
      // Wall quads.
      const quads = quadRefs.current;
      for (let i = 0; i < quads.length; i++) {
        const poly = quads[i];
        if (poly === null || poly === undefined) continue;
        const q = layout.quads[i];
        if (q === undefined || q === null || !q.visible) {
          poly.style.display = "none";
          continue;
        }
        poly.setAttribute("points", q.points);
        poly.style.display = "";
      }
      // Rubber-band quad.
      const rq = rubberQuadRef.current;
      if (rq !== null) {
        if (layout.rubberQuad !== null && layout.rubberQuad.visible) {
          rq.setAttribute("points", layout.rubberQuad.points);
          rq.style.display = "";
        } else {
          rq.style.display = "none";
        }
      }
      const band = bandRef.current;
      const label = bandLabelRef.current;
      if (band !== null) {
        if (layout.band !== null) {
          band.setAttribute("x1", String(layout.band.x1));
          band.setAttribute("y1", String(layout.band.y1));
          band.setAttribute("x2", String(layout.band.x2));
          band.setAttribute("y2", String(layout.band.y2));
          band.style.display = "";
        } else {
          band.style.display = "none";
        }
      }
      if (label !== null) {
        if (layout.band !== null) {
          label.setAttribute("x", String(layout.band.x2));
          label.setAttribute("y", String(layout.band.y2 - 10));
          label.textContent = layout.band.label;
          label.style.display = "";
        } else {
          label.style.display = "none";
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Derive edge/quad count for SVG sync: walls length or corners pairing.
  const edgeCount = walls !== undefined ? walls.length + (pendingStart && pendingEnd ? 1 : 0) : Math.max(0, corners.length - 1);
  const quadCount = walls !== undefined ? walls.length : 0;

  return (
    <svg
      className="ar-overlay"
      aria-hidden="true"
      focusable="false"
      ref={() => {
        cornerRefs.current = corners.map((_, i) => cornerRefs.current[i] ?? null);
        if (walls !== undefined) {
          edgeRefs.current = Array.from({ length: edgeCount }, (_, i) => edgeRefs.current[i] ?? null);
          edgeLabelRefs.current = Array.from({ length: edgeCount }, (_, i) => edgeLabelRefs.current[i] ?? null);
          quadRefs.current = Array.from({ length: quadCount }, (_, i) => quadRefs.current[i] ?? null);
        } else {
          edgeRefs.current = corners.length > 1 ? corners.slice(0, -1).map((_, i) => edgeRefs.current[i] ?? null) : [];
          edgeLabelRefs.current = corners.length > 1 ? corners.slice(0, -1).map((_, i) => edgeLabelRefs.current[i] ?? null) : [];
        }
      }}
    >
      {/* Wall quads: behind floor lines, translucent fill. */}
      {Array.from({ length: quadCount }).map((_, i) => (
        <polygon
          key={`q${i}`}
          className="ar-overlay-quad"
          ref={(el) => { quadRefs.current[i] = el; }}
        />
      ))}
      {/* Rubber-band quad (pending wall preview). */}
      <polygon
        className="ar-overlay-quad ar-overlay-quad-rubber"
        ref={(el) => { rubberQuadRef.current = el; }}
      />
      {Array.from({ length: edgeCount }).map((_, i) => (
        <line
          key={`e${i}`}
          className="ar-overlay-edge"
          ref={(el) => { edgeRefs.current[i] = el; }}
        />
      ))}
      {Array.from({ length: edgeCount }).map((_, i) => (
        <text
          key={`el${i}`}
          className="ar-overlay-edge-label"
          ref={(el) => { edgeLabelRefs.current[i] = el; }}
        />
      ))}
      {corners.map((_, i) => (
        <circle
          key={`c${i}`}
          className="ar-overlay-dot"
          r={8}
          ref={(el) => { cornerRefs.current[i] = el; }}
        />
      ))}
      {Array.from({ length: openings?.length ?? 0 }).map((_, i) => (
        <polygon
          key={`o${i}`}
          className={`ar-overlay-opening ar-overlay-opening-${openings?.[i]?.kind ?? "door"}`}
          ref={(el) => { openingQuadRefs.current[i] = el; }}
        />
      ))}
      <circle className="ar-overlay-marker" r={9} ref={(el) => { markerRef.current = el; }} style={{ display: "none" }} />
      <text className="ar-overlay-live-height" x="50%" y="calc(50% - 34px)" textAnchor="middle" ref={(el) => { liveHeightRef.current = el; }} style={{ display: "none" }} />
      <line className="ar-overlay-band" ref={(el) => { bandRef.current = el; }} />
      <text className="ar-overlay-label" ref={(el) => { bandLabelRef.current = el; }} />
      <circle className="ar-overlay-reticle" r={22} ref={(el) => { reticleRef.current = el; }} />
    </svg>
  );
}
