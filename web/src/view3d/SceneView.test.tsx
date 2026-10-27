import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { SceneView } from "./SceneView";
import type { Scene } from "../scene/types";

/**
 * <Canvas> (react-three-fiber) needs a real WebGL context, which jsdom does
 * not provide — so under vitest the SceneView cannot mount its 3D content.
 * This test asserts the phone-safe fallback instead: the wrapper renders with
 * its data-testid and a data-empty marker, proving empty/partial scenes are
 * handled WITHOUT WebGL rather than crashing. All geometry math is covered by
 * sceneToMeshes.test.ts, which needs no renderer.
 */
describe("SceneView fallback (no WebGL under test)", () => {
  const emptyScene: Scene = { id: "empty" };

  it("renders its wrapper without WebGL on an empty scene", () => {
    const html = renderToString(<SceneView scene={emptyScene} />);
    expect(html).toContain('data-testid="scene-view"');
    expect(html).toContain('data-empty="yes"');
  });

  it("marks a scene with walls as non-empty", () => {
    const html = renderToString(
      <SceneView
        scene={{
          ...emptyScene,
          walls: [
            {
              id: "w1",
              a: [0, 0],
              b: [4, 0],
              thickness_m: 0.2,
              kind: "exterior",
            },
          ],
        }}
      />,
    );
    expect(html).toContain('data-empty="no"');
  });

  it("exposes the selected wall id on the wrapper", () => {
    const html = renderToString(
      <SceneView
        scene={{
          ...emptyScene,
          walls: [
            {
              id: "w1",
              a: [0, 0],
              b: [4, 0],
              thickness_m: 0.2,
              kind: "exterior",
            },
          ],
        }}
        selectedWallId="w1"
      />,
    );
    expect(html).toContain('data-selected-wall="w1"');
  });

  it("renders an empty selection marker when nothing is selected", () => {
    const html = renderToString(<SceneView scene={emptyScene} />);
    expect(html).toContain('data-selected-wall=""');
  });

  it("keeps data-empty=no alongside a selection", () => {
    const html = renderToString(
      <SceneView
        scene={{
          ...emptyScene,
          walls: [
            {
              id: "w1",
              a: [0, 0],
              b: [4, 0],
              thickness_m: 0.2,
              kind: "exterior",
            },
          ],
        }}
        selectedWallId="w1"
      />,
    );
    expect(html).toContain('data-empty="no"');
  });
});
