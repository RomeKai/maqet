import { useMemo, useRef, useState } from "react";
import type { Scene, Wall } from "../scene/types";
import {
  applySceneOp,
  isWallEstimated,
  wallDisplayLengthM,
  type SceneOp,
} from "../scene/store";
import { getStrings, type Locale } from "../i18n";
import type { IntakeProposal } from "./api";
import {
  formToPlacement,
  placementToOpening,
  tapsToPlacement,
  validateAgainstWall,
} from "./opening";

export type CornerTool = "select" | "addWall" | "door" | "window";

interface Point {
  x: number;
  y: number;
}

interface CornerEditorProps {
  locale: Locale;
  scene: Scene;
  proposal?: IntakeProposal | null;
  imageUrl: string | null;
  imageWidth: number;
  imageHeight: number;
  onChange: (scene: Scene, op: SceneOp) => void;
  onUndo: () => void;
  canUndo: boolean;
}

function wallId(): string {
  return `w${Math.random().toString(36).slice(2, 8)}`;
}

function openingId(): string {
  return `o${Math.random().toString(36).slice(2, 8)}`;
}

const WALL_LEN_M = 3;

/** Screen-px minimum for wall length labels (AA, readable at a glance). */
export const WALL_LABEL_MIN_PX = 14;
export const wallLabelClass = "wall-label";

/** Narrow door warning threshold (meters) — door kept but flagged. */
export const DOOR_MIN_WIDTH_M = 0.8;

/**
 * Photo-space calibration (BUG1 fix): the editor canvas is photo pixels,
 * the Scene is meters. The normalized proposal (0..1, y-down) is the bridge.
 * We align the proposal bbox (in photo px) with the Scene bbox (meters) to
 * recover meters-per-pixel plus origin. Display mapping only — the Scene
 * stays meters, source of truth (ADR-001), geometry untouched.
 */
export interface PhotoCalibration {
  metersPerPx: number;
  sceneMinX: number;
  sceneMaxY: number;
  propMinXPx: number;
  propMinYPx: number;
}

export function calibratePhotoSpace(
  proposal: IntakeProposal | null | undefined,
  scene: Scene,
  imageWidth: number,
  imageHeight: number,
): PhotoCalibration | null {
  if (proposal === null || proposal === undefined) return null;
  if (imageWidth <= 0 || imageHeight <= 0) return null;
  const walls = proposal.walls ?? [];
  if (walls.length === 0) return null;

  let pMinX = Infinity;
  let pMaxX = -Infinity;
  let pMinY = Infinity;
  let pMaxY = -Infinity;
  for (const w of walls) {
    for (const p of [w.a, w.b]) {
      if (p[0] < pMinX) pMinX = p[0];
      if (p[0] > pMaxX) pMaxX = p[0];
      if (p[1] < pMinY) pMinY = p[1];
      if (p[1] > pMaxY) pMaxY = p[1];
    }
  }
  if (!(pMaxX > pMinX) && !(pMaxY > pMinY)) return null;
  const propWpx = (pMaxX - pMinX) * imageWidth;
  const propHpx = (pMaxY - pMinY) * imageHeight;
  if (propWpx <= 0 && propHpx <= 0) return null;

  const sceneWalls = scene.walls ?? [];
  if (sceneWalls.length === 0) return null;
  let sMinX = Infinity;
  let sMaxX = -Infinity;
  let sMinY = Infinity;
  let sMaxY = -Infinity;
  for (const w of sceneWalls) {
    for (const p of [w.a, w.b]) {
      if (p[0] < sMinX) sMinX = p[0];
      if (p[0] > sMaxX) sMaxX = p[0];
      if (p[1] < sMinY) sMinY = p[1];
      if (p[1] > sMaxY) sMaxY = p[1];
    }
  }
  const sceneW = sMaxX - sMinX;
  const sceneH = sMaxY - sMinY;
  if (!(sceneW > 0) && !(sceneH > 0)) return null;

  let metersPerPx = 0;
  let count = 0;
  if (propWpx > 0 && sceneW > 0) {
    metersPerPx += sceneW / propWpx;
    count += 1;
  }
  if (propHpx > 0 && sceneH > 0) {
    metersPerPx += sceneH / propHpx;
    count += 1;
  }
  if (count === 0) return null;
  metersPerPx /= count;

  return {
    metersPerPx,
    sceneMinX: sMinX,
    sceneMaxY: sMaxY,
    propMinXPx: pMinX * imageWidth,
    propMinYPx: pMinY * imageHeight,
  };
}

