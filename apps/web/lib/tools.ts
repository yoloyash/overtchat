import { tool } from "ai";
import { z } from "zod";
import { searxngSearch, fetchReadable } from "./web";

export const webTools = {
  web_search: tool({
    description:
      "Search the web. Returns {link, title, snippet}. Cite sources.",
    inputSchema: z.object({
      query: z.string(),
      limit: z.number().int().min(1).max(10).default(5),
    }),
    execute: async ({ query, limit }) => searxngSearch(query, limit),
  }),

  fetch_url: tool({
    description:
      "Fetch a URL as markdown (~8k chars). Use after web_search to read promising pages.",
    inputSchema: z.object({
      url: z.string().url(),
    }),
    execute: async ({ url }) => fetchReadable(url),
  }),
};

/**
 * Citation format instructions for `web_search`.
 *
 * Ported verbatim from LibreChat's buildWebSearchContext() in
 * packages/api/src/tools/toolkits/web.ts. LibreChat injects this as part of
 * the system prompt (via toolContextMap → systemContent), NOT as the tool
 * description — placement matters: tool descriptions only inform tool calls,
 * not output formatting, so the model ignores them when writing prose.
 */
export const WEB_SEARCH_CITATION_PROMPT = `# \`web_search\`:
**Execute immediately without preface.** After search, provide a brief summary addressing the query directly, then structure your response with clear Markdown formatting (## headers, lists, tables). Cite sources properly, tailor tone to query type, and provide comprehensive details.

Use the conversation date/time from the dynamic runtime context when recency matters.

**CITATION FORMAT - UNICODE ESCAPE SEQUENCES ONLY:**
Use these EXACT escape sequences (copy verbatim): \\ue202 (before each anchor), \\ue200 (group start), \\ue201 (group end), \\ue203 (highlight start), \\ue204 (highlight end)

Anchor pattern: \\ue202turn{N}{type}{index} where N=turn number, type=search|news|image|ref, index=0,1,2...

**Examples (copy these exactly):**
- Single: "Statement.\\ue202turn0search0"
- Multiple: "Statement.\\ue202turn0search0\\ue202turn0news1"
- Group: "Statement. \\ue200\\ue202turn0search0\\ue202turn0news1\\ue201"
- Highlight: "\\ue203Cited text.\\ue204\\ue202turn0search0"
- Image: "See photo\\ue202turn0image0."

**CRITICAL:** Output escape sequences EXACTLY as shown. Do NOT substitute with † or other symbols. Place anchors AFTER punctuation. Cite every non-obvious fact/quote. NEVER use markdown links, [1], footnotes, or HTML tags.`;
