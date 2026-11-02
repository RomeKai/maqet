import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { AgentApiError } from "./agentApi";
import { describeAgentError, plainAgentError } from "./agentError";
import { AgentErrorNotice } from "./AgentErrorNotice";
import { getAgentStrings } from "./agent.i18n";

describe("describeAgentError", () => {
  it("turns a 409 into one friendly sentence and keeps the raw text as details", () => {
    const raw = "Agent request failed (409): no recorded response for this request";
    const info = describeAgentError(new AgentApiError(raw, 409), "en", "add a bedroom");
    expect(info.message).toBe(getAgentStrings("en")["chat.error.server"]);
    expect(info.message).not.toMatch(/409|failed|\(/);
    expect(info.details).toBe(raw);
    expect(info.retryText).toBe("add a bedroom");
  });

  it("covers a 500 and a timeout in both locales", () => {
    for (const locale of ["en", "es-AR"] as const) {
      const server = describeAgentError(new AgentApiError("Agent request failed (500): boom", 500), locale, "x");
      expect(server.message).toBe(getAgentStrings(locale)["chat.error.server"]);
      const slow = describeAgentError(new AgentApiError("Agent request timed out", null, true), locale, "x");
      expect(slow.message).toBe(getAgentStrings(locale)["chat.error.timeout"]);
    }
  });

  it("handles a non-Error throw without leaking it into the message", () => {
    const info = describeAgentError("weird", "en", null);
    expect(info.message).toBe(getAgentStrings("en")["chat.error.server"]);
    expect(info.details).toBe("weird");
    expect(info.retryText).toBeNull();
  });

  it("plainAgentError has no details and no retry", () => {
    expect(plainAgentError("Pick a variant")).toEqual({ kind: "info", message: "Pick a variant", details: null, retryText: null });
  });
});

describe("AgentErrorNotice", () => {
  const info = describeAgentError(new AgentApiError("Agent request failed (500): boom", 500), "en", "add a bedroom");

  it("shows the friendly sentence, a Retry button and the raw text only inside Details", () => {
    const html = renderToString(<AgentErrorNotice error={info} locale="en" onRetry={() => {}} />);
    const t = getAgentStrings("en");
    expect(html).toContain(t["chat.error.server"]);
    expect(html).toContain(t["chat.retry"]);
    expect(html).toContain("<details");
    expect(html).toContain(t["chat.details"]);
    // The raw line is inside <details>, never in the visible .agent-error paragraph.
    const visible = html.split("<details")[0] ?? "";
    expect(visible).not.toContain("boom");
    expect(visible).not.toContain("500");
  });

  it("omits Retry without retry text and Details without details", () => {
    const html = renderToString(<AgentErrorNotice error={plainAgentError("Pick a variant")} locale="es-AR" onRetry={() => {}} />);
    expect(html).not.toContain(getAgentStrings("es-AR")["chat.retry"]);
    expect(html).not.toContain("<details");
  });

  it("uses 48 px tap targets for Retry and the Details summary", () => {
    const html = renderToString(<AgentErrorNotice error={info} locale="en" onRetry={() => {}} />);
    expect(html.match(/min-h-12/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
