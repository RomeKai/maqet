/**
 * An <img> error belongs to the URL it was rendered with. A stale element can report its failure after a newer
 * snapshot already replaced it; that late error must not hide the newer one (E2E-010).
 */
export function dropFailedSnapshot(current: string | null, failed: string): string | null {
  return current === failed ? null : current;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The server omits `xmlns` on purpose (the snapshot is also embedded inline), but a standalone SVG loaded through
 * an <img> must declare it or the browser refuses to decode it.
 */
export function withSvgNamespace(svg: string): string {
  const head = /^\s*<svg\b[^>]*>/.exec(svg)?.[0];
  if (head === undefined || /\bxmlns\s*=/.test(head)) return svg;
  return svg.replace(/^(\s*)<svg\b/, `$1<svg xmlns="${SVG_NS}"`);
}
