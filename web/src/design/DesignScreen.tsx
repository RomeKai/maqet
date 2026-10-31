import { useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Plus, RotateCw, Trash2, Undo2 } from "lucide-react";
import type { Scene } from "../scene/types";
import type { Locale } from "../i18n";
import { SceneView } from "../view3d/SceneView";
import { BottomSheet } from "../ui";
import { ChatSheet } from "../agent/ChatSheet";
import type { ChatMessage } from "../agent/agentTypes";
import {
  NUDGE_M,
  finishCall,
  nudgeCall,
  placeCall,
  removeCall,
  rotateCall,
  undoCall,
  type EditCall,
} from "../agent/editCall";
import { FINISHES, FURNITURE, finishLabel, furnitureLabel } from "./catalog";
import { getDesignStrings } from "./design.i18n";

export interface DesignEditResult {
  error: string | null;
  warnings: string[];
}

interface DesignScreenProps {
  scene: Scene | null;
  locale: Locale;
  selectedWallId: string | null;
  onSelectWall: (wallId: string) => void;
  messages: ChatMessage[];
  onSend: (text: string) => void | Promise<void>;
  onAudio: (audio: Blob) => void;
  pending: boolean;
  agentError: string | null;
  onNext: () => void;
  onEdit: (call: EditCall) => Promise<DesignEditResult>;
  /** Explicit tap only: resolves with an image data URL or an error. Costs credits. */
  onRender?: (roomId: string) => Promise<{ image: string | null; error: string | null }>;
}

type Tab = "furniture" | "finishes" | "items";

const btn =
  "flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-border px-3 text-[15px] font-bold disabled:opacity-40";
const on = "bg-foreground text-background";

