import type { Locale } from "../i18n";
import type { Scene } from "../scene/types";
import "./fidelity.css";
import { getFidelityStrings } from "./fidelity.i18n";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { PROVENANCES, summarizeFidelity } from "./summarizeFidelity";

interface FidelitySummaryProps {
  scene: Scene;
  locale: Locale;
}

/** Card with the Scene's overall fidelity: Measured / Preliminary, Concept, per-provenance counts, estimated walls. */
export function FidelitySummary({ scene, locale }: FidelitySummaryProps): React.JSX.Element {
  const t = getFidelityStrings(locale);
  const report = summarizeFidelity(scene);
  const present = PROVENANCES.filter((p) => report.counts[p] > 0);

  return (
    <section className="fidelity-card" aria-labelledby="fidelity-title">
      <h3 id="fidelity-title" className="fidelity-title">
        {t["summary.title"]}
      </h3>

      <div className="fidelity-chips">
        {report.label === "measured" ? (
          <span className="fidelity-chip fidelity-chip-measured" data-chip="measured">
            {t["label.measured"]}
          </span>
        ) : (
          <span className="fidelity-chip fidelity-chip-preliminary" data-chip="preliminary">
            {t["label.preliminary"]}
          </span>
        )}
        {report.hasConcept && (
          <span className="fidelity-chip fidelity-chip-concept" data-chip="concept">
            {t["chip.concept"]}
          </span>
        )}
      </div>

      {present.length > 0 && (
        <ul className="fidelity-counts">
          {present.map((provenance) => (
            <li key={provenance}>
              <ProvenanceBadge provenance={provenance} locale={locale} />
              <span className="fidelity-count">{report.counts[provenance]}</span>
            </li>
          ))}
        </ul>
      )}

      {report.estimatedWallIds.length > 0 && (
        <div className="fidelity-estimated-walls fidelity-warn">
          <p>{t["summary.estimatedWalls"]}</p>
          <ul>
            {report.estimatedWallIds.map((id) => (
              <li key={id}>
                <span className="fidelity-wall-id">{id}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
