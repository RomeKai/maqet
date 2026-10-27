import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import type { Scene } from "../scene/types";
import { sceneToMeshes } from "./sceneToMeshes";

interface SceneViewProps {
  scene: Scene;
}

/**
 * Phone-first 3D view of the measured Scene.
 * - Descriptors from sceneToMeshes(): pure geometry math, unit-tested there.
 * - Renderer detail only: three.js is Y-up, so plan [x, y, zUp] -> [x, zUp, -y].
 * - Phone-safe: pixel-ratio capped at 2 (mobile-ui skill), demand frameloop,
 *   no shadows.
 * - Empty/partial scenes render an empty canvas, never crash: the descriptors
 *   are just empty arrays. The wrapper keeps a `data-testid` so tests can
 *   assert fallback rendering WITHOUT WebGL (<Canvas> needs a real GL
 *   context, which jsdom cannot provide — see SceneView.test.tsx).
 */
export function SceneMeshesView({ scene }: { scene: Scene }): React.JSX.Element {
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
          position={[wall.center[0], wall.center[2], -wall.center[1]]}
          rotation={[0, 0, wall.rotationZ]}
        >
          <boxGeometry args={[wall.size[0], wall.size[2], wall.size[1]]} />
          <meshStandardMaterial
            color={wall.wallKind === "exterior" ? "#8a7f72" : "#b3a898"}
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

export function SceneView({ scene }: SceneViewProps): React.JSX.Element {
  return (
    <div data-testid="scene-view" data-empty={scene.walls?.length ? "no" : "yes"}>
      <Canvas
        dpr={[1, 2]}
        frameloop="demand"
        shadows={false}
        gl={{ antialias: true }}
        camera={{ position: [6, 6, 6], fov: 50 }}
      >
        <ambientLight intensity={0.9} />
        <directionalLight position={[5, 10, 4]} intensity={0.9} />
        <SceneMeshesView scene={scene} />
      </Canvas>
    </div>
  );
}
