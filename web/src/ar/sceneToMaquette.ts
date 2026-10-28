import * as THREE from "three";
import type { Furniture, Scene } from "../scene/types";
import { planToThree, sceneToMeshes } from "../view3d/sceneToMeshes";

/** Table-top maquette scale: 1 unit = 1 m at scale 1, so 1:50 is 0.02. */
export const DEFAULT_MAQUETTE_SCALE = 1 / 50;

/** Node name of the maquette root; the exported file carries the preliminary label (ADR-023). */
export const MAQUETTE_NAME = "maqet-maquette (preliminary)";

// Walls and floors share one material each (fewer draw calls on phones); concept pieces use the
// mobile-ui violet so they never pass for real products.
const WALL_COLOR = "#ece8e1";
const FLOOR_COLOR = "#e8e2d8";
const FURNITURE_COLOR = "#c9b79c";
const CONCEPT_COLOR = "#7a5ac8";

function furnitureMesh(item: Furniture, material: THREE.Material): THREE.Mesh {
  const [width, depth, height] = item.size_m;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  const concept = item.concept === true;
  mesh.name = concept ? `furniture:${item.id} (concept)` : `furniture:${item.id}`;
  mesh.position.set(...planToThree(item.position, height / 2));
  // Plan rotation about Z is a rotation about +Y by the same angle (see view3d/sceneToMeshes).
  mesh.rotation.y = THREE.MathUtils.degToRad(item.rotation_deg ?? 0);
  if (concept) mesh.userData.concept = true;
  return mesh;
}

/**
 * Table-top AR maquette of the Scene as a three.js Y-up Group, in metres times `scale`.
 * Geometry comes from `sceneToMeshes` (the same descriptors as the 3D view): wall boxes with openings
 * left as gaps and room floors. There is no ceiling, so the maquette reads from above. Furniture is
 * drawn as plain boxes; concept pieces are named "(concept)" and flagged in `userData`.
 */
export function sceneToMaquette(scene: Scene, scale: number = DEFAULT_MAQUETTE_SCALE): THREE.Group {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError(`Maquette scale must be a positive finite number, got ${scale}`);
  }

  const wallMaterial = new THREE.MeshStandardMaterial({ color: WALL_COLOR });
  const floorMaterial = new THREE.MeshStandardMaterial({ color: FLOOR_COLOR, side: THREE.DoubleSide });
  const furnitureMaterial = new THREE.MeshStandardMaterial({ color: FURNITURE_COLOR });
  const conceptMaterial = new THREE.MeshStandardMaterial({ color: CONCEPT_COLOR });

  const { walls, floors } = sceneToMeshes(scene);
  const group = new THREE.Group();
  group.name = MAQUETTE_NAME;
  group.userData = { preliminary: true, scale };

  for (const wall of walls) {
    const [length, thickness, height] = wall.size;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, height, thickness), wallMaterial);
    mesh.name = `wall:${wall.id}`;
    mesh.position.set(...planToThree([wall.center[0], wall.center[1]], wall.center[2]));
    mesh.rotation.y = wall.rotationZ;
    group.add(mesh);
  }

  for (const floor of floors) {
    const shape = new THREE.Shape(floor.points.map(([x, y]) => new THREE.Vector2(x, y)));
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), floorMaterial);
    mesh.name = `floor:${floor.id}`;
    mesh.rotation.x = -Math.PI / 2;
    group.add(mesh);
  }

  for (const item of scene.furniture ?? []) {
    group.add(furnitureMesh(item, item.concept === true ? conceptMaterial : furnitureMaterial));
  }

  group.scale.setScalar(scale);
  return group;
}
