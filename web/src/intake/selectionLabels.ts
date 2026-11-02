/** Fill the `{n}` / `{length}` / `{width}` placeholders of the "selected" dictionary strings. */
export function wallSelectedLabel(template: string, wallNumber: number, length: string): string {
  return template.replace("{n}", String(wallNumber)).replace("{length}", length);
}

export function openingSelectedLabel(template: string, width: string): string {
  return template.replace("{width}", width);
}
