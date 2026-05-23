import "server-only";
import type { UIMessagePart, UIDataTypes, UITools } from "ai";
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
      const results = withOutput.output;
      if (Array.isArray(results)) {
        for (const r of results as { title?: string; snippet?: string }[]) {
          if (r.title) out.push(r.title);
          if (r.snippet) out.push(r.snippet);
        }
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
