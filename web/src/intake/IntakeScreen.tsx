import { useEffect, useMemo, useRef, useState } from "react";
import type { Scene } from "../scene/types";
import { SceneHistory, createEmptyScene, type SceneOp } from "../scene/store";
import { getStrings, type Locale } from "../i18n";
import { UploadStep } from "./UploadStep";
import { cn } from "../ui";
import { ScaleBadge } from "./ScaleBadge";
import { CornerEditor } from "./CornerEditor";
import { weldOp } from "./weld";
import { captureStepFromScene, type CaptureStepKey } from "./captureSteps";
import { ScaleTool } from "./ScaleTool";
import { ArMeasure } from "../measure/ArMeasure";
import { mergeCaptureBeside } from "../measure/addToProject";
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
  /** The Scene as the sketch reading returned it: target of "Reset to sketch reading". */
  const readingRef = useRef<Scene | null>(null);
  const [photo, setPhoto] = useState<{ url: string | null; width: number; height: number } | null>(null);
  const [proposalDims, setProposalDims] = useState<IntakeProposalDimension[]>([]);
  const [proposal, setProposal] = useState<IntakeProposal | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [scaling, setScaling] = useState(false);
  /** idle -> (project already has walls) choose replace/add -> measure. AR always runs on its own empty Scene. */
  const hasWalls = (initialScene?.walls ?? []).length > 0;
  const [arPhase, setArPhase] = useState<"idle" | "choose" | "measure">(startInAr ? (hasWalls ? "choose" : "measure") : "idle");
  const [arMode, setArMode] = useState<"replace" | "add">("replace");
  const measuringAR = arPhase === "measure";
  const requestAr = (): void => setArPhase((scene.walls ?? []).length > 0 ? "choose" : "measure");
  // "Measure in AR" chosen from the method list while this screen is already mounted.
  useEffect(() => {
    if (startInAr && arPhase === "idle") setArPhase((history.scene.walls ?? []).length > 0 ? "choose" : "measure");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startInAr]);
  const [error, setError] = useState<string | null>(null);
  // Mode A entry before any photo (ADR-025): auto-detect WebXR immersive-ar
  // support on mount; the test seam overrides detection.
  const [arAvailable, setArAvailable] = useState<boolean>(arSupported ?? false);
  const [kindChips, setKindChips] = useState<IntakeKind>("plan");
  /** Mode A finished in this visit: show the hand-off card instead of the upload step. */
  const [arCaptured, setArCaptured] = useState(false);

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

  const arBase = useMemo(() => createEmptyScene(scene.id), [scene.id]);
  const scaleConfirmed = useMemo(() => scene.scale_confirmed === true, [scene]);

  function handleSceneDraft(draft: Scene, result: IntakeResult): void {
    history.reset(draft);
    // Close the corners the reading left almost-touching: one undoable op.
    const weld = weldOp(draft);
    const ready = weld === null ? draft : history.apply(weld);
    readingRef.current = ready;
    draft = ready;
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

  /** The photo object URL pins the image in memory: revoke it when replaced and on unmount. */
  const photoUrlRef = useRef<string | null>(null);
  useEffect(() => () => {
    if (photoUrlRef.current !== null) URL.revokeObjectURL(photoUrlRef.current);
  }, []);

  function handlePhoto(url: string | null, width: number, height: number): void {
    const previous = photoUrlRef.current;
    if (previous !== null && previous !== url && previous.startsWith("blob:")) URL.revokeObjectURL(previous);
    photoUrlRef.current = url;
    setPhoto({ url, width, height });
    onPhotoChange?.(true);
  }

  function handleResetToReading(): void {
    const reading = readingRef.current;
    if (reading === null) return;
    if (typeof window !== "undefined" && !window.confirm(t["intake.reset.confirm"])) return;
    const restored = { ...reading };
    history.restore(restored);
    setScene(restored);
    onSceneChange?.({ ...restored });
  }

  // Undo and Redo also tell the app: its 3D sheet and the saved project must follow the plan editor.
  function handleUndo(): void {
    const undone = { ...history.undo() };
    setScene(undone);
    onSceneChange?.({ ...undone });
  }

  function handleRedo(): void {
    const redone = { ...history.redo() };
    setScene(redone);
    onSceneChange?.({ ...redone });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 font-sans">
      {!hideScaleBadge && <ScaleBadge locale={locale} scene={scene} />}

      {arPhase === "choose" && (
        <section className="ar-choice" role="dialog" aria-label={t["measure.ar.choice.title"]}>
          <h2 className="intake-title">{t["measure.ar.choice.title"]}</h2>
          <p className="intake-hint">{t["measure.ar.choice.body"].replace("{n}", String((scene.walls ?? []).length))}</p>
          <div className="intake-scale-foot">
            <button type="button" className="btn-primary min-h-12" onClick={() => { setArMode("replace"); setArPhase("measure"); }}>
              {t["measure.ar.choice.replace"]}
            </button>
            <button type="button" className="chip min-h-12" onClick={() => { setArMode("add"); setArPhase("measure"); }}>
              {t["measure.ar.choice.add"]}
            </button>
            <button type="button" className="chip min-h-12" onClick={() => setArPhase("idle")}>
              {t["measure.ar.cancel"]}
            </button>
          </div>
          <p className="intake-hint">{t["measure.ar.choice.addNote"]}</p>
        </section>
      )}

      {photo === null && !measuringAR && arPhase !== "choose" && arCaptured && (
        <section className="ar-captured" aria-label={t["measure.ar.captured.title"]}>
          <h2 className="intake-title">{t["measure.ar.captured.title"]}</h2>
          <p className="intake-hint">
            {t["measure.ar.captured.body"].replace("{n}", String((scene.walls ?? []).length))}
          </p>
          <div className="intake-scale-foot">
            <button type="button" className="btn-primary" onClick={() => onLooksRight?.()}>
              {t["intake.looksRight"]}
            </button>
            <button type="button" className="chip" onClick={requestAr}>
              {t["measure.ar.captured.again"]}
            </button>
          </div>
        </section>
      )}

      {photo === null && !measuringAR && arPhase !== "choose" && !arCaptured && (
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
                onClick={requestAr}
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
            onRedo={handleRedo}
            canRedo={history.canRedo}
            warnings={warnings}
            onStepChange={onStepChange}
            onLooksRight={onLooksRight}
            initialStep={initialScene ? captureStepFromScene(initialScene) : "walls"}
            wallsExtras={
              <div className="flex flex-wrap justify-center gap-x-5 gap-y-1">
                {!scaleConfirmed && (
                  <button type="button" className="min-h-11 text-sm font-semibold text-muted-foreground underline" onClick={() => setScaling(true)}>
                    {t["intake.scale.cta"]}
                  </button>
                )}
                {!scaleConfirmed && (
                  <button type="button" className="min-h-11 text-sm font-semibold text-muted-foreground underline" onClick={requestAr}>
                    {t["measure.ar.title"]}
                  </button>
                )}
                <button type="button" className="min-h-11 text-sm font-semibold text-muted-foreground underline" onClick={handleResetToReading}>
                  {t["intake.reset.cta"]}
                </button>
              </div>
            }
          />
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
          scene={arBase}
          onChange={() => undefined}
          onDone={(captured) => {
            const gotWalls = (captured.walls ?? []).length > 0;
            if (gotWalls && arMode === "add" && (scene.walls ?? []).length > 0) {
              // Beside the existing plan, as one undoable step: never on top of it.
              const merged = history.apply(mergeCaptureBeside(scene, captured));
              setScene({ ...merged });
              onSceneChange?.({ ...merged });
            } else if (gotWalls) {
              history.reset(captured);
              setScene({ ...captured });
              onSceneChange?.({ ...captured });
            }
            setArPhase("idle");
            setArCaptured(gotWalls);
          }}
          onCancel={() => setArPhase("idle")}
          onSessionChange={onArSessionChange}
          onFallbackB={() => {
            setArPhase("idle");
            setScaling(false);
          }}
          onFallbackC={() => {
            setArPhase("idle");
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
