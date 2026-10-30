import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Mic } from "lucide-react";
import type { Locale } from "../i18n";
import { getAgentStrings } from "./agent.i18n";
import { createPressSession } from "./pressSession";
import type { PressSession } from "./pressSession";
import { isRecordingSupported, startRecording } from "./recorder";
import { onPttPress, onPttRelease } from "./pttGesture";

export type PushToTalkState = "idle" | "recording" | "denied" | "unsupported" | "error";

interface PushToTalkProps {
  locale: Locale;
  /** Receives the recorded clip when the button is released. */
  onAudio: (audio: Blob) => void;
  /** "round": big round mic for the bottom bar (label kept for screen readers). */
  appearance?: "bar" | "round";
  /** Recording state changes (for a hint outside the button). */
  onStateChange?: (state: PushToTalkState) => void;
}

const HOLD_KEYS = new Set([" ", "Enter"]);

/** Press-and-hold microphone button. Pointer and keyboard (Space/Enter) both hold. */
export function PushToTalk({ locale, onAudio, appearance = "bar", onStateChange }: PushToTalkProps): React.JSX.Element {
  const t = getAgentStrings(locale);
  const [state, setState] = useState<PushToTalkState>(() => (isRecordingSupported() ? "idle" : "unsupported"));
  const onAudioRef = useRef(onAudio);
  onAudioRef.current = onAudio;
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  const sessionRef = useRef<PressSession | null>(null);
  /** Hold = talk; a quick tap latches recording on until the next press. */
  const latched = useRef(false);
  const downAt = useRef(0);
  const pressBegan = useRef(false);
  sessionRef.current ??= createPressSession({
    startRecording,
    onAudio: (audio) => onAudioRef.current(audio),
    onState: (next) => {
      setState(next);
      onStateChangeRef.current?.(next);
    },
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
    latched.current = false;
    pressBegan.current = false;
    await sessionRef.current?.end();
  }

  function press(): void {
    if (onPttPress(latched.current) === "end") {
      void end();
      return;
    }
    downAt.current = Date.now();
    pressBegan.current = true;
    void begin();
  }

  function release(): void {
    if (!pressBegan.current) return;
    pressBegan.current = false;
    if (onPttRelease(Date.now() - downAt.current) === "latch") latched.current = true;
    else void end();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!HOLD_KEYS.has(event.key) || event.repeat) return;
    event.preventDefault();
    press();
  }

  function onKeyUp(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!HOLD_KEYS.has(event.key)) return;
    event.preventDefault();
    release();
  }

  const label = state === "recording" ? t["ptt.recording"] : t["ptt.hold"];
  const message =
    state === "denied" ? t["ptt.denied"] : state === "unsupported" ? t["ptt.unsupported"] : state === "error" ? t["ptt.error"] : null;

  return (
    <div className="agent-ptt" data-ptt-state={state} data-appearance={appearance}>
      <button
        type="button"
        className="agent-ptt-button"
        aria-label={label}
        disabled={state === "unsupported"}
        aria-pressed={state === "recording"}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          press();
        }}
        onPointerUp={release}
        onPointerCancel={() => void end()}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onContextMenu={(event) => event.preventDefault()}
      >
        <Mic className={appearance === "round" ? "size-8" : "size-6"} aria-hidden />
        {appearance === "round" ? null : label}
      </button>
      {message ? (
        <p className="agent-ptt-message" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
