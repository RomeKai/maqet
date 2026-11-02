import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TURN_TIMEOUT_MS,
  AgentApiError,
  AgentCancelledError,
  parseTurnResponse,
  sendTurn,
  snapshotUrl,
  turnUrl,
  variantChooseUrl,
  variantForkUrl,
  variantUndoUrl,
  variantsUrl,
} from "./agentApi";
import type { OpRecordIn, Scene } from "../scene/types";

const okBody = {
  scene: { id: "p1", version: 3 },
  reply: "Added a bedroom next to the kitchen.",
  ops_applied: [
    { name: "add_room", arguments: { function: "bedroom", next_to: "kitchen" }, flags: [] },
  ],
  professional_flags: [] as string[],
  history: [] as OpRecordIn[],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const scene: Scene = { id: "p1", version: 1, walls: [] };
const history: OpRecordIn[] = [{ op: "add_room", args: {}, before_version: 0, after_version: 1, actor: "agent" }];

describe("turnUrl", () => {
  it("points to POST /agent/turn via the configured API base", () => {
    expect(turnUrl()).toBe("/api/agent/turn");
  });
});

describe("variants urls", () => {
  it("builds variant routes from the API base", () => {
    expect(variantsUrl()).toBe("/api/variants");
    expect(variantForkUrl()).toBe("/api/variants/fork");
    expect(variantChooseUrl("B")).toBe("/api/variants/B/choose");
    expect(variantChooseUrl("A B")).toBe("/api/variants/A%20B/choose");
    expect(variantUndoUrl()).toBe("/api/variants/undo");
  });

  it("builds snapshot url with locale", () => {
    expect(snapshotUrl("en")).toBe("/api/scene/snapshot.svg?locale=en");
    expect(snapshotUrl("es-AR")).toBe("/api/scene/snapshot.svg?locale=es-AR");
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

  it("POSTs JSON { scene, message, stage } to the turn route", async () => {
    fetchMock.mockResolvedValue(jsonResponse(okBody));
    await sendTurn({ scene, message: "add a bedroom", stage: "reform" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/agent/turn");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.message).toBe("add a bedroom");
    expect(body.stage).toBe("reform");
    expect(body.scene).toBeDefined();
    expect(body.history).toEqual([]);
  });

  it("forwards history and tap selection as context when present", async () => {
    fetchMock.mockResolvedValue(jsonResponse(okBody));
    await sendTurn({
      scene,
      message: "make this bigger",
      stage: "design",
      history,
      selected: { kind: "room", id: "r1" },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.history).toEqual(history);
    expect(body.selected).toEqual({ kind: "room", id: "r1" });
    expect(body.stage).toBe("design");
  });

  it("returns the typed turn response", async () => {
    fetchMock.mockResolvedValue(jsonResponse(okBody));
    const turn = await sendTurn({ scene, message: "add a bedroom", stage: "reform" });
    expect(turn.reply).toBe(okBody.reply);
    expect(turn.scene.id).toBe("p1");
    expect(turn.ops_applied[0]?.name).toBe("add_room");
  });

  it("raises AgentApiError carrying the HTTP status on a non-2xx answer", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "nope" }, 503));
    await expect(sendTurn({ scene, message: "hi", stage: "reform" })).rejects.toMatchObject({
      name: "AgentApiError",
      status: 503,
    });
  });

  it("raises AgentApiError when the network fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(sendTurn({ scene, message: "hi", stage: "reform" })).rejects.toBeInstanceOf(AgentApiError);
  });

  it("raises AgentApiError when the body is not a turn response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reply: 42 }));
    await expect(sendTurn({ scene, message: "hi", stage: "reform" })).rejects.toBeInstanceOf(AgentApiError);
  });

  describe("timeout", () => {
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
      await sendTurn({ scene, message: "hi", stage: "reform" });
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("aborts a hung request after the default timeout and rejects with a timeout error", async () => {
      fetchMock.mockImplementation(hangingFetch);
      const outcome = sendTurn({ scene, message: "hi", stage: "reform" }).then(
        () => "resolved",
        (err: unknown) => err,
      );

      await vi.advanceTimersByTimeAsync(TURN_TIMEOUT_MS - 1);
      expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      const err = await outcome;
      expect(err).toBeInstanceOf(AgentApiError);
      expect(err).toMatchObject({ timedOut: true, status: null });
    });

    it("honours a custom timeout", async () => {
      fetchMock.mockImplementation(hangingFetch);
      const outcome = sendTurn({ scene, message: "hi", stage: "reform" }, { timeoutMs: 500 }).catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(500);
      expect(await outcome).toMatchObject({ timedOut: true });
    });

    it("clears the timer once the turn settles", async () => {
      fetchMock.mockResolvedValue(jsonResponse(okBody));
      await sendTurn({ scene, message: "hi", stage: "reform" });
      expect(vi.getTimerCount()).toBe(0);

      fetchMock.mockResolvedValue(jsonResponse({ detail: "nope" }, 500));
      await expect(sendTurn({ scene, message: "hi", stage: "reform" })).rejects.toBeInstanceOf(AgentApiError);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("does not report a plain network failure as a timeout", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      await expect(sendTurn({ scene, message: "hi", stage: "reform" })).rejects.toMatchObject({ timedOut: false });
    });
  });

  it("rejects empty message without calling the network", async () => {
    await expect(sendTurn({ scene, message: "   ", stage: "reform" })).rejects.toBeInstanceOf(AgentApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("parseTurnResponse", () => {
  it("defaults missing flags to empty array", () => {
    const turn = parseTurnResponse({
      scene: { id: "p1" },
      reply: "ok",
      ops_applied: [{ name: "move_wall", arguments: {} }],
      professional_flags: [],
      history: [],
    });
    expect(turn.ops_applied[0]).toMatchObject({ flags: [] });
  });

  it("keeps professional flags from the server", () => {
    const turn = parseTurnResponse({
      scene: { id: "p1" },
      reply: "I need a professional for that.",
      ops_applied: [{ name: "add_level", arguments: {}, flags: ["needs_professional:second_floor"] }],
      professional_flags: ["needs_professional:second_floor"],
      history: [],
    });
    expect(turn.professional_flags).toEqual(["needs_professional:second_floor"]);
    expect(turn.ops_applied[0]?.flags).toEqual(["needs_professional:second_floor"]);
  });

  describe("scene validation", () => {
    const wall = { id: "w1", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior" };
    const turnWith = (s: unknown) => ({ scene: s, reply: "ok", ops_applied: [], professional_flags: [], history: [] });

    it("accepts a well-formed scene with every collection populated", () => {
      const s = {
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
      expect(parseTurnResponse(turnWith(s)).scene.id).toBe("p1");
    });

    it("rejects a scene without a string id", () => {
      expect(() => parseTurnResponse(turnWith({ version: 1 }))).toThrow(AgentApiError);
      expect(() => parseTurnResponse(turnWith({ id: 7 }))).toThrow(AgentApiError);
    });

    it.each(["walls", "openings", "rooms", "surfaces", "furniture", "materials"])(
      "rejects a non-array %s collection with a clear error",
      (field) => {
        expect(() => parseTurnResponse(turnWith({ id: "p1", [field]: {} }))).toThrow(new RegExp(`scene\\.${field}`));
      },
    );

    it("rejects non-finite or non-numeric scalars", () => {
      expect(() => parseTurnResponse(turnWith({ id: "p1", ceiling_height_m: "2.6" }))).toThrow(/ceiling_height_m/);
      expect(() => parseTurnResponse(turnWith({ id: "p1", version: Number.POSITIVE_INFINITY }))).toThrow(AgentApiError);
    });

    it("rejects a wall with a bad coordinate or thickness", () => {
      expect(() => parseTurnResponse(turnWith({ id: "p1", walls: [{ ...wall, a: [0, "x"] }] }))).toThrow(/walls\[0\]\.a/);
      expect(() => parseTurnResponse(turnWith({ id: "p1", walls: [{ ...wall, b: [1] }] }))).toThrow(/walls\[0\]\.b/);
      expect(() => parseTurnResponse(turnWith({ id: "p1", walls: [{ ...wall, thickness_m: null }] }))).toThrow(/thickness_m/);
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
      expect(() => parseTurnResponse(turnWith({ id: "p1", furniture: [{ ...piece, position: [1, NaN] }] }))).toThrow(AgentApiError);
      expect(() => parseTurnResponse(turnWith({ id: "p1", furniture: [{ ...piece, size_m: [1, 1] }] }))).toThrow(
        /furniture\[0\]\.size_m/,
      );
    });
  });

  it("throws on a malformed payload", () => {
    expect(() => parseTurnResponse(null)).toThrow(AgentApiError);
    expect(() => parseTurnResponse({ scene: {}, reply: "x", ops_applied: "no" })).toThrow(AgentApiError);
  });
});

describe("sendTurn cancellation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("aborts the request and rejects with AgentCancelledError when the caller's signal fires", async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const pending = sendTurn({ scene, message: "add a bedroom", stage: "reform" }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(AgentCancelledError);
    await expect(pending).rejects.toMatchObject({ timedOut: false, network: false });
  });

  it("rejects at once when the signal is already aborted, without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(sendTurn({ scene, message: "hi", stage: "reform" }, { signal: controller.signal })).rejects.toBeInstanceOf(AgentCancelledError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
