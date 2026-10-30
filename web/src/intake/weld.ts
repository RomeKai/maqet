import type { SceneOp } from "../scene/store";
import type { Scene, Wall } from "../scene/types";

/** Endpoints closer than this (m) are the same corner after a sketch reading. */
export const WELD_TOL_M = 0.15;

export interface EndpointRef {
  wallId: string;
  end: "a" | "b";
}

interface Endpoint extends EndpointRef {
  p: readonly [number, number];
}

function endpoints(walls: readonly Wall[]): Endpoint[] {
  return walls.flatMap((w) => [
    { wallId: w.id, end: "a" as const, p: w.a },
    { wallId: w.id, end: "b" as const, p: w.b },
  ]);
}

/**
 * Weld near-coincident wall endpoints into shared vertices (cluster average),
 * as ONE undoable batch op. Null when nothing needs welding. A cluster that
 * would collapse both ends of one wall is skipped.
 */
export function weldOp(scene: Scene, tolM: number = WELD_TOL_M): SceneOp | null {
  const pts = endpoints(scene.walls ?? []);
  const parent = pts.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i]!;
      const b = pts[j]!;
      if (a.wallId === b.wallId) continue;
      if (Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) < tolM) parent[find(i)] = find(j);
    }
  }
  const clusters = new Map<number, Endpoint[]>();
  pts.forEach((e, i) => {
    const root = find(i);
    clusters.set(root, [...(clusters.get(root) ?? []), e]);
  });
  const ops: SceneOp[] = [];
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const ids = members.map((m) => m.wallId);
    if (new Set(ids).size !== ids.length) continue;
    const x = members.reduce((s, m) => s + m.p[0], 0) / members.length;
    const y = members.reduce((s, m) => s + m.p[1], 0) / members.length;
    if (members.every((m) => m.p[0] === x && m.p[1] === y)) continue;
    for (const m of members) {
      ops.push({ type: "moveWallEndpoint", wallId: m.wallId, end: m.end, point: [x, y] });
    }
  }
  return ops.length === 0 ? null : { type: "batch", ops };
}

/**
 * Snap a scene point to the nearest wall endpoint within `tolDisplayUnits`
 * (measured in display units, i.e. screen px x unitsPerPx). `exclude` skips
 * the endpoints being dragged. Null when none is close enough.
 */
export function snapToEndpoint(
  point: readonly [number, number],
  walls: readonly Wall[],
  toDisplay: (x: number, y: number) => { x: number; y: number },
  tolDisplayUnits: number,
  exclude: readonly EndpointRef[] = [],
): [number, number] | null {
  const dp = toDisplay(point[0], point[1]);
  let best: { p: readonly [number, number]; d: number } | null = null;
  for (const e of endpoints(walls)) {
    if (exclude.some((x) => x.wallId === e.wallId && x.end === e.end)) continue;
    const de = toDisplay(e.p[0], e.p[1]);
    const d = Math.hypot(de.x - dp.x, de.y - dp.y);
    if (d <= tolDisplayUnits && (best === null || d < best.d)) best = { p: e.p, d };
  }
  return best === null ? null : [best.p[0], best.p[1]];
}
