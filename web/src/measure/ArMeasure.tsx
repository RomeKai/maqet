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
import { pairCornersToWallUpdate, type Vec3 } from "./cornerMath";
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

  useEffect(() => {
    if (adapter) {
      adapter.start({
        onTapCorner: (corner) => appendCorner(corner, target?.id),
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

  function appendCorner(corner: Vec3, targetId: string | undefined): void {
    if (targetId === undefined) return;
    const paired = [...cornersRef.current, corner].slice(-2);
    setCorners(paired);
    if (paired.length === 2) {
      const update = pairCornersToWallUpdate(
        [paired[0] as Vec3, paired[1] as Vec3],
        targetId,
      );
      setPreviewM(update?.lengthM ?? null);
    }
  }

  if (target === null) {
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
    // P0 stand-in until device hit-test lands: the second tap sits 1 m from
    // the first. The length math is fully tested in cornerMath.
    const next: Vec3 =
      corners.length === 0 ? [0, 0, 0] : [corners[0][0] + 1, corners[0][1], 0];
    appendCorner(next, target.id);
  }

  function handleConfirm(): void {
    if (previewM === null) return;
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
          : formatMeasureM(locale, wallDisplayLengthM(target))}
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
        disabled={corners.length >= 2}
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
