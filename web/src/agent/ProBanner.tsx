import type { Locale } from "../i18n";
import { getStrings } from "../i18n";
import { professionalFlagLabel } from "./agent.i18n";

interface ProBannerProps {
  flags: string[];
  locale: Locale;
}

export function ProBanner({ flags, locale }: ProBannerProps): React.JSX.Element | null {
  if (flags.length === 0) return null;
  const t = getStrings(locale);
  return (
    <div className="pro-banner" role="alert" data-testid="pro-banner">
      <strong className="pro-banner-title">{t["banner.needs_professional"]}</strong>
      <p className="pro-banner-detail">{t["banner.needs_professional.detail"]}</p>
      <ul className="pro-banner-list">
        {flags.map((flag) => (
          <li key={flag} data-flag={flag}>
            {professionalFlagLabel(locale, flag)}
          </li>
        ))}
      </ul>
    </div>
  );
}
