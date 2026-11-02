export interface RealLifeViewsResult {
  images: string[];
  failed: number;
  firstError: string | null;
}

/**
 * One image per captured view. A view whose capture failed is skipped: without its guide the model would
 * return a near copy at full price. With no capture at all, one text-only image is still requested.
 */
export async function renderRealLifeViews(
  guides: readonly (string | null)[],
  post: (guide: string | null) => Promise<string>,
): Promise<RealLifeViewsResult> {
  const usable = guides.filter((g): g is string => g !== null);
  const settled = await Promise.allSettled((usable.length > 0 ? usable : [null]).map((g) => post(g)));
  const images: string[] = [];
  let failed = 0;
  let firstError: string | null = null;
  for (const r of settled) {
    if (r.status === "fulfilled") {
      images.push(r.value);
    } else {
      failed += 1;
      firstError ??= r.reason instanceof Error ? r.reason.message : String(r.reason);
    }
  }
  return { images, failed, firstError };
}
