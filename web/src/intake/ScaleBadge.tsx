import { getStrings, type Locale } from "../i18n";

interface ScaleBadgeProps {
  locale: Locale;
  scaleConfirmed: boolean;
}

/**
 * Single source of truth for the fidelity badge (mobile-ui: teal
 * "Measured · 1:1" once scale_confirmed, amber "Not to scale" before,
 * blocking export). Used by App's topbar and IntakeScreen's head.
 */
export function ScaleBadge({ locale, scaleConfirmed }: ScaleBadgeProps): React.JSX.Element {
  const t = getStrings(locale);
  return (
    <span className={scaleConfirmed ? "badge badge-measured" : "badge badge-notoscale"}>
      {scaleConfirmed ? t["badge.measured"] : t["badge.notToScale"]}
    </span>
  );
}
