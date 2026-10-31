import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./agentTypes";
import { CONVERSATION_LIMIT, chatKey, toConversation } from "./conversation";
import { sendTurn } from "./agentApi";
import type { Scene } from "../scene/types";

const msg = (i: number, role: "user" | "assistant", extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m${i}`,
  role,
  text: `t${i}`,
  ...extra,
});

describe("toConversation", () => {
  it("caps at the last 12 messages, oldest first", () => {
    const all = Array.from({ length: 30 }, (_, i) => msg(i, i % 2 === 0 ? "user" : "assistant"));
    const out = toConversation(all);
    expect(out).toHaveLength(CONVERSATION_LIMIT);
    expect(out[0].text).toBe("t18");
    expect(out.at(-1)?.text).toBe("t29");
  });
  it("uses the spoken reply, not the appended tool notes", () => {
    const out = toConversation([msg(0, "assistant", { text: "Done\n\n• Warning: x", spoken: "Done" })]);
    expect(out).toEqual([{ role: "assistant", text: "Done" }]);
  });
  it("drops empty messages", () => {
    expect(toConversation([msg(0, "user", { text: "  " })])).toEqual([]);
  });
});

describe("chatKey", () => {
  it("separates variants and stages", () => {
    expect(chatKey("stage.reform", "A")).toBe("reform:A");
    expect(chatKey("stage.reform", "B")).not.toBe(chatKey("stage.reform", "A"));
    expect(chatKey("stage.reform", null)).toBe("reform:now");
    expect(chatKey("stage.reform", "")).toBe("reform:now"); // variants not loaded yet
    expect(chatKey("stage.design", "A")).toBe("stage.design");
  });
});

describe("sendTurn conversation", () => {
  it("sends the conversation in the request body", async () => {
    let body: Record<string, unknown> = {};
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response("{}", { status: 500 });
    }) as typeof fetch;
    try {
      await sendTurn({
        scene: { id: "s", walls: [] } as unknown as Scene,
        message: "wall 3",
        stage: "reform",
        conversation: [{ role: "user", text: "add a 3x4 bedroom" }],
      }).catch(() => undefined);
    } finally {
      globalThis.fetch = original;
    }
    expect(body.conversation).toEqual([{ role: "user", text: "add a 3x4 bedroom" }]);
  });
});
