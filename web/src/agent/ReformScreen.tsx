import { useState } from "react";
import { Ruler, Undo2 } from "lucide-react";
import type { Scene } from "../scene/types";
import type { Locale } from "../i18n";
import { SceneView } from "../view3d/SceneView";
import { getAgentStrings } from "./agent.i18n";
import type { ChatMessage } from "./agentTypes";
import { ChatSheet } from "./ChatSheet";
import { floorAreaM2 } from "./floorArea";
import { VariantTabs, formatArea, type VariantsState } from "./VariantTabs";
import { EditSheet } from "./EditSheet";
import type { EditCall } from "./editCall";

interface ReformScreenProps {
  scene: Scene | null;
  locale: Locale;
  selectedWallId: string | null;
  onSelectWall: (wallId: string) => void;
  onSceneChange: (scene: Scene) => void;
  messages: ChatMessage[];
  onSend: (text: string) => void | Promise<void>;
  onAudio: (audio: Blob) => void;
  pending: boolean;
  agentError: string | null;
  onNext: () => void;
  variants: VariantsState;
  /** Apply one deterministic edit; resolves with an error message or null. */
  onEdit: (call: EditCall) => Promise<string | null>;
}

/** Reform stage (phone): compact 3D card, Now/A/B/C, chat bubbles, quick requests, talk bar. */
export function ReformScreen(props: ReformScreenProps): React.JSX.Element {
  const { scene, locale } = props;
  const t = getAgentStrings(locale);
  const variants = props.variants;
  const area = scene ? floorAreaM2(scene) : null;
  const [editing, setEditing] = useState<{ wallId: string | null } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Tapping a wall in the 3D card opens the edit sheet for that wall.
  function selectWall(wallId: string): void {
    props.onSelectWall(wallId);
    setEditError(null);
    setEditing({ wallId });
  }

  async function applyEdit(call: EditCall): Promise<void> {
    setEditBusy(true);
    const error = await props.onEdit(call);
    setEditBusy(false);
    setEditError(error);
    if (error === null) setEditing(null);
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto font-sans" aria-label={t["chat.title"]} data-testid="reform-screen">
      <div className="relative mx-3 mt-2 h-[30dvh] min-h-[7rem] shrink-0 overflow-hidden rounded-2xl border-2 border-foreground bg-card">
        {scene !== null && (scene.walls?.length ?? 0) > 0 ? (
          <SceneView scene={scene} selectedWallId={props.selectedWallId} onSelectWall={selectWall} wallNumbers />
        ) : null}
        {area !== null ? (
          <span
            className="absolute left-2 top-2 rounded-full border-2 border-foreground bg-card px-3 py-1 font-mono text-[15px] font-bold"
            aria-label={`${t["card.area"]}: ${formatArea(area, locale)}`}
          >
            {formatArea(area, locale)}
          </span>
        ) : null}
        <button
          type="button"
          className="absolute bottom-2 right-2 flex min-h-12 items-center gap-2 rounded-full border-2 border-foreground bg-card px-4 text-[15px] font-bold"
          onClick={() => {
            setEditError(null);
            setEditing({ wallId: null });
          }}
        >
          <Ruler className="size-5" aria-hidden />
          {t["edit.open"]}
        </button>
        <button
          type="button"
          className="absolute right-2 top-2 flex size-12 items-center justify-center rounded-full border-2 border-foreground bg-card disabled:opacity-40"
          aria-label={t["card.undo"]}
          disabled={variants.busy || variants.data === null}
          onClick={() => void variants.undo()}
        >
          <Undo2 className="size-5" aria-hidden />
        </button>
      </div>
      <VariantTabs state={variants} locale={locale} />
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatSheet
          messages={props.messages}
          locale={locale}
          onSend={props.onSend}
          onAudio={props.onAudio}
          pending={props.pending}
          suggestions
          onNext={props.onNext}
        />
        {props.agentError ? <p className="agent-error px-3">{props.agentError}</p> : null}
      </div>
      {editing !== null && scene !== null ? (
        <EditSheet
          scene={scene}
          locale={locale}
          wallId={editing.wallId}
          busy={editBusy}
          error={editError}
          onApply={(call) => void applyEdit(call)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </main>
  );
}
