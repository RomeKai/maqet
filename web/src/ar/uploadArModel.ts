const MIME = { glb: "model/gltf-binary", usdz: "model/vnd.usdz+zip" } as const;

export type ArModelKind = keyof typeof MIME;

interface UploadOptions {
  fetchFn?: typeof fetch;
  origin?: string;
  apiBase?: string;
}

/** Scene Viewer and Quick Look need an absolute https URL; a relative API base is resolved against the page origin. */
export function absoluteModelUrl(origin: string, apiBase: string, path: string): string {
  const base = /^https?:\/\//.test(apiBase) ? apiBase : `${origin}${apiBase}`;
  return `${base.replace(/\/$/, "")}${path}`;
}

function defaultApiBase(): string {
  const configured: unknown = import.meta.env.VITE_API_URL;
  return typeof configured === "string" && configured.length > 0 ? configured : "/api";
}

/**
 * Uploads a built GLB/USDZ so external AR apps can fetch it (they cannot read blob: URLs).
 * Resolves to the absolute URL to give <model-viewer>; rejects on any non-2xx.
 */
export async function uploadArModel(
  data: ArrayBuffer | Uint8Array,
  kind: ArModelKind,
  { fetchFn = fetch, origin = window.location.origin, apiBase = defaultApiBase() }: UploadOptions = {},
): Promise<string> {
  const form = new FormData();
  form.append("file", new File([data], `maquette.${kind}`, { type: MIME[kind] }));
  const response = await fetchFn(`${apiBase}/ar/model`, { method: "POST", body: form });
  if (!response.ok) throw new Error(`AR model upload failed: ${response.status}`);
  const body: unknown = await response.json();
  const path = typeof body === "object" && body !== null ? (body as { path?: unknown }).path : undefined;
  if (typeof path !== "string") throw new Error("AR model upload returned no path");
  return absoluteModelUrl(origin, apiBase, path);
}
