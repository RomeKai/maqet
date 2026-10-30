/** Failed tool calls and rule warnings are shown to the user, never swallowed (bug C). */
export function withToolNotes(reply: string, errors: readonly string[], warnings: readonly string[]): string {
  const notes = [...new Set([...errors, ...warnings])];
  return notes.length === 0 ? reply : `${reply}\n\n${notes.map((n) => `• ${n}`).join("\n")}`;
}
