import { useEffect, useRef, useState } from "react";
import type { Scene } from "../scene/types";
import {
  allWallsMeasured,
  applySceneOp,
  wallDisplayLengthM,
  type SceneOp,
} from "../scene/store";
import { getStrings, type Locale } from "../i18n";
import { formatMeasureM } from "../intake/ScaleTool";
import {
  emptyCornerTrace,
  traceCornerTap,
  pairCornersToWallUpdate,
  type CornerTrace,
  type Vec3,
} from "./cornerMath";
import {
  isARSupported,
  type XrHitTestAdapter,
} from "./xrAdapter";

interface ArMeasureProps {
  locale: Locale;
  scene: Scene;
  /** Wall under measure; defaults to the first wall needing a measure. */
  wallId?: string;
  /** Adapter seam (fake in tests, WebXR in production). */
  adapter?: XrHitTestAdapter;
  onChange: (scene: Scene, op: SceneOp) => void;
  onDone: (scene: Scene) => void;
  onCancel: () => void;
  /** Fallback actions: B = room photo + tapped lengths, C = sketch measures. */
  onFallbackB?: () => void;
  onFallbackC?: () => void;
}

/**
 * Mode A AR measure (P0, ADR-025): tap two corners, preview the length,
 * confirm to emit a `setWallLength` op with `measured_ar` provenance.
 * Feature-detects WebXR on mount; unsupported devices get the fallback with
 * the B/C capture modes. Bottom-sheet style, tap targets >= 44px,
 * safe-area aware, preliminary label.
 */
