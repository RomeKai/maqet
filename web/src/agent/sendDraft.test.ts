import { describe, expect, it } from "vitest";
import { sendDraft } from "./sendDraft";

function draftBox(initial: string) {
  let value = initial;
  return {
    get: () => value,
    update: (fn: (current: string) => string) => {
      value = fn(value);
    },
  };
}

describe("sendDraft", () => {
  it("clears the draft after a synchronous send", async () => {
    const box = draftBox("hello");
    await sendDraft("hello", () => undefined, box.update);
    expect(box.get()).toBe("");
  });

  it("keeps the draft while an async send is in flight and clears it once resolved", async () => {
    const box = draftBox("hello");
    let finish!: () => void;
    const pending = sendDraft("hello", () => new Promise<void>((r) => (finish = r)), box.update);
    expect(box.get()).toBe("hello");
    finish();
    await pending;
    expect(box.get()).toBe("");
  });

  it("keeps the draft when the send rejects", async () => {
    const box = draftBox("hello");
    await sendDraft("hello", () => Promise.reject(new Error("offline")), box.update);
    expect(box.get()).toBe("hello");
  });

  it("keeps the draft when the send throws synchronously", async () => {
    const box = draftBox("hello");
    await sendDraft(
      "hello",
      () => {
        throw new Error("boom");
      },
      box.update,
    );
    expect(box.get()).toBe("hello");
  });

  it("does not wipe text typed while the send was in flight", async () => {
    const box = draftBox("hello");
    let finish!: () => void;
    const pending = sendDraft("hello", () => new Promise<void>((r) => (finish = r)), box.update);
    box.update(() => "hello and more");
    finish();
    await pending;
    expect(box.get()).toBe("hello and more");
  });
});
