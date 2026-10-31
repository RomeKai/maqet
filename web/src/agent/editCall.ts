/** Pure builders for the Reform edit sheet: typed meters -> one deterministic edit tool call. */

export interface EditCall {
  tool: "set_wall_length" | "resize_room" | "place_furniture" | "move_item" | "rotate_item" | "remove_item" | "set_surface_material" | "undo";
  args: Record<string, string | number | number[]>;
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

export const placeCall = (catalogId: string, roomId: string): EditCall => ({
  tool: "place_furniture",
  args: { catalog_id: catalogId, room: roomId },
});

export const finishCall = (roomId: string, part: "floor" | "walls", materialId: string): EditCall => ({
  tool: "set_surface_material",
  args: { room: roomId, part, material_id: materialId },
});

export const NUDGE_M = 0.1;

export const nudgeCall = (itemId: string, position: [number, number], dx: number, dy: number): EditCall => ({
  tool: "move_item",
  args: { item: itemId, position: [Math.round((position[0] + dx) * 1000) / 1000, Math.round((position[1] + dy) * 1000) / 1000] },
});

export const rotateCall = (itemId: string): EditCall => ({ tool: "rotate_item", args: { item: itemId, delta_deg: 90 } });
export const removeCall = (itemId: string): EditCall => ({ tool: "remove_item", args: { item: itemId } });
export const undoCall = (): EditCall => ({ tool: "undo", args: {} });

export const moveToWallCall = (itemId: string, wallLabel: string): EditCall => ({
  tool: "move_item",
  args: { item: itemId, wall: wallLabel },
});
