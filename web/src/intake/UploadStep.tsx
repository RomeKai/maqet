import { useRef, useState } from "react";
import { Camera, Images, LoaderCircle } from "lucide-react";
import { getStrings, type Locale } from "../i18n";
import { downscaleImage } from "./image";
import {
  postIntake,
  postSampleIntake,
  type IntakeKind,
  type IntakeProposal,
  type IntakeResult,
} from "./api";
import type { Scene } from "../scene/types";
import { Banner, Button, cn } from "../ui";
import { classifyUploadError, type UploadErrorKind } from "./uploadError";
import { runUpload, type UploadPhase } from "./uploadFlow";

export type { UploadPhase } from "./uploadFlow";

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
  const t = getStrings(locale);
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex gap-3 rounded-xl border-2 border-measured/40 bg-measured-soft p-3 text-foreground"
    >
      <LoaderCircle className="mt-0.5 size-6 shrink-0 animate-spin" aria-hidden />
      <div className="min-w-0">
        <p className="text-base font-bold leading-snug">{t["intake.reading.title"]}</p>
        <p className="text-[15px] leading-snug">{uploadBusyText(locale, phase)}</p>
        <p className="text-[15px] leading-snug text-muted-foreground">{t["intake.reading.body"]}</p>
      </div>
    </div>
  );
}

interface UploadStepProps {
  locale: Locale;
  kind?: IntakeKind;
  onPhaseChange?: (phase: UploadPhase) => void;
  onPhoto: (url: string | null, width: number, height: number) => void;
  onError: (message: string) => void;
  onScene?: (scene: Scene, result: IntakeResult) => void;
  onProposal?: (proposal: IntakeProposal) => void;
}

/** Recorded fixture replayed without upload or vision (I16, offline demo). */
const SAMPLE_NAME = "croquis_nonproportional";
/** The fixture above is a sketch: replay posts its true kind, not the toggle. */
const SAMPLE_KIND: IntakeKind = "sketch";

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
  const [failure, setFailure] = useState<UploadErrorKind | null>(null);
  const lastAttempt = useRef<{ file: File } | { sample: true } | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  function fail(message: string): void {
    setFailure(classifyUploadError(message));
    onError(message);
  }

  function retry(): void {
    const last = lastAttempt.current;
    setFailure(null);
    if (last === null) return;
    if ("sample" in last) void handleSample();
    else void handleFile(last.file);
  }

  function setUploadPhase(next: UploadPhase): void {
    setPhase(next);
    onPhaseChange?.(next);
  }

  async function handleSample(): Promise<void> {
    if (busy) return;
    lastAttempt.current = { sample: true };
    setFailure(null);
    setUploadPhase("reading");
    try {
      const result = await postSampleIntake(SAMPLE_KIND, SAMPLE_NAME);
      // No photo on the replay path: the editor renders the SVG draft on its
      // fallback canvas (imageUrl null), same onScene seeding as uploads.
      onPhoto(null, 0, 0);
      onProposal?.(result.proposal);
      onScene?.(result.scene, result);
    } catch (err) {
      fail(err instanceof Error ? err.message : t["intake.upload.error"]);
    } finally {
      setUploadPhase("idle");
    }
  }

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file || busy) return;
    lastAttempt.current = { file };
    setFailure(null);
    await runUpload(file, fixedKind ?? kind, {
      downscale: downscaleImage,
      post: postIntake,
      onPhase: setUploadPhase,
      onPhoto: (width, height, blob) => onPhoto(URL.createObjectURL(blob), width, height),
      onScene: (result) => {
        onProposal?.(result.proposal);
        onScene?.(result.scene, result);
      },
      onFailure: (errKind, message) => {
        setFailure(errKind);
        onError(message);
      },
    });
  }

  /** Take the file and clear the input so choosing the same photo again still fires change. */
  function onPicked(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = "";
    void handleFile(file);
  }

  return (
    <div className="flex flex-col gap-3 font-sans">
      <p className="text-[17px] font-bold leading-snug">{t["intake.upload.hint"]}</p>
      {failure !== null && (
        <Banner
          tone="danger"
          title={t[`intake.err.${failure}.title` as const]}
          action={
            <Button variant="secondary" onClick={retry}>
              {t["intake.retry"]}
            </Button>
          }
        >
          {t[`intake.err.${failure}.body` as const]}
        </Banner>
      )}
      {fixedKind === undefined && (
        <div className="flex gap-2" role="radiogroup" aria-label={t["intake.step.capture"]}>
          {(["plan", "sketch"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              className={cn(
                "min-h-12 flex-1 rounded-xl px-3 text-base font-bold",
                kind === value ? "bg-foreground text-background" : "border-2 border-border bg-card",
              )}
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
        className="sr-only"
        aria-label={t["intake.upload.cta"]}
        disabled={busy}
        onChange={(e) => onPicked(e.currentTarget)}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label={t["intake.upload.gallery"]}
        disabled={busy}
        onChange={(e) => onPicked(e.currentTarget)}
      />
      <Button className="min-h-14 text-[17px]" disabled={busy} onClick={() => inputRef.current?.click()}>
        <Camera className="size-6" aria-hidden /> {t["intake.upload.cta"]}
      </Button>
      <Button variant="secondary" disabled={busy} onClick={() => galleryRef.current?.click()}>
        <Images className="size-6" aria-hidden /> {t["intake.upload.gallery"]}
      </Button>
      <Button
        variant="ghost"
        disabled={busy}
        aria-label={t["intake.sample.label"]}
        onClick={() => void handleSample()}
      >
        {t["intake.sample.try"]}
      </Button>
      {busy && <UploadStatus locale={locale} phase={phase === "reading" ? "reading" : "preparing"} />}
      <p className="text-sm text-muted-foreground">{t["notice.preliminary"]}</p>
    </div>
  );
}
