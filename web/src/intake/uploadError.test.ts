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
});
