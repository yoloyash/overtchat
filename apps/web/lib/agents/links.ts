export type AgentLinkSource = {
  href: string;
  text?: string;
  sourceType?: "markdown" | "autolink" | "inline-code";
};

export type AgentWorkspaceFileTarget = {
  kind: "workspace-file";
  raw: string;
  path: string;
  lineStart?: number;
  lineEnd?: number;
};

export type AgentLinkTarget =
  | { kind: "external"; url: string }
  | AgentWorkspaceFileTarget
  | { kind: "unknown"; href: string };

export const AGENT_LINK_ICON_KINDS = [
  "github",
  "web",
  "typescript",
  "javascript",
  "json",
  "markdown",
  "python",
  "c",
  "cplusplus",
  "csharp",
  "go",
  "rust",
  "code",
  "file",
  "link",
] as const;

export type AgentLinkIconKind = (typeof AGENT_LINK_ICON_KINDS)[number];

type MarkdownNode = {
  type?: string;
  url?: unknown;
  value?: unknown;
  children?: MarkdownNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, string | number>;
  };
};

const MAX_LINK_LABEL_LENGTH = 64;
const LINK_ICON_TAG = "agent-link-icon";
const WORKSPACE_LINK_TAG = "agent-workspace-link";
const LINE_FRAGMENT = /^L([0-9]+)(?:C[0-9]+)?(?:-L?([0-9]+)(?:C[0-9]+)?)?$/iu;
const COLON_LINE_SUFFIX = /^(.+?):([0-9]+)(?::[0-9]+)?(?:-([0-9]+)(?::[0-9]+)?)?$/u;
const PAREN_LINE_SUFFIX = /^(.+?)\(([0-9]+)(?:,[0-9]+)?(?:-([0-9]+)(?:,[0-9]+)?)?\)$/u;
const WORD_LINE_SUFFIX = /^(.+?)\s+lines?\s+([0-9]+)(?:-([0-9]+))?$/iu;
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/u;
const EXTERNAL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const DOMAIN_LIKE_SEGMENT = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u;

