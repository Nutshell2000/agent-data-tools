/** Choose a delimiter shorter than any matching run inside the source code. */
export function fencedCode(value: string, language: string | null = null) {
  const longest = (char: string) => {
    let max = 0;
    for (const match of value.matchAll(new RegExp(char + "+", "g")))
      max = Math.max(max, match[0].length);
    return Math.max(3, max + 1);
  };
  const ticks = longest("`"),
    tildes = longest("~");
  const fence = (ticks <= tildes ? "`" : "~").repeat(Math.min(ticks, tildes));
  // Avoid pathological delimiters dwarfing a bounded response.
  if (fence.length > 100)
    return value
      .split("\n")
      .map((line) => "    " + line)
      .join("\n");
  return `${fence}${language ?? ""}\n${value}\n${fence}`;
}

/** Clip generated Markdown without leaving a partially returned fenced block open. */
export function clipMarkdown(markdown: string, limit: number) {
  if (markdown.length <= limit) return markdown;
  let open:
    | { start: number; end: number; marker: string; indent: string }
    | undefined;
  let offset = 0;
  for (const line of markdown.split("\n")) {
    const end = offset + line.length + 1;
    const match = /^([ \t]*(?:(?:[-+*]|\d+\.) +)?)(`{3,}|~{3,})(.*)$/.exec(
      line,
    );
    if (match) {
      if (!open)
        open = {
          start: offset,
          end,
          marker: match[2],
          indent: " ".repeat(match[1].length),
        };
      else if (
        match[2][0] === open.marker[0] &&
        match[2].length >= open.marker.length &&
        !match[3].trim()
      ) {
        if (open.start < limit && end > limit) return close(open, offset);
        open = undefined;
      }
    }
    if (offset >= limit && !open) break;
    offset = end;
  }
  if (open && open.start < limit) return close(open, markdown.length);
  return markdown.slice(0, limit);

  function close(
    block: { start: number; end: number; marker: string; indent: string },
    closingStart: number,
  ) {
    const suffix = `\n${block.indent}${block.marker}`;
    const cut = Math.min(limit - suffix.length, closingStart);
    if (cut < block.end) return markdown.slice(0, block.start).trimEnd();
    return markdown.slice(0, cut) + suffix;
  }
}
