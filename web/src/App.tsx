import { useState } from "react";
import { DEFAULT_LOCALE, getStrings, type Locale, type StringKey } from "./i18n";
import { IntakeScreen } from "./intake/IntakeScreen";
import { SceneView } from "./view3d/SceneView";
import type { Scene } from "./scene/types";

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
  // Test/demo seam: pre-load a measured Scene so the viewport renders its
  // 3D view without going through the intake upload flow. In production the
  // Scene arrives via IntakeScreen's onSceneChange callback.
  initialScene?: Scene | null;
}

export function App({ initialLocale = DEFAULT_LOCALE, initialScene = null }: AppProps) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [stage, setStage] = useState<StringKey>("stage.capture");
  // Driven by the measured Scene (ADR-001): scale_confirmed flips the
  // topbar badge; hasPhoto hides the start receipt once a photo is set.
  // The intake Scene is held here so the viewport can render its 3D view;
  // a scene with no walls keeps the placeholder hint (mobile-ui: full-screen
  // 3D with bottom sheet shape stays as-is, this only swaps viewport content).
  const [scaleConfirmed, setScaleConfirmed] = useState(initialScene?.scale_confirmed === true);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [intakeScene, setIntakeScene] = useState<Scene | null>(initialScene);
  const t = getStrings(locale);

  function handleIntakeScene(scene: Scene): void {
    setIntakeScene(scene);
    setScaleConfirmed(scene.scale_confirmed === true);
  }

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
        {intakeScene !== null && (intakeScene.walls?.length ?? 0) > 0 ? (
          <SceneView scene={intakeScene} />
        ) : (
          <div className="viewport-placeholder">
            <p className="viewport-hint">{t["sheet.hint"]}</p>
          </div>
        )}
      </main>

      <section className="sheet" aria-label={t["app.name"]}>
        {stage === "stage.capture" && (
          <IntakeScreen
            locale={locale}
            initialScene={initialScene ?? undefined}
            onSceneChange={handleIntakeScene}
            onPhotoChange={setHasPhoto}
          />
        )}
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
        {stage === "stage.capture" && !hasPhoto && (
          <p className="receipt">{t["sheet.receipt"]}</p>
        )}
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
