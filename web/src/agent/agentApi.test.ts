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

  describe("timeout", () => {
    /** A server that never answers; like real fetch, it rejects with an AbortError once the signal fires. */
    function hangingFetch(_url: string, init: RequestInit): Promise<Response> {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("passes an AbortSignal to fetch", async () => {
      fetchMock.mockResolvedValue(jsonResponse(okBody));
      await sendTurn("p1", "hi");
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("aborts a hung request after the default 60 s and rejects with a timeout error", async () => {
      fetchMock.mockImplementation(hangingFetch);
      const outcome = sendTurn("p1", "hi").then(
        () => "resolved",
        (err: unknown) => err,
      );

      await vi.advanceTimersByTimeAsync(59_999);
      expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      const err = await outcome;
      expect(err).toBeInstanceOf(AgentApiError);
      expect(err).toMatchObject({ timedOut: true, status: null });
    });

    it("honours a custom timeout", async () => {
      fetchMock.mockImplementation(hangingFetch);
      const outcome = sendTurn("p1", "hi", undefined, { timeoutMs: 500 }).catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(500);
      expect(await outcome).toMatchObject({ timedOut: true });
    });

    it("clears the timer once the turn settles", async () => {
      fetchMock.mockResolvedValue(jsonResponse(okBody));
      await sendTurn("p1", "hi");
      expect(vi.getTimerCount()).toBe(0);

      fetchMock.mockResolvedValue(jsonResponse({ detail: "nope" }, 500));
      await expect(sendTurn("p1", "hi")).rejects.toBeInstanceOf(AgentApiError);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("does not report a plain network failure as a timeout", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      await expect(sendTurn("p1", "hi")).rejects.toMatchObject({ timedOut: false });
    });
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

  describe("scene validation", () => {
    const wall = { id: "w1", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior" };
    const turnWith = (scene: unknown) => ({ scene, reply: "ok", tool_events: [] });

    it("accepts a well-formed scene with every collection populated", () => {
      const scene = {
        id: "p1",
        version: 2,
        ceiling_height_m: 2.6,
        walls: [wall],
        openings: [{ id: "o1", wall_id: "w1", kind: "door", offset_m: 1, width_m: 0.9, height_m: 2.05 }],
        rooms: [{ id: "r1", name: "Kitchen", polygon: [[0, 0], [4, 0], [4, 3]] }],
        furniture: [{ id: "f1", room_id: "r1", position: [1, 1], size_m: [1, 1, 1] }],
        surfaces: [],
        materials: [],
      };
      expect(parseTurnResponse(turnWith(scene)).scene.id).toBe("p1");
    });

    it("rejects a scene without a string id", () => {
      expect(() => parseTurnResponse(turnWith({ version: 1 }))).toThrow(AgentApiError);
      expect(() => parseTurnResponse(turnWith({ id: 7 }))).toThrow(AgentApiError);
    });

    it.each(["walls", "openings", "rooms", "surfaces", "furniture", "materials"])(
      "rejects a non-array %s collection with a clear error",
      (field) => {
        expect(() => parseTurnResponse(turnWith({ id: "p1", [field]: {} }))).toThrow(
          new RegExp(`scene\\.${field}`),
        );
      },
    );

    it("rejects non-finite or non-numeric scalars", () => {
      expect(() => parseTurnResponse(turnWith({ id: "p1", ceiling_height_m: "2.6" }))).toThrow(/ceiling_height_m/);
      expect(() => parseTurnResponse(turnWith({ id: "p1", version: Number.POSITIVE_INFINITY }))).toThrow(AgentApiError);
    });

    it("rejects a wall with a bad coordinate or thickness", () => {
      expect(() => parseTurnResponse(turnWith({ id: "p1", walls: [{ ...wall, a: [0, "x"] }] }))).toThrow(/walls\[0\]\.a/);
      expect(() => parseTurnResponse(turnWith({ id: "p1", walls: [{ ...wall, b: [1] }] }))).toThrow(/walls\[0\]\.b/);
      expect(() => parseTurnResponse(turnWith({ id: "p1", walls: [{ ...wall, thickness_m: null }] }))).toThrow(
        /thickness_m/,
      );
    });

    it("rejects an opening with a non-finite dimension", () => {
      const opening = { id: "o1", wall_id: "w1", kind: "door", offset_m: 1, width_m: 0.9, height_m: 2 };
      expect(() => parseTurnResponse(turnWith({ id: "p1", openings: [{ ...opening, width_m: "wide" }] }))).toThrow(
        /openings\[0\]\.width_m/,
      );
    });

    it("rejects a room polygon with a malformed vertex", () => {
      expect(() =>
        parseTurnResponse(turnWith({ id: "p1", rooms: [{ id: "r1", name: "K", polygon: [[0, 0], [1]] }] })),
      ).toThrow(/rooms\[0\]\.polygon\[1\]/);
    });

    it("rejects furniture with a malformed position or size", () => {
      const piece = { id: "f1", room_id: "r1", position: [1, 1], size_m: [1, 1, 1] };
      expect(() => parseTurnResponse(turnWith({ id: "p1", furniture: [{ ...piece, position: [1, NaN] }] }))).toThrow(
        AgentApiError,
      );
      expect(() => parseTurnResponse(turnWith({ id: "p1", furniture: [{ ...piece, size_m: [1, 1] }] }))).toThrow(
        /furniture\[0\]\.size_m/,
      );
    });
  });

  it("throws on a malformed payload", () => {
    expect(() => parseTurnResponse(null)).toThrow(AgentApiError);
    expect(() => parseTurnResponse({ scene: {}, reply: "x", tool_events: "no" })).toThrow(AgentApiError);
  });
});
