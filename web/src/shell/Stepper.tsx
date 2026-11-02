import { Check } from "lucide-react";
import { getStrings, type Locale, type StringKey } from "../i18n";
import { cn } from "../ui";

export const STAGES: StringKey[] = [
  "stage.capture",
  "stage.reform",
  "stage.design",
  "stage.present",
  "stage.deliver",
];

export const SKIPPABLE: ReadonlySet<StringKey> = new Set(["stage.reform", "stage.design"]);

export interface StepperProps {
  locale: Locale;
  stage: StringKey;
  onSelect: (stage: StringKey) => void;
}

export function Stepper({ locale, stage, onSelect }: StepperProps) {
  const t = getStrings(locale);
  const current = STAGES.indexOf(stage);
  return (
    <nav aria-label={t["stage.nav"]} className="shrink-0 border-b border-border bg-background px-2 pb-2 pt-2.5 font-sans">
      <ol className="flex" role="tablist">
        {STAGES.map((key, i) => {
          const done = i < current;
          const active = i === current;
          const skippable = SKIPPABLE.has(key);
          return (
            <li key={key} className="relative flex-1" role="presentation">
              {i > 0 && (
                <span
                  aria-hidden
                  className={cn("absolute top-[18px] h-[3px] -translate-y-1/2", i <= current ? "bg-success" : "bg-border")}
                  style={{ left: "-50%", width: "100%" }}
                />
              )}
              <button
                type="button"
                role="tab"
                aria-selected={active}
                aria-current={active ? "step" : undefined}
                onClick={() => onSelect(key)}
                className="relative z-10 flex min-h-12 w-full flex-col items-center gap-1 rounded-lg py-0.5"
              >
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-[15px] font-extrabold",
                    active && "bg-primary text-primary-foreground ring-4 ring-primary/25",
                    done && "bg-success text-primary-foreground",
                    !active && !done && "border-2 bg-card text-foreground",
                    !active && !done && (skippable ? "border-dashed border-foreground/60" : "border-foreground/60"),
                  )}
                >
                  {done ? <Check className="size-5" strokeWidth={3} aria-hidden /> : i + 1}
                </span>
                <span className={cn("text-[13px] leading-none", active ? "font-extrabold text-foreground" : "font-semibold text-muted-foreground")}>
                  {t[key]}
                </span>
                {skippable && (
                  <span className="stage-skip-note -mt-0.5 text-xs font-semibold leading-none text-muted-foreground">{t["stage.optional"]}</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
