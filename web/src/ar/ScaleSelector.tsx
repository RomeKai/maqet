import type { Locale } from "../i18n";
import { getArStrings } from "./ar.i18n";

/** Maquette scale denominators offered on Present (real-size walk-in is P1). */
export const MAQUETTE_SCALES = [100, 50, 20] as const;
export type MaquetteScale = (typeof MAQUETTE_SCALES)[number];
export const DEFAULT_SCALE_DENOMINATOR: MaquetteScale = 50;

interface ScaleSelectorProps {
  value: MaquetteScale;
  onChange: (scale: MaquetteScale) => void;
  locale: Locale;
}

/** Segmented 1:100 / 1:50 / 1:20 control. Buttons are 48 px tall for thumbs. */
export function ScaleSelector({ value, onChange, locale }: ScaleSelectorProps): React.JSX.Element {
  const t = getArStrings(locale);
  return (
    <div className="ar-scales" role="group" aria-label={t["scale.label"]}>
      {MAQUETTE_SCALES.map((scale) => (
        <button
          key={scale}
          type="button"
          className="ar-scale"
          data-scale={scale}
          aria-pressed={scale === value}
          onClick={() => onChange(scale)}
        >
          1:{scale}
        </button>
      ))}
    </div>
  );
}
