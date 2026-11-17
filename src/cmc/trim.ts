/** Shortens long arrays and strings so a raw API response stays readable on screen. */
export function trimForDisplay(value: unknown, opts: { maxItems: number; maxString: number }, depth = 0): unknown {
  if (typeof value === "string") {
    return value.length > opts.maxString ? `${value.slice(0, opts.maxString)}... (${value.length - opts.maxString} more chars)` : value;
  }
  if (Array.isArray(value)) {
    const kept = value.slice(0, opts.maxItems).map((v) => trimForDisplay(v, opts, depth + 1));
    return value.length > opts.maxItems ? [...kept, `... ${value.length - opts.maxItems} more items`] : kept;
  }
  if (value && typeof value === "object" && depth < 12) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trimForDisplay(v, opts, depth + 1)]));
  }
  return value;
}
