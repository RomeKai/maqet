import { describe, expect, it } from "vitest";
import { arModesFor, initialAttempt, likelyUntrustedHost, nextAttempt } from "./arStatus";

describe("nextAttempt (model-viewer ar-status)", () => {
  it("a placed object then not-presenting is a normal session, not a failure", () => {
    let a = initialAttempt();
    a = nextAttempt(a, "session-started");
    a = nextAttempt(a, "object-placed");
    a = nextAttempt(a, "not-presenting");
    expect(a.failed).toBe(false);
  });

  it("not-presenting with no session started is a failure (Scene Viewer could not load the model)", () => {
    const a = nextAttempt(initialAttempt(), "not-presenting");
    expect(a.failed).toBe(true);
  });

  it("failed is a failure", () => {
    expect(nextAttempt(initialAttempt(), "failed").failed).toBe(true);
  });

  it("a new session clears an earlier failure", () => {
    let a = nextAttempt(initialAttempt(), "failed");
    a = nextAttempt(a, "session-started");
    expect(a.failed).toBe(false);
    expect(a.presenting).toBe(true);
  });

  it("each session needs its own start: a second bare not-presenting fails again", () => {
    let a = nextAttempt(initialAttempt(), "session-started");
    a = nextAttempt(a, "not-presenting");
    expect(a.failed).toBe(false);
    a = nextAttempt(a, "not-presenting");
    expect(a.failed).toBe(true);
  });

  it("ignores unknown statuses", () => {
    const a = initialAttempt();
    expect(nextAttempt(a, "whatever")).toEqual(a);
  });
});

describe("arModesFor", () => {
  it("offers every mode only when the model is hosted over https", () => {
    expect(arModesFor({ hostedReady: true, webxrOnly: false })).toBe("webxr scene-viewer quick-look");
  });
  it("is WebXR only when the hosted copy is missing (Scene Viewer cannot read blob: URLs)", () => {
    expect(arModesFor({ hostedReady: false, webxrOnly: false })).toBe("webxr");
  });
  it("is WebXR only after the user asked to retry with WebXR", () => {
    expect(arModesFor({ hostedReady: true, webxrOnly: true })).toBe("webxr");
  });
});

describe("likelyUntrustedHost", () => {
  it("flags self-signed dev hosts: IPs, localhost and .local", () => {
    for (const o of ["https://192.168.1.20:5173", "https://10.0.0.5", "https://localhost:5173", "https://mac.local:5173", "https://172.16.4.2:5173"]) {
      expect(likelyUntrustedHost(o)).toBe(true);
    }
  });
  it("does not flag a public hostname", () => {
    expect(likelyUntrustedHost("https://maqet.example.com")).toBe(false);
    expect(likelyUntrustedHost("https://abc.trycloudflare.com")).toBe(false);
  });
  it("treats plain http as unusable too", () => {
    expect(likelyUntrustedHost("http://maqet.example.com")).toBe(true);
  });
});
