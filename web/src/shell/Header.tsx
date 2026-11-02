import { ArrowLeft } from "lucide-react";
import { getStrings, type Locale } from "../i18n";
import { ScaleBadge } from "../intake/ScaleBadge";
import { Segmented } from "../ui";
import type { Scene } from "../scene/types";

export interface HeaderProps {
  locale: Locale;
  onLocaleChange: (l: Locale) => void;
  scene: Scene | null;
  onBack: (() => void) | null;
}

export function Header({ locale, onLocaleChange, scene, onBack }: HeaderProps) {
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
        <p className="flex items-center gap-2 text-lg font-extrabold">
          <span className="truncate">{t["project.defaultName"]}</span>
          <ScaleBadge locale={locale} scene={scene} />
        </p>
        <p className="truncate text-sm font-medium text-muted-foreground">{t["project.place"]}</p>
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
