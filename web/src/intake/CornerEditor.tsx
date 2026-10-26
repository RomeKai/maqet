import { useMemo, useRef, useState } from "react";
import type { Scene, Wall } from "../scene/types";
import { applySceneOp, type SceneOp } from "../scene/store";
import { getStrings, type Locale } from "../i18n";

export type CornerTool = "select" | "addWall" | "door" | "window";

interface Point {
  x: number;
  y: number;
}

interface CornerEditorProps {
  locale: Locale;
  scene: Scene;
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
 * 2D plan corner editor (P0): SVG over the photo, draggable endpoints
 * (≥44 px touch targets), add/remove wall, mark door/window.
 * Every edit is a Scene op, reported to the parent store via onChange.
 */
export function CornerEditor({
  locale,
  scene,
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

  function toSceneCoords(clientX: number, clientY: number): Point {
    const svg = svgRef.current;
    if (svg === null) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * canvasW,
      y: ((clientY - rect.top) / rect.height) * canvasH,
    };
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
          {walls.map((w) => (
            <g key={w.id}>
              <line
                x1={w.a[0]}
                y1={w.a[1]}
                x2={w.b[0]}
                y2={w.b[1]}
                className={selectedWall === w.id ? "wall wall-selected" : "wall"}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedWall(w.id);
                }}
              />
            </g>
          ))}
          {openings.map((o) => {
            const wall = walls.find((w) => w.id === o.wall_id);
            if (wall === undefined) return null;
            const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
            if (len <= 0) return null;
            const ux = (wall.b[0] - wall.a[0]) / len;
            const uy = (wall.b[1] - wall.a[1]) / len;
            const x0 = wall.a[0] + ux * o.offset_m;
            const y0 = wall.a[1] + uy * o.offset_m;
            const x1 = wall.a[0] + ux * (o.offset_m + o.width_m);
            const y1 = wall.a[1] + uy * (o.offset_m + o.width_m);
            return (
              <line
                key={o.id}
                x1={x0}
                y1={y0}
                x2={x1}
                y2={y1}
                className={o.kind === "door" ? "opening-door" : "opening-window"}
              />
            );
          })}
        </svg>
        {/* 44 px HTML hit targets: SVG units scale with zoom, screen px don't */}
        {walls.map((w) =>
          (["a", "b"] as const).map((end) => {
            const p = end === "a" ? w.a : w.b;
            return (
              <button
                key={`${w.id}-${end}`}
                type="button"
                className="handle-btn"
                aria-label={t["intake.editor"]}
                style={{
                  left: `${(p[0] / canvasW) * 100}%`,
                  top: `${(p[1] / canvasH) * 100}%`,
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
