import { TriangleAlert } from "lucide-react";
import { getStrings, type Locale } from "../i18n";
import { Banner, cn } from "../ui";
import type { CheckItem } from "./checks";

interface CheckListProps {
  locale: Locale;
  items: CheckItem[];
  highlightedWallId: string | null;
  onSelect: (item: CheckItem) => void;
}

/** "N things to check" (Check step): tapping an item highlights its wall. */
export function CheckList({ locale, items, highlightedWallId, onSelect }: CheckListProps): React.JSX.Element {
  const t = getStrings(locale);
  if (items.length === 0) {
    return <Banner tone="success" title={t["intake.checks.none"]} />;
  }
  const title = items.length === 1 ? t["intake.checks.one"] : t["intake.checks.title"].replace("{n}", String(items.length));
  return (
    <section className="space-y-2" aria-label={title}>
      <h2 className="text-lg font-extrabold">{title}</h2>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect(item)}
              aria-pressed={item.wallId !== null && item.wallId === highlightedWallId}
              className={cn(
                "flex min-h-12 w-full items-start gap-3 rounded-xl border-2 bg-warning-soft p-3 text-left text-[15px] font-semibold",
                item.wallId !== null && item.wallId === highlightedWallId ? "border-foreground" : "border-warning",
              )}
            >
              <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
              <span>{item.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
