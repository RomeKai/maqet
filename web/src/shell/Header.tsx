import { ArrowLeft } from "lucide-react";
import { getStrings, type Locale } from "../i18n";
import { ScaleBadge } from "../intake/ScaleBadge";
import { Segmented } from "../ui";

export interface HeaderProps {
  locale: Locale;
  onLocaleChange: (l: Locale) => void;
  scaleConfirmed: boolean;
  onBack: (() => void) | null;
}

export function Header({ locale, onLocaleChange, scaleConfirmed, onBack }: HeaderProps) {
  const t = getStrings(locale);
  return (
    <header className="flex shrink-0 items-center gap-2 border-b-2 border-foreground bg-card px-3 py-2 font-sans">
      <button
        type="button"
        onClick={onBack ?? undefined}
        disabled={onBack === null}
        aria-label={t["nav.back"]}
        className="flex size-12 shrink-0 items-center justify-center rounded-xl border-2 border-foreground bg-card active:scale-95 disabled:opacity-40"
      >
        <ArrowLeft className="size-6" aria-hidden />
      </button>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-lg font-extrabold">{t["project.defaultName"]}</p>
        <p className="flex items-center gap-2 truncate text-sm font-medium text-muted-foreground">
          <span className="truncate">{t["project.place"]}</span>
          <ScaleBadge locale={locale} scaleConfirmed={scaleConfirmed} />
        </p>
      </div>
      <Segmented<Locale>
        label={t["lang.label"]}
        value={locale}
        onChange={onLocaleChange}
        className="w-[116px] shrink-0 p-0.5"
        options={[
          { value: "en", label: "EN", aria: t["locale.en"] },
          { value: "es-AR", label: "ES", aria: t["locale.es"] },
        ]}
      />
    </header>
  );
}
