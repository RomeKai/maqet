import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Scene } from "../scene/types";
import { OPENING_THEME } from "./openingTheme";
import { accentColor } from "../design/furnitureShapes";
import {
  wallBadgeLayout,
  cameraForBoundingBox,
  planToThree,
  sceneBoundingBox,
  sceneToMeshes,
  furnitureMeshes,
  surfaceOverlays,
} from "./sceneToMeshes";

interface SceneViewProps {
  scene: Scene;
  selectedWallId?: string | null;
  onSelectWall?: (wallId: string) => void;
  /** Numbered wall badges (Reform/Design): the number is the label the agent uses. */
  wallNumbers?: boolean;
  /** Design: tap a piece to select it; the selected piece glows. */
  selectedItemId?: string | null;
  onSelectItem?: (itemId: string) => void;
}

/**
 * Phone-first 3D view of the measured Scene.
 * - Descriptors from sceneToMeshes(): pure geometry math, unit-tested there.
 * - Renderer detail: plan rotation about Z is a three.js rotation about +Y
 *   by the same angle (rotation about Z tips walls sideways). Centers go
 *   through planToThree so the mapping is defined once.
 * - Phone-safe: pixel-ratio capped at 1.5 on Android fill-rate (mobile-ui
 *   skill), demand frameloop with explicit invalidate on control change,
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
  wallNumbers = false,
  selectedItemId = null,
  onSelectItem,
}: SceneViewProps): React.JSX.Element {
  const meshes = useMemo(() => sceneToMeshes(scene), [scene]);
  const furniture = useMemo(() => furnitureMeshes(scene), [scene]);
  const overlays = useMemo(() => surfaceOverlays(scene), [scene]);
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
      {meshes.openings.map((opening) => {
        const theme = OPENING_THEME[opening.openingKind];
        return (
          <mesh
            key={opening.id}
            position={planToThree([opening.center[0], opening.center[1]], opening.center[2])}
            rotation={[0, opening.rotationZ, 0]}
          >
            <boxGeometry args={[opening.size[0], opening.size[2], opening.size[1]]} />
            <meshStandardMaterial
              color={theme.color}
              transparent={theme.opacity < 1}
              opacity={theme.opacity}
            />
          </mesh>
        );
      })}
      {overlays.map((o) => (
        <mesh key={o.id} position={planToThree([o.center[0], o.center[1]], o.center[2])} rotation={[0, o.rotationZ, 0]}>
          <boxGeometry args={[o.size[0], o.size[2], o.size[1]]} />
          <meshStandardMaterial color={o.color} />
        </mesh>
      ))}
      {furniture.map((f) => {
        const selected = f.id === selectedItemId;
        return (
          <group
            key={f.id}
            name={`furniture:${f.id} (${f.type})`}
            position={planToThree([f.center[0], f.center[1]], 0)}
            rotation={[0, f.rotationZ, 0]}
            onClick={
              onSelectItem
                ? (e) => {
                    e.stopPropagation();
                    onSelectItem(f.id);
                  }
                : undefined
            }
          >
            {f.parts.map((p, i) => {
              const base = f.concept ? "#7a5ac8" : f.color;
              return (
                <mesh key={i} position={[p.center[0], p.center[2], -p.center[1]]}>
                  {p.shape === "cylinder" ? (
                    <cylinderGeometry args={[p.size[0] / 2, p.size[0] / 2, p.size[2], 12]} />
                  ) : (
                    <boxGeometry args={[p.size[0], p.size[2], p.size[1]]} />
                  )}
                  <meshStandardMaterial
                    color={p.tone === 1 ? accentColor(base) : base}
                    emissive={selected ? "#e8a33d" : "#000000"}
                    emissiveIntensity={selected ? 0.55 : 0}
                  />
                </mesh>
              );
            })}
          </group>
        );
      })}
      <FurnitureLabels items={furniture} />
      {wallNumbers ? <WallBadges scene={scene} /> : null}
      {meshes.floors.map((floor, i) => (
        <mesh
          key={floor.id}
          geometry={floorGeometries[i]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <meshStandardMaterial color={floor.color ?? "#e8e2d8"} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

function labelTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.fillStyle = "#1f2124";
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 36px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 34);
  }
  return new THREE.CanvasTexture(canvas);
}

/** Type label above each furniture box (bed, sofa...): the 3D stays honest that these are placeholders. */
function FurnitureLabels({ items }: { items: ReturnType<typeof furnitureMeshes> }): React.JSX.Element {
  const labels = useMemo(() => items.map((f) => ({ ...f, texture: labelTexture(f.type) })), [items]);
  useEffect(() => () => labels.forEach((l) => l.texture.dispose()), [labels]);
  return (
    <group>
      {labels.map((l) => (
        <sprite key={l.id} position={planToThree([l.center[0], l.center[1]], l.size[2] + 0.25)} scale={[0.6, 0.15, 1]}>
          <spriteMaterial map={l.texture} depthTest={false} transparent />
        </sprite>
      ))}
    </group>
  );
}

