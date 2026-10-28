import * as THREE from "three";

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/** Textures referenced by a material (`map`, `normalMap`, ...); they hold GPU memory of their own. */
function texturesOf(material: THREE.Material): THREE.Texture[] {
  return Object.values(material).filter((value): value is THREE.Texture => value instanceof THREE.Texture);
}

/**
 * Releases the GPU resources of a maquette built by `sceneToMaquette`: geometries, materials and the
 * textures those materials hold. Each shared resource is disposed once. The group must not be rendered
 * or exported afterwards. Call it when the maquette is replaced or its owner unmounts.
 */
export function disposeMaquette(group: THREE.Group): void {
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();

  group.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    for (const material of materialsOf(node)) materials.add(material);
  });

  const textures = new Set<THREE.Texture>();
  for (const material of materials) for (const texture of texturesOf(material)) textures.add(texture);

  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
}
