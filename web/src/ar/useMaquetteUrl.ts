import { useEffect, useState } from "react";

const GLB_MIME = "model/gltf-binary";

/**
 * Turns an exported GLB into an object URL for `<model-viewer>`. The URL pins the whole file in memory
 * until revoked, so it is revoked when the GLB changes and when the component unmounts.
 */
export function useMaquetteUrl(glb: ArrayBuffer | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (glb === null) {
      setUrl(null);
      return undefined;
    }
    const objectUrl = URL.createObjectURL(new Blob([glb], { type: GLB_MIME }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [glb]);

  return url;
}
