import { useMemo, useRef, useState } from "react";
import type { Scene, Wall } from "../scene/types";
import { applySceneOp, isWallEstimated, type SceneOp } from "../scene/store";
import { getStrings, type Locale } from "../i18n";
import type { IntakeProposal } from "./api";

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
const DOOR_W_M = 0.9;
const WINDOW_W_M = 1.4;
const WINDOW_H_M = 1.4;
const DOOR_H_M = 2.05;

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
}: CornerEditorProps) {
  const t = getStrings(locale);
  const [tool, setTool] = useState<CornerTool>("select");
  const [selectedWall, setSelectedWall] = useState<string | null>(null);
  const [pendingStart, setPendingStart] = useState<Point | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

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

  function emit(op: SceneOp): void {
    onChange(applySceneOp(scene, op), op);
  }

  function handleCanvasTap(clientX: number, clientY: number): void {
    if (tool !== "addWall") return;
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
  }

  function handleEndpointDragEnd(wallIdValue: string, end: "a" | "b", clientX: number, clientY: number): void {
    const p = toSceneCoords(clientX, clientY);
    emit({ type: "moveWallEndpoint", wallId: wallIdValue, end, point: [p.x, p.y] });
  }

  function handleMarkOpening(kind: "door" | "window"): void {
    if (selectedWall === null) return;
    const wall = walls.find((w) => w.id === selectedWall);
    if (wall === undefined) return;
    const wallLen = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    if (wallLen <= 0) return;
    const width = kind === "door" ? DOOR_W_M : WINDOW_W_M;
    const offset = Math.max(0, (wallLen - width) / 2);
    emit({
      type: "markOpening",
      opening: {
        id: openingId(),
        wall_id: wall.id,
        kind,
        offset_m: offset,
        width_m: Math.min(width, wallLen * 0.8),
        height_m: kind === "door" ? DOOR_H_M : WINDOW_H_M,
        ...(kind === "door" ? {} : { sill_m: 0.8 }),
      },
    });
    setTool("select");
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
          {walls.map((w) => {
            const a = toDisplay(w.a[0], w.a[1]);
            const b = toDisplay(w.b[0], w.b[1]);
            const cls = selectedWall === w.id
              ? "wall wall-selected"
              : isWallEstimated(w)
                ? "wall wall-estimated"
                : "wall";
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
                  }}
                />
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
            return (
              <line
                key={o.id}
                x1={s0.x}
                y1={s0.y}
                x2={s1.x}
                y2={s1.y}
                className={o.kind === "door" ? "opening-door" : "opening-window"}
              />
            );
          })}
        </svg>
        {/* 44 px HTML hit targets: SVG units scale with zoom, screen px don't */}
        {walls.map((w) =>
          (["a", "b"] as const).map((end) => {
            const raw = end === "a" ? w.a : w.b;
            const p = toDisplay(raw[0], raw[1]);
            return (
              <button
                key={`${w.id}-${end}`}
                type="button"
                className="handle-btn"
                aria-label={t["intake.editor"]}
                style={{
                  left: `${(p.x / canvasW) * 100}%`,
                  top: `${(p.y / canvasH) * 100}%`,
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.target as HTMLButtonElement).setPointerCapture(e.pointerId);
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  handleEndpointDragEnd(w.id, end, e.clientX, e.clientY);
                }}
              />
            );
          }),
        )}
      </div>

      {selectedWall !== null && (
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

      {pendingStart !== null && (
        <p className="intake-hint" role="status">
          {t["intake.tapSecond"]}
        </p>
      )}

      <p className="preliminary">{t["notice.preliminary"]}</p>
    </div>
  );
}