/** Number sprite texture (client only: needs a canvas). */
function badgeTexture(n: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.fillStyle = "#1f2124";
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 72px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), 64, 70);
  }
  return new THREE.CanvasTexture(canvas);
}

/** Numbered circles on each wall, like the Check step plan; same numbers the agent uses. */
function WallBadges({ scene }: { scene: Scene }): React.JSX.Element {
  const layout = useMemo(() => wallBadgeLayout(scene), [scene]);
  const badges = useMemo(
    () => layout.badges.map((b) => ({ ...b, texture: badgeTexture(b.number) })),
    [layout],
  );
  useEffect(() => () => badges.forEach((b) => b.texture.dispose()), [badges]);
  return (
    <group>
      {badges.map((b) => (
        <sprite
          key={b.wallId}
          position={planToThree([b.position[0], b.position[1]], b.position[2])}
          scale={[layout.size, layout.size, layout.size]}
        >
          <spriteMaterial map={b.texture} depthTest={false} transparent />
        </sprite>
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
 * still fires the mesh onClick. Zoom is clamped to the Scene bbox so a wild
 * pinch can't dive inside the walls (near-plane clipping churn = the
 * Android lag) or lose the house: min 0.5 m for close looks, max twice the
 * autofit distance. Demand frameloop still needs an explicit invalidate on
 * change — otherwise the canvas freezes mid-gesture.
 */
function Controls({
  target,
  minDistance,
  maxDistance,
}: {
  target: readonly [number, number, number];
  minDistance: number;
  maxDistance: number;
}): React.JSX.Element | null {
  const { camera, gl, invalidate } = useThree();
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.target.set(target[0], target[1], target[2]);
    controls.enableDamping = false;
    controls.minDistance = minDistance;
    controls.maxDistance = maxDistance;
    const onChange = (): void => invalidate();
    controls.addEventListener("change", onChange);
    controls.update();
    return () => {
      controls.removeEventListener("change", onChange);
      controls.dispose();
    };
  }, [camera, gl, invalidate, target, minDistance, maxDistance]);
  return null;
}

/**
 * Drives the default camera from the Scene bbox: position + target are pure
 * math from sceneToMeshes (unit-tested), applied here only. Zoom clamps ride
 * along: min 0.5 m (close looks without entering wall boxes), max twice the
 * autofit distance (a wild pinch can't lose the house). Runs in an
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
    const position = new THREE.Vector3(
      cam.position[0],
      cam.position[2],
      -cam.position[1],
    );
    const target = new THREE.Vector3(cam.target[0], cam.target[2], -cam.target[1]);
    return {
      position,
      target,
      minDistance: 0.5,
      maxDistance: Math.max(position.distanceTo(target) * 2, 2),
    };
  }, [scene, size.width, size.height]);
  useLayoutEffect(() => {
    camera.position.copy(view.position);
    camera.lookAt(view.target);
  }, [camera, view]);
  return (
    <Controls
      target={[view.target.x, view.target.y, view.target.z]}
      minDistance={view.minDistance}
      maxDistance={view.maxDistance}
    />
  );
}

export function SceneView({
  scene,
  selectedWallId = null,
  onSelectWall,
  wallNumbers = false,
  selectedItemId = null,
  onSelectItem,
}: SceneViewProps): React.JSX.Element {
  return (
    <div
      className="scene-view"
      data-testid="scene-view"
      data-empty={scene.walls?.length ? "no" : "yes"}
      data-selected-wall={selectedWallId ?? ""}
      data-wall-numbers={wallNumbers ? "yes" : "no"}
    >
      <Canvas
        dpr={[1, 1.5]}
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
          wallNumbers={wallNumbers}
          selectedItemId={selectedItemId}
          onSelectItem={onSelectItem}
        />
      </Canvas>
    </div>
  );
}
