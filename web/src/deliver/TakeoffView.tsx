import type { Locale } from "../i18n";
import "./deliver.css";
import { getDeliverStrings, unitLabel, type DeliverStrings } from "./deliver.i18n";
import { buildTakeoffCsv, downloadCsv, flagLabel, formatQuantity, orderedStages } from "./takeoffFormat";
import type { Takeoff, TakeoffLine } from "./takeoffTypes";

const CSV_FILENAME = "maqet-takeoff.csv";

interface TakeoffViewProps {
  takeoff: Takeoff;
  locale: Locale;
}

interface LineItemProps {
  line: TakeoffLine;
  locale: Locale;
  t: DeliverStrings;
}

function LineItem({ line, locale, t }: LineItemProps): React.JSX.Element {
  return (
    <li className="deliver-line" data-estimated={line.estimated ? "true" : undefined}>
      <div className="deliver-line-main">
        <span className="deliver-line-name">{line.name}</span>
        <span className="deliver-qty">
          {formatQuantity(line.quantity, locale)} {unitLabel(line.unit, locale)}
        </span>
      </div>
      {line.estimated && <span className="deliver-chip deliver-chip-estimated">{t["line.estimated"]}</span>}
      <details className="deliver-source">
        <summary>{t["line.source"]}</summary>
        <p>{line.recipe_source}</p>
        <p className="deliver-waste">
          {t["line.waste"]}: <span className="deliver-qty">×{formatQuantity(line.waste_factor, locale)}</span>
        </p>
      </details>
    </li>
  );
}

/** Staged takeoff for the Deliver screen: one block per stage, flags, CSV, preliminary footer. */
export function TakeoffView({ takeoff, locale }: TakeoffViewProps): React.JSX.Element {
  const t = getDeliverStrings(locale);
  const stages = orderedStages(takeoff);

  return (
    <section className="deliver" aria-labelledby="deliver-title">
      <header className="deliver-head">
        <h2 id="deliver-title">{t["title"]}</h2>
        <p className="deliver-subtitle">{t["subtitle"]}</p>
      </header>

      {takeoff.flags.length > 0 && (
        <div className="deliver-flags" role="alert">
          <strong>{t["flags.title"]}</strong>
          <ul>
            {takeoff.flags.map((flag, index) => (
              <li key={`${flag.code}-${index}`}>{flagLabel(flag.code, locale)}</li>
            ))}
          </ul>
        </div>
      )}

      {stages.length === 0 && <p className="deliver-empty">{t["empty"]}</p>}

      {stages.map(({ stage, lines }) => (
        <section key={stage} className="deliver-stage" aria-labelledby={`deliver-stage-${stage}`}>
          <h3 id={`deliver-stage-${stage}`}>{t[`stage.${stage}`]}</h3>
          <ul className="deliver-lines">
            {lines.map((line, index) => (
              <LineItem key={`${line.material_id}-${index}`} line={line} locale={locale} t={t} />
            ))}
          </ul>
        </section>
      ))}

      <button type="button" className="deliver-export" onClick={() => downloadCsv(buildTakeoffCsv(takeoff), CSV_FILENAME)}>
        {t["action.exportCsv"]}
      </button>

      <footer className="deliver-footer">{t["footer.preliminary"]}</footer>
    </section>
  );
}
