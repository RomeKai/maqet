import { OctagonAlert } from "lucide-react";
import type { Locale } from "../i18n";
import { getStrings } from "../i18n";
import { professionalFlagLabel } from "./agent.i18n";

interface ProBannerProps {
  flags: string[];
  locale: Locale;
}

/** Red "Needs a licensed professional" flag (ADR-023), one line per flagged condition. */
export function ProBanner({ flags, locale }: ProBannerProps): React.JSX.Element | null {
  if (flags.length === 0) return null;
  const t = getStrings(locale);
  return (
    <div
      className="mx-3 mt-2 flex gap-3 rounded-xl border-2 border-danger bg-danger-soft p-3 font-sans text-foreground"
      role="alert"
      data-testid="pro-banner"
    >
      <OctagonAlert className="mt-0.5 size-6 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0">
        <strong className="block text-base font-bold leading-snug">{t["banner.needs_professional"]}</strong>
        <p className="mt-0.5 text-[15px] leading-snug">{t["banner.needs_professional.detail"]}</p>
        <ul className="mt-1 list-disc pl-5 text-[15px]">
          {flags.map((flag) => (
            <li key={flag} data-flag={flag}>
              {professionalFlagLabel(locale, flag)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
