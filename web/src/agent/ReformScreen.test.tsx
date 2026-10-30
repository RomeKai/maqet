import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReformScreen } from "./ReformScreen";
import { VariantTabs, NOW, activeVariant, type VariantsState } from "./VariantTabs";
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
      onEdit={async () => null}
      variants={{ data: null, error: null, busy: false, selected: "A", active: "A", reload: async () => {}, fork: async () => {}, choose: async () => {}, undo: async () => {} }}
    />,
  );
  it("offers the Edit measures button", () => {
    expect(html).toContain(t["edit.open"]);
  });

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

describe("ReformScreen conversation (bug E)", () => {
  it("renders the user and agent bubbles in the dock", () => {
    const html = renderToString(
      <ReformScreen
        scene={null}
        locale="en"
        selectedWallId={null}
        onSelectWall={noop}
        onSceneChange={noop}
        messages={[
          { id: "u1", role: "user", text: "Add a bedroom" },
          { id: "a1", role: "assistant", text: "Added the bedroom." },
        ]}
        onSend={noop}
        onAudio={noop}
        pending={false}
        agentError={null}
        onNext={noop}
        onEdit={async () => null}
        variants={{ data: null, error: null, busy: false, selected: "A", active: "A", reload: async () => {}, fork: async () => {}, choose: async () => {}, undo: async () => {} }}
      />,
    );
    expect(html).toContain("Add a bedroom");
    expect(html).toContain("Added the bedroom.");
    expect(html).toContain('data-role="user"');
    expect(html).toContain('data-role="assistant"');
  });
});

describe("activeVariant", () => {
  it("is null on Now (read-only) and the label otherwise", () => {
    expect(activeVariant(NOW, "A")).toBeNull();
    expect(activeVariant("B", "A")).toBe("B");
    expect(activeVariant("", "A")).toBe("A");
  });
  it("shows the read-only hint on Now", () => {
    const sc = { id: "s", walls: [], rooms: [] } as unknown as Scene;
    const st = { data: { chosen: "A", variants: [{ label: "A", scene: sc }] } as never, error: null, busy: false, selected: NOW, active: null, reload: async () => {}, fork: async () => {}, choose: async () => {}, undo: async () => {} } as VariantsState;
    expect(renderToString(<VariantTabs state={st} locale="en" />)).toContain("read-only");
  });
});

describe("VariantTabs", () => {
  const scene = { id: "s", walls: [], rooms: [{ id: "r", name: "x", polygon: [[0, 0], [5, 0], [5, 5], [0, 5]] }] } as unknown as Scene;
  const state = (selected: string): VariantsState => ({
    data: { chosen: "A", variants: [{ label: "A", scene }, { label: "B", scene }] } as never,
    error: null,
    busy: false,
    selected,
    active: selected === NOW ? null : selected,
    reload: async () => {},
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
