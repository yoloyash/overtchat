import { memo, useMemo } from "react";
import { MarkdownBody } from "./MarkdownBody";

/** Code outside a reply (a document's source, a run's input), drawn as a fenced block. */
export const CodeBlock = memo(function CodeBlock({
  code,
  language,
  streaming = false,
}: {
  code: string;
  language: string;
  /** The code is still being written. */
  streaming?: boolean;
}) {
  const markdown = useMemo(() => {
    // The fence must be longer than any run of backticks inside the code.
    let longest = 2;
    for (const run of code.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
    const fence = "`".repeat(longest + 1);
    const info = language.trim().split(/\s+/, 1)[0] ?? "";
    // An open fence tells the renderer the block is unfinished, so it
    // highlights the code once at the end instead of on every chunk.
    return `${fence}${info}\n${code}${streaming ? "" : `\n${fence}`}`;
  }, [code, language, streaming]);
  return <MarkdownBody text={markdown} streaming={streaming} />;
});
