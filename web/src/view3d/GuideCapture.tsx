import { Canvas, useThree } from "@react-three/fiber";
import { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import type * as THREE from "three";
import type { Scene } from "../scene/types";
import { GUIDE_SIZE_PX, guideCameras, type GuideCamera } from "./guideCamera";
import { SceneMeshesView } from "./SceneView";
import { planToThree } from "./sceneToMeshes";

const PNG_PREFIX = "data:image/png;base64,";

/** What the guide shows: furniture shapes, openings and finishes. No wall badges, no labels, no UI. */
export function GuideScene({ scene }: { scene: Scene }): React.JSX.Element {
  return <SceneMeshesView scene={scene} wallNumbers={false} labels={false} />;
}

function FixedCamera({ view }: { view: GuideCamera }): null {
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const p = planToThree([view.position[0], view.position[1]], view.position[2]);
    const t = planToThree([view.target[0], view.target[1]], view.target[2]);
    cam.fov = view.fovDeg;
    cam.near = 0.05;
    cam.far = 100;
    cam.position.set(p[0], p[1], p[2]);
    cam.lookAt(t[0], t[1], t[2]);
    cam.updateProjectionMatrix();
  }, [camera, view]);
  return null;
}

/**
 * Renders the Design scene once from one fixed camera on an off-screen canvas and returns the PNG as
 * base64 (no data: prefix), 1024 px wide. Null when there is no WebGL.
 */
async function captureGuideImage(scene: Scene, view: GuideCamera): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${GUIDE_SIZE_PX.width}px;height:${GUIDE_SIZE_PX.height}px;pointer-events:none`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    return await new Promise<string | null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), 8000);
      root.render(
        <Canvas
          dpr={1}
          frameloop="always"
          shadows={false}
          gl={{ antialias: true, preserveDrawingBuffer: true }}
          camera={{ fov: view.fovDeg, position: [0, 1.6, 0] }}
          onCreated={({ gl, scene: three, camera }) => {
            let frames = 0;
            const tick = (): void => {
              frames += 1;
              if (frames < 3) {
                window.requestAnimationFrame(tick);
                return;
              }
              gl.render(three, camera);
              window.clearTimeout(timer);
              const url = gl.domElement.toDataURL("image/png");
              resolve(url.startsWith(PNG_PREFIX) ? url.slice(PNG_PREFIX.length) : null);
            };
            window.requestAnimationFrame(tick);
          }}
        >
          <color attach="background" args={["#efe9df"]} />
          <ambientLight intensity={0.9} />
          <directionalLight position={[3, 6, 2]} intensity={0.9} />
          <FixedCamera view={view} />
          <GuideScene scene={scene} />
        </Canvas>,
      );
    });
  } catch {
    return null;
  } finally {
    root.unmount();
    host.remove();
  }
}

/** One capture per guide camera, one at a time: phones limit how many WebGL contexts can be alive. */
export async function captureGuideImages(scene: Scene, roomId: string): Promise<(string | null)[]> {
  const guides: (string | null)[] = [];
  for (const view of guideCameras(scene, roomId)) guides.push(await captureGuideImage(scene, view));
  return guides;
}
