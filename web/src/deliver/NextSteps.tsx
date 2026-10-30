import type { Locale } from "../i18n";
import { getDeliverStrings, type DeliverKey } from "./deliver.i18n";

interface NextStepsProps {
  locale: Locale;
  estimatedWalls: number;
  flagCount: number;
}

type StepKey = Extract<DeliverKey, `step.${string}`>;

/** Next steps derived from the Scene and flags only; no invented data. */
export function nextStepKeys(input: { estimatedWalls: number; flagCount: number }): StepKey[] {
  const keys: StepKey[] = [];
  if (input.estimatedWalls > 0) keys.push("step.measure");
  if (input.flagCount > 0) keys.push("step.professional");
  keys.push("step.dxf");
  return keys;
}

export function NextSteps({ locale, estimatedWalls, flagCount }: NextStepsProps): React.JSX.Element {
  const t = getDeliverStrings(locale);
  const keys = nextStepKeys({ estimatedWalls, flagCount });
  return (
    <section className="rounded-xl border-2 border-foreground bg-card p-3" data-testid="next-steps">
      <h2 className="text-lg font-extrabold leading-tight">{t["steps.title"]}</h2>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-[16px]">
        {keys.map((k) => (
          <li key={k}>{t[k]}</li>
        ))}
      </ol>
    </section>
  );
}
