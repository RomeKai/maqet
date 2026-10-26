import { useState } from "react";
import { DEFAULT_LOCALE, getStrings, type Locale, type StringKey } from "./i18n";
import { IntakeScreen } from "./intake/IntakeScreen";

const STAGES: StringKey[] = [
  "stage.capture",
  "stage.reform",
  "stage.design",
  "stage.present",
  "stage.deliver",
];

const SKIPPABLE: ReadonlySet<StringKey> = new Set(["stage.reform", "stage.design"]);

interface AppProps {
  initialLocale?: Locale;
}

export function App({ initialLocale = DEFAULT_LOCALE }: AppProps) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [stage, setStage] = useState<StringKey>("stage.capture");
  // Day 2+: driven by Scene.scale_confirmed. Starts unconfirmed → export blocked.
  const [scaleConfirmed] = useState(false);
  const t = getStrings(locale);

  const otherLocale: Locale = locale === "es-AR" ? "en" : "es-AR";

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="topbar-btn" aria-label={t["nav.back"]}>
          ←
        </button>
        <div className="topbar-title">
          <span className="topbar-project">{t["project.defaultName"]}</span>
          <span className={scaleConfirmed ? "badge badge-measured" : "badge badge-notoscale"}>
            {scaleConfirmed ? t["badge.measured"] : t["badge.notToScale"]}
          </span>
        </div>
        <button type="button" className="topbar-btn topbar-ar" aria-label={t["action.ar"]}>
          {t["action.ar"]}
        </button>
      </header>

      <main className="viewport" aria-label={t["app.name"]}>
        <div className="viewport-placeholder">
          <p className="viewport-hint">{t["sheet.hint"]}</p>
        </div>
      </main>

      <section className="sheet" aria-label={t["app.name"]}>
        {stage === "stage.capture" && <IntakeScreen locale={locale} />}
        <div className="chips" role="tablist">
          {STAGES.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={stage === key}
              className={stage === key ? "chip chip-active" : "chip"}
              onClick={() => setStage(key)}
            >
              {t[key]}
              {SKIPPABLE.has(key) ? ` · ${t["stage.skip"]}` : ""}
            </button>
          ))}
        </div>
        <p className="receipt">{t["sheet.receipt"]}</p>
        <div className="inputrow">
          <input
            className="prompt"
            type="text"
            placeholder={t["sheet.placeholder"]}
            aria-label={t["sheet.placeholder"]}
            disabled
          />
          <button type="button" className="mic" aria-label={t["sheet.mic"]}>
            🎙
          </button>
        </div>
        <div className="sheet-foot">
          <span className="preliminary">{t["notice.preliminary"]}</span>
          <button
            type="button"
            className="locale-switch"
            onClick={() => setLocale(otherLocale)}
          >
            {t[otherLocale === "es-AR" ? "locale.es" : "locale.en"]}
          </button>
        </div>
      </section>
    </div>
  );
}
