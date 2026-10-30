import { OctagonAlert } from "lucide-react";
import type { Locale } from "../i18n";
import { getStrings } from "../i18n";
import { normalizeProfessionalFlags, professionalFlagLabel } from "./agent.i18n";

interface ProBannerProps {
  flags: string[];
  locale: Locale;
  /** One line with the reasons behind a toggle, for Present/Deliver where the viewer needs the room. */
  compact?: boolean;
}

/** Red "Needs a licensed professional" flag (ADR-023), one line per flagged condition. */
export function ProBanner({ flags, locale, compact = false }: ProBannerProps): React.JSX.Element | null {
  const codes = normalizeProfessionalFlags(flags);
  if (codes.length === 0) return null;
  const t = getStrings(locale);
  if (compact) {
    return (
      <details
        className="mx-3 mt-1 shrink-0 rounded-xl border-2 border-danger bg-danger-soft px-3 py-2 font-sans text-foreground"
        role="alert"
        data-testid="pro-banner"
      >
        <summary className="flex min-h-9 cursor-pointer items-center gap-2 text-[15px] font-bold">
          <OctagonAlert className="size-5 shrink-0 text-danger" aria-hidden />
          {t["banner.needs_professional"]}
        </summary>
        <ul className="mt-1 max-h-[20dvh] list-disc overflow-y-auto pl-5 text-[15px]">
          {codes.map((flag) => (
            <li key={flag} data-flag={flag}>
              {professionalFlagLabel(locale, flag)}
            </li>
          ))}
        </ul>
      </details>
    );
  }
  return (
    <div
      className="mx-3 mt-2 flex max-h-[30dvh] shrink-0 gap-3 overflow-y-auto rounded-xl border-2 border-danger bg-danger-soft p-3 font-sans text-foreground"
      role="alert"
      data-testid="pro-banner"
    >
      <OctagonAlert className="mt-0.5 size-6 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0">
        <strong className="block text-base font-bold leading-snug">{t["banner.needs_professional"]}</strong>
        <p className="mt-0.5 text-[15px] leading-snug">{t["banner.needs_professional.detail"]}</p>
        <ul className="mt-1 list-disc pl-5 text-[15px]">
          {codes.map((flag) => (
            <li key={flag} data-flag={flag}>
              {professionalFlagLabel(locale, flag)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
