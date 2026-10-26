import { useState } from "react";
import type { Scene } from "../scene/types";
import { applySceneOp } from "../scene/store";
import { getStrings, type Locale } from "../i18n";
import { metersPerPixel, parseDimensionMeters } from "./image";

export interface ReadDimension {
  text: string;
  spanPx: number;
}

interface ScaleToolProps {
  locale: Locale;
  scene: Scene;
  readDimensions: ReadDimension[];
  onConfirm: (scene: Scene) => void;
  onCancel: () => void;
}

/**
 * Scale confirmation (P0): two-taps + typed length ("3,50 m") OR pick one
 * read dimension transcribed by vision. px->m = typed / pixel_len.
 * On confirm, rescales the Scene and sets scale_confirmed=true.
 */
export function ScaleTool({ locale, scene, readDimensions, onConfirm, onCancel }: ScaleToolProps) {
  const t = getStrings(locale);
  const [tapPx, setTapPx] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  function pixelLength(): number | null {
    const px = Number(tapPx.replace(",", "."));
    return Number.isFinite(px) && px > 0 ? px : null;
  }

  function confirmFromInputs(pixelLen: number, meters: number | null): void {
    if (meters === null) {
      setError(t["intake.scale.invalid"]);
      return;
    }
    const mPerPx = metersPerPixel(meters, pixelLen);
    if (mPerPx === null) {
      setError(t["intake.scale.invalid"]);
      return;
    }
    // Scene drawn in image px; bring to meters with one rescale.
    const scaled = applySceneOp(scene, { type: "rescale", ratio: mPerPx });
    onConfirm(applySceneOp(scaled, { type: "confirmScale" }));
  }

  function handleTypedConfirm(): void {
    setError(null);
    const pixelLen = pixelLength();
    if (pixelLen === null) {
      setError(t["intake.scale.invalid"]);
      return;
    }
    confirmFromInputs(pixelLen, parseDimensionMeters(typed));
  }

  function handlePickDimension(dim: ReadDimension): void {
    setError(null);
    confirmFromInputs(dim.spanPx, parseDimensionMeters(dim.text));
  }

  return (
    <div className="intake-scale" role="dialog" aria-label={t["intake.scale.title"]}>
      <h2 className="intake-title">{t["intake.scale.title"]}</h2>
      <p className="intake-hint">{t["intake.scale.hint"]}</p>

      <label className="intake-label" htmlFor="scale-px">
        {t["intake.scale.pixelLength"]}
      </label>
      <input
        id="scale-px"
        className="prompt"
        type="text"
        inputMode="decimal"
        value={tapPx}
        onChange={(e) => setTapPx(e.target.value)}
        placeholder="240"
      />

      <label className="intake-label" htmlFor="scale-typed">
        {t["intake.scale.typedLength"]}
      </label>
      <input
        id="scale-typed"
        className="prompt"
        type="text"
        inputMode="decimal"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder="3,50 m"
      />
      <button type="button" className="btn-primary" onClick={handleTypedConfirm}>
        {t["intake.scale.confirm"]}
      </button>

      {readDimensions.length > 0 && (
        <div className="intake-dims">
          <p className="intake-hint">{t["intake.scale.orPick"]}</p>
          {readDimensions.map((dim, i) => (
            <button
              key={i}
              type="button"
              className="chip"
              onClick={() => handlePickDimension(dim)}
            >
              {dim.text}
            </button>
          ))}
        </div>
      )}

      {error !== null && (
        <p className="intake-error" role="alert">
          {error}
        </p>
      )}

      <button type="button" className="chip" onClick={onCancel}>
        {t["intake.scale.later"]}
      </button>
      <p className="preliminary">{t["notice.preliminary"]}</p>
    </div>
  );
}
