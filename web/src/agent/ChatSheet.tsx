import { useState } from "react";
import type { FormEvent } from "react";
import type { Locale } from "../i18n";
import "./agent.css";
import { getAgentStrings, professionalFlagLabel } from "./agent.i18n";
import type { AgentStrings } from "./agent.i18n";
import type { ChatMessage, ToolEvent } from "./agentTypes";
import { PushToTalk } from "./PushToTalk";

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
          {t["chip.applied"]}: {event.name}
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
      {event.flags.map((flag) => (
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
  onSend: (text: string) => void;
  /** When given, a press-and-hold microphone button is shown and the recorded clip is passed here. */
  onAudio?: (audio: Blob) => void;
  /** A turn is in flight: sending is disabled. */
  pending?: boolean;
}

/** Bottom-sheet chat with the reform agent (phone-first). */
export function ChatSheet({ messages, locale, onSend, onAudio, pending = false }: ChatSheetProps): React.JSX.Element {
  const t = getAgentStrings(locale);
  const [draft, setDraft] = useState("");

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = draft.trim();
    if (text.length === 0 || pending) return;
    onSend(text);
    setDraft("");
  }

  return (
    <section className="agent-sheet" aria-label={t["chat.title"]} aria-busy={pending}>
      <ol className="agent-messages">
        {messages.length === 0 ? <li className="agent-empty">{t["chat.empty"]}</li> : null}
        {messages.map((message) => (
          <li key={message.id} className="agent-message" data-role={message.role}>
            <p className="agent-text">{message.text}</p>
            {message.toolEvents && message.toolEvents.length > 0 ? (
              <ul className="agent-chips">
                {message.toolEvents.map((event, index) => (
                  <ToolChips key={`${message.id}-${index}`} event={event} locale={locale} t={t} />
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
      {pending ? (
        <p className="agent-pending" role="status">
          {t["chat.sending"]}
        </p>
      ) : null}
      <form className="agent-composer" onSubmit={submit}>
        <input
          className="agent-input"
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={t["chat.input"]}
          placeholder={t["chat.placeholder"]}
          enterKeyHint="send"
        />
        <button type="submit" className="agent-send" disabled={pending}>
          {t["chat.send"]}
        </button>
      </form>
      {onAudio ? <PushToTalk locale={locale} onAudio={onAudio} /> : null}
      <p className="agent-caption">{t["caption.preliminary"]}</p>
    </section>
  );
}
