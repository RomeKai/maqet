/**
 * Send a drafted message and clear the draft only once the send succeeded, so a failed turn
 * does not lose what the user typed. Text typed while the send was in flight is preserved.
 */
export async function sendDraft(
  text: string,
  onSend: (text: string) => void | Promise<void>,
  updateDraft: (fn: (current: string) => string) => void,
): Promise<void> {
  try {
    await onSend(text);
  } catch {
    return; // keep the draft so the user can retry
  }
  updateDraft((current) => (current === text ? "" : current));
}