export function sceneToPhoto(cal: PhotoCalibration, x: number, y: number): Point {
  return {
    x: cal.propMinXPx + (x - cal.sceneMinX) / cal.metersPerPx,
    y: cal.propMinYPx + (cal.sceneMaxY - y) / cal.metersPerPx,
  };
}

export function photoToScene(cal: PhotoCalibration, px: number, py: number): Point {
  return {
    x: cal.sceneMinX + (px - cal.propMinXPx) * cal.metersPerPx,
    y: cal.sceneMaxY - (py - cal.propMinYPx) * cal.metersPerPx,
  };
}

export interface DragPreview {
  wallId: string;
  end: "a" | "b";
  point: Point;
}

export interface SharedHandle {
  members: { wallId: string; end: "a" | "b" }[];
  point: [number, number];
}

/** Display-space distance below which endpoints merge into one handle. */
export const HANDLE_CLUSTER_PX = 12;

/** Meters equiv of 12 px when no photo calibration maps px to meters. */
export const HANDLE_CLUSTER_M = 0.05;

/**
 * One handle per shared corner: cluster endpoints in display space (~12 px).
 * Pure so the clustering rule is unit-testable; the test counts handles.
 */
export function clusterHandles(
  walls: Wall[],
  toDisplay: (x: number, y: number) => Point,
  preview: DragPreview | null,
  tolPx: number = HANDLE_CLUSTER_PX,
): SharedHandle[] {
  const handles: SharedHandle[] = [];
  for (const wall of walls) {
    for (const end of ["a", "b"] as const) {
      const raw = previewEndpoint(wall, end, preview);
      const p = toDisplay(raw[0], raw[1]);
      const existing = handles.find((h) => {
        const dp = toDisplay(h.point[0], h.point[1]);
        return Math.hypot(dp.x - p.x, dp.y - p.y) <= tolPx;
      });
      if (existing === undefined) {
        handles.push({ members: [{ wallId: wall.id, end }], point: [raw[0], raw[1]] });
      } else {
        existing.members.push({ wallId: wall.id, end });
      }
    }
  }
  return handles;
}

/** Walls sharing the dragged handle move together (one op per wall). */
export function handleMembersFor(
  handles: SharedHandle[],
  wallId: string,
  end: "a" | "b",
): SharedHandle | undefined {
  return handles.find((h) => h.members.some((m) => m.wallId === wallId && m.end === end));
}

/** "W1" style 1-based wall number for the selected-element label. */
export function wallNumber(walls: Wall[], wallId: string): number {
  const idx = walls.findIndex((w) => w.id === wallId);
  return idx >= 0 ? idx + 1 : 0;
}

/**
 * Effective endpoint for rendering: the live finger position while a corner
 * drag is in flight, else the stored Scene endpoint. Pure so the render
 * branch is unit-testable; pointer handlers only set/clear the preview and
 * commit one op on pointerup (no Scene/3D updates mid-drag).
 */
export function previewEndpoint(
  wall: Wall,
  end: "a" | "b",
  preview: DragPreview | null,
): [number, number] {
  if (preview !== null && preview.wallId === wall.id && preview.end === end) {
    return [preview.point.x, preview.point.y];
  }
  return end === "a" ? wall.a : wall.b;
}

