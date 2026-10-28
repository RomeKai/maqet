import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Locale } from "../i18n";
import { getAgentStrings } from "./agent.i18n";
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
  const heldRef = useRef(false);
  const stopRef = useRef<(() => Promise<Blob>) | null>(null);

  // Release the microphone if the component goes away mid-recording.
  useEffect(
    () => () => {
      heldRef.current = false;
      void stopRef.current?.();
      stopRef.current = null;
    },
    [],
  );

  async function begin(): Promise<void> {
    if (heldRef.current || state === "unsupported") return;
    heldRef.current = true;
    setState("recording");

    const result = await startRecording();
    if (result.status !== "recording") {
      heldRef.current = false;
      setState(result.status);
      return;
    }
    if (!heldRef.current) {
      // Released before the microphone was ready: too short to be speech, discard it.
      await result.stop();
      setState("idle");
      return;
    }
    stopRef.current = result.stop;
  }

  async function end(): Promise<void> {
    if (!heldRef.current) return;
    heldRef.current = false;
    const stop = stopRef.current;
    stopRef.current = null;
    if (!stop) return; // begin() is still waiting for the microphone and will discard.
    setState("idle");
    onAudio(await stop());
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
