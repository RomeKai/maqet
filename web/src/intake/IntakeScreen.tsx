import { useEffect, useMemo, useState } from "react";
import type { Scene } from "../scene/types";
import { SceneHistory, createEmptyScene, type SceneOp } from "../scene/store";
import { getStrings, type Locale } from "../i18n";
import { UploadStep } from "./UploadStep";
import { Button, cn } from "../ui";
import { ScaleBadge } from "./ScaleBadge";
import { CornerEditor } from "./CornerEditor";
import { captureStepFromScene, type CaptureStepKey } from "./captureSteps";
import { ScaleTool } from "./ScaleTool";
import { ArMeasure } from "../measure/ArMeasure";
import { isARSupported } from "../measure/xrAdapter";
import type { IntakeKind, IntakeProposal, IntakeProposalDimension, IntakeResult } from "./api";

interface IntakeScreenProps {
  locale: Locale;
  initialScene?: Scene;
  /** Test seam: override the auto-detected WebXR immersive-ar support. */
  arSupported?: boolean;
  /** Open straight into AR measure (chosen from the method screen). */
  startInAr?: boolean;
  /** The app header already shows the scale badge; hide the in-screen copy. */
  hideScaleBadge?: boolean;
  onStepChange?: (step: CaptureStepKey) => void;
  onLooksRight?: () => void;
  onSceneChange?: (scene: Scene) => void;
  onPhotoChange?: (hasPhoto: boolean) => void;
  /** Fired when the AR session starts/ends (app hides/restores chrome). */
  onArSessionChange?: (active: boolean) => void;
}

/**
 * Intake screen (P0 Capture): upload -> correct corners -> check wall measures.
 * Edits go through SceneHistory (Scene ops + undo); the parent app owns the
 * confirmed Scene. Per-wall dims carry wall_index straight from the proposal
 * (ADR-025 mode C); the ScaleTool confirms each wall's measure.
 * Localized strings (demo default English), no prices, preliminary label.
 */
export function IntakeScreen({ locale, initialScene, arSupported, startInAr = false, hideScaleBadge = false, onStepChange, onLooksRight, onSceneChange, onPhotoChange, onArSessionChange }: IntakeScreenProps) {
  const t = getStrings(locale);
  const [history] = useState(() => new SceneHistory(initialScene ?? createEmptyScene()));
  const [scene, setScene] = useState<Scene>(history.scene);
  const [photo, setPhoto] = useState<{ url: string | null; width: number; height: number } | null>(null);
  const [proposalDims, setProposalDims] = useState<IntakeProposalDimension[]>([]);
  const [proposal, setProposal] = useState<IntakeProposal | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [scaling, setScaling] = useState(false);
  const [measuringAR, setMeasuringAR] = useState(startInAr);
  const [error, setError] = useState<string | null>(null);
  // Mode A entry before any photo (ADR-025): auto-detect WebXR immersive-ar
  // support on mount; the test seam overrides detection.
  const [arAvailable, setArAvailable] = useState<boolean>(arSupported ?? false);
  const [kindChips, setKindChips] = useState<IntakeKind>("plan");

  useEffect(() => {
    if (arSupported !== undefined) {
      setArAvailable(arSupported);
      return;
    }
    let cancelled = false;
    isARSupported().then((ok) => {
      if (!cancelled) setArAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [arSupported]);

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
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 font-sans">
      {!hideScaleBadge && <ScaleBadge locale={locale} scaleConfirmed={scaleConfirmed} />}

      {photo === null && !measuringAR && (
        <>
          <div className="flex gap-2" role="radiogroup" aria-label={t["intake.step.capture"]}>
            {(["plan", "sketch"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={kindChips === value}
                className={cn(
                  "min-h-12 flex-1 rounded-xl px-3 text-base font-bold",
                  kindChips === value ? "bg-foreground text-background" : "border-2 border-border bg-card",
                )}
                onClick={() => setKindChips(value)}
              >
                {value === "plan" ? t["intake.kind.plan"] : t["intake.kind.sketch"]}
              </button>
            ))}
            {arAvailable && (
              <button
                type="button"
                className="min-h-12 flex-1 rounded-xl border-2 border-foreground bg-card px-3 text-base font-bold"
                onClick={() => setMeasuringAR(true)}
              >
                {t["intake.capture.ar"]}
              </button>
            )}
          </div>
          <UploadStep
            locale={locale}
            kind={kindChips}
            onPhoto={(url, width, height) => handlePhoto(url, width, height)}
            onError={setError}
            onScene={handleSceneDraft}
          />
        </>
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
            warnings={warnings}
            onStepChange={onStepChange}
            onLooksRight={onLooksRight}
            initialStep={initialScene ? captureStepFromScene(initialScene) : "walls"}
          />
          {!scaleConfirmed && (
            <>
              <Button onClick={() => setScaling(true)}>{t["intake.scale.cta"]}</Button>
              <Button variant="secondary" onClick={() => setMeasuringAR(true)}>
                {t["measure.ar.title"]}
              </Button>
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
          onSessionChange={onArSessionChange}
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

      {error !== null && photo !== null && (
        <p className="intake-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