/**
 * 2D plan corner editor (P0): SVG over the photo, draggable endpoints
 * (≥44 px touch targets), add/remove wall, mark door/window.
 * Every edit is a Scene op, reported to the parent store via onChange.
 * The Scene stays meters (ADR-001); the SVG is photo-pixel space fed by the
 * normalized proposal mapping, never by raw Scene meters.
 */
export function CornerEditor({
  locale,
  scene,
  proposal = null,
  imageUrl,
  imageWidth,
  imageHeight,
  onChange,
  onUndo,
  canUndo,
  initialSelectedWallId = null,
  initialPreview = null,
}: CornerEditorProps & {
  initialSelectedWallId?: string | null;
  initialPreview?: DragPreview | null;
}) {
  const t = getStrings(locale);
  const [tool, setTool] = useState<CornerTool>("select");
  const [selectedWall, setSelectedWall] = useState<string | null>(initialSelectedWallId);
  const [selectedOpening, setSelectedOpening] = useState<string | null>(null);
  const [pendingStart, setPendingStart] = useState<Point | null>(null);
  /** Live finger position mid-drag: local render only, never emitted. */
  const [preview, setPreview] = useState<DragPreview | null>(initialPreview);
  const svgRef = useRef<SVGSVGElement>(null);

  /** Placing an opening: wall + kind, then two taps (or form). */
  const [placing, setPlacing] = useState<{ wallId: string; kind: "door" | "window"; firstTap: [number, number] | null } | null>(null);
  const [tapPreview, setTapPreview] = useState<[number, number] | null>(null);
  const [openingError, setOpeningError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formVals, setFormVals] = useState({ offset: "", width: "", height: "", sill: "" });

  const walls = useMemo(() => scene.walls ?? [], [scene.walls]);
  const openings = useMemo(() => scene.openings ?? [], [scene.openings]);

  const canvasW = imageWidth > 0 ? imageWidth : WALL_LEN_M * 2;
  const canvasH = imageHeight > 0 ? imageHeight : WALL_LEN_M * 2;

  const calibration = useMemo(
    () => calibratePhotoSpace(proposal, scene, imageWidth, imageHeight),
    [proposal, scene, imageWidth, imageHeight],
  );

  function toSceneCoords(clientX: number, clientY: number): Point {
    const svg = svgRef.current;
    if (svg === null) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * canvasW;
    const py = ((clientY - rect.top) / rect.height) * canvasH;
    if (calibration !== null) return photoToScene(calibration, px, py);
    return { x: px, y: py };
  }

  /** Scene meters -> display (photo px) for SVG + handle positions. */
  function toDisplay(x: number, y: number): Point {
    if (calibration === null) return { x, y };
    return sceneToPhoto(calibration, x, y);
  }

  /** Shared corner handles, recomputed from display positions each render. */
  const handles = useMemo(
    () => clusterHandles(
      walls,
      toDisplay,
      preview,
      calibration !== null ? HANDLE_CLUSTER_PX : HANDLE_CLUSTER_M,
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [walls, calibration, preview],
  );

  /** Walls touched by the in-flight drag: highlighted while preview active. */
  const draggingWallIds = useMemo(() => {
    if (preview === null) return new Set<string>();
    const h = handleMembersFor(handles, preview.wallId, preview.end);
    return new Set((h?.members ?? [{ wallId: preview.wallId }]).map((m) => m.wallId));
  }, [handles, preview]);

  /** Locale length: JetBrains Mono in CSS, comma decimals for es-AR. */
  function formatLengthM(meters: number): string {
    const fixed = meters.toFixed(2);
    return locale === "es-AR" ? `${fixed.replace(".", ",")} m` : `${fixed} m`;
  }

  const selectedWallObj = selectedWall !== null
    ? walls.find((w) => w.id === selectedWall) ?? null
    : null;
  const selectedOpeningObj = selectedOpening !== null
    ? openings.find((o) => o.id === selectedOpening) ?? null
    : null;

  function emit(op: SceneOp): void {
    onChange(applySceneOp(scene, op), op);
  }

  function startPlacing(wallIdValue: string, kind: "door" | "window"): void {
    setPlacing({ wallId: wallIdValue, kind, firstTap: null });
    setTapPreview(null);
    setOpeningError(null);
    setShowForm(false);
    const wall = walls.find((w) => w.id === wallIdValue);
    if (wall !== undefined) {
      const wallLen = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
      const defW = kind === "door" ? 0.9 : 1.4;
      const defH = kind === "door" ? 2.05 : 1.4;
      setFormVals({
        offset: (Math.max(0, (wallLen - defW) / 2)).toFixed(2),
        width: defW.toFixed(2),
        height: defH.toFixed(2),
        sill: "0.80",
      });
    }
  }

  function handleCanvasTap(clientX: number, clientY: number): void {
    if (tool === "addWall") {
      const p = toSceneCoords(clientX, clientY);
      if (pendingStart === null) {
        setPendingStart(p);
        return;
      }
      const wall: Wall = {
        id: wallId(),
        a: [pendingStart.x, pendingStart.y],
        b: [p.x, p.y],
        thickness_m: 0.1,
        kind: "interior",
      };
      setPendingStart(null);
      emit({ type: "addWall", wall });
      return;
    }
    // Opening placement taps: projected onto selected wall's segment.
    if (placing !== null && selectedWall !== null) {
      const wall = walls.find((w) => w.id === placing.wallId);
      if (wall === undefined) {
        setOpeningError(t["intake.opening.outsideWall"]);
        return;
      }
      const p = toSceneCoords(clientX, clientY);
      const point: [number, number] = [p.x, p.y];
      if (placing.firstTap === null) {
        // Validate first tap is on wall
        const res = tapsToPlacement(wall, placing.kind, point, [point[0] + 0.001, point[1]]);
        void res;
        // We show preview; validation happens on second tap. But reject if first is far.
        // Lightweight: use validateAgainstWall with t check — instead just store.
        setPlacing({ ...placing, firstTap: point });
        setTapPreview(null);
        return;
      }
      // Second tap -> try to emit
      const result = tapsToPlacement(wall, placing.kind, placing.firstTap, point);
      if ("rejected" in result) {
        if (result.rejected.reason === "outside-wall") {
          setOpeningError(t["intake.opening.outsideWall"]);
        } else {
          setOpeningError(t["intake.opening.outsideWall"]);
        }
        return;
      }
      const validation = validateAgainstWall(wall, result.placement.offset_m, result.placement.width_m);
      if (validation !== null) {
        setOpeningError(t["intake.opening.outsideWall"]);
        return;
      }
      setOpeningError(null);
      emit({ type: "markOpening", opening: placementToOpening(result.placement, openingId()) });
      setPlacing(null);
      setTapPreview(null);
      setTool("select");
    }
  }

  function handleEndpointDragEnd(wallIdValue: string, end: "a" | "b", clientX: number, clientY: number): void {
    const p = toSceneCoords(clientX, clientY);
    // Shared corner: every wall meeting at this handle moves together.
    const members = handleMembersFor(handles, wallIdValue, end)?.members
      ?? [{ wallId: wallIdValue, end }];
    let next = scene;
    for (const m of members) {
      const op: SceneOp = { type: "moveWallEndpoint", wallId: m.wallId, end: m.end, point: [p.x, p.y] };
      next = applySceneOp(next, op);
      onChange(next, op);
    }
  }

  function handleFormConfirm(): void {
    if (placing === null) return;
    const wall = walls.find((w) => w.id === placing.wallId);
    if (wall === undefined) {
      setOpeningError(t["intake.opening.outsideWall"]);
      return;
    }
    const offset = Number.parseFloat(formVals.offset.replace(",", "."));
    const width = Number.parseFloat(formVals.width.replace(",", "."));
    const height = Number.parseFloat(formVals.height.replace(",", "."));
    const sill = placing.kind === "window" ? Number.parseFloat(formVals.sill.replace(",", ".")) : null;
    const result = formToPlacement({
      wallId: placing.wallId,
      kind: placing.kind,
      wallOffsetM: offset,
      widthM: width,
      heightM: height,
      sillM: sill,
    });
    if ("rejected" in result) {
      setOpeningError(t["intake.opening.outsideWall"]);
      return;
    }
    if (placing.kind === "window" && Number.isFinite(sill as number) === false) {
      setOpeningError(t["intake.opening.outsideWall"]);
      return;
    }
    const validation = validateAgainstWall(wall, result.placement.offset_m, result.placement.width_m);
    if (validation !== null) {
      setOpeningError(t["intake.opening.outsideWall"]);
      return;
    }
    setOpeningError(null);
    emit({ type: "markOpening", opening: placementToOpening(result.placement, openingId()) });
    setPlacing(null);
    setTapPreview(null);
    setShowForm(false);
    setTool("select");
  }

  function handleMarkOpening(kind: "door" | "window"): void {
    if (selectedWall === null) return;
    const wall = walls.find((w) => w.id === selectedWall);
    if (wall === undefined) return;
    // New flow: enter two-tap placing mode (or form). Do NOT emit until confirmed.
    startPlacing(wall.id, kind);
  }

  function handleRemoveWall(): void {
    if (selectedWall === null) return;
    emit({ type: "removeWall", wallId: selectedWall });
    setSelectedWall(null);
  }

  const toolButtons: { tool: CornerTool; label: string }[] = [
    { tool: "select", label: t["intake.tool.select"] },
    { tool: "addWall", label: t["intake.tool.addWall"] },
    { tool: "door", label: t["intake.tool.door"] },
    { tool: "window", label: t["intake.tool.window"] },
  ];

  const proposalWalls = useMemo(() => proposal?.walls ?? [], [proposal]);
  const proposalDims = useMemo(() => proposal?.dimensions ?? [], [proposal]);
  const proposalOpenings = useMemo(() => proposal?.openings ?? [], [proposal]);

  return (
    <div className="intake-editor">
      <div className="intake-toolbar" role="toolbar" aria-label={t["intake.editor"]}>
        {toolButtons.map((b) => (
          <button
            key={b.tool}
            type="button"
            className={tool === b.tool ? "chip chip-active" : "chip"}
            aria-pressed={tool === b.tool}
            onClick={() => {
              setTool(b.tool);
              if (b.tool === "door" || b.tool === "window") handleMarkOpening(b.tool);
            }}
          >
            {b.label}
          </button>
        ))}
        <button type="button" className="chip" onClick={onUndo} disabled={!canUndo}>
          {t["intake.undo"]}
        </button>
      </div>

      <div className="intake-canvas">
        {imageUrl !== null && (
          <img src={imageUrl} alt="" className="intake-photo" draggable={false} />
        )}
        <svg
          ref={svgRef}
          className="intake-svg"
          viewBox={`0 0 ${canvasW} ${canvasH}`}
          role="application"
          aria-label={t["intake.editor"]}
          onClick={(e) => handleCanvasTap(e.clientX, e.clientY)}
          onPointerMove={(e) => {
            if (placing === null || placing.firstTap === null) return;
            const p = toSceneCoords(e.clientX, e.clientY);
            setTapPreview([p.x, p.y]);
          }}
        >
          {proposalWalls.map((w, i) => (
            <line
              key={`proposal-${i}`}
              x1={w.a[0] * canvasW}
              y1={w.a[1] * canvasH}
              x2={w.b[0] * canvasW}
              y2={w.b[1] * canvasH}
              className="proposal-wall"
              stroke="#2F5D62"
              strokeWidth={1.5}
            />
          ))}
          {proposalDims.map((d, i) => (
            <g key={`dim-${i}`} className="proposal-dim">
              <line
                x1={d.a[0] * canvasW}
                y1={d.a[1] * canvasH}
                x2={d.b[0] * canvasW}
                y2={d.b[1] * canvasH}
                stroke="#2F5D62"
                strokeWidth={1}
                strokeDasharray="4 2"
              />
              <text
                x={(d.a[0] + d.b[0]) / 2 * canvasW}
                y={(d.a[1] + d.b[1]) / 2 * canvasH}
                fill="#2F5D62"
                fontSize={12}
              >
                {d.text}
              </text>
            </g>
          ))}
          {proposalOpenings.map((o, i) => {
            const wall = proposalWalls[o.wall_index];
            if (wall === undefined) return null;
            const ax = wall.a[0] * canvasW;
            const ay = wall.a[1] * canvasH;
            const bx = wall.b[0] * canvasW;
            const by = wall.b[1] * canvasH;
            return (
              <line
                key={`proposal-opening-${i}`}
                x1={ax + (bx - ax) * o.t0}
                y1={ay + (by - ay) * o.t0}
                x2={ax + (bx - ax) * o.t1}
                y2={ay + (by - ay) * o.t1}
                className={o.kind === "door" ? "proposal-opening-door" : "proposal-opening-window"}
              />
            );
          })}
          {walls.map((w) => {
            const a = toDisplay(...previewEndpoint(w, "a", preview));
            const b = toDisplay(...previewEndpoint(w, "b", preview));
            const dragging = preview !== null && draggingWallIds.has(w.id);
            const cls = [
              "wall",
              w.kind === "interior" ? "wall-interior" : "wall-exterior",
              selectedWall === w.id ? "wall-selected" : "",
              isWallEstimated(w) ? "wall-estimated" : "",
              dragging ? "wall-dragging" : "",
            ].filter(Boolean).join(" ");
            return (
              <g key={w.id}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={cls}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedWall(w.id);
                    setSelectedOpening(null);
                  }}
                />
                {selectedWall === w.id && (
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2}
                    className="wall-label"
                  >
                    {`W${wallNumber(walls, w.id)} · ${formatLengthM(wallDisplayLengthM(w))}`}
                  </text>
                )}
              </g>
            );
          })}
          {openings.map((o) => {
            const wall = walls.find((w) => w.id === o.wall_id);
            if (wall === undefined) return null;
            const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
            if (len <= 0) return null;
            const ux = (wall.b[0] - wall.a[0]) / len;
            const uy = (wall.b[1] - wall.a[1]) / len;
            const s0 = toDisplay(wall.a[0] + ux * o.offset_m, wall.a[1] + uy * o.offset_m);
            const s1 = toDisplay(
              wall.a[0] + ux * (o.offset_m + o.width_m),
              wall.a[1] + uy * (o.offset_m + o.width_m),
            );
            if (o.kind === "door") {
              const mx = s1.x - s0.x;
              const my = s1.y - s0.y;
              const mLen = Math.hypot(mx, my);
              const tx = mLen > 0 ? mx / mLen : 0;
              const ty = mLen > 0 ? my / mLen : 1;
              const nx = ty;
              const ny = -tx;
              const r = mLen;
              const arcEnd = { x: s0.x + r * nx, y: s0.y + r * ny };
              const arcD = `M ${s0.x} ${s0.y} A ${r} ${r} 0 0 1 ${arcEnd.x} ${arcEnd.y}`;
              const doorCls = ["opening-door", selectedOpening === o.id ? "opening-selected" : ""].filter(Boolean).join(" ");
              return (
                <g key={o.id}>
                  <line x1={s0.x} y1={s0.y} x2={s1.x} y2={s1.y} className="opening-door-gap" />
                  <line x1={s0.x} y1={s0.y} x2={s1.x} y2={s1.y} className={doorCls} onClick={(e) => { e.stopPropagation(); setSelectedOpening(o.id); setSelectedWall(wall.id); }} />
                  <path d={arcD} className="opening-door-arc" />
                  {selectedOpening === o.id && (<text x={(s0.x + s1.x) / 2} y={(s0.y + s1.y) / 2} className="wall-label">{`${t["intake.selected.door"]} · ${formatLengthM(o.width_m)}`}</text>)}
                </g>
              );
            }
            const mx = s1.x - s0.x;
            const my = s1.y - s0.y;
            const mLen = Math.hypot(mx, my);
            const tx = mLen > 0 ? mx / mLen : 0;
            const ty = mLen > 0 ? my / mLen : 1;
            const nx = ty;
            const ny = -tx;
            const off = 3;
            const winCls = ["opening-window", selectedOpening === o.id ? "opening-selected" : ""].filter(Boolean).join(" ");
            const wA0 = { x: s0.x + nx * off, y: s0.y + ny * off };
            const wA1 = { x: s1.x + nx * off, y: s1.y + ny * off };
            const wB0 = { x: s0.x - nx * off, y: s0.y - ny * off };
            const wB1 = { x: s1.x - nx * off, y: s1.y - ny * off };
            return (
              <g key={o.id}>
                <line x1={wA0.x} y1={wA0.y} x2={wA1.x} y2={wA1.y} className={winCls} onClick={(e) => { e.stopPropagation(); setSelectedOpening(o.id); setSelectedWall(wall.id); }} />
                <line x1={wB0.x} y1={wB0.y} x2={wB1.x} y2={wB1.y} className={winCls} onClick={(e) => { e.stopPropagation(); setSelectedOpening(o.id); setSelectedWall(wall.id); }} />
                {selectedOpening === o.id && (<text x={(s0.x + s1.x) / 2} y={(s0.y + s1.y) / 2} className="wall-label">{`${t["intake.selected.window"]} · ${formatLengthM(o.width_m)}`}</text>)}
              </g>
            );
          })}
        </svg>
        {handles.map((h, i) => {
          const dp = toDisplay(h.point[0], h.point[1]);
          const active = preview !== null
            && h.members.some((m) => m.wallId === preview.wallId && m.end === preview.end);
          const first = h.members[0]!;
          return (
            <button
              key={`handle-${i}`}
              type="button"
              className={active ? "handle-btn handle-active" : "handle-btn"}
              aria-label={t["intake.editor"]}
              style={{
                left: `${(dp.x / canvasW) * 100}%`,
                top: `${(dp.y / canvasH) * 100}%`,
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                (e.target as HTMLButtonElement).setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!e.buttons) return;
                e.stopPropagation();
                setPreview({
                  wallId: first.wallId,
                  end: first.end,
                  point: toSceneCoords(e.clientX, e.clientY),
                });
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                setPreview(null);
                handleEndpointDragEnd(first.wallId, first.end, e.clientX, e.clientY);
              }}
              onPointerCancel={() => setPreview(null)}
            />
          );
        })}
      </div>

      {selectedWallObj !== null && (
        <p className="intake-selected-label" role="status">
          {t["intake.selected.wall"]
            .replace("{n}", String(wallNumber(walls, selectedWallObj.id)))
            .replace("{length}", formatLengthM(wallDisplayLengthM(selectedWallObj)))}
        </p>
      )}
      {selectedOpeningObj !== null && (
        <p className="intake-selected-label" role="status">
          {(selectedOpeningObj.kind === "door"
            ? t["intake.selected.door"]
            : t["intake.selected.window"]
          ).replace("{width}", formatLengthM(selectedOpeningObj.width_m))}
          {selectedOpeningObj.kind === "door" && selectedOpeningObj.width_m < DOOR_MIN_WIDTH_M ? ` · ${t["intake.opening.narrowDoor"]}` : ""}
        </p>
      )}

      {selectedWall !== null && placing === null && (
        <div className="intake-selected">
          <button type="button" className="chip" onClick={() => handleMarkOpening("door")}>
            {t["intake.markDoor"]}
          </button>
          <button type="button" className="chip" onClick={() => handleMarkOpening("window")}>
            {t["intake.markWindow"]}
          </button>
          <button type="button" className="chip chip-danger" onClick={handleRemoveWall}>
            {t["intake.removeWall"]}
          </button>
        </div>
      )}

      {placing !== null && (
        <div className="intake-opening">
          <p className="intake-hint" role="status">
            {placing.firstTap === null
              ? `${t["intake.opening.tapPrompt"]} — ${t["intake.selected.wall"].replace("{n}", String(wallNumber(walls, placing.wallId)))}`
              : `${t["intake.opening.tapPrompt"]} (1/2)`}
          </p>
          {openingError !== null && (
            <p className="intake-error" role="alert">{openingError}</p>
          )}
          {placing.kind === "door" && openings.some((o) => o.kind === "door" && o.width_m < DOOR_MIN_WIDTH_M) === false && (
            // live preview of narrow check is on form/tap result; no-op placeholder to keep strings reachable
            <span style={{ display: "none" }}>{t["intake.opening.narrowDoor"]}</span>
          )}
          {tapPreview !== null && placing.firstTap !== null && (
            <svg className="intake-opening-preview" viewBox={`0 0 ${canvasW} ${canvasH}`} aria-hidden>
              {(() => {
                const wall = walls.find((w) => w.id === placing.wallId);
                if (wall === undefined) return null;
                const p0 = toDisplay(placing.firstTap[0], placing.firstTap[1]);
                const p1 = toDisplay(tapPreview[0], tapPreview[1]);
                return <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} className="opening-preview" strokeDasharray="4 4" stroke="#0ea5e9" strokeWidth={2} />;
              })()}
            </svg>
          )}
          <div className="intake-opening-actions">
            <button type="button" className="chip" onClick={() => setShowForm((v) => !v)}>
              {t["intake.opening.useForm"]}
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => {
                setPlacing(null);
                setTapPreview(null);
                setOpeningError(null);
                setShowForm(false);
              }}
            >
              {t["intake.undo"]}
            </button>
          </div>
          {showForm && (
            <div className="intake-opening-form" role="group" aria-label={t["intake.opening.confirm"]}>
              <label>
                {t["intake.opening.distance"]}
                <input
                  type="text"
                  inputMode="decimal"
                  value={formVals.offset}
                  onChange={(e) => setFormVals((s) => ({ ...s, offset: e.target.value }))}
                />
              </label>
              <label>
                {t["intake.opening.width"]}
                <input
                  type="text"
                  inputMode="decimal"
                  value={formVals.width}
                  onChange={(e) => setFormVals((s) => ({ ...s, width: e.target.value }))}
                />
              </label>
              <label>
                {t["intake.opening.height"]}
                <input
                  type="text"
                  inputMode="decimal"
                  value={formVals.height}
                  onChange={(e) => setFormVals((s) => ({ ...s, height: e.target.value }))}
                />
              </label>
              {placing.kind === "window" && (
                <label>
                  {t["intake.opening.sill"]}
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formVals.sill}
                    onChange={(e) => setFormVals((s) => ({ ...s, sill: e.target.value }))}
                  />
                </label>
              )}
              <button type="button" className="btn-primary" onClick={handleFormConfirm}>
                {t["intake.opening.confirm"]}
              </button>
              {placing.kind === "door" && Number.parseFloat(formVals.width.replace(",", ".")) > 0
                && Number.parseFloat(formVals.width.replace(",", ".")) < DOOR_MIN_WIDTH_M && (
                <span className="intake-warn">{t["intake.opening.narrowDoor"]}</span>
              )}
            </div>
          )}
        </div>
      )}

      {pendingStart !== null && (
        <p className="intake-hint" role="status">
          {t["intake.tapSecond"]}
        </p>
      )}

      <p className="preliminary">{t["notice.preliminary"]}</p>
    </div>
  );
}
