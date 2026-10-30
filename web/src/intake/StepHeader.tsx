import { Check } from "lucide-react";
import { captureSteps, STEP_ORDER, type CaptureStepKey } from "./captureSteps";
import { getStrings, type Locale } from "../i18n";
import { Banner, cn } from "../ui";

interface StepHeaderProps {
  locale: Locale;
  step: CaptureStepKey;
  error?: string | null;
  instruction?: string | null;
}

/**
 * Capture sub-step header: Photo > Walls > Openings > Check, one large
 * instruction line (17 px), then the error banner right under it.
 */
export function StepHeader({ locale, step, error, instruction }: StepHeaderProps): React.JSX.Element {
  const t = getStrings(locale);
  const current = STEP_ORDER.indexOf(step);
  return (
    <div className="flex flex-col gap-2 font-sans" role="region" aria-label={t["intake.editor"]}>
      <ol className="flex items-center gap-1.5" aria-label={t["intake.step.capture"]}>
        {captureSteps.map((s, i) => {
          const active = s.key === step;
          const done = i < current;
          return (
            <li
              key={s.key}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex min-h-9 flex-1 items-center justify-center gap-1 rounded-full px-2 text-sm font-bold",
                active && "bg-foreground text-background",
                done && "bg-success-soft text-foreground",
                !active && !done && "border border-border bg-card text-muted-foreground",
              )}
            >
              {done ? <Check className="size-4" strokeWidth={3} aria-hidden /> : <span aria-hidden>{i + 1}</span>}
              {t[s.labelKey as keyof typeof t]}
            </li>
          );
        })}
      </ol>
      {instruction && <p className="text-[17px] font-bold leading-snug text-balance">{instruction}</p>}
      {error && <Banner tone="danger" title={error} />}
    </div>
  );
}
