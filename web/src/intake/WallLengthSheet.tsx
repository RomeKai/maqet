import { useState } from "react";
import type { Wall } from "../scene/types";
import type { SceneOp } from "../scene/store";
import { getStrings, type Locale } from "../i18n";
import { Banner, BottomSheet, Button } from "../ui";

interface Props {
  locale: Locale;
  wall: Wall;
  /** 1-based wall number shown in the title. */
  wallNumber: number;
  onSave: (op: SceneOp) => void;
  onClose: () => void;
}

/** Tapping a wall opens this sheet: one big numeric field, dispatches setWallLength. */
export function WallLengthSheet({ locale, wall, wallNumber, onSave, onClose }: Props): React.JSX.Element {
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
    <BottomSheet
      open
      onClose={onClose}
      title={t["intake.wallSheet.title"].replace("{n}", String(wallNumber))}
      closeLabel={t["ui.close"]}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            {t["intake.scale.later"]}
          </Button>
          <Button className="flex-[2]" onClick={handleSave}>
            {t["intake.scale.confirm"]}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 font-sans">
        <label className="block text-[15px] font-bold" htmlFor="wall-length-input">
          {t["intake.scale.typedLength"]}
        </label>
        <div className="flex items-center gap-2">
          <input
            id="wall-length-input"
            type="text"
            inputMode="decimal"
            className="min-h-16 w-full rounded-xl border-2 border-input bg-background px-4 font-mono text-3xl font-bold"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="3.50"
            data-autofocus
            autoFocus
          />
          <span className="text-xl font-bold text-muted-foreground">m</span>
        </div>
        {error && <Banner tone="danger" title={error} />}
      </div>
    </BottomSheet>
  );
}
