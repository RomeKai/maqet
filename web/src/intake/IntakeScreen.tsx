import { useMemo, useState } from "react";
import type { Scene } from "../scene/types";
import { SceneHistory, createEmptyScene, type SceneOp } from "../scene/store";
import { getStrings, type Locale } from "../i18n";
import { UploadStep } from "./UploadStep";
import { CornerEditor } from "./CornerEditor";
import { ScaleTool } from "./ScaleTool";
import { ArMeasure } from "../measure/ArMeasure";
import type { IntakeProposal, IntakeProposalDimension, IntakeResult } from "./api";

interface IntakeScreenProps {
  locale: Locale;
  initialScene?: Scene;
  onSceneChange?: (scene: Scene) => void;
  onPhotoChange?: (hasPhoto: boolean) => void;
}

/**
 * Intake screen (P0 Capture): upload -> correct corners -> check wall measures.
 * Edits go through SceneHistory (Scene ops + undo); the parent app owns the
 * confirmed Scene. Per-wall dims carry wall_index straight from the proposal
 * (ADR-025 mode C); the ScaleTool confirms each wall's measure.
 * Localized strings (demo default English), no prices, preliminary label.
 */
export function IntakeScreen({ locale, initialScene, onSceneChange, onPhotoChange }: IntakeScreenProps) {
  const t = getStrings(locale);
  const [history] = useState(() => new SceneHistory(initialScene ?? createEmptyScene()));
  const [scene, setScene] = useState<Scene>(history.scene);
  const [photo, setPhoto] = useState<{ url: string | null; width: number; height: number } | null>(null);
  const [proposalDims, setProposalDims] = useState<IntakeProposalDimension[]>([]);
  const [proposal, setProposal] = useState<IntakeProposal | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [scaling, setScaling] = useState(false);
  const [measuringAR, setMeasuringAR] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scaleConfirmed = useMemo(() => scene.scale_confirmed === true, [scene]);

  function handleSceneDraft(draft: Scene, result: IntakeResult): void {
    history.reset(draft);
    setScene({ ...draft });
    setProposalDims(result.proposal.dimensions);
    setProposal(result.proposal);
    setWarnings(result.warnings);
    setError(null);
    onSceneChange?.({ ...draft });
  }

  function handleChange(next: Scene, _op: SceneOp): void {
    history.apply(_op);
    setScene(next);
    setError(null);
    onSceneChange?.({ ...next });
  }

  function handlePhoto(url: string | null, width: number, height: number): void {
    setPhoto({ url, width, height });
    onPhotoChange?.(true);
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
          onPhoto={(url, width, height) => handlePhoto(url, width, height)}
          onError={setError}
          onScene={handleSceneDraft}
        />
      )}

      {photo !== null && !scaling && (
        <>
          <CornerEditor
            locale={locale}
            scene={scene}
            proposal={proposal}
            imageUrl={photo.url}
            imageWidth={photo.width}
            imageHeight={photo.height}
            onChange={handleChange}
            onUndo={handleUndo}
            canUndo={history.canUndo}
          />
          {!scaleConfirmed && (
            <>
              <button type="button" className="btn-primary" onClick={() => setScaling(true)}>
                {t["intake.scale.cta"]}
              </button>
              <button type="button" className="chip" onClick={() => setMeasuringAR(true)}>
                {t["measure.ar.title"]}
              </button>
            </>
          )}
        </>
      )}

      {scaling && (
        <ScaleTool
          locale={locale}
          scene={scene}
          dimensions={proposalDims}
          onChange={handleChange}
          onDone={(next) => {
            setScene(next);
            onSceneChange?.({ ...next });
            setScaling(false);
          }}
          onCancel={() => setScaling(false)}
        />
      )}

      {measuringAR && (
        <ArMeasure
          locale={locale}
          scene={scene}
          onChange={handleChange}
          onDone={(next) => {
            setScene(next);
            onSceneChange?.({ ...next });
            setMeasuringAR(false);
          }}
          onCancel={() => setMeasuringAR(false)}
          onFallbackB={() => {
            setMeasuringAR(false);
            setScaling(false);
          }}
          onFallbackC={() => {
            setMeasuringAR(false);
            setScaling(true);
          }}
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
