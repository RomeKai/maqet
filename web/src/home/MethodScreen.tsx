import type { LucideIcon } from "lucide-react";
import { Camera, PenLine, Ruler, Type } from "lucide-react";
import { getStrings, type Locale, type StringKey } from "../i18n";
import { Banner, Chip, cn } from "../ui";

export interface MethodScreenProps {
  locale: Locale;
  /** Result of navigator.xr.isSessionSupported('immersive-ar'). */
  arSupported: boolean;
  onPhoto: () => void;
  onAr: () => void;
}

interface Option {
  id: string;
  icon: LucideIcon;
  title: StringKey;
  desc: StringKey;
  enabled: boolean;
  onSelect?: () => void;
}

export function MethodScreen({ locale, arSupported, onPhoto, onAr }: MethodScreenProps) {
  const t = getStrings(locale);
  const options: Option[] = [
    { id: "photo", icon: Camera, title: "method.photo", desc: "method.photo.desc", enabled: true, onSelect: onPhoto },
    ...(arSupported
      ? [{ id: "ar", icon: Ruler, title: "method.ar", desc: "method.ar.desc", enabled: true, onSelect: onAr } satisfies Option]
      : []),
    { id: "draw", icon: PenLine, title: "method.draw", desc: "method.draw.desc", enabled: false },
    { id: "type", icon: Type, title: "method.type", desc: "method.type.desc", enabled: false },
  ];
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-background p-3 font-sans" data-testid="method-screen">
      <h1 className="px-1 pt-1 text-2xl font-extrabold">{t["method.title"]}</h1>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          data-method={o.id}
          disabled={!o.enabled}
          onClick={o.onSelect}
          className={cn(
            "flex min-h-24 w-full items-center gap-4 rounded-2xl border-2 p-4 text-left active:scale-[0.99]",
            o.enabled ? "border-foreground bg-card" : "border-border bg-card/60",
          )}
        >
          <span
            className={cn(
              "flex size-14 shrink-0 items-center justify-center rounded-xl",
              o.enabled ? "bg-primary text-primary-foreground" : "bg-secondary",
            )}
          >
            <o.icon className="size-7" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[19px] font-extrabold leading-tight">{t[o.title]}</span>
            <span className="block text-[15px] text-muted-foreground">{t[o.desc]}</span>
          </span>
          {!o.enabled && <Chip>{t["method.soon"]}</Chip>}
        </button>
      ))}
      <Banner tone="info" title={t["method.hint.title"]}>
        {t["method.hint.body"]}
      </Banner>
    </div>
  );
}
