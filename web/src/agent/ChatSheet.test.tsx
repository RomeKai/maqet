import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatSheet } from "./ChatSheet";
import { PushToTalk } from "./PushToTalk";
import { getAgentStrings } from "./agent.i18n";
import type { ChatMessage, ToolEvent } from "./agentTypes";

function event(overrides: Partial<ToolEvent> = {}): ToolEvent {
  return { name: "add_room", arguments: {}, ok: true, errors: [], warnings: [], flags: [], ...overrides };
}

function render(messages: ChatMessage[], extra: Partial<Parameters<typeof ChatSheet>[0]> = {}): string {
  return renderToString(
    <ChatSheet messages={messages} locale="en" onSend={() => undefined} {...extra} />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChatSheet", () => {
  it("renders user and assistant messages in order", () => {
    const html = render([
      { id: "1", role: "user", text: "add a bedroom" },
      { id: "2", role: "assistant", text: "Done: bedroom added." },
    ]);
    expect(html.indexOf("add a bedroom")).toBeGreaterThan(-1);
    expect(html.indexOf("Done: bedroom added.")).toBeGreaterThan(html.indexOf("add a bedroom"));
    expect(html).toContain('data-role="user"');
    expect(html).toContain('data-role="assistant"');
  });

  it("escapes message text instead of injecting markup", () => {
    const html = render([{ id: "1", role: "user", text: "<img src=x onerror=alert(1)>" }]);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("shows the empty state hint when there are no messages", () => {
    expect(render([])).toContain(getAgentStrings("en")["chat.empty"]);
  });

  it("renders an applied op as a compact chip", () => {
    const html = render([{ id: "1", role: "assistant", text: "ok", toolEvents: [event({ name: "add_room" })] }]);
    expect(html).toContain('data-chip="applied"');
    expect(html).toContain("Add room");
  });

  it("renders each rule violation as a warning-styled chip with its code", () => {
    const html = render([
      {
        id: "1",
        role: "assistant",
        text: "That door is too narrow.",
        toolEvents: [
          event({
            name: "add_opening",
            ok: false,
            errors: [{ code: "door.width_below_minimum", message: "Door too narrow" }],
          }),
        ],
      },
    ]);
    expect(html).toContain('data-chip="violation"');
    expect(html).toContain('data-code="door.width_below_minimum"');
    expect(html).toContain("Door too narrow");
    expect(html).not.toContain('data-chip="applied"');
  });

  it("renders a generic rejected chip when a tool failed without rule errors", () => {
    const html = render([
      { id: "1", role: "assistant", text: "x", toolEvents: [event({ name: "move_wall", ok: false })] },
    ]);
    expect(html).toContain('data-chip="rejected"');
    expect(html).toContain(getAgentStrings("en")["chip.rejected"]);
    expect(html).not.toContain('data-chip="applied"');
    const es = render(
      [{ id: "1", role: "assistant", text: "x", toolEvents: [event({ ok: false })] }],
      { locale: "es-AR" },
    );
    expect(es).toContain(getAgentStrings("es-AR")["chip.rejected"]);
  });

  it("does not add a rejected chip when the failure already lists rule errors", () => {
    const html = render([
      {
        id: "1",
        role: "assistant",
        text: "x",
        toolEvents: [event({ ok: false, errors: [{ code: "a.b", message: "Nope" }] })],
      },
    ]);
    expect(html).not.toContain('data-chip="rejected"');
  });

  it("renders a licensed-professional flag as an alert chip with the localized label", () => {
    const html = render([
      {
        id: "1",
        role: "assistant",
        text: "A second floor needs an engineer.",
        toolEvents: [event({ name: "add_level", flags: ["needs_professional:second_floor"] })],
      },
    ]);
    expect(html).toContain('data-chip="professional"');
    expect(html).toContain('data-flag="needs_professional:second_floor"');
    expect(html).toContain('role="alert"');
    expect(html).toContain(getAgentStrings("en")["flag.needs_professional:second_floor"]);
  });

  it("falls back to a generic professional label for unknown flag codes", () => {
    const html = render([
      {
        id: "1",
        role: "assistant",
        text: "x",
        toolEvents: [event({ flags: ["needs_professional:something_new"] })],
      },
    ]);
    expect(html).toContain('data-chip="professional"');
    expect(html).toContain(getAgentStrings("en")["flag.generic"]);
  });

  it("renders tool warnings as warning chips", () => {
    const html = render([
      { id: "1", role: "assistant", text: "x", toolEvents: [event({ warnings: ["Window ratio is low"] })] },
    ]);
    expect(html).toContain('data-chip="warning"');
    expect(html).toContain("Window ratio is low");
  });

  it("localizes the chrome to es-AR", () => {
    const html = render([], { locale: "es-AR" });
    expect(html).toContain(getAgentStrings("es-AR")["chat.send"]);
    expect(html).not.toContain(getAgentStrings("en")["chat.send"]);
  });

  it("offers a labelled text input with a send button of at least 44px (class contract)", () => {
    const html = render([]);
    expect(html).toContain('aria-label="' + getAgentStrings("en")["chat.input"] + '"');
    expect(html).toContain("agent-send");
  });

  it("disables sending and signals progress while a turn is pending", () => {
    const html = render([], { pending: true });
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/<button[^>]*class="agent-send"[^>]*disabled/);
  });

  it("leaves the preliminary label to the single app footer", () => {
    expect(render([])).not.toContain(getAgentStrings("en")["caption.preliminary"]);
  });

  it("shows quick-request chips that are buttons", () => {
    const html = render([], { suggestions: true });
    expect(html).toContain("agent-suggestion");
    expect(html).toContain(getAgentStrings("en")["suggest.bedroom"]);
  });

  it("with a microphone: talk bar with hint, round mic, Next, and the text row behind a keyboard button", () => {
    const html = render([], { onAudio: () => undefined, onNext: () => undefined });
    expect(html).toContain(getAgentStrings("en")["bar.hint"]);
    expect(html).toContain('data-appearance="round"');
    expect(html).toContain(getAgentStrings("en")["bar.next"]);
    expect(html).toContain('aria-label="' + getAgentStrings("en")["bar.keyboard"] + '"');
    expect(html).not.toContain("agent-input");
  });

  it("shows the unsupported voice state when the microphone APIs are missing", () => {
    vi.stubGlobal("navigator", {});
    const html = render([], { onAudio: () => undefined });
    expect(html).toContain('data-ptt-state="unsupported"');
  });

  it("omits push-to-talk when no onAudio handler is given", () => {
    expect(render([])).not.toContain("data-ptt-state");
  });
});

describe("PushToTalk", () => {
  it("starts idle and enabled when recording is supported", () => {
    vi.stubGlobal("MediaRecorder", class {});
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => Promise.resolve({}) } });
    const html = renderToString(<PushToTalk locale="en" onAudio={() => undefined} />);
    expect(html).toContain('data-ptt-state="idle"');
    expect(html).not.toContain("disabled");
    expect(html).toContain(getAgentStrings("en")["ptt.hold"]);
  });

  it("explains why voice is unavailable and disables the button", () => {
    vi.stubGlobal("navigator", {});
    const html = renderToString(<PushToTalk locale="en" onAudio={() => undefined} />);
    expect(html).toContain('data-ptt-state="unsupported"');
    expect(html).toContain("disabled");
    expect(html).toContain(getAgentStrings("en")["ptt.unsupported"]);
  });
});
