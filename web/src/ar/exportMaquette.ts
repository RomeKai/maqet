import type { Object3D } from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { USDZExporter } from "three/examples/jsm/exporters/USDZExporter.js";

/** Binary glTF (GLB) for model-viewer, Scene Viewer and WebXR. */
export async function exportGlb(object: Object3D): Promise<ArrayBuffer> {
  const result = await new GLTFExporter().parseAsync(object, { binary: true });
  if (!(result instanceof ArrayBuffer)) {
    throw new Error("GLTFExporter did not return a binary GLB");
  }
  return result;
}

/** USDZ archive for iOS Quick Look (pre-baked `ios-src`; model-viewer can also generate it from the GLB). */
export async function exportUsdz(object: Object3D): Promise<Uint8Array> {
  return new USDZExporter().parseAsync(object);
}
