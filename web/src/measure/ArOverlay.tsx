import { useEffect, useRef } from "react";
import type { Locale } from "../i18n";
import { formatMeasureM } from "../intake/ScaleTool";
import {
  floorPlaneDistanceM,
  shouldCloseRoom,
  type Vec3,
} from "./cornerMath";
import { projectToScreen } from "./projectToScreen";
import type { OverlayFrame } from "./xrAdapter";

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

/** One projected line segment between two overlay dots. */
export interface OverlayEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The dashed rubber band: last corner to the live reticle. */
export interface OverlayBand extends OverlayEdge {
  lengthM: number;
  label: string;
}

/**
 * Everything ArOverlay draws for one overlay frame + corner list. Pure
 * data, no DOM: the rAF loop writes it straight into SVG attributes via
 * element refs, never through React state. Unit-tested (the loop itself
 * needs a device).
 */
export interface OverlayLayout {
  reticle: OverlayDot | null;
  corners: OverlayDot[];
  edges: OverlayEdge[];
  band: OverlayBand | null;
  /** True when the world reticle is within CLOSE_ROOM_M of the first corner. */
  closeLoop: boolean;
}

const HIDDEN_DOT: OverlayDot = { x: 0, y: 0, visible: false };

/**
 * Pure layout for the AR DOM overlay: project the reticle + planted
 * corners with the frame's viewer matrices, link consecutive visible
 * corners with edges, and build the dashed rubber band from the last
 * corner to the reticle with its live floor-plane length label.
 *
 * A null frame (no viewer pose yet) hides everything: nothing is drawn
 * at a stale position. A null reticle (hit-test found no surface) hides
 * the ring and the band but keeps the planted corners. The close-loop
 * highlight is a WORLD-space check (shouldCloseRoom on the raw reticle),
 * independent of projection — it must fire even at the screen edge.
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
    closeLoop: false,
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
  const edges: OverlayEdge[] = [];
  for (let i = 0; i + 1 < dots.length; i++) {
    const a = dots[i] ?? HIDDEN_DOT;
    const b = dots[i + 1] ?? HIDDEN_DOT;
    if (a.visible && b.visible) {
      edges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
  }
  const lastIndex = dots.length - 1;
  const lastDot = lastIndex >= 0 ? (dots[lastIndex] ?? HIDDEN_DOT) : null;
  const band: OverlayBand | null =
    lastDot !== null &&
    reticle !== null &&
    lastDot.visible &&
    reticle.visible
      ? {
          x1: lastDot.x,
          y1: lastDot.y,
          x2: reticle.x,
          y2: reticle.y,
          lengthM: floorPlaneDistanceM(
            corners[lastIndex] as Vec3,
            frame.reticle as Vec3,
          ),
          label: formatMeasureM(
            locale,
            floorPlaneDistanceM(
              corners[lastIndex] as Vec3,
              frame.reticle as Vec3,
            ),
          ),
        }
      : null;
  const closeLoop =
    frame.reticle !== null &&
    corners.length > 0 &&
    shouldCloseRoom(corners[0] as Vec3, frame.reticle);
  return { reticle, corners: dots, edges, band, closeLoop };
}

/** Live frame written by the adapter's onOverlayFrame (plain assignment, no setState). */
export interface OverlayFrameRef {
  current: OverlayFrame | null;
}

interface ArOverlayProps {
  frameRef: OverlayFrameRef;
  corners: Vec3[];
  locale: Locale;
}

/**
 * DOM/SVG AR feedback (Plan B): an <svg> filling the HUD root, driven by
 * a rAF loop with ZERO React state per frame. Each tick reads the latest
 * frame ref, runs the pure computeOverlayLayout, and writes attributes
 * DIRECTLY via element refs (cx/cy/x1/y1/x2/y2/textContent + display
 * toggles). Draws: a teal reticle ring at the projected hit point (hidden
 * while the hit-test finds nothing), one filled dot per planted corner, a
 * solid edge between consecutive corners, and a dashed rubber band from the
 * last corner to the reticle with its live floor-plane length label. The
 * first-corner dot highlights when the world reticle is close enough to
 * close the room (shouldCloseRoom contract, world-space check).
 */
export function ArOverlay({ frameRef, corners, locale }: ArOverlayProps) {
  const reticleRef = useRef<SVGCircleElement | null>(null);
  const cornerRefs = useRef<Array<SVGCircleElement | null>>([]);
  const edgeRefs = useRef<Array<SVGLineElement | null>>([]);
  const bandRef = useRef<SVGLineElement | null>(null);
  const bandLabelRef = useRef<SVGTextElement | null>(null);
  // Refs the loop reads without re-subscribing: latest props per tick, so
  // the useEffect runs once (mount/unmount) and never tears down mid-session.
  const latest = useRef({ frameRef, corners, locale });
  latest.current = { frameRef, corners, locale };

  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const { frameRef: ref, corners: taps, locale: loc } = latest.current;
      const layout = computeOverlayLayout(ref.current, taps, loc);
      // Reticle ring.
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
      // Corner dots (rendered for every tapped corner; hidden when behind
      // the camera). The first dot highlights on close-loop: the flag is a
      // world-space check, so it fires even at the screen edge.
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
      // Edges between consecutive corners.
      const lines = edgeRefs.current;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === null || line === undefined) continue;
        const edge = layout.edges[i];
        if (edge === undefined) {
          line.style.display = "none";
          continue;
        }
        line.setAttribute("x1", String(edge.x1));
        line.setAttribute("y1", String(edge.y1));
        line.setAttribute("x2", String(edge.x2));
        line.setAttribute("y2", String(edge.y2));
        line.style.display = "";
      }
      // Rubber band + its live length label.
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

  return (
    <svg
      className="ar-overlay"
      aria-hidden="true"
      focusable="false"
      // Corners count changes only on taps (React state), never per frame:
      // the ref arrays are rebuilt on re-render, the rAF loop reads them.
      ref={() => {
        cornerRefs.current = corners.map(
          (_, i) => cornerRefs.current[i] ?? null,
        );
        edgeRefs.current =
          corners.length > 1
            ? corners
                .slice(0, -1)
                .map((_, i) => edgeRefs.current[i] ?? null)
            : [];
      }}
    >
      {corners.slice(0, -1).map((_, i) => (
        <line
          key={`e${i}`}
          className="ar-overlay-edge"
          ref={(el) => {
            edgeRefs.current[i] = el;
          }}
        />
      ))}
      {corners.map((_, i) => (
        <circle
          key={`c${i}`}
          className="ar-overlay-dot"
          r={8}
          ref={(el) => {
            cornerRefs.current[i] = el;
          }}
        />
      ))}
      <line
        className="ar-overlay-band"
        ref={(el) => {
          bandRef.current = el;
        }}
      />
      <text
        className="ar-overlay-label"
        ref={(el) => {
          bandLabelRef.current = el;
        }}
      />
      <circle
        className="ar-overlay-reticle"
        r={22}
        ref={(el) => {
          reticleRef.current = el;
        }}
      />
    </svg>
  );
}
