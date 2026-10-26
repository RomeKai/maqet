import { useRef, useState } from "react";
import { getStrings, type Locale } from "../i18n";
import { downscaleImage } from "./image";

interface UploadStepProps {
  locale: Locale;
  onPhoto: (url: string, width: number, height: number) => void;
  onError: (message: string) => void;
}

/**
 * Capture step (P0): phone camera / file upload.
 * Client-side downscale to ≤ 2048 px + EXIF rotation fix before any upload.
 */
export function UploadStep({ locale, onPhoto, onError }: UploadStepProps) {
  const t = getStrings(locale);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setBusy(true);
    try {
      const image = await downscaleImage(file);
      onPhoto(URL.createObjectURL(image.blob), image.width, image.height);
    } catch (err) {
      onError(err instanceof Error ? err.message : t["intake.upload.error"]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="intake-upload">
      <p className="intake-hint">{t["intake.upload.hint"]}</p>
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
        {busy ? t["intake.upload.busy"] : t["intake.upload.cta"]}
      </button>
      <p className="preliminary">{t["notice.preliminary"]}</p>
    </div>
  );
}
