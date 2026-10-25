import type { ToolState } from "./tools";

export const RUN_PYTHON_TOOL_NAME = "run_python" as const;

/** Where run code finds the conversation's files and writes its own. */
export const SANDBOX_UPLOADS_DIR = "/mnt/data/uploads" as const;
export const SANDBOX_OUTPUTS_DIR = "/mnt/data/outputs" as const;

export type CodeExecutionUnavailableReason =
  | "not-installed"
  | "unreachable";

export interface CodeExecutionCapability {
  installed: boolean;
  available: boolean;
  /** "slim" or "full" sandbox image. */
  tier?: string;
  unavailableReason: CodeExecutionUnavailableReason | null;
}

/** A file a run wrote, saved as an upload owned by the user. */
export interface CodeExecutionFile {
  id: string;
  url: string;
  name: string;
  mediaType: string;
  size: number;
}

export interface CodeExecutionOutput {
  /** Null when the run was stopped by a signal. */
  exitCode: number | null;
  signal?: string;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  files: CodeExecutionFile[];
  /** Files the run wrote that were not returned, with the reason. */
  skippedFiles?: Array<{ path: string; reason: string }>;
  /** Conversation files left out of the run because of size limits. */
  omittedInputs?: string[];
}

export type CodeExecutionPart = {
  type: "tool-run_python";
  toolCallId: string;
  state: ToolState;
  input?: { code?: string; timeout_seconds?: number };
  output?: CodeExecutionOutput;
  errorText?: string;
};

export function isCodeExecutionPart(part: {
  type: string;
}): part is CodeExecutionPart {
  return part.type === "tool-run_python";
}

/** A run's status in its activity step, such as "Done · 1.2s" or "Exit code 1". */
export function codeRunStatus(part: CodeExecutionPart): string {
  if (part.state === "output-error") return "Failed";
  const output = part.output;
  if (!output) return "Running…";
  if (output.timedOut) return "Timed out";
  if (output.exitCode === 0) return `Done · ${(output.durationMs / 1000).toFixed(1)}s`;
  return output.signal ? `Stopped (${output.signal})` : `Exit code ${output.exitCode}`;
}

const SHARED_FILE_URL = /^\/api\/share\/[0-9a-f-]{36}\/files\/([a-zA-Z0-9_-]+)$/;

/** A saved run output: its URL is the owner's upload route, or the same file
 * in a public share snapshot. */
export function isCodeExecutionFile(value: unknown): value is CodeExecutionFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<CodeExecutionFile>;
  return (
    typeof file.id === "string" &&
    /^[a-zA-Z0-9_-]+$/.test(file.id) &&
    (file.url === `/api/uploads/${file.id}` ||
      SHARED_FILE_URL.exec(file.url ?? "")?.[1] === file.id) &&
    typeof file.name === "string" &&
    file.name.length > 0 &&
    typeof file.mediaType === "string" &&
    typeof file.size === "number"
  );
}

/** Saved output files of a run, ignoring malformed entries. */
export function codeExecutionFiles(part: CodeExecutionPart): CodeExecutionFile[] {
  return part.state === "output-available" && Array.isArray(part.output?.files)
    ? part.output.files.filter(isCodeExecutionFile)
    : [];
}

/**
 * Files the conversation's runs returned, keyed by lower-cased name. Saved
 * names are unique within a conversation, so a reply can link a file by name.
 */
export function codeExecutionFileIndex(
  messages: readonly { parts: readonly { type: string }[] }[],
): Map<string, CodeExecutionFile> {
  const index = new Map<string, CodeExecutionFile>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isCodeExecutionPart(part)) continue;
      for (const file of codeExecutionFiles(part)) index.set(file.name.toLowerCase(), file);
    }
  }
  return index;
}

/**
 * The file name a reply's link target names, for targets such as
 * `chart.png`, `outputs/chart.png`, `/mnt/data/outputs/chart.png` or
 * `sandbox:/mnt/data/outputs/chart.png`. Web URLs, other absolute paths and
 * in-page anchors are not file links.
 */
export function codeFileLinkName(target: string): string | null {
  let path = target.trim();
  if (/^sandbox:/i.test(path)) path = path.slice("sandbox:".length);
  else if (/^[a-z][a-z\d+.-]*:/i.test(path)) return null;
  if (!path || /^[#?]/.test(path) || path.startsWith("//")) return null;
  if (path.startsWith("/") && !path.startsWith("/mnt/")) return null;
  try {
    path = decodeURIComponent(path);
  } catch {
    // A stray % keeps the name as written.
  }
  return path.slice(path.lastIndexOf("/") + 1) || null;
}

const PREVIEWABLE_IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function isPreviewableImage(file: Pick<CodeExecutionFile, "mediaType">): boolean {
  return PREVIEWABLE_IMAGES.has(file.mediaType);
}
