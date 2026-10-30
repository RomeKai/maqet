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

/** "N things to check" for the Check step: reading notices + what is still unconfirmed. */
export function buildChecks(scene: Scene, readingWarnings: string[], t: Strings): CheckItem[] {
  const walls = scene.walls ?? [];
  const number = (id: string): number => walls.findIndex((w) => w.id === id) + 1;
  const items: CheckItem[] = readingWarnings.map((text, i) => ({ id: `warn-${i}`, text, wallId: null }));
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
