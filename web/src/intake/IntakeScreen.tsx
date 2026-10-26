import { useMemo, useState } from "react";
import type { Scene } from "../scene/types";
import { SceneHistory, createEmptyScene, type SceneOp } from "../scene/store";
import { getStrings, type Locale } from "../i18n";
import { UploadStep } from "./UploadStep";
import { CornerEditor } from "./CornerEditor";
import { ScaleTool, type ReadDimension } from "./ScaleTool";

interface IntakeScreenProps {
  locale: Locale;
  initialScene?: Scene;
  readDimensions?: ReadDimension[];
}

/**
 * Intake screen (P0 Capture): upload -> correct corners -> confirm scale.
 * Edits go through SceneHistory (Scene ops + undo); the parent app owns the
 * confirmed Scene. Spanish-first strings, no prices, preliminary label.
 */
export function IntakeScreen({ locale, initialScene, readDimensions = [] }: IntakeScreenProps) {
  const t = getStrings(locale);
  const [history] = useState(() => new SceneHistory(initialScene ?? createEmptyScene()));
  const [scene, setScene] = useState<Scene>(history.scene);
  const [photo, setPhoto] = useState<{ url: string; width: number; height: number } | null>(null);
  const [scaling, setScaling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scaleConfirmed = useMemo(() => scene.scale_confirmed === true, [scene]);

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

      {photo === null && (
        <UploadStep
          locale={locale}
          onPhoto={(url, width, height) => setPhoto({ url, width, height })}
          onError={setError}
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
          readDimensions={readDimensions}
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
