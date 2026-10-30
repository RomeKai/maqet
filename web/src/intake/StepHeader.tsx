import { captureSteps, type CaptureStepKey } from "./captureSteps";
import { getStrings, type Locale } from "../i18n";

interface StepHeaderProps {
  locale: Locale;
  step: CaptureStepKey;
  error?: string | null;
  instruction?: string | null;
}

export function StepHeader({ locale, step, error, instruction }: StepHeaderProps): React.JSX.Element {
  const t = getStrings(locale);
  return (
    <div className="capture-step-header" role="region" aria-label={t["intake.editor"]}>
      <ol className="capture-steps" aria-label={t["intake.warnings.title"]}>
        {captureSteps.map((s) => (
          <li
            key={s.key}
            className={s.key === step ? "capture-step capture-step-active" : "capture-step"}
            aria-current={s.key === step ? "step" : undefined}
          >
            {t[s.labelKey as keyof typeof t]}
          </li>
        ))}
      </ol>
      {instruction && <p className="capture-instruction">{instruction}</p>}
      {error && (
        <p className="capture-error-banner" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
