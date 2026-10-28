import type { Vec3 } from "./cornerMath";

/** Column-major 4x4 matrix, as WebXR provides it (projectionMatrix, inverse). */
export type Mat4ColMajor = readonly number[];

/**
 * Minimal XR-view input for projection: the two column-major matrices
 * WebXR gives per view (`view.projectionMatrix` and
 * `view.transform.inverse.matrix`), each 16 numbers.
 */
export interface ViewMatrices {
  projectionMatrix: Mat4ColMajor;
  viewInverse: Mat4ColMajor;
}

/** Pixel viewport the frame renders to (CSS pixels of the HUD overlay). */
export interface ViewportPx {
  width: number;
  height: number;
}

/** Projected point in overlay pixels; {0,0,visible:false} when unprojectable. */
export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

/**
 * Project a world-space corner to overlay pixels: clip = P * V * [p, 1]
 * (column-major mat4 multiply). A clip w <= 0 means the point is on or
 * behind the camera plane, so it is reported not visible. Otherwise NDC
 * divide maps x/y to [0,1] and then to viewport pixels (y flipped: NDC up
 * is +y, screen down is +y). Pure function, no DOM/WebXR: the rAF loop in
 * ArOverlay calls it per frame and writes attributes directly.
 */
export function projectToScreen(
  world: Vec3,
  view: ViewMatrices,
  viewport: ViewportPx,
): ScreenPoint {
  const hidden: ScreenPoint = { x: 0, y: 0, visible: false };
  const p = view.projectionMatrix;
  const v = view.viewInverse;
  if (p.length < 16 || v.length < 16) return hidden;
  // view-space point: Vs = V * [p, 1] (column-major: out[i] = sum_j M[i+4j]*in[j]).
  const vx = v[0] * world[0] + v[4] * world[1] + v[8] * world[2] + v[12];
  const vy = v[1] * world[0] + v[5] * world[1] + v[9] * world[2] + v[13];
  const vz = v[2] * world[0] + v[6] * world[1] + v[10] * world[2] + v[14];
  const vw = v[3] * world[0] + v[7] * world[1] + v[11] * world[2] + v[15];
  // clip = P * Vs.
  const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12] * vw;
  const cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13] * vw;
  const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15] * vw;
  if (!(cw > 0)) return hidden;
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  return {
    x: (ndcX * 0.5 + 0.5) * viewport.width,
    y: (1 - (ndcY * 0.5 + 0.5)) * viewport.height,
    visible: true,
  };
}
