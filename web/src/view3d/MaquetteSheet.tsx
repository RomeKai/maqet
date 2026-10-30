import { useCallback, useRef, useState } from "react";
import type { Scene } from "../scene/types";
import { getStrings, type Locale } from "../i18n";
import { SceneView } from "./SceneView";
import "./maquette.css";

interface MaquetteSheetProps {
  scene: Scene;
  locale: Locale;
  selectedWallId?: string | null;
  onSelectWall?: (wallId: string) => void;
  initialExpanded?: boolean;
}

/** Vertical travel (px) below which a handle release counts as a tap. */
export const SHEET_DRAG_SLOP_PX = 10;

/**
 * Decide the sheet state from one drag gesture. Positive dy = finger moved
 * down (collapse), negative = up (expand). Returns null when the travel is
 * within the slop so the caller treats it as a tap toggle instead.
 */
export function resolveSheetDrag(dyPx: number, slopPx = SHEET_DRAG_SLOP_PX): boolean | null {
  if (Math.abs(dyPx) <= slopPx) return null;
  return dyPx < 0;
}

/**
 * Phone-first 3D maquette as a two-state bottom sheet (mobile-ui):
 * expanded (~60% of the screen) or collapsed (handle + 3D label, canvas
 * unmounted so the plan editor owns the full screen). Drag the handle or tap
 * it to toggle. CSS drives the states via `data-state` on the wrapper.
 */
export function MaquetteSheet({
  scene,
  locale,
  selectedWallId = null,
  onSelectWall,
  initialExpanded = true,
}: MaquetteSheetProps): React.JSX.Element {
  const t = getStrings(locale);
  const [expanded, setExpanded] = useState(initialExpanded);
  const startY = useRef<number | null>(null);
  // Pointer-up already handled the gesture: swallow the click that follows
  // it (pointer and click both fire; keyboard clicks only fire click).
  const skipClick = useRef(false);

  const onPointerUp = useCallback((clientY: number) => {
    if (startY.current === null) return;
    const dy = clientY - startY.current;
    startY.current = null;
    skipClick.current = true;
    const decided = resolveSheetDrag(dy);
    if (decided === null) setExpanded((prev) => !prev);
    else setExpanded(decided);
  }, []);

  const onActivate = useCallback(() => {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    setExpanded((prev) => !prev);
  }, []);

  return (
    <div
      className="maquette-sheet"
      data-state={expanded ? "expanded" : "collapsed"}
      data-empty={scene.walls?.length ? "no" : "yes"}
    >
      <button
        type="button"
        className="maquette-handle"
        aria-expanded={expanded}
        aria-label={expanded ? t["maquette.collapse"] : t["maquette.expand"]}
        onPointerDown={(e) => {
          startY.current = e.clientY;
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerUp={(e) => {
          (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
          onPointerUp(e.clientY);
        }}
        onPointerCancel={(e) => {
          startY.current = null;
          (e.currentTarget as HTMLElement).releasePointerCapture?.((e as unknown as { pointerId: number }).pointerId);
        }}
        onClick={onActivate}
      >
        <span className="maquette-grip" aria-hidden="true" />
        <span className="maquette-label">3D</span>
      </button>
      {expanded && (
        <div className="maquette-canvas">
          <SceneView scene={scene} selectedWallId={selectedWallId} onSelectWall={onSelectWall} />
        </div>
      )}
    </div>
  );
}
