/**
 * Low-poly furniture built from primitives, shared by the r3f view and the AR GLB.
 * Local frame, meters: u along the item width, v along its depth (back at -v, front at +v),
 * z up from the floor. Parts stay inside the catalog footprint (w x d) and height (h).
 */
export interface FurniturePart {
  shape: "box" | "cylinder";
  /** Part center: [u, v, z]. */
  center: readonly [number, number, number];
  /** Box: [width u, depth v, height z]. Cylinder: [diameter, diameter, height]. */
  size: readonly [number, number, number];
  /** 0 = main body color, 1 = accent (pillow, door panel, burner). */
  tone: 0 | 1;
}

const box = (u: number, v: number, z: number, w: number, d: number, h: number, tone: 0 | 1 = 0): FurniturePart => ({
  shape: "box",
  center: [u, v, z],
  size: [w, d, h],
  tone,
});

function legs(w: number, d: number, h: number, t: number, inset: number): FurniturePart[] {
  const u = w / 2 - inset - t / 2;
  const v = d / 2 - inset - t / 2;
  return [-1, 1].flatMap((su) => [-1, 1].map((sv) => box(su * u, sv * v, h / 2, t, t, h)));
}

export function furnitureParts(type: string, size: readonly [number, number, number]): FurniturePart[] {
  const [w, d, h] = size;
  switch (type) {
    case "bed":
      return [
        box(0, 0, h * 0.3, w, d, h * 0.6),
        box(0, -d / 2 + 0.03, h / 2, w, 0.06, h),
        box(0, -d / 2 + 0.33, h * 0.6 + 0.05, w * 0.8, 0.3, 0.1, 1),
      ];
    case "sofa":
      return [
        box(0, d * 0.15, h * 0.25, w, d * 0.7, h * 0.5),
        box(0, -d / 2 + d * 0.15, h / 2, w, d * 0.3, h),
        box(-w / 2 + w * 0.06, d * 0.15, h * 0.35, w * 0.12, d * 0.7, h * 0.7),
        box(w / 2 - w * 0.06, d * 0.15, h * 0.35, w * 0.12, d * 0.7, h * 0.7),
      ];
    case "table":
      return [box(0, 0, h - 0.03, w, d, 0.06), ...legs(w, d, h - 0.06, 0.06, 0.04)];
    case "chair":
      return [
        box(0, 0, h * 0.5 - 0.025, w, d, 0.05),
        box(0, -d / 2 + 0.025, h * 0.75, w, 0.05, h * 0.5),
        ...legs(w, d, h * 0.5 - 0.05, 0.04, 0.0),
      ];
    case "wardrobe":
      return [
        box(0, -0.01, h / 2, w, d - 0.02, h),
        box(-w * 0.245, d / 2 - 0.01, h / 2, w * 0.46, 0.02, h * 0.92, 1),
        box(w * 0.245, d / 2 - 0.01, h / 2, w * 0.46, 0.02, h * 0.92, 1),
      ];
    case "desk":
      return [box(0, 0, h - 0.02, w, d, 0.04), ...legs(w, d, h - 0.04, 0.05, 0.03)];
    case "nightstand":
      return [box(0, 0, h / 2, w, d, h), box(0, d / 2 - 0.01, h * 0.7, w * 0.8, 0.02, h * 0.25, 1)];
    case "armchair":
      return [
        box(0, d * 0.15, h * 0.2, w, d * 0.7, h * 0.4),
        box(0, -d / 2 + d * 0.15, h / 2, w, d * 0.3, h),
        box(-w / 2 + w * 0.08, d * 0.15, h * 0.35, w * 0.16, d * 0.7, h * 0.7),
        box(w / 2 - w * 0.08, d * 0.15, h * 0.35, w * 0.16, d * 0.7, h * 0.7),
      ];
    case "tvunit":
      return [box(0, 0, h / 2, w, d, h), box(0, d / 2 - 0.01, h / 2, w * 0.9, 0.02, h * 0.7, 1)];
    case "bookshelf":
      return [
        box(0, 0, h / 2, w, d, h),
        ...[0.25, 0.5, 0.75].map((f) => box(0, d / 2 - 0.01, h * f, w * 0.9, 0.02, 0.03, 1)),
      ];
    case "coffeetable":
      return [box(0, 0, h - 0.02, w, d, 0.04), ...legs(w, d, h - 0.04, 0.05, 0.03)];
    case "crib":
      return [
        box(0, 0, h * 0.3, w, d, h * 0.6),
        box(0, -d / 2 + 0.02, h / 2, w, 0.04, h),
        box(0, d / 2 - 0.02, h / 2, w, 0.04, h),
      ];
    case "stove":
      return [
        box(0, 0, (h - 0.01) / 2, w, d, h - 0.01),
        ...[-1, 1].flatMap((su) =>
          [-1, 1].map((sv): FurniturePart => ({
            shape: "cylinder",
            center: [su * w * 0.22, sv * d * 0.22, h - 0.005],
            size: [Math.min(w, d) * 0.28, Math.min(w, d) * 0.28, 0.01],
            tone: 1,
          })),
        ),
      ];
    default:
      return [box(0, 0, h / 2, w, d, h)];
  }
}

/** Slightly darker/lighter accent of a "#rrggbb" body color. */
export function accentColor(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const f = (c: number): number => Math.max(0, Math.min(255, Math.round(c * 0.7)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, "0")).join("")}`;
}