export function ArMeasure({
  locale,
  scene,
  wallId,
  adapter,
  onChange,
  onDone,
  onCancel,
  onFallbackB,
  onFallbackC,
}: ArMeasureProps) {
  const t = getStrings(locale);
  const walls = scene.walls ?? [];
  const target =
    walls.find((w) => w.id === wallId) ??
    walls.find((w) => w.provenance === undefined || w.provenance === "estimated") ??
    walls[0] ??
    null;

  const [support, setSupport] = useState<"checking" | "ar" | "fallback">(
    adapter ? "ar" : "checking",
  );
  const [corners, setCorners] = useState<Vec3[]>([]);
  const [previewM, setPreviewM] = useState<number | null>(null);
  const cornersRef = useRef<Vec3[]>([]);
  cornersRef.current = corners;
  // Adapter taps arrive through the mount-time subscription: keep a ref to
  // the latest scene so each tap emits its addWall onto current walls.
  const sceneRef = useRef<Scene>(scene);
  sceneRef.current = scene;

  // Empty scene (no photo yet, ADR-025 Mode A entry): trace walls corner by
  // corner with stable incremental ids (wall-1, wall-2, ...). Each new tap
  // emits the wall ending at it from the previous corner immediately via
  // onChange + applySceneOp addWall; a tap within CLOSE_ROOM_M of the
  // first corner closes the loop.
  const isEmptyStart = target === null;
  const traceRef = useRef<CornerTrace>(emptyCornerTrace());

  useEffect(() => {
    if (adapter) {
      adapter.start({
        onTapCorner: (corner) => appendCorner(corner, target?.id ?? null),
        onEnd: () => undefined,
      });
      return () => adapter.end();
    }
    let cancelled = false;
    isARSupported().then((ok) => {
      if (!cancelled) setSupport(ok ? "ar" : "fallback");
    });
    return () => {
      cancelled = true;
    };
    // Mount-only: adapter and target are construction-time inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function appendCorner(corner: Vec3, targetId: string | null): void {
    if (targetId === null && !isEmptyStart) return;
    if (isEmptyStart) {
      // Each new tap completes one wall (the segment ending at it), emitted
      // immediately so the 3D view grows corner by corner. Preview shows the
      // length of the wall just completed.
      const nextTrace = traceCornerTap(
        traceRef.current,
        corner,
        (sceneRef.current.walls ?? []).length,
      );
      traceRef.current = nextTrace;
      setCorners(nextTrace.corners);
      const wall = nextTrace.lastWall;
      setPreviewM(wall?.measured_length_m ?? null);
      if (wall !== null) {
        const op: SceneOp = { type: "addWall", wall };
        onChange(applySceneOp(sceneRef.current, op), op);
      }
      return;
    }
    const next = [...cornersRef.current, corner];
    setCorners(next);
    if (next.length === 2 && targetId !== null) {
      const update = pairCornersToWallUpdate(
        [next[0] as Vec3, next[1] as Vec3],
        targetId,
      );
      setPreviewM(update?.lengthM ?? null);
    }
  }

  if (target === null && !isEmptyStart) {
    return (
      <div className="ar-measure" role="dialog" aria-label={t["measure.ar.title"]}>
        <h2 className="intake-title">{t["measure.ar.title"]}</h2>
        <p className="intake-hint">{t["intake.scale.empty"]}</p>
        <button type="button" className="chip" onClick={onCancel}>
          {t["measure.ar.cancel"]}
        </button>
        <p className="preliminary">{t["notice.preliminary"]}</p>
      </div>
    );
  }

  function handleTapCorner(): void {
    // P0 stand-in until device hit-test lands: taps march around a 1 m
    // square so the chained path (wall-1..wall-4) is tappable by hand.
    // The length math is fully tested in cornerMath.
    const square: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, -1],
      [0, 0, -1],
    ];
    const next: Vec3 = square[corners.length] ?? square[0]!;
    appendCorner(next, isEmptyStart ? null : (target as { id: string }).id);
  }

  function handleConfirm(): void {
    if (previewM === null) return;
    if (isEmptyStart) {
      // Walls were already emitted per tap; confirm just clears the trace so
      // the technician can start the next room from a clean state.
      traceRef.current = emptyCornerTrace();
      setCorners([]);
      setPreviewM(null);
      return;
    }
    if (target === null) return;
    const op: SceneOp = {
      type: "setWallLength",
      wallId: target.id,
      lengthM: previewM,
      provenance: "measured_ar",
    };
    const next = applySceneOp(scene, op);
    onChange(next, op);
    setCorners([]);
    setPreviewM(null);
    if (allWallsMeasured(next)) {
      onDone(applySceneOp(next, { type: "confirmScale" }));
    }
  }

  function handleReset(): void {
    traceRef.current = emptyCornerTrace();
    setCorners([]);
    setPreviewM(null);
  }

  if (support === "fallback") {
    return (
      <div className="ar-measure" role="dialog" aria-label={t["measure.ar.unsupported"]}>
        <h2 className="intake-title">{t["measure.ar.unsupported"]}</h2>
        <p className="intake-hint">{t["measure.ar.fallback"]}</p>
        <div className="intake-scale-foot">
          {onFallbackB && (
            <button type="button" className="chip" onClick={onFallbackB}>
              {t["intake.kind.plan"]}
            </button>
          )}
          {onFallbackC && (
            <button type="button" className="chip" onClick={onFallbackC}>
              {t["intake.kind.sketch"]}
            </button>
          )}
          <button type="button" className="chip" onClick={onCancel}>
            {t["measure.ar.cancel"]}
          </button>
        </div>
        <p className="preliminary">{t["notice.preliminary"]}</p>
      </div>
    );
  }

  const stepLabel =
    corners.length === 0 ? t["measure.ar.tapFirst"] : t["measure.ar.tapSecond"];

  return (
    <div className="ar-measure" role="dialog" aria-label={t["measure.ar.title"]}>
      <h2 className="intake-title">{t["measure.ar.title"]}</h2>
      <p className="intake-hint">{t["measure.ar.hint"]}</p>
      <p className="intake-hint">{stepLabel}</p>

      <span className="wall-row-measure">
        {previewM !== null
          ? formatMeasureM(locale, previewM)
          : target !== null
            ? formatMeasureM(locale, wallDisplayLengthM(target))
            : formatMeasureM(locale, 0)}
      </span>
      {previewM === null && (
        <span className="wall-row-flag wall-row-flag-estimated">
          {t["intake.scale.estimated"]}
        </span>
      )}

      <button
        type="button"
        className="btn-primary ar-tap"
        onClick={handleTapCorner}
        disabled={isEmptyStart ? traceRef.current.closed : corners.length >= 2}
      >
        {stepLabel}
      </button>

      {previewM !== null && (
        <div className="intake-scale-foot">
          <button type="button" className="btn-primary" onClick={handleConfirm}>
            {t["measure.ar.confirm"]}
          </button>
          <button type="button" className="chip" onClick={handleReset}>
            {t["intake.undo"]}
          </button>
        </div>
      )}

      <div className="intake-scale-foot">
        <button type="button" className="chip" onClick={onCancel}>
          {t["measure.ar.cancel"]}
        </button>
      </div>
      <p className="preliminary">{t["notice.preliminary"]}</p>
    </div>
  );
}
