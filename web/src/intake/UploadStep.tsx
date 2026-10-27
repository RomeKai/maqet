import { useRef, useState } from "react";
import { getStrings, type Locale } from "../i18n";
import { downscaleImage } from "./image";
import { postIntake, type IntakeKind, type IntakeProposal, type IntakeResult } from "./api";
import type { Scene } from "../scene/types";

export type UploadPhase = "idle" | "preparing" | "reading";

/** Staged busy label: downscale ("preparing") vs Spark POST ("reading"). */
export function uploadBusyText(locale: Locale, phase: Exclude<UploadPhase, "idle">): string {
  const t = getStrings(locale);
  return phase === "reading" ? t["intake.upload.reading"] : t["intake.upload.busy"];
}

/** Announced busy line while the plan photo is downscaled + uploaded. */
export function UploadStatus({
  locale,
  phase,
}: {
  locale: Locale;
  phase: Exclude<UploadPhase, "idle">;
}) {
  return (
    <p className="intake-status" role="status" aria-live="polite">
      {uploadBusyText(locale, phase)}
    </p>
  );
}

interface UploadStepProps {
  locale: Locale;
  kind?: IntakeKind;
  onPhaseChange?: (phase: UploadPhase) => void;
  onPhoto: (url: string, width: number, height: number) => void;
  onError: (message: string) => void;
  onScene?: (scene: Scene, result: IntakeResult) => void;
  onProposal?: (proposal: IntakeProposal) => void;
}

/**
 * Capture step (P0): phone camera / file upload.
 * Client-side downscale to ≤ 2048 px + EXIF rotation fix, then POST to
 * /intake (multipart file + kind) for the Scene draft.
 * onPhoto keeps the local preview; onScene seeds SceneHistory with the
 * server draft. Both stay optional for backward compatibility.
 */
export function UploadStep({
  locale,
  kind: fixedKind,
  onPhaseChange,
  onPhoto,
  onError,
  onScene,
  onProposal,
}: UploadStepProps) {
  const t = getStrings(locale);
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const busy = phase !== "idle";
  const [kind, setKind] = useState<IntakeKind>(fixedKind ?? "plan");

  function setUploadPhase(next: UploadPhase): void {
    setPhase(next);
    onPhaseChange?.(next);
  }

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file || busy) return;
    setUploadPhase("preparing");
    try {
      const image = await downscaleImage(file);
      setUploadPhase("reading");
      let result: IntakeResult;
      try {
        result = await postIntake(image.blob, fixedKind ?? kind);
      } catch (err) {
        onError(err instanceof Error ? err.message : t["intake.upload.error"]);
        return;
      }
      // Advance only after POST succeeds: a failed upload keeps UploadStep
      // mounted with its busy/error state visible.
      onPhoto(URL.createObjectURL(image.blob), image.width, image.height);
      onProposal?.(result.proposal);
      onScene?.(result.scene, result);
    } catch (err) {
      onError(err instanceof Error ? err.message : t["intake.upload.error"]);
    } finally {
      setUploadPhase("idle");
    }
  }

  return (
    <div className="intake-upload">
      <p className="intake-hint">{t["intake.upload.hint"]}</p>
      {fixedKind === undefined && (
        <div className="intake-kind" role="radiogroup" aria-label={t["intake.step.capture"]}>
          {(["plan", "sketch"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              className={kind === value ? "chip chip-active" : "chip"}
              disabled={busy}
              onClick={() => setKind(value)}
            >
              {value === "plan" ? t["intake.kind.plan"] : t["intake.kind.sketch"]}
            </button>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="intake-file"
        aria-label={t["intake.upload.cta"]}
        disabled={busy}
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <button
        type="button"
        className="btn-primary"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {t["intake.upload.cta"]}
      </button>
      {busy && <UploadStatus locale={locale} phase={phase === "reading" ? "reading" : "preparing"} />}
      <p className="preliminary">{t["notice.preliminary"]}</p>
    </div>
  );
}
