import { useState } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";
import type { Locale } from "../i18n";
import { Banner, Button, Chip, cn } from "../ui";
import { getDeliverStrings, unitLabel, type DeliverStrings } from "./deliver.i18n";
import { buildTakeoffCsv, downloadCsv, flagLabel, formatQuantity, lineName, orderedStages, uniqueFlagCodes } from "./takeoffFormat";
import type { Takeoff, TakeoffLine, TakeoffStage } from "./takeoffTypes";

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
    <li
      className={cn("px-3 py-3", line.estimated && "bg-warning-soft")}
      data-estimated={line.estimated ? "true" : undefined}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold leading-snug">{lineName(line, locale)}</p>
          {line.estimated && (
            <Chip tone="warning" className="mt-1 border-2 border-dashed border-warning-foreground/70">
              <TriangleAlert className="size-3.5" aria-hidden />
              {t["line.estimated"]}
            </Chip>
          )}
        </div>
        <p className="shrink-0 text-right font-mono leading-tight">
          <span className="block text-2xl font-bold tabular-nums">{formatQuantity(line.quantity, locale)}</span>
          <span className="block text-sm text-muted-foreground">{unitLabel(line.unit, locale)}</span>
        </p>
      </div>
      <details className="mt-1 text-[15px]">
        <summary className="flex min-h-12 cursor-pointer items-center font-bold underline underline-offset-4">
          {t["line.source"]}
        </summary>
        <p>{line.recipe_source}</p>
        <p className="text-muted-foreground">
          {t["line.waste"]}: <span className="font-mono">×{formatQuantity(line.waste_factor, locale)}</span>
        </p>
      </details>
    </li>
  );
}

/** Staged takeoff: collapsible stage cards in purchase order, flags, CSV, preliminary footer. */
export function TakeoffView({ takeoff, locale }: TakeoffViewProps): React.JSX.Element {
  const t = getDeliverStrings(locale);
  const stages = orderedStages(takeoff);
  const [openStage, setOpenStage] = useState<TakeoffStage | null>(stages[0]?.stage ?? null);

  return (
    <section className="space-y-3 font-sans" aria-labelledby="deliver-title">
      <header>
        <h2 id="deliver-title" className="text-xl font-extrabold">
          {t["title"]}
        </h2>
        <p className="text-[15px] text-muted-foreground">{t["subtitle"]}</p>
      </header>

      {takeoff.flags.length > 0 && (
        <Banner tone="danger" title={t["flags.title"]}>
          <ul className="list-disc pl-5">
            {uniqueFlagCodes(takeoff.flags).map((code) => (
              <li key={code}>{flagLabel(code, locale)}</li>
            ))}
          </ul>
        </Banner>
      )}

      {stages.length === 0 && <p className="text-[15px] text-muted-foreground">{t["empty"]}</p>}

      <ul className="space-y-2">
        {stages.map(({ stage, lines }) => {
          const open = openStage === stage;
          const guessed = lines.filter((l) => l.estimated).length;
          return (
            <li key={stage} className="overflow-hidden rounded-xl border-2 border-foreground bg-card">
              <h3>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`deliver-stage-${stage}`}
                  onClick={() => setOpenStage(open ? null : stage)}
                  className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-lg font-extrabold leading-tight">{t[`stage.${stage}`]}</span>
                    <span className="block text-sm text-muted-foreground">
                      {t["stage.items"].replace("{n}", String(lines.length))}
                      {guessed > 0 && ` · ${t["stage.estimatedCount"].replace("{n}", String(guessed))}`}
                    </span>
                  </span>
                  <ChevronDown className={cn("size-6 shrink-0", open && "rotate-180")} aria-hidden />
                </button>
              </h3>
              {/* Always in the markup (hidden when collapsed) so print/SSR and tests see every line. */}
              <ul
                id={`deliver-stage-${stage}`}
                hidden={!open}
                className="divide-y divide-border border-t-2 border-foreground"
              >
                {lines.map((line, index) => (
                  <LineItem key={`${line.material_id}-${index}`} line={line} locale={locale} t={t} />
                ))}
              </ul>
            </li>
          );
        })}
      </ul>

      <Button variant="secondary" className="w-full" onClick={() => downloadCsv(buildTakeoffCsv(takeoff), CSV_FILENAME)}>
        {t["action.exportCsv"]}
      </Button>

      <footer className="text-sm text-muted-foreground">{t["footer.preliminary"]}</footer>
    </section>
  );
}
