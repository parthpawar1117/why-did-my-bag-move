export type CitationPart = { text: string } | { cite: string };

/** "moved +1% [E2]." becomes [{ text: "moved +1% " }, { cite: "E2" }, { text: "." }] */
export function splitCitations(text: string): CitationPart[] {
  const parts: CitationPart[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[(E\d+)\]/g)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ cite: m[1]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
