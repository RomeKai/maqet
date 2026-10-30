/** Pure builders for the Reform edit sheet: typed meters -> one deterministic edit tool call. */

export interface EditCall {
  tool: "set_wall_length" | "resize_room";
  args: Record<string, string | number>;
}

/** Accepts "3.5" and "3,5"; null for anything that is not a positive finite number. */
export function parseMeters(text: string): number | null {
  const value = Number.parseFloat(text.trim().replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function wallEditCall(wallId: string, lengthText: string): EditCall | null {
  const length = parseMeters(lengthText);
  return length === null ? null : { tool: "set_wall_length", args: { wall: wallId, length_m: length } };
}

export function roomEditCall(roomId: string, widthText: string, depthText: string): EditCall | null {
  const width = parseMeters(widthText);
  const depth = parseMeters(depthText);
  if (width === null || depth === null) return null;
  return { tool: "resize_room", args: { room: roomId, width_m: width, depth_m: depth } };
}
