/** PS5 and PS4 title IDs in a piece of text ("PPSA12345", "cusa-12345"), normalised and each once. */
export function titleIds(text: string): string[] {
  return [...new Set([...text.toUpperCase().matchAll(/\b(PPSA|CUSA)[-_ ]?(\d{5})\b/g)].map((m) => `${m[1]}${m[2]}`))];
}
