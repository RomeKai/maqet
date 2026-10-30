import { useState } from "react";
import type { Opening, Wall } from "../scene/types";
import { getStrings, type Locale } from "../i18n";
import { Banner, BottomSheet, Button } from "../ui";
import { editOpeningOps, type OpeningEdit } from "./openingEdit";
import type { SceneOp } from "../scene/store";

interface Props {
  locale: Locale;
  opening: Opening;
  wall: Wall;
  onSave: (ops: SceneOp[]) => void;
  onRemove: () => void;
  onClose: () => void;
}

function parse(value: string): number {
  return Number.parseFloat(value.replace(",", "."));
}

const FIELD =
  "min-h-16 w-full rounded-xl border-2 border-input bg-background px-4 font-mono text-3xl font-bold";

/** Tapping an opening in Select mode: width / height (/ sill) as big numeric inputs. */
export function OpeningSheet({ locale, opening, wall, onSave, onRemove, onClose }: Props): React.JSX.Element {
  const t = getStrings(locale);
  const isWindow = opening.kind === "window";
  const [width, setWidth] = useState(opening.width_m.toFixed(2));
  const [height, setHeight] = useState(opening.height_m.toFixed(2));
  const [sill, setSill] = useState((opening.sill_m ?? 0.8).toFixed(2));
  const [error, setError] = useState<string | null>(null);

  function handleSave(): void {
    const edit: OpeningEdit = { width: parse(width), height: parse(height), sill: isWindow ? parse(sill) : null };
    const wallLen = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    const bad =
      !(edit.width > 0) || !(edit.height > 0) || (isWindow && !(edit.sill !== null && edit.sill >= 0))
      || opening.offset_m + edit.width > wallLen + 0.12;
    if (bad) {
      setError(t["intake.scale.invalid"]);
      return;
    }
    onSave(editOpeningOps(opening, edit));
    onClose();
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void): React.JSX.Element => (
    <div>
      <label className="block text-[15px] font-bold" htmlFor={id}>{label}</label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          className={FIELD}
          value={value}
          onChange={(e) => set(e.target.value)}
        />
        <span className="text-xl font-bold text-muted-foreground">m</span>
      </div>
    </div>
  );

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={isWindow ? t["intake.openingSheet.window"] : t["intake.openingSheet.door"]}
      closeLabel={t["ui.close"]}
      footer={
        <div className="flex gap-2">
          <Button variant="danger" className="flex-1" onClick={() => { onRemove(); onClose(); }}>
            {t["intake.removeOpening"]}
          </Button>
          <Button className="flex-[2]" onClick={handleSave}>
            {t["intake.scale.confirm"]}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 font-sans">
        {field("opening-width-input", t["intake.openingSheet.width"], width, setWidth)}
        {field("opening-height-input", t["intake.openingSheet.height"], height, setHeight)}
        {isWindow && field("opening-sill-input", t["intake.openingSheet.sill"], sill, setSill)}
        {error && <Banner tone="danger" title={error} />}
      </div>
    </BottomSheet>
  );
}
