import "server-only";
import fsp from "node:fs/promises";
import { tool } from "ai";
import { z } from "zod";
import {
  isCodeExecutionFile,
  isPreviewableImage,
  RUN_PYTHON_TOOL_NAME,
  SANDBOX_OUTPUTS_DIR,
  SANDBOX_UPLOADS_DIR,
  type CodeExecutionFile,
  type CodeExecutionOutput,
} from "@overtchat/shared";
import { formatSize } from "@/lib/chat/attachments";
import { numberedName, safeFilename, type ChatFile } from "@/lib/chat/chat-files";
import { createUpload, getUpload, readFetchedImage, uploadPath } from "@/lib/db/uploads";
import { extractFile, MAX_BYTES_DOC, MAX_BYTES_TEXT } from "@/lib/extract";
import { assertFetchedImageContent } from "@/lib/image-content";
import { runInSandbox, type SandboxFile, type SandboxInfo } from "./client";

/** Exhaustive code-execution tool names in deterministic provider order. */
export const CODE_EXECUTION_TOOL_ORDER = Object.freeze([RUN_PYTHON_TOOL_NAME] as const);

const MAX_INPUT_FILES = 50;
const MAX_MODEL_IMAGES = 4;
const MAX_CODE_CHARS = 200_000;
/** Room for a numbered suffix, so a saved name stays within the name limits. */
const NAME_SUFFIX_RESERVE = 20;
/**
 * The sandbox answers when a run ends, and Node's fetch gives up after 300
 * seconds without response headers.
 */
const MAX_RUN_SECONDS = 240;
/** Output is mostly numbers and code, which take more tokens per character. */
const CHARS_PER_TOKEN = 3;

const MEDIA_TYPES: Record<string, string> = {
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  html: "text/html",
  htm: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  md: "text/markdown",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  pdf: "application/pdf",
  png: "image/png",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  py: "text/x-python",
  svg: "image/svg+xml",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  wav: "audio/wav",
  webp: "image/webp",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  zip: "application/zip",
};

/** Media types come from the name the server sees, not from run code. */
export function mediaTypeFor(name: string): string {
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return MEDIA_TYPES[extension] ?? "application/octet-stream";
}

export function codeExecutionPrompt(info: SandboxInfo): string {
  const skills = info.skills
    .map((skill) => `${skill.name} (${skill.path}): ${skill.description}`)
    .join("\n");
  return `Code execution:
Use run_python to compute exact numbers, analyze data files, edit images, and create or convert files such as charts, spreadsheets, Word documents, PDFs and presentations. Report results from the code's output instead of estimating. The user sees a file in your reply only when you link it by name, such as ![Chart](chart.png) to show an image or [Report](report.docx) to offer a download; write spaces as %20. Link only finished files a run returned, not intermediate ones.${
    skills
      ? `\nBefore working with one of these file types, read its guide with run_python, for example print(open(path).read()):\n${skills}`
      : ""
  }`;
}

function toolDescription(info: SandboxInfo | undefined): string {
  const packages = info ? Object.keys(info.packages).join(", ") : "";
  const tools = info?.tools.length ? ` Command-line tools: ${info.tools.join(", ")}.` : "";
  return `Run Python 3 in an isolated sandbox without network access. Files from this conversation are read-only in ${SANDBOX_UPLOADS_DIR}/<name>. Save files to ${SANDBOX_OUTPUTS_DIR}/ to keep them; plt.show() saves charts there. Each call starts fresh, so re-read files instead of relying on earlier variables; files saved by earlier calls are in ${SANDBOX_UPLOADS_DIR}. Print what you need to see.${
    packages ? ` Installed packages: ${packages}.` : ""
  }${tools}`;
}

/**
 * run_python sends the conversation's files to the sandbox and saves the files
 * a run returns as the user's uploads, named uniquely within the conversation
 * except that a run's file replaces an earlier run's file of the same name.
 * The model reads at most `outputTokens` of a run's printed output.
 */
