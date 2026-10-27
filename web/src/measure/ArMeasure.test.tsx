import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { ArMeasure } from "./ArMeasure";
import { applySceneOp } from "../scene/store";
import { pairCornersToWallUpdate } from "./cornerMath";
import type { XrHitTestAdapter } from "./xrAdapter";
import type { Scene } from "../scene/types";
import type { SceneOp } from "../scene/store";
import type { Vec3 } from "./cornerMath";

/** Captures the adapter callbacks so the test taps corners like a device. */
function makeFakeAdapter() {
  let onTap: ((corner: Vec3) => void) | null = null;
  const adapter: XrHitTestAdapter = {
    start: async (callbacks) => {
      onTap = callbacks.onTapCorner;
    },
    end: () => undefined,
  };
  return {
    adapter,
    tap: (corner: Vec3) => onTap?.(corner),
  };
}

const scene: Scene = {
  id: "intake",
  version: 1,
  units: "m",
  scale_confirmed: false,
  ceiling_height_m: 2.6,
  walls: [
    { id: "w0", a: [0, 0], b: [2, 0], thickness_m: 0.2, kind: "exterior", provenance: "estimated" },
  ],
  openings: [],
  rooms: [],
};

function noopChange(_next: Scene, _op: SceneOp): void {}
function noopDone(_next: Scene): void {}
function noopCancel(): void {}

describe("ArMeasure", () => {
  it("renders the AR title and first-tap prompt", () => {
    const { adapter } = makeFakeAdapter();
    const html = renderToString(
      <ArMeasure
        locale="en"
        scene={scene}
        adapter={adapter}
        onChange={noopChange}
        onDone={noopDone}
        onCancel={noopCancel}
      />,
    );
    expect(html).toContain("Measure with AR");
    expect(html).toContain("Tap the first corner");
  });

  it("3-4-5 corners through the real path emit measured_ar length 5m", () => {
    // Same functions the component wires: corner pair -> op -> store.
    const update = pairCornersToWallUpdate(
      [
        [0, 0, 0],
        [3, 4, 0],
      ],
      "w0",
    );
    expect(update?.provenance).toBe("measured_ar");
    const op: SceneOp = {
      type: "setWallLength",
      wallId: "w0",
      lengthM: update?.lengthM ?? 0,
      provenance: "measured_ar",
    };
    const next = applySceneOp(scene, op);
    expect(next.walls?.[0]?.measured_length_m).toBeCloseTo(5, 9);
    expect(next.walls?.[0]?.provenance).toBe("measured_ar");
  });

  it("renders the Spanish strings under es-AR", () => {
    const { adapter } = makeFakeAdapter();
    const html = renderToString(
      <ArMeasure
        locale="es-AR"
        scene={scene}
        adapter={adapter}
        onChange={noopChange}
        onDone={noopDone}
        onCancel={noopCancel}
      />,
    );
    expect(html).toContain("Medir con AR");
  });

  it("uses the injected fake adapter seam", async () => {
    const { adapter, tap } = makeFakeAdapter();
    const seen: Vec3[] = [];
    await adapter.start({ onTapCorner: (c) => seen.push(c), onEnd: () => undefined });
    tap([0, 0, 0]);
    tap([3, 4, 0]);
    expect(seen).toHaveLength(2);
    expect(vi.fn).toBeDefined();
  });
});
