import { useState } from "react";
import type { Scene } from "../scene/types";
import type { Locale } from "../i18n";
import { BottomSheet } from "../ui";
import { getAgentStrings } from "./agent.i18n";
import { roomEditCall, wallEditCall, type EditCall } from "./editCall";

interface EditSheetProps {
  scene: Scene;
  locale: Locale;
  /** Tapped wall id, or null to edit a room. */
  wallId: string | null;
  busy: boolean;
  error: string | null;
  onApply: (call: EditCall) => void;
  onClose: () => void;
}

const field =
  "min-h-12 w-full rounded-xl border-2 border-input bg-background px-4 font-mono text-2xl font-bold";

/** Reform edit sheet: typed meters for a wall or a room -> one deterministic op (undoable). */
export function EditSheet({ scene, locale, wallId, busy, error, onApply, onClose }: EditSheetProps): React.JSX.Element {
  const t = getAgentStrings(locale);
  const rooms = scene.rooms ?? [];
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [depth, setDepth] = useState("");
  const [invalid, setInvalid] = useState(false);

  function apply(): void {
    const call = wallId !== null ? wallEditCall(wallId, length) : roomEditCall(roomId, width, depth);
    if (call === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onApply(call);
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t["edit.title"]}
      closeLabel={t["edit.cancel"]}
      footer={
        <div className="flex gap-2">
          <button type="button" className="min-h-12 flex-1 rounded-xl border-2 border-border font-bold" onClick={onClose}>
            {t["edit.cancel"]}
          </button>
          <button
            type="button"
            className="min-h-12 flex-[2] rounded-xl bg-foreground font-bold text-background disabled:opacity-50"
            disabled={busy}
            onClick={apply}
          >
            {t["edit.apply"]}
          </button>
        </div>
      }
    >
      <div className="space-y-3 font-sans">
        {wallId !== null ? (
          <label className="block text-[15px] font-bold">
            {t["edit.wall"]}
            <input className={field} inputMode="decimal" value={length} onChange={(e) => setLength(e.target.value)} autoFocus />
          </label>
        ) : (
          <>
            <label className="block text-[15px] font-bold">
              {t["edit.room"]}
              <select className={field} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <label className="block flex-1 text-[15px] font-bold">
                {t["edit.width"]}
                <input className={field} inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} />
              </label>
              <label className="block flex-1 text-[15px] font-bold">
                {t["edit.depth"]}
                <input className={field} inputMode="decimal" value={depth} onChange={(e) => setDepth(e.target.value)} />
              </label>
            </div>
          </>
        )}
        {invalid ? <p role="alert" className="text-danger">{t["edit.invalid"]}</p> : null}
        {error ? <p role="alert" className="text-danger">{error}</p> : null}
        <p className="text-sm text-muted-foreground">{t["edit.preliminary"]}</p>
      </div>
    </BottomSheet>
  );
}
