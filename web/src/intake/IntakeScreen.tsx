import { useMemo, useState } from "react";
import type { Scene } from "../scene/types";
import { SceneHistory, createEmptyScene, type SceneOp } from "../scene/store";
import { getStrings, type Locale } from "../i18n";
import { UploadStep } from "./UploadStep";
import { CornerEditor } from "./CornerEditor";
import { ScaleTool, type ReadDimension } from "./ScaleTool";
import type { IntakeProposalDimension, IntakeResult } from "./api";

interface IntakeScreenProps {
  locale: Locale;
  initialScene?: Scene;
  readDimensions?: ReadDimension[];
}

/**
 * Intake screen (P0 Capture): upload -> correct corners -> confirm scale.
 * Edits go through SceneHistory (Scene ops + undo); the parent app owns the
 * confirmed Scene. Localized strings (demo default English), no prices, preliminary label.
 */
export function IntakeScreen({ locale, initialScene, readDimensions = [] }: IntakeScreenProps) {
  const t = getStrings(locale);
  const [history] = useState(() => new SceneHistory(initialScene ?? createEmptyScene()));
  const [scene, setScene] = useState<Scene>(history.scene);
  const [photo, setPhoto] = useState<{ url: string; width: number; height: number } | null>(null);
  const [proposalDims, setProposalDims] = useState<IntakeProposalDimension[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [scaling, setScaling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scaleConfirmed = useMemo(() => scene.scale_confirmed === true, [scene]);

  // Vision dims are normalized (0..1, y-down); ScaleTool needs pixel spans,
  // resolved against the uploaded photo size once both have arrived.
  const proposalReadDims = useMemo<ReadDimension[]>(() => {
    if (photo === null || proposalDims.length === 0) return [];
    return proposalDims.map((d) => ({
      text: d.text,
      spanPx: Math.hypot(
        (d.b[0] - d.a[0]) * photo.width,
        (d.b[1] - d.a[1]) * photo.height,
      ),
    }));
  }, [photo, proposalDims]);

  const effectiveDims = useMemo(
    () => [...readDimensions, ...proposalReadDims],
    [readDimensions, proposalReadDims],
  );

  function handleSceneDraft(draft: Scene, result: IntakeResult): void {
    history.reset(draft);
    setScene({ ...draft });
    setProposalDims(result.proposal.dimensions);
    setWarnings(result.warnings);
    setError(null);
  }

  function handleChange(next: Scene, _op: SceneOp): void {
    history.apply(_op);
    setScene(next);
    setError(null);
  }

  function handleUndo(): void {
    setScene({ ...history.undo() });
  }

  return (
    <div className="intake">
      <div className="intake-head">
        <span className={scaleConfirmed ? "badge badge-measured" : "badge badge-notoscale"}>
          {scaleConfirmed ? t["badge.measured"] : t["badge.notToScale"]}
        </span>
        <span className="intake-step">{t["intake.step.capture"]}</span>
      </div>

      {warnings.length > 0 && (
        <ul className="intake-warnings" aria-label={t["intake.warnings.title"]}>
          {warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      )}

      {photo === null && (
        <UploadStep
          locale={locale}
          onPhoto={(url, width, height) => setPhoto({ url, width, height })}
          onError={setError}
          onScene={handleSceneDraft}
        />
      )}

      {photo !== null && !scaling && (
        <>
          <CornerEditor
            locale={locale}
            scene={scene}
            imageUrl={photo.url}
            imageWidth={photo.width}
            imageHeight={photo.height}
            onChange={handleChange}
            onUndo={handleUndo}
            canUndo={history.canUndo}
          />
          {!scaleConfirmed && (
            <button type="button" className="btn-primary" onClick={() => setScaling(true)}>
              {t["intake.scale.cta"]}
            </button>
          )}
        </>
      )}

      {scaling && (
        <ScaleTool
          locale={locale}
          scene={scene}
          readDimensions={effectiveDims}
          onConfirm={(next) => {
            setScene(next);
            setScaling(false);
          }}
          onCancel={() => setScaling(false)}
        />
      )}

      {error !== null && (
        <p className="intake-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