const CODING_FILE_EXTENSIONS = new Set([
  "astro",
  "bash",
  "c",
  "cc",
  "cjs",
  "cpp",
  "cs",
  "css",
  "cts",
  "cxx",
  "env",
  "fish",
  "go",
  "gql",
  "gradle",
  "graphql",
  "h",
  "hpp",
  "htm",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsonc",
  "jsx",
  "kt",
  "kts",
  "less",
  "lock",
  "lua",
  "md",
  "mdx",
  "mjs",
  "mts",
  "php",
  "proto",
  "py",
  "rb",
  "rs",
  "sass",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);

const CODE_FILE_NAMES = new Set([
  "dockerfile",
  "gemfile",
  "justfile",
  "makefile",
  "procfile",
]);

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseHttpUrl(href: string): URL | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  return url.protocol === "http:" || url.protocol === "https:" ? url : null;
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function validLines(
  lineStart: number | undefined,
  lineEnd: number | undefined,
): Pick<AgentWorkspaceFileTarget, "lineStart" | "lineEnd"> | null {
  if (lineEnd !== undefined && (lineStart === undefined || lineEnd < lineStart)) {
    return null;
  }
  return {
    ...(lineStart !== undefined ? { lineStart } : {}),
    ...(lineEnd !== undefined ? { lineEnd } : {}),
  };
}

function splitPathAndLines(
  rawValue: string,
): { path: string; lineStart?: number; lineEnd?: number } | null {
  const trimmed = rawValue.trim().replace(/^['"`]|['"`]$/gu, "");
  if (!trimmed || trimmed.includes("?")) return null;

  if (trimmed.toLowerCase().startsWith("file://")) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    let path = safeDecodeURIComponent(url.pathname).replace(/\\/gu, "/");
    if (/^\/[A-Za-z]:\//u.test(path)) path = path.slice(1);
    if (!path) return null;
    const fragment = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    if (!fragment) return { path };
    const match = fragment.match(LINE_FRAGMENT);
    if (!match) return null;
    const lines = validLines(positiveInteger(match[1]), positiveInteger(match[2]));
    return lines ? { path, ...lines } : null;
  }

  const hashIndex = trimmed.indexOf("#");
  const withoutHash = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const fragment = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) : "";
  let fragmentLines: Pick<AgentWorkspaceFileTarget, "lineStart" | "lineEnd"> = {};
  if (fragment) {
    const match = fragment.match(LINE_FRAGMENT);
    if (!match) return null;
    const lines = validLines(positiveInteger(match[1]), positiveInteger(match[2]));
    if (!lines) return null;
    fragmentLines = lines;
  }

  const inlineMatch =
    withoutHash.match(COLON_LINE_SUFFIX) ??
    withoutHash.match(PAREN_LINE_SUFFIX) ??
    withoutHash.match(WORD_LINE_SUFFIX);
  if (inlineMatch) {
    const lines = validLines(
      positiveInteger(inlineMatch[2]),
      positiveInteger(inlineMatch[3]),
    );
    if (!lines) return null;
    return {
      path: safeDecodeURIComponent(inlineMatch[1]).replace(/\\/gu, "/"),
      ...lines,
    };
  }

  return {
    path: safeDecodeURIComponent(withoutHash).replace(/\\/gu, "/"),
    ...fragmentLines,
  };
}

function fileExtension(path: string): string | null {
  const name = path.split("/").filter(Boolean).at(-1)?.toLowerCase();
  if (!name) return null;
  const lastDot = name.lastIndexOf(".");
  return lastDot >= 0 && lastDot < name.length - 1
    ? name.slice(lastDot + 1)
    : null;
}

function looksLikeWorkspacePath(path: string): boolean {
  if (
    path.startsWith("/") ||
    path.startsWith("./") ||
    path.startsWith("../") ||
    path.startsWith("~/") ||
    WINDOWS_ABSOLUTE_PATH.test(path)
  ) {
    return true;
  }

  const segments = path.split("/").filter(Boolean);
  const fileName = segments.at(-1)?.toLowerCase();
  if (!fileName) return false;
  if (CODE_FILE_NAMES.has(fileName) || (fileName.startsWith(".") && fileName.length > 1)) {
    return true;
  }

  const extension = fileExtension(path);
  if (segments.length === 1) {
    return extension !== null && CODING_FILE_EXTENSIONS.has(extension);
  }

  return !DOMAIN_LIKE_SEGMENT.test(segments[0]) && extension !== null;
}

function workspaceFileTarget(href: string): AgentWorkspaceFileTarget | null {
  const parsed = splitPathAndLines(href);
  if (!parsed || !looksLikeWorkspacePath(parsed.path)) return null;
  return {
    kind: "workspace-file",
    raw: href,
    path: parsed.path,
    ...(parsed.lineStart !== undefined ? { lineStart: parsed.lineStart } : {}),
    ...(parsed.lineEnd !== undefined ? { lineEnd: parsed.lineEnd } : {}),
  };
}

export function classifyAgentLink(source: AgentLinkSource): AgentLinkTarget {
  const href = source.href.trim();
  if (!href) return { kind: "unknown", href };

  const httpUrl = parseHttpUrl(href);
  if (httpUrl) return { kind: "external", url: href };

  const fileTarget = workspaceFileTarget(href);
  if (fileTarget) return fileTarget;

  if (EXTERNAL_SCHEME.test(href) && !WINDOWS_ABSOLUTE_PATH.test(href)) {
    return { kind: "external", url: href };
  }

  return { kind: "unknown", href };
}

export function agentLinkIconKind(target: AgentLinkTarget): AgentLinkIconKind {
  if (target.kind === "external") {
    const url = parseHttpUrl(target.url);
    const hostname = url?.hostname.toLowerCase();
    return hostname === "github.com" || hostname?.endsWith(".github.com")
      ? "github"
      : "web";
  }
  if (target.kind === "unknown") return "link";

  const extension = fileExtension(target.path);
  if (["ts", "tsx", "cts", "mts"].includes(extension ?? "")) {
    return "typescript";
  }
  if (["js", "jsx", "cjs", "mjs"].includes(extension ?? "")) {
    return "javascript";
  }
  if (extension === "json" || extension === "jsonc") return "json";
  if (extension === "md" || extension === "mdx") return "markdown";
  if (extension === "py") return "python";
  if (extension === "c") return "c";
  if (["cc", "cpp", "cxx"].includes(extension ?? "")) return "cplusplus";
  if (extension === "cs") return "csharp";
  if (extension === "go") return "go";
  if (extension === "rs") return "rust";
  if (extension && CODING_FILE_EXTENSIONS.has(extension)) return "code";
  return "file";
}

export function compactExternalLinkLabel(href: string): string | null {
  const url = parseHttpUrl(href);
  if (!url) return null;

  const hostname = url.hostname.replace(/^www\./u, "");
  const segments = url.pathname.split("/").filter(Boolean);
  if (
    hostname === "github.com" &&
    segments.length >= 4 &&
    /^\d+$/u.test(segments[3])
  ) {
    const [owner, repository, kind, number] = segments;
    if (kind === "pull") return `${owner}/${repository} PR #${number}`;
    if (kind === "issues") return `${owner}/${repository} #${number}`;
  }

  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/u, "");
  const display = `${hostname}${path}${url.search}${url.hash}`;
  return display.length <= MAX_LINK_LABEL_LENGTH
    ? display
    : `${display.slice(0, MAX_LINK_LABEL_LENGTH - 1)}…`;
}

function markdownText(node: MarkdownNode): string {
  if (node.type === "text" && typeof node.value === "string") return node.value;
  return node.children?.map(markdownText).join("") ?? "";
}

function rawTextMatchesHref(text: string, href: string): boolean {
  const normalizedText = text.trim().replace(/\/$/u, "");
  const normalizedHref = href.trim().replace(/\/$/u, "");
  return (
    normalizedText === normalizedHref ||
    normalizedHref === `https://${normalizedText}` ||
    normalizedHref === `http://${normalizedText}`
  );
}

function containsImage(node: MarkdownNode): boolean {
  return node.type === "image" || node.children?.some(containsImage) === true;
}

function decorateAgentLinks(node: MarkdownNode): void {
  if (node.type === "link" && typeof node.url === "string" && !containsImage(node)) {
    const text = markdownText(node);
    const source: AgentLinkSource = {
      href: node.url,
      text,
      sourceType: rawTextMatchesHref(text, node.url) ? "autolink" : "markdown",
    };
    const target = classifyAgentLink(source);

    if (source.sourceType === "autolink" && target.kind === "external") {
      const label = compactExternalLinkLabel(target.url);
      if (
        label &&
        node.children?.length === 1 &&
        node.children[0]?.type === "text"
      ) {
        node.children[0].value = label;
      }
    }

    const iconKind = agentLinkIconKind(target);
    node.children = [
      {
        type: "agent-link-icon",
        data: {
          hName: LINK_ICON_TAG,
          hProperties: { kind: iconKind },
        },
      },
      ...(node.children ?? []),
    ];

    if (target.kind === "workspace-file") {
      node.data = {
        hName: WORKSPACE_LINK_TAG,
        hProperties: {
          path: target.path,
          ...(target.lineStart !== undefined
            ? { linestart: target.lineStart }
            : {}),
          ...(target.lineEnd !== undefined ? { lineend: target.lineEnd } : {}),
        },
      };
    }
  }

  node.children?.forEach(decorateAgentLinks);
}

/** Adds compact labels and semantic icon markers to coding-agent links. */
export function remarkAgentLinks() {
  return decorateAgentLinks;
}
