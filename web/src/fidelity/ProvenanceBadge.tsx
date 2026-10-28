import type { Locale } from "../i18n";
import "./fidelity.css";
import { getFidelityStrings } from "./fidelity.i18n";
import type { Provenance } from "./summarizeFidelity";

interface ProvenanceBadgeProps {
  provenance: Provenance;
  locale: Locale;
}

/** How one wall's length was obtained. Estimated reads as a warning; measured ones stay calm. */
export function ProvenanceBadge({ provenance, locale }: ProvenanceBadgeProps): React.JSX.Element {
  const t = getFidelityStrings(locale);
  const tone = provenance === "estimated" ? "fidelity-warn" : "fidelity-ok";
  return (
    <span className={`fidelity-badge ${tone}`} data-provenance={provenance}>
      {t[`provenance.${provenance}`]}
    </span>
  );
}
