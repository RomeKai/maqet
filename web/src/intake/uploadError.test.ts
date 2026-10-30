import { describe, expect, it } from "vitest";
import { classifyUploadError } from "./uploadError";

describe("classifyUploadError", () => {
  it("maps network failures to server-unreachable", () => {
    expect(classifyUploadError("Failed to fetch")).toBe("server");
    expect(classifyUploadError("NetworkError when attempting to fetch resource.")).toBe("server");
  });
  it("maps a replay 409 to replay", () => {
    expect(classifyUploadError("Server returned 409 on POST /intake: pick one of")).toBe("replay");
  });
  it("maps everything else to unreadable photo", () => {
    expect(classifyUploadError("Server returned 422 on POST /intake")).toBe("photo");
    expect(classifyUploadError("Couldn't read the photo. Try again.")).toBe("photo");
  });
  it("never calls a server answer unreachable, even if the detail mentions network words", () => {
    const msg = "Server returned 409 on POST /intake: no recorded vision response for this upload (ReplayMiss: network failed to fetch): pick a recorded sample";
    expect(classifyUploadError(msg)).toBe("replay");
    expect(classifyUploadError("Server returned 500 on POST /intake: failed to fetch model")).toBe("photo");
    expect(classifyUploadError("Could not reach the server (/api/intake): Failed to fetch")).toBe("server");
  });
});
