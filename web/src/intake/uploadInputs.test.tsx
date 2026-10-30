import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { UploadStep } from "./UploadStep";

describe("UploadStep inputs", () => {
  it("camera input captures the environment camera; gallery input does not; both accept images", () => {
    const html = renderToString(<UploadStep locale="en" onPhoto={() => {}} onError={() => {}} />);
    const inputs = html.match(/<input[^>]*type="file"[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
    expect(inputs.filter((i) => i.includes('capture="environment"'))).toHaveLength(1);
    expect(inputs.every((i) => i.includes('accept="image/*"'))).toBe(true);
  });
});
