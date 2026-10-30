/**
 * Registers the <model-viewer> custom element on demand. The dynamic import keeps the library out of the
 * main bundle and out of vitest. Resolves false (never throws) so the viewer can show its 3D-only fallback.
 */
export async function loadModelViewer(): Promise<boolean> {
  try {
    await import("@google/model-viewer");
    return true;
  } catch {
    return false;
  }
}
