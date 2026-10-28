import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Locale } from "../i18n";
import { getAgentStrings } from "./agent.i18n";
import { createPressSession } from "./pressSession";
import type { PressSession } from "./pressSession";
import { isRecordingSupported, startRecording } from "./recorder";

export type PushToTalkState = "idle" | "recording" | "denied" | "unsupported" | "error";

interface PushToTalkProps {
  locale: Locale;
  /** Receives the recorded clip when the button is released. */
  onAudio: (audio: Blob) => void;
}

const HOLD_KEYS = new Set([" ", "Enter"]);

/** Press-and-hold microphone button. Pointer and keyboard (Space/Enter) both hold. */
export function PushToTalk({ locale, onAudio }: PushToTalkProps): React.JSX.Element {
  const t = getAgentStrings(locale);
  const [state, setState] = useState<PushToTalkState>(() => (isRecordingSupported() ? "idle" : "unsupported"));
  const onAudioRef = useRef(onAudio);
  onAudioRef.current = onAudio;
  const sessionRef = useRef<PressSession | null>(null);
  sessionRef.current ??= createPressSession({
    startRecording,
    onAudio: (audio) => onAudioRef.current(audio),
    onState: setState,
  });

  // Release the microphone if the component goes away mid-recording.
  useEffect(() => {
    const session = sessionRef.current;
    return () => session?.dispose();
  }, []);

  async function begin(): Promise<void> {
    if (state === "unsupported") return;
    await sessionRef.current?.begin();
  }

  async function end(): Promise<void> {
    await sessionRef.current?.end();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!HOLD_KEYS.has(event.key) || event.repeat) return;
    event.preventDefault();
    void begin();
  }

  function onKeyUp(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!HOLD_KEYS.has(event.key)) return;
    event.preventDefault();
    void end();
  }

  const label = state === "recording" ? t["ptt.recording"] : t["ptt.hold"];
  const message =
    state === "denied" ? t["ptt.denied"] : state === "unsupported" ? t["ptt.unsupported"] : state === "error" ? t["ptt.error"] : null;

  return (
    <div className="agent-ptt" data-ptt-state={state}>
      <button
        type="button"
        className="agent-ptt-button"
        disabled={state === "unsupported"}
        aria-pressed={state === "recording"}
        onPointerDown={() => void begin()}
        onPointerUp={() => void end()}
        onPointerCancel={() => void end()}
        onPointerLeave={() => void end()}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onContextMenu={(event) => event.preventDefault()}
      >
        {label}
      </button>
      {message ? (
        <p className="agent-ptt-message" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
