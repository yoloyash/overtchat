import "server-only";
import type { UIMessagePart, UIDataTypes, UITools } from "ai";
import {
  webSearchResults,
  type PersistedWebSearchOutput,
} from "@overtchat/shared";
import { stripCitationMarkers } from "@/lib/citations";

type AnyPart = UIMessagePart<UIDataTypes, UITools>;

export function extractSearchText(parts: AnyPart[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (p.type === "text" && typeof p.text === "string") {
      out.push(stripCitationMarkers(p.text));
    } else if (p.type === "reasoning" && typeof p.text === "string") {
      out.push(p.text);
    } else if (p.type === "tool-web_search") {
      const withOutput = p as { output?: unknown; input?: unknown };
      const query = (withOutput.input as { query?: string } | undefined)?.query;
      if (query) out.push(query);
      const output = withOutput.output as PersistedWebSearchOutput | undefined;
      if (output && !Array.isArray(output) && output.answer) {
        out.push(output.answer);
      }
      for (const result of webSearchResults(output)) {
        if (result.title) out.push(result.title);
        if (result.snippet) out.push(result.snippet);
      }
    } else if (p.type === "tool-fetch_url") {
      const withOutput = p as { output?: unknown };
      const page = withOutput.output as
        | { title?: string; content?: string }
        | undefined;
      if (page?.title) out.push(page.title);
      if (page?.content) out.push(page.content);
    }
  }
  return out.join("\n").trim();
}