export function createCodeExecutionTools({
  userId,
  files,
  supportsImageInput,
  outputTokens,
  info,
}: {
  userId: string;
  files: readonly ChatFile[];
  supportsImageInput: boolean;
  outputTokens: number;
  info?: SandboxInfo;
}) {
  const outputChars = outputTokens * CHARS_PER_TOKEN;
  // Names taken in this conversation, including files saved earlier in this
  // request, so every saved file keeps the name later runs see. Each maps to
  // whether a run saved it: saving that name again replaces the file, as
  // saving over a file does. Attachments and generated images keep theirs.
  const takenNames = new Map(files.map((file) => [file.name.toLowerCase(), file.fromRun === true]));
  const savedFiles: ChatFile[] = [];

  /** `runNames` holds the names this run saved, which it cannot replace. */
  function reserveName(name: string, runNames: Set<string>): string {
    const base = safeFilename(name, mediaTypeFor(name), NAME_SUFFIX_RESERVE);
    let chosen = base;
    if (!takenNames.get(base.toLowerCase()) || runNames.has(base.toLowerCase())) {
      for (let n = 2; takenNames.has(chosen.toLowerCase()); n++) chosen = numberedName(base, n);
    }
    takenNames.set(chosen.toLowerCase(), true);
    runNames.add(chosen.toLowerCase());
    return chosen;
  }

  async function inputs(): Promise<{ files: SandboxFile[]; omitted: string[] }> {
    let remaining = info?.limits.max_input_bytes ?? 100 * 1024 * 1024;
    const selected: SandboxFile[] = [];
    const omitted: string[] = [];
    const names = new Set<string>();
    // Newest first, so a large old file never crowds out what was just made,
    // and a file this request replaced gives way to its replacement.
    for (const file of [...files, ...savedFiles].reverse()) {
      if (names.has(file.name.toLowerCase())) continue;
      names.add(file.name.toLowerCase());
      const row = await getUpload(file.uploadId, userId);
      if (!row) continue;
      if (selected.length >= MAX_INPUT_FILES || row.size > remaining) {
        omitted.push(file.name);
        continue;
      }
      const bytes = await fsp.readFile(uploadPath(file.uploadId)).catch(() => null);
      if (!bytes) continue;
      remaining -= bytes.byteLength;
      selected.push({ name: file.name, data: bytes.toString("base64") });
    }
    return { files: selected, omitted: omitted.reverse() };
  }

  async function save(
    output: { name: string; data: string },
    runNames: Set<string>,
  ): Promise<CodeExecutionFile> {
    const name = reserveName(output.name, runNames);
    const mediaType = mediaTypeFor(name);
    const bytes = Buffer.from(output.data, "base64");
    let category: "image" | "document" | "text" | "spreadsheet" = "document";
    let extractedText: string | null = null;
    let pageCount: number | null = null;
    let truncated = false;
    let storedType = mediaType;
    if (isPreviewableImage({ mediaType })) {
      try {
        assertFetchedImageContent(bytes, mediaType);
        category = "image";
      } catch {
        // Bytes that are not the named image type download as a plain file.
        storedType = "application/octet-stream";
      }
    } else if (
      bytes.byteLength <=
      (/^(text\/|application\/(json|xml|yaml))/.test(mediaType) ? MAX_BYTES_TEXT : MAX_BYTES_DOC)
    ) {
      try {
        const extracted = await extractFile({ buffer: bytes, filename: name, mediaType });
        category = extracted.category;
        extractedText = extracted.text;
        pageCount = extracted.pageCount;
        truncated = extracted.truncated;
      } catch {
        // Unsupported or unreadable formats are still returned as files.
      }
    }
    const id = crypto.randomUUID();
    await fsp.writeFile(uploadPath(id), bytes);
    try {
      await createUpload({
        id,
        userId,
        filename: name,
        mediaType: storedType,
        category,
        size: bytes.byteLength,
        pageCount,
        extractedText,
        truncated,
      });
    } catch (error) {
      await fsp.rm(uploadPath(id), { force: true });
      throw error;
    }
    savedFiles.push({ uploadId: id, name, mediaType: storedType, fromRun: true });
    return { id, url: `/api/uploads/${id}`, name, mediaType: storedType, size: bytes.byteLength };
  }

  return Object.freeze({
    [RUN_PYTHON_TOOL_NAME]: tool<
      { code: string; timeout_seconds?: number },
      CodeExecutionOutput,
      Record<string, never>
    >({
      description: toolDescription(info),
      inputSchema: z.object({
        code: z.string().min(1).max(MAX_CODE_CHARS).describe("Python 3 source to run"),
        timeout_seconds: z
          .number()
          .int()
          .min(1)
          .max(Math.min(info?.limits.max_timeout_seconds ?? MAX_RUN_SECONDS, MAX_RUN_SECONDS))
          .optional()
          .describe(
            `Wall-clock limit for this run. Defaults to ${info?.limits.timeout_seconds ?? 60}; raise it only for long computations.`,
          ),
      }),
      execute: async ({ code, timeout_seconds }, { abortSignal }) => {
        const { files: sent, omitted } = await inputs();
        const result = await runInSandbox(
          { code, files: sent, timeoutSeconds: timeout_seconds },
          abortSignal,
        );
        const saved: CodeExecutionFile[] = [];
        const runNames = new Set<string>();
        for (const file of result.files) saved.push(await save(file, runNames));
        return {
          exitCode: result.exit_code,
          ...(result.signal ? { signal: result.signal } : {}),
          timedOut: result.timed_out,
          durationMs: result.duration_ms,
          stdout: result.stdout,
          stderr: result.stderr,
          ...(result.stdout_truncated ? { stdoutTruncated: true } : {}),
          ...(result.stderr_truncated ? { stderrTruncated: true } : {}),
          files: saved,
          ...(result.skipped_files.length ? { skippedFiles: result.skipped_files } : {}),
          ...(omitted.length ? { omittedInputs: omitted } : {}),
        };
      },
      toModelOutput: async ({ output }) => {
        if (!isCodeExecutionOutput(output)) {
          return { type: "error-text", value: "This code run is unavailable." };
        }
        const text = formatRun(output, outputChars);
        if (!supportsImageInput) return { type: "text", value: text };
        const images = [];
        for (const file of output.files.filter(isPreviewableImage).slice(0, MAX_MODEL_IMAGES)) {
          const stored = await readFetchedImage(file.url, userId);
          if (stored) images.push(stored);
        }
        if (!images.length) return { type: "text", value: text };
        return {
          type: "content",
          value: [
            { type: "text", text },
            ...images.map((image) => ({
              type: "file" as const,
              mediaType: image.mediaType,
              filename: image.filename,
              data: { type: "data" as const, data: image.data },
            })),
          ],
        };
      },
    }),
  });
}

