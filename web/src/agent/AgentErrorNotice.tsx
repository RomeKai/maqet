import type { Locale } from "../i18n";
import { getAgentStrings } from "./agent.i18n";
import type { AgentErrorInfo } from "./agentError";

interface AgentErrorNoticeProps {
  error: AgentErrorInfo;
  locale: Locale;
  onRetry?: () => void;
  /** Disables Retry while a turn is already running. */
  busy?: boolean;
}

/** One friendly sentence, a Retry button when the message can be resent, raw text behind Details. */
export function AgentErrorNotice({ error, locale, onRetry, busy = false }: AgentErrorNoticeProps): React.JSX.Element {
  const t = getAgentStrings(locale);
  return (
    <div className="agent-error-box px-3" role="alert">
      <p className="agent-error">{error.message}</p>
      {error.retryText !== null && onRetry ? (
        <button type="button" className="agent-retry min-h-12 rounded-xl border-2 border-foreground px-4 text-[15px] font-bold" onClick={onRetry} disabled={busy}>
          {t["chat.retry"]}
        </button>
      ) : null}
      {error.details ? (
        <details className="agent-details">
          <summary className="min-h-12 py-3 text-[15px] font-bold">{t["chat.details"]}</summary>
          <p className="agent-detail-line">{error.details}</p>
        </details>
      ) : null}
    </div>
  );
}
