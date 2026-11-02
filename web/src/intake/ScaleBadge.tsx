import { getStrings, type Locale } from "../i18n";
import { wallProvenance } from "../fidelity/summarizeFidelity";
import type { Scene } from "../scene/types";

interface ScaleBadgeProps {
  locale: Locale;
  scene: Scene | null;
}

export type ScaleBadgeState =
  | { kind: "none" }
  | { kind: "measured" }
  | { kind: "written" }
  | { kind: "estimated"; estimated: number; total: number };

/**
 * What the walls really are, from their provenance (ADR-025): "measured" only when every wall was measured
 * (AR or tape); lengths written on a sketch are "written"; any estimated wall is surfaced with its count;
 * and a Scene with no measured or written wall at all is "none" (not to scale). Pure, so it follows every
 * edit and undo of the Scene.
 */
export function scaleBadgeState(scene: Scene | null): ScaleBadgeState {
  const walls = scene?.walls ?? [];
  if (walls.length === 0) return { kind: "none" };
  const provenances = walls.map(wallProvenance);
  const estimated = provenances.filter((p) => p === "estimated").length;
  if (estimated === walls.length) return { kind: "none" };
  if (estimated > 0) return { kind: "estimated", estimated, total: walls.length };
  return provenances.every((p) => p === "measured_ar" || p === "measured_tape") ? { kind: "measured" } : { kind: "written" };
}

/**
 * Single source of truth for the fidelity badge (mobile-ui). Teal "Measured · 1:1" only for really measured
 * walls; "Written lengths" for a sketch; amber with a count when any wall is estimated or nothing is to scale.
 */
export function ScaleBadge({ locale, scene }: ScaleBadgeProps): React.JSX.Element {
  const t = getStrings(locale);
  const state = scaleBadgeState(scene);
  switch (state.kind) {
    case "measured":
      return <span className="badge badge-measured">{t["badge.measured"]}</span>;
    case "written":
      return <span className="badge badge-written">{t["badge.written"]}</span>;
    case "estimated":
      return (
        <span className="badge badge-notoscale" role="status">
          {t["badge.estimatedSome"].replace("{n}", String(state.estimated)).replace("{total}", String(state.total))}
        </span>
      );
    default:
      return <span className="badge badge-notoscale">{t["badge.notToScale"]}</span>;
  }
}
