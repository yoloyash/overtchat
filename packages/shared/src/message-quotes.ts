/**
 * Quoted replies. A quote travels inside the message text as a Markdown
 * blockquote ahead of what the user typed, so the model, export and search
 * read it without a separate message part.
 */

/** Selected transcript text as it is staged: trimmed, without runs of blank lines. */
export function normalizeQuoteText(selected: string): string {
  return selected
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The message text for `text` sent in reply to `quotes`. */
export function formatQuotedMessage(
  quotes: readonly string[],
  text: string,
): string {
  const blocks = quotes.map((quote) =>
    quote
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n"),
  );
  return [...blocks, text].filter(Boolean).join("\n\n");
}

function isQuoteLine(line: string): boolean {
  return line === ">" || line.startsWith("> ");
}

/**
 * Splits the blockquotes that lead a message from the text after them. A
 * blockquote counts only when a blank line or the end of the message follows
 * it, so "> 5 means more" on the first line of a paragraph stays prose.
 */
export function splitQuotedMessage(text: string): {
  quotes: string[];
  body: string;
} {
  const lines = text.split("\n");
  const quotes: string[] = [];
  let index = 0;
  while (index < lines.length && isQuoteLine(lines[index])) {
    let end = index;
    while (end < lines.length && isQuoteLine(lines[end])) end += 1;
    if (end < lines.length && lines[end].trim() !== "") break;
    quotes.push(
      lines
        .slice(index, end)
        .map((line) => line.slice(2))
        .join("\n"),
    );
    index = end;
    while (index < lines.length && lines[index].trim() === "") index += 1;
  }
  return { quotes, body: lines.slice(index).join("\n") };
}
