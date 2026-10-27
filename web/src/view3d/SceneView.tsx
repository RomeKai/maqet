import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Scene } from "../scene/types";
import {
  cameraForBoundingBox,
  planToThree,
  sceneBoundingBox,
  sceneToMeshes,
} from "./sceneToMeshes";

interface SceneViewProps {
  scene: Scene;
  selectedWallId?: string | null;
  onSelectWall?: (wallId: string) => void;
}

/**
 * Phone-first 3D view of the measured Scene.
 * - Descriptors from sceneToMeshes(): pure geometry math, unit-tested there.
 * - Renderer detail: plan rotation about Z is a three.js rotation about +Y
 *   by the same angle (rotation about Z tips walls sideways). Centers go
 *   through planToThree so the mapping is defined once.
 * - Phone-safe: pixel-ratio capped at 2 (mobile-ui skill), demand frameloop,
 *   no shadows.
 * - Empty/partial scenes render an empty canvas, never crash: the descriptors
 *   are just empty arrays. The wrapper keeps a `data-testid` so tests can
 *   assert fallback rendering WITHOUT WebGL (<Canvas> needs a real GL
 *   context, which jsdom cannot provide — see SceneView.test.tsx).
 */
export function SceneMeshesView({
  scene,
  selectedWallId = null,
  onSelectWall,
}: SceneViewProps): React.JSX.Element {
  const meshes = useMemo(() => sceneToMeshes(scene), [scene]);
  const floorGeometries = useMemo(
    () =>
      meshes.floors.map((floor) => {
        const shape = new THREE.Shape();
        floor.points.forEach(([x, y], i) => {
          if (i === 0) shape.moveTo(x, y);
          else shape.lineTo(x, y);
        });
        shape.closePath();
        return new THREE.ShapeGeometry(shape);
      }),
    [meshes],
  );

  return (
    <group>
      {meshes.walls.map((wall) => (
        <mesh
          key={wall.id}
          // Plan rotation about Z is a three.js rotation about +Y by the
          // same angle (rotation about Z tips the wall sideways). Center
          // goes through planToThree so the mapping is defined once.
          position={planToThree([wall.center[0], wall.center[1]], wall.center[2])}
          rotation={[0, wall.rotationZ, 0]}
          onClick={(e) => {
            e.stopPropagation();
            onSelectWall?.(wall.id);
          }}
        >
          <boxGeometry args={[wall.size[0], wall.size[2], wall.size[1]]} />
          <meshStandardMaterial
            color={
              wall.id === selectedWallId
                ? "#e8a33d"
                : wall.wallKind === "exterior"
                  ? "#8a7f72"
                  : "#b3a898"
            }
            emissive={wall.id === selectedWallId ? "#7a4d00" : "#000000"}
          />
        </mesh>
      ))}
      {meshes.floors.map((floor, i) => (
        <mesh
          key={floor.id}
          geometry={floorGeometries[i]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <meshStandardMaterial color="#e8e2d8" side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Ground plane under the walls, derived from the Scene bbox (never invents
 * rooms: no rooms → no plane). Subtle warm-grey, slightly below z=0 to avoid
 * z-fighting with room floors.
 */
function GroundPlane({ scene }: { scene: Scene }): React.JSX.Element | null {
  const plane = useMemo(() => {
    const bbox = sceneBoundingBox(scene);
    if (bbox === null) return null;
    const margin = 1;
    const width = bbox.max[0] - bbox.min[0] + margin * 2;
    const depth = bbox.max[1] - bbox.min[1] + margin * 2;
    const cx = (bbox.min[0] + bbox.max[0]) / 2;
    const cy = (bbox.min[1] + bbox.max[1]) / 2;
    return { width, depth, cx, cy };
  }, [scene]);
  if (plane === null) return null;
  return (
    <mesh position={[plane.cx, -0.01, -plane.cy]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[plane.width, plane.depth]} />
      <meshStandardMaterial color="#d9d5ce" side={THREE.DoubleSide} />
    </mesh>
  );
}

/**
 * OrbitControls from the already-installed `three` examples (no new dep):
 * touch rotate + pinch zoom on phones. Tap-to-select keeps working because
 * OrbitControls only starts a drag after the pointer moves — a clean tap
 * still fires the mesh onClick.
 */
function Controls({
  target,
}: {
  target: readonly [number, number, number];
}): React.JSX.Element | null {
  const { camera, gl } = useThree();
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.target.set(target[0], target[1], target[2]);
    controls.enableDamping = false;
    controls.update();
    return () => {
      controls.dispose();
    };
  }, [camera, gl, target]);
  return null;
}

/**
 * Drives the default camera from the Scene bbox: position + target are pure
 * math from sceneToMeshes (unit-tested), applied here only. Runs in an
 * isomorphic layout effect so the SSR fallback test (renderToString) never
 * touches the camera.
 */
function CameraRig({ scene }: { scene: Scene }): React.JSX.Element | null {
  const { camera, size } = useThree();
  const view = useMemo(() => {
    const bbox = sceneBoundingBox(scene);
    const cam = cameraForBoundingBox(bbox, {
      width: size.width,
      height: size.height,
    });
    // Z-up math -> three.js Y-up: [x, y, zUp] becomes [x, zUp, -y].
    return {
      position: new THREE.Vector3(
        cam.position[0],
        cam.position[2],
        -cam.position[1],
      ),
      target: new THREE.Vector3(cam.target[0], cam.target[2], -cam.target[1]),
    };
  }, [scene, size.width, size.height]);
  useLayoutEffect(() => {
    camera.position.copy(view.position);
    camera.lookAt(view.target);
  }, [camera, view]);
  return <Controls target={[view.target.x, view.target.y, view.target.z]} />;
}

export function SceneView({
  scene,
  selectedWallId = null,
  onSelectWall,
}: SceneViewProps): React.JSX.Element {
  return (
    <div
      className="scene-view"
      data-testid="scene-view"
      data-empty={scene.walls?.length ? "no" : "yes"}
      data-selected-wall={selectedWallId ?? ""}
    >
      <Canvas
        dpr={[1, 2]}
        frameloop="demand"
        shadows={false}
        gl={{ antialias: true }}
        camera={{ position: [6, 6, 6], fov: 50 }}
        onPointerMissed={() => onSelectWall?.("")}
      >
        <ambientLight intensity={0.9} />
        <directionalLight position={[5, 10, 4]} intensity={0.9} />
        <CameraRig scene={scene} />
        <GroundPlane scene={scene} />
        <SceneMeshesView
          scene={scene}
          selectedWallId={selectedWallId}
          onSelectWall={onSelectWall}
        />
      </Canvas>
    </div>
  );
}
