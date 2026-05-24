export type HighlightSegment = { text: string; mark: boolean };

const TAG_PATTERN = /<mark>([\s\S]*?)<\/mark>/g;

export function parseSnippet(snippet: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let lastIndex = 0;
  for (const match of snippet.matchAll(TAG_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({ text: snippet.slice(lastIndex, start), mark: false });
    }
    segments.push({ text: match[1], mark: true });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < snippet.length) {
    segments.push({ text: snippet.slice(lastIndex), mark: false });
  }
  return segments;
}
