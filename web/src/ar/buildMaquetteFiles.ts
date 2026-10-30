import type { Scene } from "../scene/types";
import { DEFAULT_MAQUETTE_SCALE, sceneToMaquette } from "./sceneToMaquette";
import { exportGlb, exportUsdz } from "./exportMaquette";
import { disposeMaquette } from "./disposeMaquette";

export interface MaquetteFiles {
  glb: ArrayBuffer;
  usdz: Uint8Array;
}

/** Builds the maquette once and exports GLB (Android, WebXR) and USDZ (iPhone Quick Look) in parallel. */
export async function buildMaquetteFiles(scene: Scene, scale: number = DEFAULT_MAQUETTE_SCALE): Promise<MaquetteFiles> {
  const maquette = sceneToMaquette(scene, scale);
  try {
    const [glb, usdz] = await Promise.all([exportGlb(maquette), exportUsdz(maquette)]);
    return { glb, usdz };
  } finally {
    disposeMaquette(maquette);
  }
}
