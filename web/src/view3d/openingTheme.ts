/**
 * One theme for openings, shared by the r3f view (SceneView) and the table-top
 * maquette / GLB (sceneToMaquette), so doors and windows read the same
 * everywhere. Walls stay neutral. Door accent = the design orange/terracotta.
 */
export const OPENING_THEME = {
  door: { color: "#c8643c", opacity: 1 },
  window: { color: "#9fd3ec", opacity: 0.55 },
} as const;

export type OpeningThemeKind = keyof typeof OPENING_THEME;
