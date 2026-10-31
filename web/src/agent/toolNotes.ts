/** Failed tool calls and rule warnings are shown to the user, never swallowed (bug C). */
export function withToolNotes(reply: string, errors: readonly string[], warnings: readonly string[]): string {
  const notes = [...new Set([...errors, ...warnings])];
  return notes.length === 0 ? reply : `${reply}\n\n${notes.map((n) => `• ${n}`).join("\n")}`;
}

/** Reply stays one plain sentence; raw tool errors and warnings go to a "details" list (still never swallowed). */
export function splitToolNotes(
  reply: string,
  errors: readonly string[],
  warnings: readonly string[],
  fallback: string,
): { text: string; details: string[] } {
  const details = [...new Set([...errors, ...warnings])];
  const text = reply.trim().length === 0 && errors.length > 0 ? fallback : reply;
  return { text, details };
}
