const MCP_TOOL_PREFIX = "mcp__";
const MCP_TOOL_DELIMITER = "__";
const MAX_MCP_TOOL_NAME_LENGTH = 64;

function hashSegment(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0").slice(0, 7);
}

function safeSegment(value: string, fallback: string): string {
  const segment = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return segment || fallback;
}

function withHash(value: string, identity: string): string {
  return `${value}_${hashSegment(identity)}`;
}

function fitName(namespace: string, tool: string, identity: string): string {
  const candidate = `${namespace}${MCP_TOOL_DELIMITER}${tool}`;
  if (candidate.length <= MAX_MCP_TOOL_NAME_LENGTH) return candidate;

  const suffix = `_${hashSegment(identity)}`;
  const namespaceBudget = Math.min(
    namespace.length,
    Math.floor((MAX_MCP_TOOL_NAME_LENGTH - MCP_TOOL_DELIMITER.length) / 2),
  );
  const fittedNamespace = namespace
    .slice(0, namespaceBudget)
    .replace(/[_-]+$/g, "");
  const toolBudget =
    MAX_MCP_TOOL_NAME_LENGTH -
    fittedNamespace.length -
    MCP_TOOL_DELIMITER.length -
    suffix.length;
  const fittedTool = tool
    .slice(0, Math.max(0, toolBudget))
    .replace(/[_-]+$/g, "");
  return `${fittedNamespace}${MCP_TOOL_DELIMITER}${fittedTool}${suffix}`;
}

export type McpToolIdentity = {
  server: { id: string; name: string };
  toolName: string;
};

/** Produces Codex-style `mcp__server__tool` names, hashing only collisions. */
export function mcpToolNames(tools: McpToolIdentity[]): string[] {
  const candidates = tools.map(({ server, toolName }) => ({
    server,
    toolName,
    namespace: `${MCP_TOOL_PREFIX}${safeSegment(server.name, "server")}`,
    callable: safeSegment(toolName, "tool"),
    serverIdentity: `${server.id}\0${server.name}`,
    toolIdentity: `${server.id}\0${server.name}\0${toolName}`,
  }));

  const namespaceIdentities = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const identities =
      namespaceIdentities.get(candidate.namespace) ?? new Set<string>();
    identities.add(candidate.serverIdentity);
    namespaceIdentities.set(candidate.namespace, identities);
  }
  for (const candidate of candidates) {
    if ((namespaceIdentities.get(candidate.namespace)?.size ?? 0) > 1) {
      candidate.namespace = withHash(
        candidate.namespace,
        candidate.serverIdentity,
      );
    }
  }

  const callableIdentities = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const key = `${candidate.namespace}\0${candidate.callable}`;
    const identities = callableIdentities.get(key) ?? new Set<string>();
    identities.add(candidate.toolIdentity);
    callableIdentities.set(key, identities);
  }

  return candidates.map((candidate) => {
    const key = `${candidate.namespace}\0${candidate.callable}`;
    const callable =
      (callableIdentities.get(key)?.size ?? 0) > 1
        ? withHash(candidate.callable, candidate.toolIdentity)
        : candidate.callable;
    return fitName(candidate.namespace, callable, candidate.toolIdentity);
  });
}

export function mcpToolName(
  server: { id: string; name: string },
  toolName: string,
): string {
  return mcpToolNames([{ server, toolName }])[0] as string;
}

export function parseMcpToolName(name: string): {
  serverName: string;
  toolName: string;
} | null {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return null;
  const segments = name.slice(MCP_TOOL_PREFIX.length).split(MCP_TOOL_DELIMITER);
  if (segments.length !== 2) return null;
  const [serverName, toolName] = segments;
  if (!serverName || !toolName) return null;
  return {
    serverName: serverName
      .replaceAll("_", " ")
      .replace(/\b\w/g, (character) => character.toUpperCase()),
    toolName: toolName.replaceAll("_", " "),
  };
}

export function isMcpToolName(name: string): boolean {
  return parseMcpToolName(name) !== null;
}
