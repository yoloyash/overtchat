/**
 * `#` mentions attach one of the project's files to the message being
 * written. Like inline slash commands, the token is the word ending at the
 * caret; a `#` inside a word (C#, issue#5) is not a trigger.
 */
export interface FileMentionQuery {
  /** Text after the `#`, verbatim. */
  query: string;
  /** Draft offsets of the token, from the `#` to the caret. */
  start: number;
  end: number;
}

export function parseFileMention(
  value: string,
  caret: number,
): FileMentionQuery | null {
  const before = value.slice(0, caret);
  // The token must contain no whitespace, so a heading "# Title" closes the
  // menu as soon as the space is typed.
  const token = /(^|\s)(#(\S*))$/.exec(before);
  if (!token) return null;
  const start = caret - token[2].length;
  return { query: token[3], start, end: caret };
}

function fold(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

/**
 * Files whose name contains the query, ignoring case and spaces so
 * `#launchpl` finds "Launch plan.md". An empty query lists every file.
 */
export function filterFileMentions<T extends { filename: string }>(
  files: readonly T[],
  query: string,
): T[] {
  const needle = fold(query);
  if (!needle) return [...files];
  return files.filter((file) => fold(file.filename).includes(needle));
}
