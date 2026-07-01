import { createHash, randomUUID } from "node:crypto";

const MAX_TOOL_NAME_LENGTH = 64;

export function namespacedMcpToolName(
  serverSlug: string,
  toolName: string,
  used: Set<string> = new Set(),
): string {
  const server = safeNamePart(serverSlug, "server");
  const tool = safeNamePart(toolName, "tool");
  const hash = shortHash(`${serverSlug}:${toolName}`);
  const suffix = `_${hash}`;
  const prefix = `mcp_${server}_`;
  const maxToolPart = MAX_TOOL_NAME_LENGTH - prefix.length - suffix.length;
  const trimmedTool =
    maxToolPart > 0 ? tool.slice(0, maxToolPart).replace(/_+$/g, "") : "tool";
  const base = `${prefix}${trimmedTool || "tool"}${suffix}`.slice(
    0,
    MAX_TOOL_NAME_LENGTH,
  );

  if (!used.has(base)) {
    used.add(base);
    return base;
  }

  for (let i = 2; i < 1_000; i++) {
    const indexSuffix = `_${i}`;
    const candidate = `${base.slice(
      0,
      MAX_TOOL_NAME_LENGTH - indexSuffix.length,
    )}${indexSuffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }

  const fallback = `${base.slice(0, MAX_TOOL_NAME_LENGTH - 9)}_${shortHash(
    randomUUID(),
  )}`;
  used.add(fallback);
  return fallback;
}

function safeNamePart(value: string, fallback: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return safe || fallback;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}
