import * as THREE from "three";
import type { Furniture, Scene } from "../scene/types";
import { OPENING_THEME } from "../view3d/openingTheme";
import { furnitureMeshes, planToThree, sceneToMeshes, surfaceOverlays, type FurnitureMesh } from "../view3d/sceneToMeshes";
import { accentColor } from "../design/furnitureShapes";

/** Table-top maquette scale: 1 unit = 1 m at scale 1, so 1:50 is 0.02. */
export const DEFAULT_MAQUETTE_SCALE = 1 / 50;

/** Node name of the maquette root; the exported file carries the preliminary label (ADR-023). */
export const MAQUETTE_NAME = "maqet-maquette (preliminary)";

// Walls and floors share one material each (fewer draw calls on phones); concept pieces use the
// mobile-ui violet so they never pass for real products.
const WALL_COLOR = "#f6f4f0"; // paper (mobile-ui --bg): reads on a dark table and under AR lighting
const PLATE_COLOR = "#cfc8bb";
const FLOOR_COLOR = "#e8e2d8";
const FURNITURE_COLOR = "#c9b79c";
const CONCEPT_COLOR = "#7a5ac8";

/** Same low-poly parts as the r3f view (design/furnitureShapes), as one named group per item. */
function furnitureGroup(item: Furniture, info: FurnitureMesh | undefined, material: THREE.Material, accent: THREE.Material): THREE.Group {
  const [width, depth, height] = item.size_m;
  const concept = item.concept === true;
  const group = new THREE.Group();
  group.name = concept ? `furniture:${item.id} (concept)` : `furniture:${item.id}`;
  const parts = info?.parts ?? [{ shape: "box" as const, center: [0, 0, height / 2] as const, size: [width, depth, height] as const, tone: 0 as const }];
  for (const p of parts) {
    const geometry =
      p.shape === "cylinder"
        ? new THREE.CylinderGeometry(p.size[0] / 2, p.size[0] / 2, p.size[2], 12)
        : new THREE.BoxGeometry(p.size[0], p.size[2], p.size[1]);
    const mesh = new THREE.Mesh(geometry, p.tone === 1 ? accent : material);
    mesh.position.set(p.center[0], p.center[2], -p.center[1]);
    group.add(mesh);
  }
  group.position.set(...planToThree(item.position, 0));
  // Plan rotation about Z is a rotation about +Y by the same angle (see view3d/sceneToMeshes).
  group.rotation.y = THREE.MathUtils.degToRad(item.rotation_deg ?? 0);
  if (concept) group.userData.concept = true;
  return group;
}

/** Base plate: margin around the footprint and thickness, in metres before scaling. */
const PLATE_MARGIN_M = 0.4;
const PLATE_THICKNESS_M = 0.1;

/** Moves the content so the origin is the floor centre: min y = 0 and the footprint centred on x and z. */
function centreOnFloor(group: THREE.Group): void {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  for (const child of group.children) {
    child.position.x -= center.x;
    child.position.y -= box.min.y;
    child.position.z -= center.z;
  }
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
  const conceptMaterial = new THREE.MeshStandardMaterial({ color: CONCEPT_COLOR });

  const { walls, floors, openings } = sceneToMeshes(scene);
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

  for (const opening of openings) {
    const theme = OPENING_THEME[opening.openingKind];
    const material = new THREE.MeshStandardMaterial({
      color: theme.color,
      transparent: theme.opacity < 1,
      opacity: theme.opacity,
    });
    const [width, thickness, height] = opening.size;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, thickness), material);
    mesh.name = `opening:${opening.openingKind}:${opening.openingId}`;
    mesh.position.set(...planToThree([opening.center[0], opening.center[1]], opening.center[2]));
    mesh.rotation.y = opening.rotationZ;
    group.add(mesh);
  }

  for (const floor of floors) {
    const shape = new THREE.Shape(floor.points.map(([x, y]) => new THREE.Vector2(x, y)));
    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      floor.color ? new THREE.MeshStandardMaterial({ color: floor.color, side: THREE.DoubleSide }) : floorMaterial,
    );
    mesh.name = `floor:${floor.id}`;
    mesh.rotation.x = -Math.PI / 2;
    group.add(mesh);
  }

  for (const o of surfaceOverlays(scene)) {
    const [length, thickness, height] = o.size;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, height, thickness), new THREE.MeshStandardMaterial({ color: o.color }));
    mesh.name = `finish:${o.id}`;
    mesh.position.set(...planToThree([o.center[0], o.center[1]], o.center[2]));
    mesh.rotation.y = o.rotationZ;
    group.add(mesh);
  }

  const infos = new Map(furnitureMeshes(scene).map((f) => [f.id, f]));
  for (const item of scene.furniture ?? []) {
    const info = infos.get(item.id);
    const color = info?.color ?? FURNITURE_COLOR;
    const group3 = furnitureGroup(
      item,
      info,
      item.concept === true ? conceptMaterial : new THREE.MeshStandardMaterial({ color }),
      item.concept === true ? conceptMaterial : new THREE.MeshStandardMaterial({ color: accentColor(color) }),
    );
    if (info && !item.concept) group3.name = `furniture:${item.id} (${info.type})`;
    group.add(group3);
  }

  centreOnFloor(group);
  addFloorPlate(group);
  group.scale.setScalar(scale);
  return group;
}

/** A slab slightly larger than the footprint, so the maquette is visible and stable on a table. The whole model is lifted onto it. */
function addFloorPlate(group: THREE.Group): void {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(size.x + 2 * PLATE_MARGIN_M, PLATE_THICKNESS_M, size.z + 2 * PLATE_MARGIN_M),
    new THREE.MeshStandardMaterial({ color: PLATE_COLOR }),
  );
  plate.name = "floor-plate";
  for (const child of group.children) child.position.y += PLATE_THICKNESS_M;
  plate.position.y = PLATE_THICKNESS_M / 2;
  group.add(plate);
}
