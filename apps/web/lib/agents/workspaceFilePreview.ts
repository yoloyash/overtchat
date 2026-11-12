import { agentWorkspaceImageMediaType } from "@overtchat/agent-bridge";

/** How a workspace text file can be shown besides its source. */
export type WorkspaceFileRendering =
  | { kind: "markdown" }
  | { kind: "table"; delimiter: "," | "\t" }
  | { kind: "html" }
  | { kind: "svg" };

type MarkdownNode = {
  type?: string;
  url?: unknown;
  alt?: unknown;
  children?: MarkdownNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, string | number>;
  };
};

const RENDERINGS: Record<string, WorkspaceFileRendering> = {
  md: { kind: "markdown" },
  markdown: { kind: "markdown" },
  csv: { kind: "table", delimiter: "," },
  tsv: { kind: "table", delimiter: "\t" },
  html: { kind: "html" },
  htm: { kind: "html" },
  svg: { kind: "svg" },
};

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

/** The rendered view a workspace file offers, or null when it only has source. */
export function workspaceFileRendering(
  filePath: string,
): WorkspaceFileRendering | null {
  const name = filePath.split("/").at(-1)?.toLowerCase() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return RENDERINGS[name.slice(dot + 1)] ?? null;
}

/**
 * The workspace path a link inside a workspace file points at, or null when
 * the link leaves the workspace or is not a file path. Relative links resolve
 * against the file's directory; a leading slash means the workspace root.
 */
export function resolveWorkspaceFileLink(
  filePath: string,
  href: string,
): string | null {
  const target = href.trim().split(/[?#]/u)[0] ?? "";
  if (!target || SCHEME.test(target) || target.startsWith("//")) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    decoded = target;
  }
  const segments = decoded.startsWith("/")
    ? []
    : filePath.split("/").filter(Boolean).slice(0, -1);
  for (const segment of decoded.replace(/\\/gu, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.length > 0 ? segments.join("/") : null;
}

/** Whether a workspace path is a picture a document can embed. */
export function isWorkspaceImagePath(filePath: string): boolean {
  return (
    agentWorkspaceImageMediaType(filePath) !== null ||
    workspaceFileRendering(filePath)?.kind === "svg"
  );
}

/**
 * Turns a document's references to other workspace files into workspace
 * elements: links open in the files pane instead of navigating the browser,
 * and pictures load from the workspace instead of the app's own address.
 */
export function remarkWorkspaceFileLinks(filePath: string) {
  function decorate(node: MarkdownNode): void {
    if (node.type === "link" && typeof node.url === "string") {
      const path = resolveWorkspaceFileLink(filePath, node.url);
      if (path) {
        node.data = {
          hName: "agent-workspace-link",
          hProperties: { path },
        };
      }
    } else if (node.type === "image" && typeof node.url === "string") {
      const path = resolveWorkspaceFileLink(filePath, node.url);
      if (path && isWorkspaceImagePath(path)) {
        node.data = {
          hName: "agent-workspace-image",
          hProperties: {
            path,
            alt: typeof node.alt === "string" ? node.alt : "",
          },
        };
      }
    }
    node.children?.forEach(decorate);
  }
  return () => decorate;
}
