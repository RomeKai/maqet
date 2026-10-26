import { en } from "./en";
import { esAR } from "./es-AR";

export type StringKey = keyof typeof esAR;
export type Strings = Record<StringKey, string>;

export const dictionaries = { "es-AR": esAR, en } as const;
export type Locale = keyof typeof dictionaries;

export const DEFAULT_LOCALE: Locale = "en";

export function getStrings(locale: Locale): Strings {
  return dictionaries[locale];
}