/** Design stage (phone): 3D card, tap sheet (furniture, finishes, placed items), chat chips. Same layout contract as Reform. */
export function DesignScreen(props: DesignScreenProps): React.JSX.Element {
  const { scene, locale } = props;
  const t = getDesignStrings(locale);
  const rooms = scene?.rooms ?? [];
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("furniture");
  const [roomId, setRoomId] = useState<string>("");
  const [itemId, setItemId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [rendering, setRendering] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const activeRoom = rooms.find((r) => r.id === roomId)?.id ?? rooms[0]?.id ?? "";
  const items = scene?.furniture ?? [];
  const item = items.find((f) => f.id === itemId) ?? items[items.length - 1] ?? null;

  async function run(call: EditCall): Promise<void> {
    setBusy(true);
    const res = await props.onEdit(call);
    setBusy(false);
    setNotes(res.error !== null ? [res.error] : res.warnings);
  }

  async function render(): Promise<void> {
    if (!props.onRender) return;
    setRendering(true);
    const res = await props.onRender(activeRoom);
    setRendering(false);
    setImage(res.image);
    if (res.error !== null) setNotes([res.error]);
  }

  const nudge = (dx: number, dy: number, label: string, icon: React.ReactNode): React.JSX.Element => (
    <button
      type="button"
      className={btn}
      aria-label={label}
      disabled={busy || item === null}
      onClick={() => item !== null && void run(nudgeCall(item.id, item.position, dx, dy))}
    >
      {icon}
    </button>
  );

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden font-sans" aria-label={t["design.title"]} data-testid="design-screen">
      <div className="agent-card relative mx-3 mt-2 h-[26dvh] min-h-[4.5rem] shrink overflow-hidden rounded-2xl border-2 border-foreground bg-card">
        {scene !== null && (scene.walls?.length ?? 0) > 0 ? (
          <SceneView scene={scene} selectedWallId={props.selectedWallId} onSelectWall={props.onSelectWall} wallNumbers />
        ) : null}
        <button
          type="button"
          className="absolute bottom-2 right-2 flex min-h-12 items-center gap-2 rounded-full border-2 border-foreground bg-card px-4 text-[15px] font-bold"
          onClick={() => setOpen(true)}
        >
          <Plus className="size-5" aria-hidden />
          {t["design.add"]}
        </button>
        <button
          type="button"
          className="absolute right-2 top-2 flex size-12 items-center justify-center rounded-full border-2 border-foreground bg-card disabled:opacity-40"
          aria-label={t["design.undo"]}
          disabled={busy}
          onClick={() => void run(undoCall())}
        >
          <Undo2 className="size-5" aria-hidden />
        </button>
      </div>
      {notes.length > 0 ? (
        <ul className="mx-3 mt-1 space-y-1" role="status" data-testid="design-notes">
          {notes.map((n) => (
            <li key={n} className="agent-chip agent-chip-warn">
              {n}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="agent-dock flex flex-1 flex-col">
        <ChatSheet
          messages={props.messages}
          locale={locale}
          onSend={props.onSend}
          onAudio={props.onAudio}
          pending={props.pending}
          suggestions
          suggestionStage="design"
          onNext={props.onNext}
        />
        {props.agentError ? <p className="agent-error px-3">{props.agentError}</p> : null}
      </div>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={t["design.sheet"]} closeLabel={t["design.close"]}>
        <div className="space-y-3 font-sans">
          {rooms.length === 0 ? (
            <p>{t["design.noRooms"]}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t["design.room"]}>
                {rooms.map((r) => (
                  <button key={r.id} type="button" aria-pressed={r.id === activeRoom} className={`${btn} ${r.id === activeRoom ? on : ""}`} onClick={() => setRoomId(r.id)}>
                    {r.name}
                  </button>
                ))}
              </div>
              <div className="flex gap-2" role="tablist">
                {(["furniture", "finishes", "items"] as const).map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k} className={`${btn} flex-1 ${tab === k ? on : ""}`} onClick={() => setTab(k)}>
                    {t[`design.tab.${k}`]}
                  </button>
                ))}
              </div>
              {tab === "furniture" ? (
                <div className="grid grid-cols-2 gap-2">
                  {FURNITURE.map((f) => (
                    <button key={f.id} type="button" className={btn} disabled={busy} onClick={() => void run(placeCall(f.id, activeRoom))}>
                      <span className="size-4 rounded-sm border border-foreground" style={{ background: f.color }} aria-hidden />
                      {furnitureLabel(f.id, locale)}
                    </button>
                  ))}
                </div>
              ) : null}
              {tab === "finishes" ? (
                <div className="space-y-3">
                  <p className="text-sm">{t["design.brighterHint"]}</p>
                  {(["floor", "walls"] as const).map((part) => (
                    <div key={part}>
                      <h3 className="mb-1 text-[15px] font-bold">{t[`design.${part}`]}</h3>
                      <div className="grid grid-cols-2 gap-2">
                        {FINISHES.filter((f) => f.surface === (part === "floor" ? "floor" : "wall")).map((f) => (
                          <button key={f.id} type="button" className={btn} disabled={busy} onClick={() => void run(finishCall(activeRoom, part, f.id))}>
                            <span className="size-4 rounded-sm border border-foreground" style={{ background: f.color }} aria-hidden />
                            {finishLabel(f, locale)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {tab === "items" ? (
                item === null ? (
                  <p>{t["design.noItems"]}</p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {items.map((f) => (
                        <button key={f.id} type="button" aria-pressed={f.id === item.id} className={`${btn} ${f.id === item.id ? on : ""}`} onClick={() => setItemId(f.id)}>
                          {furnitureLabel(f.catalog_id, locale)}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {nudge(-NUDGE_M, 0, t["design.moveLeft"], <ArrowLeft className="size-5" />)}
                      {nudge(0, NUDGE_M, t["design.moveUp"], <ArrowUp className="size-5" />)}
                      {nudge(0, -NUDGE_M, t["design.moveDown"], <ArrowDown className="size-5" />)}
                      {nudge(NUDGE_M, 0, t["design.moveRight"], <ArrowRight className="size-5" />)}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" className={`${btn} flex-1`} disabled={busy} onClick={() => void run(rotateCall(item.id))}>
                        <RotateCw className="size-5" aria-hidden />
                        {t["design.rotate"]}
                      </button>
                      <button type="button" className={`${btn} flex-1`} disabled={busy} onClick={() => void run(removeCall(item.id))}>
                        <Trash2 className="size-5" aria-hidden />
                        {t["design.remove"]}
                      </button>
                    </div>
                  </div>
                )
              ) : null}
              {notes.length > 0 ? (
                <p role="status" className="text-sm font-bold">
                  {notes[0]}
                </p>
              ) : null}
              {props.onRender ? (
                <div className="space-y-2">
                  <button type="button" className={`${btn} w-full`} disabled={rendering || activeRoom === ""} onClick={() => void render()}>
                    {rendering ? t["design.rendering"] : t["design.render"]}
                  </button>
                  {image !== null ? (
                    <figure>
                      <img src={image} alt={t["design.renderLabel"]} className="w-full rounded-xl border-2 border-foreground" />
                      <figcaption className="text-sm font-bold">{t["design.renderLabel"]}</figcaption>
                    </figure>
                  ) : null}
                </div>
              ) : null}
              <p className="text-sm">{t["design.prelim"]}</p>
            </>
          )}
        </div>
      </BottomSheet>
    </main>
  );
}
