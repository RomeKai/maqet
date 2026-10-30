import { useEffect, useState } from "react";

export const GLB_MIME = "model/gltf-binary";
export const USDZ_MIME = "model/vnd.usdz+zip";

/**
 * Turns an exported GLB into an object URL for `<model-viewer>`. The URL pins the whole file in memory
 * until revoked, so it is revoked when the GLB changes and when the component unmounts.
 */
export function useMaquetteUrl(glb: ArrayBuffer | Uint8Array | null, mime: string = GLB_MIME): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (glb === null) {
      setUrl(null);
      return undefined;
    }
    const objectUrl = URL.createObjectURL(new Blob([glb], { type: mime }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [glb, mime]);

  return url;
}
