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
    } else if (p.type === "dynamic-tool" || p.type.startsWith("tool-")) {
      const tool = p as {
        toolName?: string;
        title?: string;
        toolMetadata?: Record<string, unknown>;
        input?: unknown;
        output?: unknown;
      };
      const metadata = tool.toolMetadata ?? {};
      for (const value of [
        tool.title,
        tool.toolName,
        metadata.serverName,
        metadata.displayName,
        metadata.toolName,
      ]) {
        if (typeof value === "string") out.push(value);
      }
      if (tool.input !== undefined) out.push(stringifyForSearch(tool.input));
      if (tool.output !== undefined) out.push(stringifyForSearch(tool.output));
    }
  }
  return out.join("\n").trim();
}

function stringifyForSearch(value: unknown): string {
  try {
    const text =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return text.slice(0, 2_000);
  } catch {
    return String(value).slice(0, 2_000);
  }
}