export type CodeExecutionTools = ReturnType<typeof createCodeExecutionTools>;

function block(label: string, text: string, truncated?: boolean): string {
  return text ? `${label}${truncated ? " (truncated)" : ""}:\n${text.replace(/\n$/, "")}` : "";
}

/** Keeps the start and end of long output, at line breaks where possible. */
function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let head = text.slice(0, Math.floor(limit * 0.7));
  const headBreak = head.lastIndexOf("\n");
  if (headBreak >= head.length * 0.8) head = head.slice(0, headBreak + 1);
  let tail = text.slice(text.length - (limit - head.length));
  const tailBreak = tail.indexOf("\n");
  if (tailBreak >= 0 && tailBreak < tail.length * 0.2) tail = tail.slice(tailBreak + 1);
  const omitted = text.length - head.length - tail.length;
  return `${head}${head.endsWith("\n") ? "" : "\n"}[${omitted} characters omitted]\n${tail}`;
}

/** Splits a character budget between two outputs; a short one keeps all of it. */
function share(first: number, second: number, total: number): [number, number] {
  if (first + second <= total) return [first, second];
  const half = Math.floor(total / 2);
  if (first <= half) return [first, total - first];
  if (second <= half) return [total - second, second];
  return [half, total - half];
}

/**
 * What the model reads about a run: status, output, and the files it made.
 * Printed output beyond `outputChars` keeps its start and end.
 */
export function formatRun(output: CodeExecutionOutput, outputChars = Infinity): string {
  const seconds = `${(output.durationMs / 1000).toFixed(1)}s`;
  const [stdoutChars, stderrChars] = share(output.stdout.length, output.stderr.length, outputChars);
  const status = output.timedOut
    ? `Stopped after reaching the time limit (${seconds}).`
    : output.signal
      ? `Stopped by ${output.signal} after ${seconds}.`
      : `Exit code ${output.exitCode} after ${seconds}.`;
  const files = output.files.length
    ? `Saved files (later runs read them from ${SANDBOX_UPLOADS_DIR}/<name>; link finished ones in your reply):\n${output.files
        .map((file) => `- ${file.name} (${file.mediaType}, ${formatSize(file.size)})`)
        .join("\n")}`
    : "";
  const skipped = output.skippedFiles?.length
    ? `Not returned: ${output.skippedFiles.map((file) => `${file.path} (${file.reason})`).join(", ")}`
    : "";
  const omitted = output.omittedInputs?.length
    ? `Left out of this run because of size limits: ${output.omittedInputs.join(", ")}`
    : "";
  return [
    status,
    block(
      "stdout",
      clip(output.stdout, stdoutChars),
      output.stdoutTruncated || output.stdout.length > stdoutChars,
    ),
    block(
      "stderr",
      clip(output.stderr, stderrChars),
      output.stderrTruncated || output.stderr.length > stderrChars,
    ),
    files,
    skipped,
    omitted,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function isCodeExecutionOutput(value: unknown): value is CodeExecutionOutput {
  if (!value || typeof value !== "object") return false;
  const output = value as Partial<CodeExecutionOutput>;
  return (
    (output.exitCode === null || typeof output.exitCode === "number") &&
    typeof output.timedOut === "boolean" &&
    typeof output.durationMs === "number" &&
    typeof output.stdout === "string" &&
    typeof output.stderr === "string" &&
    Array.isArray(output.files) &&
    output.files.every(isCodeExecutionFile)
  );
}
