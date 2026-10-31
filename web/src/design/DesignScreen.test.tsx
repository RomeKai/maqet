import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Scene } from "../scene/types";
import { finishCall, nudgeCall, placeCall, removeCall, rotateCall, undoCall } from "../agent/editCall";
import { getAgentStrings } from "../agent/agent.i18n";
import { SUGGESTIONS } from "../agent/suggestions";
import { getDesignStrings } from "./design.i18n";
import { DesignScreen } from "./DesignScreen";
import { EMPTY_REAL_LIFE } from "./RealLifeCard";

const noop = (): void => {};
const scene = {
  id: "s",
  walls: [],
  rooms: [{ id: "r1", name: "Bedroom", polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
} as unknown as Scene;

function html(locale: "en" | "es-AR"): string {
  return renderToString(
    <DesignScreen scene={scene} locale={locale} selectedWallId={null} onSelectWall={noop} messages={[]} onSend={noop} onAudio={noop} pending={false} agentError={null} onNext={noop} onEdit={async () => ({ error: null, warnings: [] })} realLife={EMPTY_REAL_LIFE} onRealLife={noop} />,
  );
}

describe("DesignScreen", () => {
  it("has the 3D card actions, every design chip, talk bar and Next in both locales", () => {
    for (const locale of ["en", "es-AR"] as const) {
      const out = html(locale);
      const d = getDesignStrings(locale);
      const a = getAgentStrings(locale);
      expect(out).toContain(`aria-label="${d["design.undo"]}"`);
      expect(out).toContain(d["design.add"]);
      for (const { key } of SUGGESTIONS.design) expect(out).toContain(a[key]);
      expect(out).toContain(a["bar.next"]);
    }
  });
  it("maps taps to the same tools the agent uses", () => {
    expect(placeCall("sofa-3seat-200x90", "r1")).toEqual({ tool: "place_furniture", args: { catalog_id: "sofa-3seat-200x90", room: "r1" } });
    expect(finishCall("r1", "walls", "wall-paint-white")).toEqual({ tool: "set_surface_material", args: { room: "r1", part: "walls", material_id: "wall-paint-white" } });
    expect(nudgeCall("f1", [2, 1], 0, 0.1)).toEqual({ tool: "move_item", args: { item: "f1", position: [2, 1.1] } });
    expect(rotateCall("f1").args).toEqual({ item: "f1", delta_deg: 90 });
    expect(removeCall("f1").tool).toBe("remove_item");
    expect(undoCall().tool).toBe("undo");
  });
  it("has the same design string keys in en and es-AR", () => {
    expect(Object.keys(getDesignStrings("es-AR"))).toEqual(Object.keys(getDesignStrings("en")));
  });
});

import { moveToWallCall } from "../agent/editCall";

describe("item sheet calls", () => {
  it("moves to a wall label through move_item", () => {
    expect(moveToWallCall("f1", "wall 2")).toEqual({ tool: "move_item", args: { item: "f1", wall: "wall 2" } });
  });
});
