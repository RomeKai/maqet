import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentApiError, parseTurnResponse, sendTurn, turnUrl } from "./agentApi";

const okBody = {
  scene: { id: "p1", version: 3 },
  reply: "Added a bedroom next to the kitchen.",
  tool_events: [
    {
      name: "add_room",
      arguments: { function: "bedroom", next_to: "kitchen" },
      ok: true,
      errors: [],
      warnings: [],
      flags: [],
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("turnUrl", () => {
  it("is built from the configured API base (same-origin /api by default) and encodes the project id", () => {
    expect(turnUrl("p 1")).toBe("/api/projects/p%201/turn");
  });
});

describe("sendTurn", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs JSON { text } to the turn route", async () => {
    fetchMock.mockResolvedValue(jsonResponse(okBody));
    await sendTurn("p1", "add a bedroom");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/projects/p1/turn");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ text: "add a bedroom" });
  });

  it("forwards the tap selection as context when present", async () => {
    fetchMock.mockResolvedValue(jsonResponse(okBody));
    await sendTurn("p1", "make this bigger", { kind: "room", id: "r1" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      text: "make this bigger",
      selected: { kind: "room", id: "r1" },
    });
  });

  it("returns the typed turn response", async () => {
    fetchMock.mockResolvedValue(jsonResponse(okBody));
    const turn = await sendTurn("p1", "add a bedroom");
    expect(turn.reply).toBe(okBody.reply);
    expect(turn.scene.id).toBe("p1");
    expect(turn.tool_events[0]?.name).toBe("add_room");
  });

  it("raises AgentApiError carrying the HTTP status on a non-2xx answer", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "nope" }, 503));
    await expect(sendTurn("p1", "hi")).rejects.toMatchObject({
      name: "AgentApiError",
      status: 503,
    });
  });

  it("raises AgentApiError when the network fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(sendTurn("p1", "hi")).rejects.toBeInstanceOf(AgentApiError);
  });

  it("raises AgentApiError when the body is not a turn response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reply: 42 }));
    await expect(sendTurn("p1", "hi")).rejects.toBeInstanceOf(AgentApiError);
  });

  it("rejects empty text without calling the network", async () => {
    await expect(sendTurn("p1", "   ")).rejects.toBeInstanceOf(AgentApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("parseTurnResponse", () => {
  it("defaults missing tool event lists to empty arrays", () => {
    const turn = parseTurnResponse({
      scene: { id: "p1" },
      reply: "ok",
      tool_events: [{ name: "move_wall", arguments: {}, ok: false }],
    });
    expect(turn.tool_events[0]).toMatchObject({ errors: [], warnings: [], flags: [] });
  });

  it("keeps professional flags and error codes from the server", () => {
    const turn = parseTurnResponse({
      scene: { id: "p1" },
      reply: "I need a professional for that.",
      tool_events: [
        {
          name: "add_level",
          arguments: {},
          ok: true,
          errors: [{ code: "door.width_below_minimum", message: "Door too narrow" }],
          warnings: ["check span"],
          flags: ["needs_professional:second_floor"],
        },
      ],
    });
    expect(turn.tool_events[0]?.flags).toEqual(["needs_professional:second_floor"]);
    expect(turn.tool_events[0]?.errors[0]?.code).toBe("door.width_below_minimum");
    expect(turn.tool_events[0]?.warnings).toEqual(["check span"]);
  });

  it("throws on a malformed payload", () => {
    expect(() => parseTurnResponse(null)).toThrow(AgentApiError);
    expect(() => parseTurnResponse({ scene: {}, reply: "x", tool_events: "no" })).toThrow(AgentApiError);
  });
});
