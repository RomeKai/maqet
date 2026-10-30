import { useState } from "react";
import { getStrings, type Locale } from "../i18n";

interface WarningsChipProps {
  locale: Locale;
  warnings: string[];
  onSelectWarning?: (index: number) => void;
}

export function WarningsChip({ locale, warnings, onSelectWarning }: WarningsChipProps): React.JSX.Element | null {
  const t = getStrings(locale);
  const [open, setOpen] = useState(false);
  if (warnings.length === 0) return null;
  return (
    <div className="warnings-chip-wrap">
      <button type="button" className="warnings-chip" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {t["intake.warnings.count"].replace("{n}", String(warnings.length))}
      </button>
      {open && (
        <ul className="warnings-list" role="list">
          {warnings.map((w, i) => (
            <li key={i}>
              <button type="button" className="warnings-item" onClick={() => onSelectWarning?.(i)}>
                {w}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
