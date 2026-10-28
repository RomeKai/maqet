import { useMemo, useState } from "react";
import type { Scene, Wall } from "../scene/types";
import {
  allWallsMeasured,
  applySceneOp,
  isWallEstimated,
  wallDisplayLengthM,
  type SceneOp,
  type WallProvenance,
} from "../scene/store";
import { getStrings, type Locale } from "../i18n";
import { parseDimensionMeters } from "./image";
import type { IntakeProposalDimension } from "./api";

interface ScaleToolProps {
  locale: Locale;
  scene: Scene;
  dimensions: IntakeProposalDimension[];
  onChange: (scene: Scene, op: SceneOp) => void;
  onDone: (scene: Scene) => void;
  onCancel: () => void;
}

/** Locale-aware measure: "3.50 m" (en) / "3,50 m" (es-AR). */
export function formatMeasureM(locale: Locale, meters: number): string {
  const tag = locale === "es-AR" ? "es-AR" : "en-US";
  const grouped = new Intl.NumberFormat(tag, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(meters);
  return `${grouped} m`;
}

function wallLabel(index: number): string {
  return `W${index + 1}`;
}

function dimsForWall(
  dimensions: IntakeProposalDimension[],
  wallIndex: number,
): IntakeProposalDimension[] {
  return dimensions.filter((d) => d.wall_index === wallIndex);
}

/**
 * Per-wall measure check (P0, ADR-025 mode C): tap a wall, then confirm its
 * read measure or type the real length. Confirmed walls carry
 * `measured_length_m` + provenance in the Scene; estimated walls stay amber
 * dashed until the human confirms them. No pixel/scale wording in the UI.
 * Closing with every wall measured flips `scale_confirmed` (badge gating).
 */
export function ScaleTool({ locale, scene, dimensions, onChange, onDone, onCancel }: ScaleToolProps) {
  const t = getStrings(locale);
  const walls = useMemo(() => scene.walls ?? [], [scene.walls]);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => walls.find((w) => isWallEstimated(w))?.id ?? walls[0]?.id ?? null,
  );
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selectedIndex = walls.findIndex((w) => w.id === selectedId);
  const selected: Wall | null = selectedIndex >= 0 ? (walls[selectedIndex] as Wall) : null;
  const selectedDims = selectedIndex >= 0 ? dimsForWall(dimensions, selectedIndex) : [];
  const estimatedCount = walls.filter((w) => isWallEstimated(w)).length;

  function emit(op: SceneOp): Scene {
    const next = applySceneOp(scene, op);
    onChange(next, op);
    return next;
  }

  function confirmWall(lengthM: number, provenance: WallProvenance): void {
    if (selected === null) {
      setError(t["intake.scale.noWall"]);
      return;
    }
    setError(null);
    const next = emit({
      type: "setWallLength",
      wallId: selected.id,
      lengthM,
      provenance,
    });
    setTyped("");
    if (allWallsMeasured(next)) {
      onDone(applySceneOp(next, { type: "confirmScale" }));
    }
  }

  function handleTypedConfirm(): void {
    const meters = parseDimensionMeters(typed);
    if (meters === null || meters <= 0) {
      setError(t["intake.scale.invalid"]);
      return;
    }
    confirmWall(meters, "measured_tape");
  }

  function handleReadConfirm(dim: IntakeProposalDimension): void {
    const meters = parseDimensionMeters(dim.text);
    if (meters === null || meters <= 0) {
      setError(t["intake.scale.invalid"]);
      return;
    }
    confirmWall(meters, "written_on_sketch");
  }

  if (walls.length === 0) {
    return (
      <div className="intake-scale" role="dialog" aria-label={t["intake.scale.title"]}>
        <h2 className="intake-title">{t["intake.scale.title"]}</h2>
        <p className="intake-hint">{t["intake.scale.empty"]}</p>
        <button type="button" className="chip" onClick={onCancel}>
          {t["intake.scale.later"]}
        </button>
        <p className="preliminary">{t["notice.preliminary"]}</p>
      </div>
    );
  }

  return (
    <div className="intake-scale" role="dialog" aria-label={t["intake.scale.title"]}>
      <h2 className="intake-title">{t["intake.scale.title"]}</h2>
      <p className="intake-hint">{t["intake.scale.hint"]}</p>

      <div className="intake-walls" role="listbox" aria-label={t["intake.scale.pickWall"]}>
        {walls.map((wall, i) => {
          const estimated = isWallEstimated(wall);
          const fromSketch = wall.provenance === "written_on_sketch";
          const flagClass = estimated
            ? "wall-row-flag wall-row-flag-estimated"
            : "wall-row-flag";
          const flagText = estimated
            ? t["intake.scale.estimated"]
            : fromSketch
              ? t["intake.scale.fromSketch"]
              : t["intake.scale.measured"];
          return (
            <button
              key={wall.id}
              type="button"
              role="option"
              aria-selected={wall.id === selectedId}
              className={[
                "wall-row",
                wall.id === selectedId ? "wall-row-active" : "",
                estimated ? "wall-row-estimated" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => {
                setSelectedId(wall.id);
                setError(null);
                setTyped("");
              }}
            >
              <span className="wall-row-name">{wallLabel(i)}</span>
              <span className="wall-row-measure">{formatMeasureM(locale, wallDisplayLengthM(wall))}</span>
              <span className={flagClass}>
                {flagText}
              </span>
            </button>
          );
        })}
      </div>

      {selected !== null && selectedDims.length > 0 && (
        <div className="intake-dims">
          <p className="intake-hint">{t["intake.scale.readLength"]}</p>
          {selectedDims.map((dim, i) => (
            <button
              key={i}
              type="button"
              className="chip"
              onClick={() => handleReadConfirm(dim)}
            >
              {dim.text}
            </button>
          ))}
        </div>
      )}

      <label className="intake-label" htmlFor="wall-typed">
        {t["intake.scale.typedLength"]}
      </label>
      <input
        id="wall-typed"
        className="prompt"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={formatMeasureM(locale, 3.5)}
      />
      <button type="button" className="btn-primary" onClick={handleTypedConfirm}>
        {t["intake.scale.confirm"]}
      </button>

      {error !== null && (
        <p className="intake-error" role="alert">
          {error}
        </p>
      )}

      <div className="intake-scale-foot">
        <span className="intake-hint">
          {estimatedCount === 0 ? t["intake.scale.measured"] : `${estimatedCount} · ${t["intake.scale.estimated"]}`}
        </span>
        <button type="button" className="chip" onClick={onCancel}>
          {estimatedCount === 0 ? t["intake.scale.done"] : t["intake.scale.later"]}
        </button>
      </div>
      <p className="preliminary">{t["notice.preliminary"]}</p>
    </div>
  );
}
