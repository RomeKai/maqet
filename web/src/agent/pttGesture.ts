/** A press shorter than this (ms) is a tap: it latches recording on instead of sending. */
export const TAP_MAX_MS = 350;

/** Pointer/key down: start, or stop a recording a previous tap latched on. */
export function onPttPress(latched: boolean): "begin" | "end" {
  return latched ? "end" : "begin";
}

/** Pointer/key up after a press that began recording. */
export function onPttRelease(heldMs: number): "end" | "latch" {
  return heldMs <= TAP_MAX_MS ? "latch" : "end";
}
