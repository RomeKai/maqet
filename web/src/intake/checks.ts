import type { Scene } from "../scene/types";
import type { Strings } from "../i18n";
import { isWallEstimated } from "../scene/store";
import { DOOR_MIN_WIDTH_M } from "./opening";

export interface CheckItem {
  id: string;
  text: string;
  /** Wall to highlight in the editor, or null for a general reading notice. */
  wallId: string | null;
}

type WarnKey = Extract<keyof Strings, `intake.warn.${string}`>;

/** Engine warning code (text before the first colon) -> dictionary key. */
const WARNING_KEYS: Record<string, WarnKey> = {
  kind_defaulted: "intake.warn.kind_defaulted",
  "wall.snapped_large_change": "intake.warn.snap_large",
  "wall.diagonal_kept": "intake.warn.diagonal",
  wall_dropped: "intake.warn.wall_dropped",
  opening_dropped: "intake.warn.opening_dropped",
  rooms_empty: "intake.warn.rooms_empty",
  assigned: "intake.warn.assigned",
  unassigned: "intake.warn.unassigned",
  opening: "intake.warn.opening",
  opening_estimated: "intake.warn.opening_estimated",
  "possible opening": "intake.warn.possible_opening",
  contradiction: "intake.warn.contradiction",
};

/** Codes whose message is rebuilt from the current Scene (estimated walls) and so must not be replayed from the first response. */
const DERIVED_CODES = new Set(["estimated"]);
/** Codes that describe openings: they only make sense while the Scene still has openings. */
const OPENING_CODES = new Set(["opening", "opening_estimated", "possible opening", "opening_dropped"]);

function warningCode(raw: string): string | null {
  const colon = raw.indexOf(":");
  return colon > 0 && colon <= 40 ? raw.slice(0, colon).trim() : null;
}

/**
 * Engine warnings -> readable translated items. Never echoes the raw string and never repeats a number from the
 * first response (they go stale when the user edits): one sentence per code, tied to the current Scene.
 */
function readingItems(scene: Scene, readingWarnings: string[], t: Strings): CheckItem[] {
  const hasOpenings = (scene.openings ?? []).length > 0;
  const seen = new Set<string>();
  const items: CheckItem[] = [];
  for (const raw of readingWarnings) {
    const code = warningCode(raw);
    if (code !== null && DERIVED_CODES.has(code)) continue;
    const key = code === null ? undefined : WARNING_KEYS[code];
    if (code !== null && OPENING_CODES.has(code) && !hasOpenings) continue;
    const slot = key ?? "unknown";
    if (seen.has(slot)) continue;
    seen.add(slot);
    items.push({ id: `warn-${slot}`, text: t[key ?? "intake.warn.unknown"], wallId: null });
  }
  return items;
}

/** "N things to check" for the Check step: reading notices + what is still unconfirmed, derived from the current Scene. */
export function buildChecks(scene: Scene, readingWarnings: string[], t: Strings): CheckItem[] {
  const walls = scene.walls ?? [];
  const number = (id: string): number => walls.findIndex((w) => w.id === id) + 1;
  const items: CheckItem[] = readingItems(scene, readingWarnings, t);
  for (const w of walls) {
    if (isWallEstimated(w)) {
      items.push({ id: `est-${w.id}`, text: t["intake.check.estimated"].replace("{n}", String(number(w.id))), wallId: w.id });
    }
  }
  for (const o of scene.openings ?? []) {
    if (o.kind === "door" && o.width_m < DOOR_MIN_WIDTH_M) {
      items.push({ id: `door-${o.id}`, text: t["intake.check.narrowDoor"].replace("{n}", String(number(o.wall_id))), wallId: o.wall_id });
    }
  }
  return items;
}
