import { useEffect, useRef, useState } from "react";
import { ArrowRight, Keyboard } from "lucide-react";
import type { FormEvent } from "react";
import type { Locale } from "../i18n";
import "./agent.css";
import { SUGGESTIONS, type SuggestionStage } from "./suggestions";
import { getAgentStrings, normalizeProfessionalFlags, professionalFlagLabel, toolLabel } from "./agent.i18n";
import type { AgentStrings } from "./agent.i18n";
import type { ChatMessage, ToolEvent } from "./agentTypes";
import { PushToTalk, type PushToTalkState } from "./PushToTalk";
import { sendDraft } from "./sendDraft";

interface ToolChipsProps {
  event: ToolEvent;
  locale: Locale;
  t: AgentStrings;
}

/** Compact chips for one tool call: op applied, rule violations, warnings and licensed-professional flags. */
function ToolChips({ event, locale, t }: ToolChipsProps): React.JSX.Element {
  return (
    <>
      {event.ok ? (
        <li className="agent-chip agent-chip-ok" data-chip="applied">
          {t["chip.applied"]}: {toolLabel(locale, event.name)}
        </li>
      ) : null}
      {!event.ok && event.errors.length === 0 ? (
        <li className="agent-chip agent-chip-warn" data-chip="rejected">
          {t["chip.rejected"]}: {toolLabel(locale, event.name)}
        </li>
      ) : null}
      {event.errors.map((error, index) => (
        <li
          key={`e-${error.code}-${index}`}
          className="agent-chip agent-chip-warn"
          data-chip="violation"
          data-code={error.code}
        >
          {t["chip.violation"]}: {error.message}
        </li>
      ))}
      {event.warnings.map((warning, index) => (
        <li key={`w-${index}`} className="agent-chip agent-chip-warn" data-chip="warning">
          {t["chip.warning"]}: {warning}
        </li>
      ))}
      {normalizeProfessionalFlags(event.flags).map((flag) => (
        <li key={`f-${flag}`} className="agent-chip agent-chip-pro" data-chip="professional" data-flag={flag} role="alert">
          {professionalFlagLabel(locale, flag)}
        </li>
      ))}
    </>
  );
}

interface ChatSheetProps {
  messages: ChatMessage[];
  locale: Locale;
  onSend: (text: string) => void | Promise<void>;
  /** When given, the round microphone (hold = talk, tap = toggle) replaces the text row; a keyboard button opens it. */
  onAudio?: (audio: Blob) => void;
  /** A turn is in flight: sending is disabled. */
  pending?: boolean;
  /** Show the quick-request chips above the bottom bar. */
  suggestions?: boolean;
  /** Which stage the chips belong to (each chip maps to one tool of that stage). */
  suggestionStage?: SuggestionStage;
  /** "Next ->" in the bottom bar. */
  onNext?: () => void;
  /** Compact dock (Reform/Design): the text input is always visible and the message list only exists once there are messages. */
  compact?: boolean;
}


/** Chat with the agent: bubbles, quick requests and a talk bar (phone-first). */
export function ChatSheet({
  messages,
  locale,
  onSend,
  onAudio,
  pending = false,
  suggestions = false,
  suggestionStage = "reform",
  onNext,
  compact = false,
}: ChatSheetProps): React.JSX.Element {
  const t = getAgentStrings(locale);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [pttState, setPttState] = useState<PushToTalkState>("idle");
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list !== null) list.scrollTop = list.scrollHeight;
  }, [messages, pending]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = draft.trim();
    if (text.length === 0 || pending) return;
    void sendDraft(text, onSend, setDraft);
  }

  const showInput = onAudio === undefined || typing || compact;
  const showList = !compact || messages.length > 0 || pending;
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <section className="agent-sheet" aria-label={t["chat.title"]} aria-busy={pending}>
      {showList ? (
      <ol className="agent-messages" ref={listRef} aria-live="polite">
        {messages.length === 0 && !compact ? <li className="agent-empty">{t["chat.empty"]}</li> : null}
        {messages.map((message) => (
          <li key={message.id} className="agent-message" data-role={message.role}>
            <p className="agent-text">{message.text}</p>
            {message.details && message.details.length > 0 ? (
              <details className="agent-details">
                <summary className="min-h-12 py-3 text-[15px] font-bold">{t["chat.details"]}</summary>
                <ul className="text-sm">
                  {message.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            {message.toolEvents && message.toolEvents.length > 0 ? (
              <ul className="agent-chips">
                {message.toolEvents.map((event, index) => (
                  <ToolChips key={`${message.id}-${index}`} event={event} locale={locale} t={t} />
                ))}
              </ul>
            ) : null}
          </li>
        ))}
        {pending ? (
          <li className="agent-message agent-pending" data-role="assistant" role="status">
            {t["chat.sending"]}
          </li>
        ) : null}
      </ol>
      ) : null}
      {suggestions ? (
        <div className={compact ? "agent-suggestions agent-suggestions-compact" : "agent-suggestions"} role="group" aria-label={t["suggest.label"]}>
          {SUGGESTIONS[suggestionStage].map(({ key }) => (
            <button
              key={key}
              type="button"
              className="agent-suggestion"
              disabled={pending}
              onClick={() => void onSend(t[key])}
            >
              {t[key]}
            </button>
          ))}
          {compact && onNext ? (
            <button type="button" className="agent-next shrink-0" onClick={onNext}>
              {t["bar.next"]} <ArrowRight className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}
      {showInput ? (
        <form className="agent-composer" onSubmit={submit}>
          <input
            className="agent-input"
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={t["chat.input"]}
            placeholder={t["chat.placeholder"]}
            enterKeyHint="send"
            autoFocus={typing && !compact}
            ref={inputRef}
          />
          <button type="submit" className="agent-send" disabled={pending}>
            {t["chat.send"]}
          </button>
          {compact && onAudio ? (
            <PushToTalk locale={locale} onAudio={onAudio} appearance="round" onStateChange={setPttState} />
          ) : null}
        </form>
      ) : null}
      {onAudio && !compact ? (
        <div className="agent-bar">
          <div className="agent-bar-left">
            <p className="agent-bar-hint">{pttState === "recording" ? t["bar.hintRecording"] : t["bar.hint"]}</p>
            <button
              type="button"
              className="agent-keyboard"
              aria-label={t["bar.keyboard"]}
              aria-pressed={compact ? undefined : typing}
              onClick={() => (compact ? inputRef.current?.focus() : setTyping((v) => !v))}
            >
              <Keyboard className="size-5" aria-hidden />
            </button>
          </div>
          <PushToTalk locale={locale} onAudio={onAudio} appearance="round" onStateChange={setPttState} />
          <div className="agent-bar-right">
            {onNext ? (
              <button type="button" className="agent-next" onClick={onNext}>
                {t["bar.next"]} <ArrowRight className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
