import { useState } from "react";
import type { Wall } from "../scene/types";
import type { SceneOp } from "../scene/store";
import { getStrings, type Locale } from "../i18n";

interface Props {
  locale: Locale;
  wall: Wall;
  onSave: (op: SceneOp) => void;
  onClose: () => void;
}

export function WallLengthSheet({ locale, wall, onSave, onClose }: Props): React.JSX.Element {
  const t = getStrings(locale);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSave(): void {
    const meters = Number.parseFloat(value.replace(",", "."));
    if (!Number.isFinite(meters) || meters <= 0) {
      setError(t["intake.scale.invalid"]);
      return;
    }
    onSave({ type: "setWallLength", wallId: wall.id, lengthM: meters, provenance: "measured_tape" });
    onClose();
  }

  return (
    <div className="wall-length-sheet" role="dialog" aria-label={t["intake.scale.typedLength"]}>
      <h3 className="wall-length-title">{t["intake.scale.typedLength"]}</h3>
      <input
        type="text"
        inputMode="decimal"
        className="wall-length-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="3.50"
        autoFocus
      />
      {error && (
        <p className="capture-error-banner" role="alert">
          {error}
        </p>
      )}
      <div className="wall-length-actions">
        <button type="button" className="btn-primary" onClick={handleSave}>
          {t["intake.scale.confirm"]}
        </button>
        <button type="button" className="chip" onClick={onClose}>
          {t["intake.scale.later"]}
        </button>
      </div>
    </div>
  );
}
