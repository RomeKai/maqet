import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReformScreen } from "./ReformScreen";
import { VariantTabs, NOW, type VariantsState } from "./VariantTabs";
import { getAgentStrings } from "./agent.i18n";
import type { Scene } from "../scene/types";

const noop = (): void => {};
const t = getAgentStrings("en");

describe("ReformScreen", () => {
  const html = renderToString(
    <ReformScreen
      scene={null}
      locale="en"
      selectedWallId={null}
      onSelectWall={noop}
      onSceneChange={noop}
      messages={[]}
      onSend={noop}
      onAudio={noop}
      pending={false}
      agentError={null}
      onNext={noop}
    />,
  );
  it("has the 3D card undo, chips, talk bar and Next", () => {
    expect(html).toContain(`aria-label="${t["card.undo"]}"`);
    expect(html).toContain(t["suggest.bedroom"]);
    expect(html).toContain(t["bar.hint"]);
    expect(html).toContain(t["bar.next"]);
  });
  it("keeps no preliminary label of its own", () => {
    expect(html).not.toContain(t["caption.preliminary"]);
  });
});

describe("VariantTabs", () => {
  const scene = { id: "s", walls: [], rooms: [{ id: "r", name: "x", polygon: [[0, 0], [5, 0], [5, 5], [0, 5]] }] } as unknown as Scene;
  const state = (selected: string): VariantsState => ({
    data: { chosen: "A", variants: [{ label: "A", scene }, { label: "B", scene }] } as never,
    error: null,
    busy: false,
    selected,
    fork: async () => {},
    choose: async () => {},
    undo: async () => {},
  });
  it("offers Now, A, B and a fork action, Now caption by default", () => {
    const html = renderToString(<VariantTabs state={state(NOW)} locale="en" />);
    expect(html).toContain(">Now<");
    expect(html).toContain(">B<");
    expect(html).toContain("Fork variant");
    expect(html).toContain(t["variants.nowCaption"]);
  });
  it("captions the selected option with its floor area", () => {
    const html = renderToString(<VariantTabs state={state("B")} locale="en" />);
    expect(html).toContain("Option B · 25.0 m²");
  });
});
